#include <gba.h>
#include <stdint.h>

#include "ui.h"

/*
 * BG1 VRAM layout (deliberately far from BG0's char blocks 0-1 and
 * screen blocks 28-31, see background.c):
 *
 *   char base block 2    0x06008000
 *     tile 0             transparent (all zero)
 *     tiles 1-9          current frame, 3x3
 *     tiles 16-127       dialogue canvas, 4 lines x 28 tiles
 *     tiles 128-247      debug HUD canvas, 4 rows x 30 tiles
 *   screen base block 23 0x0600B800 (= tile 448 of block 2, so tiles
 *                        must stay below that)
 *
 * Palette: BG bank 15, which the compiler keeps free of scene colours.
 */
#define UI_CHAR_BLOCK    2
#define UI_SCREEN_BLOCK  23
#define PALETTE_BANK       15

#define UI_TILES   ((volatile uint32_t *)(0x06000000 + UI_CHAR_BLOCK * 0x4000))
#define UI_MAP     ((volatile uint16_t *)(0x06000000 + UI_SCREEN_BLOCK * 0x800))
#define BG_PAL  ((volatile uint16_t *)0x05000000)

#define FRAME_TILE     1
#define BOX_TILE       16
#define HUD_TILE       128
#define BOX_COLS       28
#define HUD_COLS       30
#define SCREEN_ROWS    20

static uint32_t box_canvas[UI_MAX_LINES * BOX_COLS][8] EWRAM_BSS;
static uint32_t hud_canvas[UI_HUD_ROWS * HUD_COLS][8] EWRAM_BSS;

static int cur_font;
static int cur_frame;
static int cur_speed;
static int box_lines;
static int box_top = -1;
static int box_rows;        /* screen rows the box covers, frame included */
static int box_framed = 1;

static void put(int row, int col, int tile)
{
    if (row < 0 || row >= 32 || col < 0 || col >= 32)
        return;
    UI_MAP[row * 32 + col] = (uint16_t)((tile & 0x3FF) | (PALETTE_BANK << 12));
}

static void load_frame_tiles(void)
{
    const uint32_t *src = ui_frames[cur_frame];
    for (int i = 0; i < 72; i++)
        UI_TILES[FRAME_TILE * 8 + i] = src[i];
}

void ui_init(void)
{
    for (int i = 0; i < 8; i++)
        UI_TILES[i] = 0;

    for (int i = 0; i < 16; i++)
        BG_PAL[PALETTE_BANK * 16 + i] = ui_palette[i];

    cur_font = ui_default_font < ui_font_count ? ui_default_font : 0;
    cur_frame = ui_default_frame < ui_frame_count ? ui_default_frame : 0;
    cur_speed = ui_default_text_speed;
    load_frame_tiles();

    REG_BG1CNT = (0 << 0) |              /* priority 0: above scene and sprites */
                 (UI_CHAR_BLOCK << 2) |
                 (UI_SCREEN_BLOCK << 8);
    REG_BG1HOFS = 0;
    REG_BG1VOFS = 0;

    for (int i = 0; i < 32 * 32; i++)
        UI_MAP[i] = PALETTE_BANK << 12;   /* tile 0: see-through */
    box_top = -1;
}

void ui_set_font(int font)
{
    if (font >= 0 && font < ui_font_count)
        cur_font = font;
}

void ui_set_frame(int frame)
{
    if (frame >= 0 && frame < ui_frame_count && frame != cur_frame)
    {
        cur_frame = frame;
        load_frame_tiles();
    }
}

void ui_set_speed(int frames_per_char)
{
    if (frames_per_char >= 0 && frames_per_char <= 255)
        cur_speed = frames_per_char;
}

int ui_font(void) { return cur_font; }
int ui_speed(void) { return cur_speed; }

static const uint32_t *glyph(int font, unsigned char ch, int *width)
{
    if (font < 0 || font >= ui_font_count)
        return 0;
    const UiFont *f = &ui_fonts[font];
    int i = (int)ch - f->first;
    if (i < 0 || i >= f->count)
    {
        i = '?' - f->first;
        if (i < 0 || i >= f->count)
            return 0;
    }
    *width = f->widths[i];
    return f->glyphs + i * 8;
}

int ui_char_width(int font, unsigned char ch)
{
    int w = 0;
    return glyph(font, ch, &w) ? w : 0;
}

/* OR one row of 4bpp pixels into a canvas row at pixel x (non-zero
 * pixels replace what's there, zero ones leave it). */
static void blit_row(uint32_t (*canvas)[8], int cols, int line, int x, int y, uint32_t row)
{
    if (!row || x < 0)
        return;
    uint32_t mask = row | (row >> 1) | (row >> 2) | (row >> 3);
    mask = (mask & 0x11111111u) * 0xF;
    int col = x >> 3;
    int shift = (x & 7) * 4;
    if (col < cols)
    {
        uint32_t *w = &canvas[line * cols + col][y];
        *w = (*w & ~(mask << shift)) | (row << shift);
    }
    if (shift && col + 1 < cols)
    {
        uint32_t *w = &canvas[line * cols + col + 1][y];
        *w = (*w & ~(mask >> (32 - shift))) | (row >> (32 - shift));
    }
}

/* A glyph row with every `ink` pixel changed to `color`. */
static uint32_t recolor(uint32_t row, int ink, int color)
{
    uint32_t out = row;
    for (int i = 0; i < 8; i++)
    {
        int shift = i * 4;
        if (((row >> shift) & 0xF) == (uint32_t)ink)
            out = (out & ~(0xFu << shift)) | ((uint32_t)color << shift);
    }
    return out;
}

