#include <gba.h>
#include <stdint.h>

#include "dialogue.h"
#include "font_data.h"
#include "input.h"
#include "state.h"   /* var_get() - variable interpolation */

/*
 * The dialogue box lives on its own background, BG1, so it always
 * draws on top of the scene (BG0) and the sprites (see sprite.c and
 * background.c for the priority ordering: BG1=0, OBJ=1, BG0=2).
 *
 * VRAM layout for BG1 (deliberately far from BG0's char blocks 0-1
 * and screen blocks 28-31, see background.c):
 *
 *   char base block 2   0x06008000   font tiles (95 glyphs, 3040 bytes -
 *                                     well under this block's 16KB)
 *   screen base block 23 0x0600B800  tilemap (32x32 tiles)
 *
 * The font uses BG palette bank 15, which compiler/build_project.py
 * reserves - scene backgrounds are capped at 15 banks (0-14) so this
 * one is always free.
 */
#define DLG_CHAR_BASE_BLOCK    2
#define DLG_SCREEN_BASE_BLOCK  23
#define DLG_PALETTE_BANK       15

#define DLG_TILES \
    ((volatile uint16_t *)(0x06000000 + DLG_CHAR_BASE_BLOCK * 0x4000))

#define DLG_MAP \
    ((volatile uint16_t *)(0x06000000 + DLG_SCREEN_BASE_BLOCK * 0x800))

#define BG_PAL ((volatile uint16_t *)0x05000000)

/* Screen is 240x160px = 30x20 tiles. Box = bottom 4 rows, full width. */
#define BOX_TOP_ROW    16
#define BOX_ROWS       4
#define BOX_COLS       30

/* Text sits one tile in from the box edges, leaving room to grow. */
#define TEXT_MARGIN_X  1
#define TEXT_MARGIN_Y  1
#define TEXT_MAX_COLS  (BOX_COLS - TEXT_MARGIN_X * 2)   /* 28 */
#define TEXT_MAX_ROWS  (BOX_ROWS - TEXT_MARGIN_Y * 2)   /*  2 */

/*
 * Tile layout in char block 2:
 *   tile 0        reserved, all-zero pixels - genuinely transparent,
 *                 so BG1 cells that were never drawn into show BG0
 *                 (and the sprites) through instead of solid color.
 *   tile 1..95    font glyphs, ASCII 32..126 (space first).
 *
 * The space glyph (tile 1) is entirely box-color, no foreground
 * pixels, so it doubles as the box's blank/fill tile.
 */
#define TRANSPARENT_TILE   0
#define GLYPH_TILE_OFFSET  1
#define BLANK_TILE         GLYPH_TILE_OFFSET   /* tile for ' ' */

/* A general menu has no prompt line of its own, so it gets the whole
 * box - one option per row. */
#define MENU_MAX_OPTIONS   BOX_ROWS

static int dlg_active = 0;

/* Current dialogue string and where the current page starts. */
static const char *dlg_text = 0;
static const char *dlg_page_start = 0;

/* Choice-mode state (dialogue_show_choice()). dlg_is_choice is only
 * ever set while dlg_active is also set - see dialogue_update(). */
static int dlg_is_choice = 0;
static int dlg_choice_cursor = 0;
static int dlg_last_choice = 0;
static const char *dlg_choice_a_start = 0;
static const char *dlg_choice_a_end = 0;
static const char *dlg_choice_b_start = 0;
static const char *dlg_choice_b_end = 0;

/* Menu-mode state (dialogue_show_menu()) - same idea as choice-mode
 * above, generalized to 2..MENU_MAX_OPTIONS options. dlg_is_menu is
 * only ever set while dlg_active is also set. Shares dlg_last_choice
 * with choice-mode - only one of the two is ever active at once. */
static int dlg_is_menu = 0;
static int menu_option_count = 0;
static int menu_cursor = 0;
static const char *menu_option_start[MENU_MAX_OPTIONS];
static const char *menu_option_end[MENU_MAX_OPTIONS];

static void put_tile(int row, int col, uint16_t tile_index)
{
    if (row < 0 || row >= 32 || col < 0 || col >= 32)
        return;

    DLG_MAP[row * 32 + col] =
        (tile_index & 0x3FF) |
        ((uint16_t)DLG_PALETTE_BANK << 12);
}

static uint16_t char_tile(char ch)
{
    if (ch < FONT_FIRST_CHAR || ch > FONT_LAST_CHAR)
        return BLANK_TILE;

    return (uint16_t)(ch - FONT_FIRST_CHAR) + GLYPH_TILE_OFFSET;
}

