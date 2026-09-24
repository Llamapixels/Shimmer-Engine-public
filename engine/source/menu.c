#include <gba.h>
#include <stdint.h>

#include "menu.h"
#include "font_data.h"
#include "input.h"

/*
 * Same VRAM as dialogue.c's box - see that file's header comment for
 * the full layout. dialogue_init() already loaded the font tiles
 * and palette at startup; this file just draws into the same map.
 */
#define DLG_SCREEN_BASE_BLOCK  23
#define DLG_MAP \
    ((volatile uint16_t *)(0x06000000 + DLG_SCREEN_BASE_BLOCK * 0x800))
#define DLG_PALETTE_BANK 15

#define BOX_TOP_ROW 16
#define BOX_ROWS    4
#define BOX_COLS    30

#define TRANSPARENT_TILE   0
#define GLYPH_TILE_OFFSET  1
#define BLANK_TILE         GLYPH_TILE_OFFSET   /* tile for ' ' */

static const char *const MENU_LABELS[] = { "SAVE", "ITEMS", "CLOSE" };
#define MENU_ITEM_COUNT 3

static int menu_cursor = 0;

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

static void clear_box(void)
{
    for (int r = 0; r < BOX_ROWS; r++)
        for (int c = 0; c < BOX_COLS; c++)
            put_tile(BOX_TOP_ROW + r, c, BLANK_TILE);
}

static void draw_text(int row, int col, const char *text)
{
    for (int i = 0; text[i] != 0; i++)
        put_tile(BOX_TOP_ROW + row, col + i, char_tile(text[i]));
}

static void draw_menu(void)
{
    clear_box();

    for (int i = 0; i < MENU_ITEM_COUNT; i++)
    {
        draw_text(1 + i, 4, MENU_LABELS[i]);

        put_tile(
            BOX_TOP_ROW + 1 + i,
            2,
            (i == menu_cursor) ? char_tile('>') : BLANK_TILE
        );
    }
}

void menu_open(void)
{
    menu_cursor = 0;
    draw_menu();

    REG_DISPCNT |= BG1_ENABLE;
}

MenuAction menu_update(void)
{
    if (input_pressed(INPUT_UP))
    {
        menu_cursor = (menu_cursor - 1 + MENU_ITEM_COUNT) % MENU_ITEM_COUNT;
        draw_menu();
    }
    else if (input_pressed(INPUT_DOWN))
    {
        menu_cursor = (menu_cursor + 1) % MENU_ITEM_COUNT;
        draw_menu();
    }

    if (input_pressed(INPUT_B))
    {
        REG_DISPCNT &= ~BG1_ENABLE;
        return MENU_CLOSE;
    }

    if (input_pressed(INPUT_A))
    {
        if (menu_cursor == 0)
        {
            /* Leave BG1 on - the caller shows a confirmation message
             * in the same box (via dialogue_show()) right after this. */
            return MENU_SAVE;
        }

        if (menu_cursor == 1)
        {
            /* Same deal - the caller shows the inventory list via
             * dialogue_show() right after this, so leave BG1 on. */
            return MENU_ITEMS;
        }

        REG_DISPCNT &= ~BG1_ENABLE;
        return MENU_CLOSE;
    }

    return MENU_NONE;
}
