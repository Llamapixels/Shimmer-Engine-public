#ifndef ADVANCE_ACTOR_H
#define ADVANCE_ACTOR_H

/*
 * Runtime control over an NPC actor already placed by the current
 * scene - OR the player - called from event scripts (see the
 * SCRIPT_ACTOR_* ops in script.h). Implemented in main.c, which owns
 * the loaded scene's live NPC Entity array (and the player Entity);
 * this header just lets script.c reach them without main.c and
 * script.c needing to know about each other's internals.
 *
 * `index` is either the NPC's position in its scene's npcs[] list -
 * the same order as scene JSON's "npcs" array (see compiler/
 * build_project.py, which resolves a name, "self", or "player" to
 * this parameter at compile time) - or PLAYER_ACTOR_INDEX, meaning
 * "the player" rather than any NPC. Out-of-range NPC indices, or a
 * scene with no NPC at that index, are silently ignored - a script
 * can only ever be running while its own scene is loaded, so this is
 * really just defensive against a bad index, not something that
 * should happen with compiler-generated data.
 */

/* Sentinel `index` meaning "the player", not an NPC - resolve_actor()
 * in compiler/build_project.py emits this for an event's "actor"
 * field set to "player". Distinct from every real NPC index (always
 * >= 0) and from the -1 various other subsystems (camera lock,
 * "not currently moving") use for their own "nothing"/"unlocked"
 * sentinels, so it can't be confused with those. */
#define PLAYER_ACTOR_INDEX (-2)

/* Show/hide an actor. A hidden actor also stops blocking movement
 * and stops being talked to (and stops wandering, if it wanders)
 * until shown again - it's fully "not there", not just invisible. */
void actor_set_visible(int index, int visible);

/* Teleport an actor to a new position, in pixels. */
void actor_set_position(int index, int x, int y);

/* Turn an actor to face a direction (Direction, 0-3 - see entity.h),
 * without moving it. */
void actor_set_direction(int index, int direction);

/*
 * Step an actor one frame closer to (target_x, target_y), in pixels -
 * the engine side of SCRIPT_ACTOR_MOVE_TO. Moves fully along X before
 * starting Y, matching the 4-direction sprite system (it can only
 * face one axis at a time). Like actor_set_position(), this ignores
 * collision completely - it's author-directed movement, not the
 * player's collision-checked movement, the same way a cutscene walk
 * in GB Studio doesn't get blocked by the furniture it's scripted to
 * walk past.
 *
 * Returns 1 if the actor is still short of the target (call again
 * next frame), 0 once it has arrived (or the index was invalid).
 */
int actor_step_toward(int index, int target_x, int target_y);

/*
 * Switch an actor to one of its sprite's authored animation states (see
 * EntityAnimState in entity.h) by index - resolved from a name at
 * compile time, same pattern as resolve_actor()/resolve_timer() in
 * compiler/build_project.py. No-op if the actor's sprite has no
 * authored states (the legacy fixed-convention sprites this project
 * started with).
 */
void actor_set_state(int index, int state_index);

/* Turn per-frame animation stepping on/off for an actor using authored
 * states - while off, it holds whatever frame is currently shown. */
void actor_set_animate(int index, int enabled);

/* Show a specific frame directly, by index into the actor's sprite
 * sheet - bypasses both the legacy convention and any authored state's
 * frame list. Also stops animation stepping until re-enabled. */
void actor_set_frame(int index, int frame);

/* Set an actor's collision box: offset + size in pixels within its
 * sprite's canvas, overriding whatever its sprite sheet authored (or
 * the default full-sprite-rect box, for a sprite with none). */
void actor_set_collision_box(int index, int ox, int oy, int w, int h);

/* Current position, in pixels - the read-back counterpart to
 * actor_set_position(). 0 for an out-of-range index. */
int actor_get_x(int index);
int actor_get_y(int index);

/* Current facing direction (Direction, 0-3 - see entity.h). 0 (down)
 * for an out-of-range index. */
int actor_get_direction(int index);

/* Scripted-move speed in px per frame (1-8; see Entity.move_speed),
 * used by actor_step_toward(). */
void actor_set_move_speed(int index, int speed);

/* Animation speed override in frames per animation frame (0 = the
 * sprite's own speed; see Entity.anim_speed). */
void actor_set_anim_speed(int index, int speed);

/* Collisions on/off (see Entity.collide): off = walks through walls
 * and doesn't block, or get blocked by, other actors. */
void actor_set_collisions(int index, int enabled);

/*
 * "Push Actor Away From Player": works out where the actor ends up
 * when pushed one 16px step in the direction the player faces (or, if
 * `slide`, as many steps as it can take before hitting a wall). Returns
 * 0 if it can't move at all, else 1 with the target in *x and *y, for
 * actor_step_toward() to walk it there.
 */
int actor_push_target(int index, int slide, int *x, int *y);

#endif
