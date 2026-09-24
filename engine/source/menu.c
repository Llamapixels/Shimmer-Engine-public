#include <gba.h>
#include <stdint.h>

#include "menu.h"
#include "ui.h"
#include "input.h"

/* Drawn in the dialogue box (ui.c) - the two are never up together. */
#define LABEL_X 10

static const char *const MENU_LABELS[] = { "SAVE", "ITEMS", "CLOSE" };
#define MENU_ITEM_COUNT 3

static int menu_cursor = 0;

static void draw_menu(void)
{
    ui_box_clear();
    for (int i = 0; i < MENU_ITEM_COUNT; i++)
    {
        if (i == menu_cursor)
            ui_box_cursor(i, 0);
        int x = LABEL_X;
        for (const char *p = MENU_LABELS[i]; *p; p++)
        {
            ui_box_char(i, x, ui_font(), (unsigned char)*p);
            x += ui_char_width(ui_font(), (unsigned char)*p);
        }
    }
    ui_box_flush();
}

void menu_open(void)
{
    menu_cursor = 0;
    ui_box_open(MENU_ITEM_COUNT);
    draw_menu();
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
        ui_box_close();
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

        ui_box_close();
        return MENU_CLOSE;
    }

    return MENU_NONE;
}
