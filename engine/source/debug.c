#include <gba.h>
#include <stdint.h>

#include "debug.h"
#include "font_data.h"

/*
 * Same VRAM as dialogue.c's box (see that file for the full layout
 * comment) - dialogue_init() already loaded the font tiles/palette
 * at startup, this just draws into unused rows of the same map.
 */
#define DLG_SCREEN_BASE_BLOCK  23
#define DLG_MAP \
    ((volatile uint16_t *)(0x06000000 + DLG_SCREEN_BASE_BLOCK * 0x800))
#define DLG_PALETTE_BANK 15

/* Dialogue/menu box owns rows 16-19 (see dialogue.c). This HUD stays
 * up top, well clear of it. */
#define HUD_TOP_ROW  0
#define HUD_ROWS     4
#define HUD_COLS     30

#define TRANSPARENT_TILE   0
#define GLYPH_TILE_OFFSET  1
#define BLANK_TILE         GLYPH_TILE_OFFSET   /* tile for ' ' */

static int dbg_active = 0;

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

static void clear_hud(void)
{
    for (int r = 0; r < HUD_ROWS; r++)
        for (int c = 0; c < HUD_COLS; c++)
            put_tile(HUD_TOP_ROW + r, c, TRANSPARENT_TILE);
}

static void draw_text(int row, int col, const char *text)
{
    int i;

    for (i = 0; text[i] != 0 && col + i < HUD_COLS; i++)
        put_tile(HUD_TOP_ROW + row, col + i, char_tile(text[i]));
}

/*
 * Hand-rolled signed decimal formatter - avoids pulling sprintf (and
 * its float-formatting baggage) into the ROM just for a couple of
 * debug numbers. Writes into buf (no bounds check - callers only
 * ever pass 16-bit-range coordinates, so 8 chars is always enough)
 * and returns the number of characters written.
 */
static int format_int(char *buf, int value)
{
    unsigned int u;
    char digits[12];
    int d = 0;
    int i = 0;

    if (value < 0)
    {
        buf[i++] = '-';
        u = (unsigned int)(-value);
    }
    else
    {
        u = (unsigned int)value;
    }

    do
    {
        digits[d++] = (char)('0' + (u % 10));
        u /= 10;
    } while (u != 0);

    while (d > 0)
        buf[i++] = digits[--d];

    buf[i] = 0;
    return i;
}

static void draw_hud(const SceneDef *scene, const Entity *player,
                      uint32_t flags, uint32_t inventory)
{
    clear_hud();

    /* Row 0: scene name. */
    draw_text(0, 1, (scene && scene->name) ? scene->name : "(no scene)");

    /* Row 1: player position, e.g. "X:128 Y:64". */
    char line[24];
    int p = 0;

    line[p++] = 'X';
    line[p++] = ':';
    p += format_int(line + p, player ? player->x : 0);
    line[p++] = ' ';
    line[p++] = 'Y';
    line[p++] = ':';
    p += format_int(line + p, player ? player->y : 0);
    line[p] = 0;

    draw_text(1, 1, line);

    /* Row 2: event flags (the "once" NPC bits) as 8 hex digits. */
    static const char hex_digits[] = "0123456789ABCDEF";
    char flag_line[16];
    int fp = 0;

    flag_line[fp++] = 'F';
    flag_line[fp++] = 'L';
    flag_line[fp++] = ':';

    for (int shift = 28; shift >= 0; shift -= 4)
        flag_line[fp++] = hex_digits[(flags >> shift) & 0xF];

    flag_line[fp] = 0;

    draw_text(2, 1, flag_line);

    /* Row 3: inventory bits, same hex layout as the flags row. */
    char inv_line[16];
    int ip = 0;

    inv_line[ip++] = 'I';
    inv_line[ip++] = 'N';
    inv_line[ip++] = 'V';
    inv_line[ip++] = ':';

    for (int shift = 28; shift >= 0; shift -= 4)
        inv_line[ip++] = hex_digits[(inventory >> shift) & 0xF];

    inv_line[ip] = 0;

    draw_text(3, 1, inv_line);
}

void debug_init(void)
{
    dbg_active = 0;
}

void debug_toggle(void)
{
    dbg_active = !dbg_active;

    if (!dbg_active)
        clear_hud();
}

int debug_active(void)
{
    return dbg_active;
}

void debug_update(const SceneDef *scene, const Entity *player,
                   uint32_t flags, uint32_t inventory)
{
    if (!dbg_active)
        return;

    draw_hud(scene, player, flags, inventory);
}