/*
 * Variable interpolation: compiler/build_project.py's interpolate_vars()
 * turns a JSON "{varname}" into two raw bytes in the compiled string -
 * 0x02, then that variable's index (0..255, always < MAX_VARIABLES) -
 * since there's no room to store a whole substring in ScriptEvent.
 * Every place below that walks one of these strings byte-by-byte has
 * to treat that pair as a single atomic unit: skip both together when
 * just scanning past it (page_end(), find_char_or_end()), or expand it
 * to the variable's current decimal value when actually measuring/
 * drawing text (expand_word(), expand_range(), via this shared
 * helper). Without that, an index byte that happens to collide with
 * '\n' (10) or '\x01' (1, the choice/menu option separator) would
 * corrupt an unrelated scan.
 *
 * `p` must point at the 0x02 byte; appends the digits (with a leading
 * '-' if negative) to buf[*len_ref], clipped to buf_max, and always
 * returns 2 (how many source bytes the marker occupied), so callers
 * can just do `p += expand_marker(...)`.
 */
static int expand_marker(const char *p, char *buf, int *len_ref, int buf_max)
{
    int idx = (unsigned char)p[1];
    int value = var_get(idx);
    char digits[8];
    int n = 0;

    if (value < 0)
    {
        if (*len_ref < buf_max - 1)
            buf[(*len_ref)++] = '-';
        value = -value;
    }

    do
    {
        digits[n++] = (char)('0' + (value % 10));
        value /= 10;
    } while (value > 0 && n < (int)sizeof(digits));

    while (n > 0 && *len_ref < buf_max - 1)
        buf[(*len_ref)++] = digits[--n];

    return 2;
}

/*
 * Expands the next "word" (up to the next space or `end`) starting at
 * `*p_ref` into `buf` (clipped to buf_max-1 chars, not null-
 * terminated - callers track the length themselves, same as the raw-
 * byte-range code this replaced), substituting any embedded variable
 * reference via expand_marker() above. Advances *p_ref past the word
 * (not past any trailing spaces). Returns the expanded word's length.
 */
static int expand_word(const char **p_ref, const char *end, char *buf, int buf_max)
{
    const char *p = *p_ref;
    int len = 0;

    while (p < end && *p != ' ')
    {
        if (*p == '\x02' && p + 1 < end)
            p += expand_marker(p, buf, &len, buf_max);
        else
        {
            if (len < buf_max - 1)
                buf[len++] = *p;
            p++;
        }
    }

    *p_ref = p;
    return len;
}

/*
 * Same idea as expand_word(), but expands the WHOLE [start,end) range
 * rather than stopping at spaces - for draw_range() below, which
 * doesn't word-wrap so has no reason to stop early.
 */
static int expand_range_text(const char *start, const char *end, char *buf, int buf_max)
{
    const char *p = start;
    int len = 0;

    while (p < end)
    {
        if (*p == '\x02' && p + 1 < end)
            p += expand_marker(p, buf, &len, buf_max);
        else
        {
            if (len < buf_max - 1)
                buf[len++] = *p;
            p++;
        }
    }

    return len;
}

/* Fill the whole box with blank tiles (opaque box color, no text). */
static void clear_box(void)
{
    for (int r = 0; r < BOX_ROWS; r++)
        for (int c = 0; c < BOX_COLS; c++)
            put_tile(BOX_TOP_ROW + r, c, BLANK_TILE);
}

/*
 * Set every cell of BG1's tilemap to the transparent tile. Run once
 * at startup so that, before anything has drawn into the box area,
 * the whole layer is see-through rather than showing raw VRAM zero
 * (which happens to land on an opaque tile/bank combination).
 */
static void clear_whole_tilemap(void)
{
    for (int r = 0; r < 32; r++)
        for (int c = 0; c < 32; c++)
            put_tile(r, c, TRANSPARENT_TILE);
}

/*
 * Draw one page: greedy word-wrap across TEXT_MAX_ROWS lines of
 * TEXT_MAX_COLS characters. Words that don't fit past TEXT_MAX_ROWS
 * are silently dropped - keep pages short. A word containing a
 * variable reference is measured/drawn by its EXPANDED length (e.g.
 * "{score}" might become "-32768", 6 characters, not the 2 raw source
 * bytes it's stored as) - see expand_word().
 */
