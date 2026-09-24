#ifndef ADVANCE_ENTITY_H
#define ADVANCE_ENTITY_H

#include <stdint.h>

#include "sprite.h"

#define ENTITY_MAX 32

typedef enum
{
    ENTITY_NONE = 0,
    ENTITY_PLAYER,
    ENTITY_NPC,
    ENTITY_OBJECT
} EntityType;

/*
 * Facing direction. The value * 2 is the first animation frame for
 * that direction, matching the sprite sheet layout produced by
 * tools/png_to_gba_sprite.py:
 *
 *   frames 0,1 = down   2,3 = up   4,5 = right   6,7 = left
 */
typedef enum
{
    DIR_DOWN = 0,
    DIR_UP,
    DIR_RIGHT,
    DIR_LEFT
} Direction;

#define ENTITY_WALK_FRAMES   2   /* frames per direction */
#define ENTITY_ANIM_SPEED    8   /* VBlanks per walk frame */

#define ENTITY_STATE_MAX_FRAMES 16   /* frames in any one authored state */

/*
 * Direction map ("Animation Type", GB Studio's core sprite behaviour):
 * an optional 8-entry table, compiled per sprite sheet from its
 * slot-tagged states (build_project.py's build_anim_map()), indexed
 *     moving * 4 + Direction      (DIR_DOWN 0, UP 1, RIGHT 2, LEFT 3)
 * whose value is the authored state to show when the entity faces that
 * way while standing (moving 0) or walking (moving 1), or
 * ANIM_MAP_KEEP = leave whatever state is current. See entity_animate().
 */
#define ANIM_MAP_KEEP        0xFF
#define ANIM_MAP_SIZE        8

/*
 * A named, authored animation state - a generic replacement for the
 * fixed "direction*2" formula below. A sprite that defines its own
 * states (see NpcSpriteDef in scene.h, compiled from project.json's
 * "spriteSheets") gets an ordered frame list (indices into the
 * sprite's frame sheet, i.e. what entity_set_frame()/sprite_set_frame()
 * already take) and its own speed, in VBlanks per frame, replacing the
 * hardcoded ENTITY_ANIM_SPEED for that state.
 *
 * A sprite that defines NO states (states == 0 on Entity/NpcSpriteDef,
 * the default) keeps using the fixed 4-direction/8-frame convention via
 * entity_animate() exactly as before - this struct and the functions
 * below it are purely additive. Conceptually, "walking down" etc. under
 * the old convention IS a state (frames {0,1} at ENTITY_ANIM_SPEED) -
 * this is just the general mechanism those states would be authored
 * with, if a sprite chooses to define them explicitly instead of
 * relying on the built-in default.
 */
typedef struct
{
    const uint8_t *frames;   /* frame indices, e.g. {4,5,4,6} */
    uint8_t frame_count;
    uint8_t speed;           /* VBlanks per frame; 0 = ENTITY_ANIM_SPEED */
} EntityAnimState;

typedef struct
{
    uint8_t active;
    uint8_t type;

    int x;
    int y;

    int width;
    int height;

    int solid;

    uint8_t direction;   /* Direction */
    uint8_t moving;      /* moved this frame? */
    uint8_t anim_timer;
    uint8_t anim_step;   /* 0..ENTITY_WALK_FRAMES-1 */

    /*
     * Authored animation states (optional - see EntityAnimState above).
     * 0/0 = not authored; entity_animate() (the legacy direction/moving
     * API) is what drives animation instead, exactly as before. When
     * set (via entity_set_states()), entity_set_state()/
     * entity_set_frame()/entity_set_animate() take over and
     * entity_update()/entity_update_camera() step the state's frame
     * timer once per call.
     */
    const EntityAnimState *states;
    uint8_t state_count;
    int8_t  state_index;    /* -1 = none selected */
    uint8_t anim_enabled;   /* SCRIPT_ACTOR_SET_ANIMATE - 1 = playing */
    uint8_t state_frame;    /* index into states[state_index].frames */
    uint8_t state_timer;    /* VBlanks counted toward the next frame */

    /*
     * Direction map (optional - see ANIM_MAP_KEEP above). 0 = none: the
     * entity behaves exactly as before this field existed. When set
     * (together with `states`), entity_animate() selects
     * states[anim_map[moving*4 + direction]] instead of running the
     * legacy direction*2+step frame formula.
     *
     * state_hold: set by entity_hold_state()/entity_set_frame() (the
     * script events actor_set_state/actor_set_frame) so a scripted
     * state/frame isn't immediately replaced by the map; cleared - and
     * the map applied again - the next time entity_animate() sees this
     * entity's direction or moving flag CHANGE.
     */
    const uint8_t *anim_map;
    uint8_t state_hold;

    /*
     * Collision box: offset + size within the sprite's canvas, used by
     * entity_can_move() instead of the full width/height rect. Defaults
     * to (0, 0, width, height) - the full sprite rect, i.e. today's
     * behavior - set by entity_create() and overridable with
     * entity_set_collision_box().
     */
    int col_ox;
    int col_oy;
    int col_w;
    int col_h;

    /*
     * Script-set overrides (GB Studio's "Set Actor Movement Speed",
     * "Set Actor Animation Speed" and "Actor Collisions Enable/
     * Disable" events). entity_create() sets the defaults.
     *   move_speed: px per frame for scripted moves (default 1)
     *   anim_speed: VBlanks per animation frame, overriding both
     *               ENTITY_ANIM_SPEED and an authored state's own
     *               speed (0 = no override, the default)
     *   collide:    0 = ignores tile collision and doesn't block (or
     *               get blocked by) other actors (default 1)
     */
    uint8_t move_speed;
    uint8_t anim_speed;
    uint8_t collide;

    ASprite sprite;

} Entity;

