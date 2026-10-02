#ifndef ADVANCE_GAME_H
#define ADVANCE_GAME_H

/*
 * Whole-game operations that script events need but that only main.c
 * can do, since it owns the player, the loaded scene and the game-state
 * machine (same arrangement as actor.h / timer.h). Implemented in
 * main.c.
 */

/* Index of the current scene in scenes[] (0 if unknown). */
int game_scene_index(void);

/* "Save Data" / "Load Data": save slots 0..SAVE_SLOT_COUNT-1 (see
 * save.h) - slot 0 is the one the pause menu saves to. Loading
 * restores flags/items/variables straight away and requests a switch
 * to the saved scene/position; it returns 0 (and does nothing) if the
 * slot is empty. */
void game_save_slot(int slot);
int  game_load_slot(int slot);

/* Scene stack ("Store Current Scene On Stack" and friends): push
 * remembers the current scene + player position/facing; pop switches
 * back to the last one pushed (all = 1: the first one, clearing the
 * stack) and returns 1 if it started a switch, 0 if the stack was
 * empty; reset forgets everything pushed. */
void game_scene_push(int full, int exclude_thread);
int  game_scene_pop(int all);
void game_scene_reset(void);

#endif
