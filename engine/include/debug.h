#ifndef ADVANCE_DEBUG_H
#define ADVANCE_DEBUG_H

#include <stdint.h>

#include "scene.h"
#include "entity.h"

/*
 * Dev-only on-screen HUD: scene name, player position, and the raw
 * event-flags/inventory bitmasks (see save.h). Lives on BG1's TOP 4
 * rows, clear of the dialogue/menu box which only ever uses the
 * bottom 4 rows (see dialogue.c/menu.c), so it can stay up at the
 * same time as either of those without stepping on them.
 *
 * Toggle in-game by holding SELECT and pressing A.
 */

/* One-time setup. Call once at startup, after dialogue_init()
 * (shares its font/VRAM setup - just needs the tiles to already be
 * loaded). */
void debug_init(void);

/* Flip the HUD on/off. */
void debug_toggle(void);

/* Is the HUD currently on? Callers that gate BG1_ENABLE should force
 * it back on after this is true, since dialogue/menu turn BG1 off
 * when they close. */
int debug_active(void);

/* Call once per frame. Redraws the HUD when active; does nothing
 * otherwise. Safe to call with player == 0 (e.g. before the player
 * entity exists yet). */
void debug_update(const SceneDef *scene, const Entity *player,
                   uint32_t flags, uint32_t inventory);

#endif
