#include <gba.h>
#include <stdint.h>

#include "ui.h"
#include "state.h"   /* var_get() - variables in screen text */

/*
 * BG1 VRAM layout (deliberately far from BG0's char blocks 0-1 and
 * screen blocks 28-31, see background.c):
 *
 *   char base block 2    0x06008000
 *     tile 0             transparent (all zero)
 *     tiles 1-9          current frame, 3x3
 *     tiles 16-127       dialogue canvas, 4 lines x 28 tiles
 *     tiles 128-447      screen text ("Draw Text"), 40 per slot
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
#define LABEL_TILE     128
#define LABEL_TILES    40     /* text tiles per screen-text slot */
#define BOX_COLS       28
#define SCREEN_ROWS    20

static uint32_t box_canvas[UI_MAX_LINES * BOX_COLS][8] EWRAM_BSS;

typedef struct
{
    uint8_t active, framed, col, row, cols, lines;
    uint16_t frames_left;   /* 0 = stays until cleared */
} Label;
static Label labels[UI_LABEL_MAX];
static uint32_t label_canvas[UI_LABEL_MAX][LABEL_TILES][8] EWRAM_BSS;
static void labels_refresh(void);
static void labels_reflush(void);
static int labels_any(void);

static int cur_font;
static int cur_frame;
static int cur_speed;
static int box_lines;
static int box_top = -1;
static int box_rows;        /* screen rows the box covers, frame included */
static int box_framed = 1;
static int box_left = 0;    /* screen column of the box's left edge */
static int box_cols = 30;   /* screen columns it covers, frame included */
static int text_cols = BOX_COLS;   /* text tiles per line */

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

/* After something else used BG1's VRAM (a cutscene): put the palette,
 * frame tiles and an empty map back, keeping the current font/speed. */
