#ifndef ADVANCE_WORLD_H
#define ADVANCE_WORLD_H

#include "entity.h"
#include "scene.h"
#include "script.h"

/*
 * The current scene's actors, for the scene-type controllers (modes.c)
 * and projectiles. Implemented in main.c, which owns them.
 */
int world_npc_count(void);
Entity *world_player(void);
Entity *world_npc(int index);
const NpcDef *world_npc_def(int index);

/* Can this NPC block the player right now (visible, not pinned,
 * collisions on)? */
int world_npc_solid(int index);

/* The NPC whose box holds the point, -1 if none (visible, unpinned). */
int world_npc_at(int x, int y);

/* The on_interact script of the NPC in front of the player, or 0. */
const ScriptEvent *world_npc_in_front(Entity *player);

/* The player got hit (touching an actor, a projectile, a damage tile):
 * unless still invincible from the last hit, knockback, a moment of
 * invincibility and `script` (may be 0). */
void world_player_hit(const ScriptEvent *script, int from_x, int from_y);

/* A script to start from something that isn't the player walking into
 * it: as the main script if none is running, else in the background. */
void world_run_script(const ScriptEvent *script);

#endif