static void draw_page(const char *start, const char *end)
{
    clear_box();

    int row = 0;
    int col = 0;
    const char *p = start;

    while (p < end && row < TEXT_MAX_ROWS)
    {
        char word[TEXT_MAX_COLS + 1];
        int word_len = expand_word(&p, end, word, sizeof(word));

        if (word_len > TEXT_MAX_COLS)
            word_len = TEXT_MAX_COLS;

        if (col > 0 && col + 1 + word_len > TEXT_MAX_COLS)
        {
            row++;
            col = 0;

            if (row >= TEXT_MAX_ROWS)
                break;
        }
        else if (col > 0)
        {
            col++;   /* space before this word */
        }

        for (int i = 0; i < word_len; i++)
        {
            put_tile(
                BOX_TOP_ROW + TEXT_MARGIN_Y + row,
                TEXT_MARGIN_X + col + i,
                char_tile(word[i])
            );
        }

        col += word_len;

        while (p < end && *p == ' ')
            p++;
    }
}

/* Find the end of the current page: the next '\n', or end of string -
 * skipping over any variable-reference marker pair as one atomic unit
 * (see expand_marker()'s comment) so an index byte that happens to
 * equal '\n' (10) can't be mistaken for a page break. */
static const char *page_end(const char *page_start)
{
    const char *p = page_start;

    while (*p != 0 && *p != '\n')
    {
        if (*p == '\x02' && p[1] != 0)
            p += 2;
        else
            p++;
    }

    return p;
}

static void show_current_page(void)
{
    draw_page(dlg_page_start, page_end(dlg_page_start));
}

/* Find the next occurrence of `target`, or the string's real end - used
 * to split a packed "a\x01b\x01c" choice/menu string into (start,end)
 * pointer pairs without ever mutating it (it's a ROM string literal).
 * Skips over variable-reference marker pairs atomically (see
 * expand_marker()'s comment) so an index byte that happens to equal
 * '\x01' can't be mistaken for a separator. */
static const char *find_char_or_end(const char *start, char target)
{
    const char *p = start;

    while (*p != 0 && *p != target)
    {
        if (*p == '\x02' && p[1] != 0)
            p += 2;
        else
            p++;
    }

    return p;
}

/*
 * Draw one line of text, clipped to TEXT_MAX_COLS - no word-wrap.
 * `row` is relative to BOX_TOP_ROW, `col` is absolute within the box
 * (see draw_choice_options()/draw_menu_options() below for how it's
 * used). Choice/menu labels are meant to be short; unlike draw_page(),
 * this never spills onto a second line. Expands any variable reference
 * in [start,end) the same way draw_page()'s words do - see
 * expand_range_text().
 */
static void draw_range(int row, int col, const char *start, const char *end)
{
    char text[BOX_COLS + 1];
    int n = expand_range_text(start, end, text, sizeof(text));
    int max_n = BOX_COLS - col;

    if (n > max_n)
        n = max_n;

    for (int i = 0; i < n; i++)
        put_tile(BOX_TOP_ROW + row, col + i, char_tile(text[i]));
}

/* Redraws the cursor + both option lines - called on open and on every
 * Up/Down while a choice is showing. */
static void draw_choice_options(void)
{
    put_tile(BOX_TOP_ROW + 2, TEXT_MARGIN_X,
              (dlg_choice_cursor == 0) ? char_tile('>') : BLANK_TILE);
    draw_range(2, TEXT_MARGIN_X + 2, dlg_choice_a_start, dlg_choice_a_end);

    put_tile(BOX_TOP_ROW + 3, TEXT_MARGIN_X,
              (dlg_choice_cursor == 1) ? char_tile('>') : BLANK_TILE);
    draw_range(3, TEXT_MARGIN_X + 2, dlg_choice_b_start, dlg_choice_b_end);
}

/* Redraws the cursor + every option line - called on open and on every
 * Up/Down while a menu is showing. One row per option, no prompt row
 * (unlike draw_choice_options() above) - see dialogue_show_menu(). */
static void draw_menu_options(void)
{
    for (int i = 0; i < menu_option_count; i++)
    {
        put_tile(BOX_TOP_ROW + i, TEXT_MARGIN_X,
                  (i == menu_cursor) ? char_tile('>') : BLANK_TILE);
        draw_range(i, TEXT_MARGIN_X + 2, menu_option_start[i], menu_option_end[i]);
    }
}