void ui_restore_vram(void)
{
    for (int i = 0; i < 8; i++)
        UI_TILES[i] = 0;
    for (int i = 0; i < 16; i++)
        BG_PAL[PALETTE_BANK * 16 + i] = ui_palette[i];
    load_frame_tiles();
    REG_BG1CNT = (0 << 0) | (UI_CHAR_BLOCK << 2) | (UI_SCREEN_BLOCK << 8);
    for (int i = 0; i < 32 * 32; i++)
        UI_MAP[i] = PALETTE_BANK << 12;
    box_top = -1;
    box_framed = 1;
    box_left = 0;
    box_cols = 30;
    text_cols = BOX_COLS;
    labels_reflush();
    labels_refresh();
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

/* Blank the screen area the last box covered. */
static void clear_box_rows(void)
{
    if (box_top >= 0)
        for (int r = box_top; r < box_top + box_rows && r < SCREEN_ROWS; r++)
            for (int c = box_left; c < box_left + box_cols && c < 30; c++)
                put(r, c, 0);
}

void ui_box_open(int lines)
{
    ui_box_open_ex(lines, UI_BOX_BOTTOM, 1);
}

int ui_text_width(void)
{
    return text_cols * 8;
}

void ui_box_open_ex(int lines, int position, int framed)
{
    if (lines < 1)
        lines = 1;
    if (lines > UI_MAX_LINES)
        lines = UI_MAX_LINES;
    int rows = lines + (framed ? 2 : 0);
    int top = position == UI_BOX_TOP ? 0 : position == UI_BOX_MIDDLE ? (SCREEN_ROWS - rows) / 2 : SCREEN_ROWS - rows;
    ui_box_open_at(lines, 0, top, 30, framed);
}

void ui_box_open_at(int lines, int col, int row, int width, int framed)
{
    if (lines < 1)
        lines = 1;
    if (lines > UI_MAX_LINES)
        lines = UI_MAX_LINES;

    /* Clear the area a box of another size or place used before. */
    clear_box_rows();

    box_lines = lines;
    box_framed = framed != 0;
    box_rows = lines + (box_framed ? 2 : 0);

    /* Fit on screen: at least one text tile, at most the canvas's 28. */
    int min_w = box_framed ? 3 : 1;
    if (width < min_w) width = min_w;
    if (width > 30) width = 30;
    if (col < 0) col = 0;
    if (col + width > 30) col = 30 - width;
    if (row < 0) row = 0;
    if (row + box_rows > SCREEN_ROWS) row = SCREEN_ROWS - box_rows;
    box_left = col;
    box_cols = width;
    box_top = row;

    /* A full-width box keeps its text one tile in from each side, framed
     * or not, as before; otherwise the text fills inside the frame. */
    int text_left = box_framed ? col + 1 : (width == 30 ? 1 : col);
    text_cols = box_framed ? width - 2 : (width == 30 ? BOX_COLS : width);
    if (text_cols > BOX_COLS) text_cols = BOX_COLS;
    int text_top = box_top + (box_framed ? 1 : 0);
    int right = col + width - 1;

    if (box_framed)
    {
        int bottom = box_top + box_rows - 1;
        put(box_top, col, FRAME_TILE + 0);
        put(box_top, right, FRAME_TILE + 2);
        put(bottom, col, FRAME_TILE + 6);
        put(bottom, right, FRAME_TILE + 8);
        for (int c = col + 1; c < right; c++)
        {
            put(box_top, c, FRAME_TILE + 1);
            put(bottom, c, FRAME_TILE + 7);
        }
    }
    for (int l = 0; l < lines; l++)
    {
        int r = text_top + l;
        if (box_framed)
        {
            put(r, col, FRAME_TILE + 3);
            put(r, right, FRAME_TILE + 5);
        }
        for (int c = 0; c < text_cols; c++)
            put(r, text_left + c, BOX_TILE + l * BOX_COLS + c);
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
    box_left = 0;
    box_cols = 30;
    text_cols = BOX_COLS;
    /* Screen text shares BG1: put back what the box covered. */
    labels_refresh();
    if (!labels_any())
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

/* ------------------------------------------------------------------ */
/* Screen text                                                          */

/* Walk compiled text: returns the widest line in px (and the line count);
 * with `draw`, also draws it into slot's canvas, `cols` tiles a line. */
static int label_text(const unsigned char *s, int slot, int cols, int draw, int *lines_out)
{
    int font = cur_font, color = 0, x = 0, line = 0, widest = 0;
    for (; *s; s++)
    {
        unsigned char ch = *s;
        if (ch == '\n')
        {
            if (x > widest)
                widest = x;
            x = 0;
            if (line + 1 >= UI_MAX_LINES)
                break;
            line++;
            continue;
        }
        if ((ch == UI_CODE_FONT || ch == UI_CODE_COLOR || ch == UI_CODE_SPEED ||
             ch == UI_CODE_VAR || ch == UI_CODE_VAR_HI) && s[1])
        {
            int arg = s[1] - 1;
            s++;
            if (ch == UI_CODE_FONT)
            {
                if (arg < ui_font_count)
                    font = arg;
            }
            else if (ch == UI_CODE_COLOR)
                color = arg;
            else if (ch != UI_CODE_SPEED)
            {
                int v = var_get(arg + (ch == UI_CODE_VAR_HI ? 128 : 0));
                unsigned int u = v < 0 ? (unsigned int)-v : (unsigned int)v;
                char buf[8];
                int n = 0;
                do { buf[n++] = (char)('0' + u % 10); u /= 10; } while (u);
                if (v < 0)
                    buf[n++] = '-';
                while (n--)
                {
                    if (draw)
                        draw_char(label_canvas[slot], cols, line, x, font, (unsigned char)buf[n], color);
                    x += ui_char_width(font, (unsigned char)buf[n]);
                }
            }
            continue;
        }
        if (ch < 0x20)
            continue;
        if (draw)
            draw_char(label_canvas[slot], cols, line, x, font, ch, color);
        x += ui_char_width(font, ch);
    }
    if (x > widest)
        widest = x;
    if (lines_out)
        *lines_out = line + 1;
    return widest;
}

/* Is screen tile (r, c) under the open dialogue box? */
static int under_box(int r, int c)
{
    return box_top >= 0 && r >= box_top && r < box_top + box_rows && c >= box_left && c < box_left + box_cols;
}

static void label_cell(int r, int c, int tile)
{
    if (!under_box(r, c))
        put(r, c, tile);
}

/* Write a label's map entries (its frame, if any, and its text tiles). */
static void label_put(int slot)
{
    const Label *l = &labels[slot];
    int e = l->framed ? 1 : 0;
    int left = l->col, top = l->row, right = l->col + l->cols + 2 * e - 1, bottom = l->row + l->lines + 2 * e - 1;
    if (e)
    {
        label_cell(top, left, FRAME_TILE + 0);
        label_cell(top, right, FRAME_TILE + 2);
        label_cell(bottom, left, FRAME_TILE + 6);
        label_cell(bottom, right, FRAME_TILE + 8);
        for (int c = left + 1; c < right; c++)
        {
            label_cell(top, c, FRAME_TILE + 1);
            label_cell(bottom, c, FRAME_TILE + 7);
        }
        for (int r = top + 1; r < bottom; r++)
        {
            label_cell(r, left, FRAME_TILE + 3);
            label_cell(r, right, FRAME_TILE + 5);
        }
    }
    for (int ln = 0; ln < l->lines; ln++)
        for (int c = 0; c < l->cols; c++)
            label_cell(top + e + ln, left + e + c, LABEL_TILE + slot * LABEL_TILES + ln * l->cols + c);
}

static void label_unput(int slot)
{
    const Label *l = &labels[slot];
    int e = l->framed ? 1 : 0;
    for (int r = l->row; r < l->row + l->lines + 2 * e; r++)
        for (int c = l->col; c < l->col + l->cols + 2 * e; c++)
            label_cell(r, c, 0);
}

/* Copy a label's canvas to its VRAM tiles. */
static void label_flush(int slot)
{
    volatile uint32_t *dst = UI_TILES + (LABEL_TILE + slot * LABEL_TILES) * 8;
    int n = labels[slot].cols * labels[slot].lines;
    for (int t = 0; t < n; t++)
        for (int y = 0; y < 8; y++)
            dst[t * 8 + y] = label_canvas[slot][t][y];
}

static void labels_refresh(void)
{
    for (int s = 0; s < UI_LABEL_MAX; s++)
        if (labels[s].active)
            label_put(s);
}

static void labels_reflush(void)
{
    for (int s = 0; s < UI_LABEL_MAX; s++)
        if (labels[s].active)
            label_flush(s);
}

static int labels_any(void)
{
    for (int s = 0; s < UI_LABEL_MAX; s++)
        if (labels[s].active)
            return 1;
    return 0;
}

void ui_label_draw(int slot, int col, int row, const char *text, int framed, int frames)
{
    if (slot < 0 || slot >= UI_LABEL_MAX || !text)
        return;
    if (labels[slot].active)
        ui_label_clear(slot);

    int lines = 1;
    int width = label_text((const unsigned char *)text, slot, 0, 0, &lines);
    int e = framed ? 1 : 0;
    int cols = (width + 7) / 8;
    if (cols < 1)
        cols = 1;
    if (cols * lines > LABEL_TILES)
        cols = LABEL_TILES / lines;
    if (cols > 30 - 2 * e)
        cols = 30 - 2 * e;
    if (col < 0) col = 0;
    if (row < 0) row = 0;
    if (col + cols + 2 * e > 30) col = 30 - cols - 2 * e;
    if (row + lines + 2 * e > SCREEN_ROWS) row = SCREEN_ROWS - lines - 2 * e;

    Label *l = &labels[slot];
    l->framed = (uint8_t)e;
    l->col = (uint8_t)col;
    l->row = (uint8_t)row;
    l->cols = (uint8_t)cols;
    l->lines = (uint8_t)lines;
    l->frames_left = (uint16_t)(frames < 0 ? 0 : frames > 0xFFFF ? 0xFFFF : frames);

    static const uint32_t clear[8];
    const uint32_t *fill = e ? &ui_frames[cur_frame][4 * 8] : clear;
    for (int t = 0; t < cols * lines; t++)
        for (int y = 0; y < 8; y++)
            label_canvas[slot][t][y] = fill[y];
    label_text((const unsigned char *)text, slot, cols, 1, 0);
    label_flush(slot);
    l->active = 1;
    label_put(slot);
    REG_DISPCNT |= BG1_ENABLE;
}

void ui_label_clear(int slot)
{
    for (int s = 0; s < UI_LABEL_MAX; s++)
    {
        if ((slot >= 0 && s != slot) || !labels[s].active)
            continue;
        label_unput(s);
        labels[s].active = 0;
    }
    labels_refresh();   /* overlapping ones */
    if (!labels_any() && box_top < 0)
        REG_DISPCNT &= ~BG1_ENABLE;
}

void ui_label_clear_area(int col, int row, int width, int height)
{
    for (int s = 0; s < UI_LABEL_MAX; s++)
    {
        const Label *l = &labels[s];
        int e = l->framed ? 2 : 0;
        if (l->active && l->col < col + width && l->col + l->cols + e > col &&
            l->row < row + height && l->row + l->lines + e > row)
            ui_label_clear(s);
    }
}

void ui_labels_tick(void)
{
    for (int s = 0; s < UI_LABEL_MAX; s++)
        if (labels[s].active && labels[s].frames_left && --labels[s].frames_left == 0)
            ui_label_clear(s);
}