void entity_system_init(void);

Entity *entity_create(
    EntityType type,
    int x,
    int y,
    int width,
    int height
);

void entity_destroy(
    Entity *entity
);

void entity_set_graphics(
    Entity *entity,
    const uint8_t *data,
    uint32_t size
);

/* Attach a sprite sheet (4bpp frames, back to back) + palette bank. */
void entity_set_frames(
    Entity *entity,
    const uint8_t *frames,
    uint16_t frame_count,
    int palette_bank
);

/* Attach a sprite's authored tile-composed ("metasprite") frames (see
 * sprite.h's ASpriteMultiFrame) instead of a plain frame-streamed sheet
 * - for a sprite sheet whose frames were built from multiple
 * independently-placed/flipped/palette'd tiles (project.json
 * spriteSheets[].frames, see shared/projectTypes.ts's SpriteFrameJSON).
 * `max_sub_tiles` is the largest tile_count (OBJs) and `max_vram_tiles`
 * the largest vram_tiles (8x8 VRAM tiles) across `frames` (the compiler
 * computes both). Every entity_set_frame()/entity_set_state()/
 * entity_animate() call below keeps working unchanged after this -
 * they all go through sprite_show_frame(), which dispatches to
 * whichever path this entity's sprite actually uses. */
void entity_set_multi_frames(
    Entity *entity,
    const ASpriteMultiFrame *frames,
    uint16_t frame_count,
    uint8_t max_sub_tiles,
    uint16_t max_vram_tiles
);

/* Set facing + whether the entity is walking; advances the animation.
 *
 * With a direction map (entity_set_anim_map()) and authored states: picks
 * states[anim_map[moving*4 + direction]] via entity_set_state() (which
 * no-ops if that state is already current, so its own frame timer keeps
 * running), unless the entry is ANIM_MAP_KEEP or a scripted state/frame
 * is being held (state_hold) and neither direction nor moving changed.
 *
 * Without a map: the legacy fixed-convention path (direction*2 + walk
 * step) - see the doc comment above EntityAnimState - exactly as before
 * direction maps existed. */
void entity_animate(
    Entity *entity,
    Direction direction,
    int moving
);

/* Attach a sprite's authored animation states (see EntityAnimState).
 * Pass 0/0 to go back to the legacy entity_animate() convention. Does
 * not itself pick a state - call entity_set_state() too (typically 0,
 * "standing"/first state). */
void entity_set_states(
    Entity *entity,
    const EntityAnimState *states,
    uint8_t state_count
);

/* Switch to a different authored state. Resets the frame timer so the
 * new state always starts on its first frame. No-op if entity->states is
 * 0, state_index is out of range, or it is already the current state. */
void entity_set_state(
    Entity *entity,
    int state_index
);

/* SCRIPT_ACTOR_SET_STATE: entity_set_state() + hold it against the
 * direction map until the entity's direction or moving flag next changes
 * (see Entity.state_hold). Like entity_set_state(), a no-op (no restart)
 * if it is already the current state - so an entity without a direction
 * map behaves exactly as before this function existed. */
void entity_hold_state(
    Entity *entity,
    int state_index
);

/* Attach a direction map (see ANIM_MAP_KEEP; 0 = none). If the entity
 * also has states, immediately selects the mapped state for its current
 * direction/moving flag (state 0 if that entry is ANIM_MAP_KEEP and no
 * state is selected yet). */
void entity_set_anim_map(
    Entity *entity,
    const uint8_t *anim_map
);

/* Turn per-frame animation stepping on/off (SCRIPT_ACTOR_SET_ANIMATE)
 * for an entity using authored states - while off, entity_update()
 * stops advancing state_frame, holding whatever frame is currently
 * shown. Has no effect on the legacy entity_animate() path. */
void entity_set_animate(
    Entity *entity,
    int enabled
);

/* Show a specific frame directly (SCRIPT_ACTOR_SET_FRAME), bypassing
 * both the legacy convention and any authored state's own frame list.
 * Also disables animate-stepping (as if entity_set_animate(0) was
 * called) so entity_update() doesn't immediately overwrite it -
 * call entity_set_animate(1) or entity_set_state() to resume. With a
 * direction map, the frame is also held (state_hold) until the entity's
 * direction or moving flag next changes. */
void entity_set_frame(
    Entity *entity,
    int frame
);

/* Set an authored collision box: offset + size within the sprite's
 * canvas (SCRIPT_ACTOR_SET_COLLISION_BOX). Used by entity_can_move()
 * in place of the full width/height rect. */
void entity_set_collision_box(
    Entity *entity,
    int ox,
    int oy,
    int w,
    int h
);

void entity_update(
    Entity *entity
);

void entity_update_camera(
    Entity *entity,
    int camera_x,
    int camera_y
);

int entity_can_move(
    Entity *entity,
    int x,
    int y
);

Entity *entity_get(
    int index
);

#endif