void dialogue_init(void)
{
    /* Tile 0: all-zero, genuinely transparent. */
    for (int i = 0; i < 16; i++)
        DLG_TILES[i] = 0;

    /* Font tiles + palette are static for the whole game - load once,
     * starting one tile in (tile 0 is the transparent tile above). */
    uint32_t halfwords = sizeof(font_tiles) / 2;

    for (uint32_t i = 0; i < halfwords; i++)
    {
        DLG_TILES[16 + i] =
            font_tiles[i * 2] |
            ((uint16_t)font_tiles[i * 2 + 1] << 8);
    }

    volatile uint16_t *pal = BG_PAL + DLG_PALETTE_BANK * 16;
    for (int i = 0; i < 16; i++)
        pal[i] = font_palette[i];

    REG_BG1CNT =
        (0 << 0) |                     /* priority 0 - always on top */
        (DLG_CHAR_BASE_BLOCK << 2) |
        (DLG_SCREEN_BASE_BLOCK << 8);

    REG_BG1HOFS = 0;
    REG_BG1VOFS = 0;

    clear_whole_tilemap();

    dlg_active = 0;
}

void dialogue_show(const char *text)
{
    dlg_text = text;
    dlg_page_start = text;
    dlg_active = 1;

    show_current_page();

    REG_DISPCNT |= BG1_ENABLE;
}

int dialogue_active(void)
{
    return dlg_active;
}

void dialogue_show_choice(const char *packed)
{
    const char *p0_end = find_char_or_end(packed, '\x01');
    const char *p1 = (*p0_end == '\x01') ? p0_end + 1 : p0_end;
    const char *p1_end = find_char_or_end(p1, '\x01');
    const char *p2 = (*p1_end == '\x01') ? p1_end + 1 : p1_end;
    const char *p2_end = find_char_or_end(p2, '\x01');

    dlg_choice_a_start = p1;
    dlg_choice_a_end = p1_end;
    dlg_choice_b_start = p2;
    dlg_choice_b_end = p2_end;

    dlg_is_choice = 1;
    dlg_choice_cursor = 0;
    dlg_active = 1;

    clear_box();
    draw_range(0, TEXT_MARGIN_X, packed, p0_end);
    draw_choice_options();

    REG_DISPCNT |= BG1_ENABLE;
}

void dialogue_show_menu(const char *packed, int option_count)
{
    if (option_count < 2)
        option_count = 2;
    if (option_count > MENU_MAX_OPTIONS)
        option_count = MENU_MAX_OPTIONS;

    const char *p = packed;
    for (int i = 0; i < option_count; i++)
    {
        menu_option_start[i] = p;
        const char *seg_end = find_char_or_end(p, '\x01');
        menu_option_end[i] = seg_end;
        p = (*seg_end == '\x01') ? seg_end + 1 : seg_end;
    }

    menu_option_count = option_count;
    menu_cursor = 0;
    dlg_is_menu = 1;
    dlg_active = 1;

    clear_box();
    draw_menu_options();

    REG_DISPCNT |= BG1_ENABLE;
}

int dialogue_last_choice(void)
{
    return dlg_last_choice;
}

void dialogue_update(void)
{
    if (!dlg_active)
        return;

    if (dlg_is_choice)
    {
        if (input_pressed(INPUT_UP) || input_pressed(INPUT_DOWN))
        {
            dlg_choice_cursor ^= 1;   /* only ever two options */
            draw_choice_options();
        }

        if (input_pressed(INPUT_A))
        {
            dlg_last_choice = dlg_choice_cursor;
            dlg_is_choice = 0;
            dlg_active = 0;
            REG_DISPCNT &= ~BG1_ENABLE;
        }

        return;
    }

    if (dlg_is_menu)
    {
        if (input_pressed(INPUT_UP))
        {
            menu_cursor = (menu_cursor - 1 + menu_option_count) % menu_option_count;
            draw_menu_options();
        }
        else if (input_pressed(INPUT_DOWN))
        {
            menu_cursor = (menu_cursor + 1) % menu_option_count;
            draw_menu_options();
        }

        if (input_pressed(INPUT_A))
        {
            dlg_last_choice = menu_cursor;
            dlg_is_menu = 0;
            dlg_active = 0;
            REG_DISPCNT &= ~BG1_ENABLE;
        }

        return;
    }

    if (!input_pressed(INPUT_A))
        return;

    const char *end = page_end(dlg_page_start);

    if (*end == '\n')
    {
        /* More pages left. */
        dlg_page_start = end + 1;
        show_current_page();
        return;
    }

    /* That was the last page - close the box. */
    dlg_active = 0;
    REG_DISPCNT &= ~BG1_ENABLE;
}
