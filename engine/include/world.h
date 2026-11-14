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
/* Is the player or any actor see-through (Set Actor Transparency)? */
int world_any_see_through(void);
Entity *world_npc(int index);
const NpcDef *world_npc_def(int index);

/* Can this NPC block the player (present, unpinned, movement collisions
 * on, blocking enabled, not a pickup)? */
int world_npc_solid(int index);
const ScriptEvent *world_npc_interact_script(int index);

/* Visible, active and unpinned, independently of movement collisions.
 * Used for interaction and receiving hits. */
int world_npc_active(int index);

/* Handler for an incoming projectile group (1-4). */
const ScriptEvent *world_npc_hit_script(int index, int group);

/* First enabled interactable NPC whose footprint holds the point, else -1. */
int world_npc_at(int x, int y);

/* The on_interact script of the NPC in front of the player, or 0. */
const ScriptEvent *world_npc_in_front(Entity *player);

/* The player got hit (touching an actor, a projectile, a damage tile):
 * unless still invincible from the last hit, knockback, a moment of
 * invincibility and `script`. A missing or empty script has no effect. */
void world_player_hit(const ScriptEvent *script, int from_x, int from_y);

/* A script to start from something that isn't the player walking into
 * it: as the main script if none is running, else in the background. */
/* Returns nonzero when scheduled; zero if empty or threads are full. */
int world_run_script(const ScriptEvent *script);

#endif
