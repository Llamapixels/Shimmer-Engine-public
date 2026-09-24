#ifndef ADVANCE_MENU_H
#define ADVANCE_MENU_H

/*
 * A minimal pause menu: SAVE / ITEMS / CLOSE, opened with START.
 * Shares the dialogue box's VRAM (BG1, char block 2's font, screen
 * block 23) - the two are never shown at the same time, so this is
 * safe and needs no VRAM of its own. dialogue_init() must have run
 * first (it's the one that loads the font).
 */
typedef enum
{
    MENU_NONE,    /* nothing happened this frame - still open */
    MENU_SAVE,    /* player picked SAVE - caller should write the save */
    MENU_ITEMS,   /* player picked ITEMS - caller should show the inventory */
    MENU_CLOSE    /* player picked CLOSE, or pressed B - menu is now off */
} MenuAction;

/* Opens the menu with the cursor on SAVE. */
void menu_open(void);

/* Call once per frame while the menu is open. */
MenuAction menu_update(void);

#endif