static void draw_char(uint32_t (*canvas)[8], int cols, int line, int x, int font, unsigned char ch, int color)
{
    int w = 0;
    const uint32_t *g = glyph(font, ch, &w);
    if (!g)
        return;
    int ink = ui_fonts[font].ink;
    for (int y = 0; y < 8; y++)
        blit_row(canvas, cols, line, x, y, color && ink ? recolor(g[y], ink, color & 0xF) : g[y]);
}

void ui_box_clear(void)
{
    static const uint32_t clear[8];
    const uint32_t *fill = box_framed ? &ui_frames[cur_frame][4 * 8] : clear;
    for (int t = 0; t < UI_MAX_LINES * BOX_COLS; t++)
        for (int y = 0; y < 8; y++)
            box_canvas[t][y] = fill[y];
}

/* Blank the screen rows the last box covered. */
static void clear_box_rows(void)
{
    if (box_top >= 0)
        for (int r = box_top; r < box_top + box_rows && r < SCREEN_ROWS; r++)
            for (int c = 0; c < 30; c++)
                put(r, c, 0);
}

void ui_box_open(int lines)
{
    ui_box_open_ex(lines, UI_BOX_BOTTOM, 1);
}

void ui_box_open_ex(int lines, int position, int framed)
{
    if (lines < 1)
        lines = 1;
    if (lines > UI_MAX_LINES)
        lines = UI_MAX_LINES;

    /* Clear the rows a box of another size or place used before. */
    clear_box_rows();

    box_lines = lines;
    box_framed = framed != 0;
    box_rows = lines + (box_framed ? 2 : 0);
    if (position == UI_BOX_TOP)
        box_top = 0;
    else if (position == UI_BOX_MIDDLE)
        box_top = (SCREEN_ROWS - box_rows) / 2;
    else
        box_top = SCREEN_ROWS - box_rows;
    int text_top = box_top + (box_framed ? 1 : 0);

    if (box_framed)
    {
        int bottom = box_top + box_rows - 1;
        put(box_top, 0, FRAME_TILE + 0);
        put(box_top, 29, FRAME_TILE + 2);
        put(bottom, 0, FRAME_TILE + 6);
        put(bottom, 29, FRAME_TILE + 8);
        for (int c = 1; c < 29; c++)
        {
            put(box_top, c, FRAME_TILE + 1);
            put(bottom, c, FRAME_TILE + 7);
        }
    }
    for (int l = 0; l < lines; l++)
    {
        int r = text_top + l;
        put(r, 0, box_framed ? FRAME_TILE + 3 : 0);
        put(r, 29, box_framed ? FRAME_TILE + 5 : 0);
        for (int c = 0; c < BOX_COLS; c++)
            put(r, 1 + c, BOX_TILE + l * BOX_COLS + c);
    }

    ui_box_clear();
    ui_box_flush();
    REG_DISPCNT |= BG1_ENABLE;
}

void ui_box_close(void)
{
    clear_box_rows();
    box_top = -1;
    box_framed = 1;
    /* The debug HUD shares BG1; keep the layer on while it's showing. */
    int hud = 0;
    for (int t = 0; t < UI_HUD_ROWS * HUD_COLS && !hud; t++)
        for (int y = 0; y < 8; y++)
            if (hud_canvas[t][y]) { hud = 1; break; }
    if (!hud)
        REG_DISPCNT &= ~BG1_ENABLE;
}

void ui_box_char(int line, int x, int font, unsigned char ch)
{
    ui_box_char_color(line, x, font, ch, 0);
}

void ui_box_char_color(int line, int x, int font, unsigned char ch, int color)
{
    if (line >= 0 && line < box_lines)
        draw_char(box_canvas, BOX_COLS, line, x, font, ch, color);
}

void ui_box_cursor(int line, int x)
{
    if (line < 0 || line >= box_lines)
        return;
    for (int y = 0; y < 8; y++)
        blit_row(box_canvas, BOX_COLS, line, x, y, ui_cursor[y]);
}

void ui_box_flush(void)
{
    volatile uint32_t *dst = UI_TILES + BOX_TILE * 8;
    for (int t = 0; t < box_lines * BOX_COLS; t++)
        for (int y = 0; y < 8; y++)
            dst[t * 8 + y] = box_canvas[t][y];
}

void ui_hud_clear(void)
{
    for (int t = 0; t < UI_HUD_ROWS * HUD_COLS; t++)
        for (int y = 0; y < 8; y++)
            hud_canvas[t][y] = 0;
}

void ui_hud_text(int row, int x, const char *text)
{
    if (row < 0 || row >= UI_HUD_ROWS)
        return;
    for (; *text && x < HUD_COLS * 8; text++)
    {
        unsigned char ch = (unsigned char)*text;
        draw_char(hud_canvas, HUD_COLS, row, x, cur_font, ch, 0);
        x += ui_char_width(cur_font, ch);
    }
}

void ui_hud_flush(void)
{
    volatile uint32_t *dst = UI_TILES + HUD_TILE * 8;
    int any = 0;
    for (int t = 0; t < UI_HUD_ROWS * HUD_COLS; t++)
        for (int y = 0; y < 8; y++)
        {
            dst[t * 8 + y] = hud_canvas[t][y];
            any |= hud_canvas[t][y] != 0;
        }
    for (int r = 0; r < UI_HUD_ROWS; r++)
        for (int c = 0; c < HUD_COLS; c++)
            put(r, c, any ? HUD_TILE + r * HUD_COLS + c : 0);
    if (any)
        REG_DISPCNT |= BG1_ENABLE;
    else if (box_top < 0)
        REG_DISPCNT &= ~BG1_ENABLE;
}
