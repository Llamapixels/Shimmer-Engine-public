#ifndef ADVANCE_GAME_H
#define ADVANCE_GAME_H

#include "script.h"

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
/* `on_return` (may be 0) runs once the scene is back. */
int  game_scene_pop(int all, const ScriptEvent *on_return);

/* The playtime clock (frames; counts while running, saved with the game):
 * op 0 start/resume, 1 pause, 2 reset to 0, 3 add `seconds`, 4 subtract. */
void game_playtime(int op, int seconds);
uint32_t game_playtime_frames(void);
/* Persistent data: op 0 save all variables + playtime to `group`, 1 load
 * them, 2 clear the group, 3 store variable `var`, 4 load variable `var`
 * (left as it is if the group has no value for it). */
void game_persist(int op, int group, int var);

/* A save slot as a line for the slot menu ("Slot 1  Forest  1:23");
 * returns 0 (and writes `empty`) for an empty slot. */
int game_slot_line(int slot, const char *label, const char *empty, char *out, int max);
void game_scene_reset(void);

#endif
