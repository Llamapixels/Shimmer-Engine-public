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

typedef enum
{
    DIR_DOWN = 0,
    DIR_UP,
    DIR_RIGHT,
    DIR_LEFT
} Direction;

#define ENTITY_ANIM_SPEED 8   /* default VBlanks per animation frame */

/* One compiled animation: frame indices into the sprite's frames, shown
 * in order and looped. */
typedef struct
{
    const uint16_t *frames;
    uint8_t frame_count;
    uint8_t speed;            /* VBlanks per frame; 0 = ENTITY_ANIM_SPEED */
} EntityAnimation;

/*
 * A compiled sprite sheet (compiler/build_project.py writes one per
 * sprite the project uses). Laid out like GB Studio's sprites: the sheet
 * has one or more animation states (the first is the default; the "Set
 * Actor Animation State" event picks another), and each state maps the
 * 8 combinations of facing direction x standing/moving to one of
 * `anims`:
 *
 *   state_maps[state * ENTITY_STATE_SLOTS + moving * 4 + direction] (then
 *   the extra ENTITY_SLOT_* ones)
 *
 * (direction as in Direction above). The compiler has already resolved
 * the state's animation type and "flip right to make left" into this map.
 */
typedef struct
{
    const ASpriteFrame *frames;
    uint16_t frame_count;
    uint8_t max_objs;           /* most OBJs any frame uses */
    uint16_t max_vram_tiles;    /* most VRAM tiles any frame uses */

    const EntityAnimation *anims;
    uint8_t anim_count;
    const uint8_t *state_maps;
    uint8_t state_count;

    /* Collision box relative to the actor's 16x16 footprint. */
    int16_t col_ox, col_oy;
    uint16_t col_w, col_h;

    const uint16_t *palette;    /* 16 colors; index 0 transparent */

    /* For the scene types (modes.c): per MODE_ANIM_* the state named
     * for it ("jump", "fall"...) + 1, 0 = none (may be 0 = no names). */
    const uint8_t *mode_states;
    uint32_t platform_mask;     /* bit s: state s is a platform_player sprite */
    uint32_t cursor_mask;       /* bit s: state s is a cursor sprite */
} SpriteDef;

typedef struct
{
    uint8_t active;
    uint8_t type;

    /* Position of the actor's 16x16 footprint (movement, collision and
     * talking all use this cell; the sprite is drawn around it). */
    int x;
    int y;
    int width;
    int height;
    int solid;

    uint8_t direction;      /* Direction */
    uint8_t moving;         /* moved this frame? */

    const SpriteDef *def;   /* 0 = no sprite */
    uint8_t anim_state;     /* index into def's states */
    int16_t anim_index;     /* current animation, -1 = none */
    uint8_t anim_frame;     /* index into that animation's frames */
    uint8_t anim_timer;     /* VBlanks counted toward the next frame */
    uint8_t anim_enabled;   /* "Set Actor Animate" */
    uint8_t extra_slot;     /* 0, or ENTITY_SLOT_* + 1: shown instead
                             * of the direction/moving animation */
    uint8_t anim_hold;      /* a script picked a frame: keep it until the
                             * actor's direction or moving flag changes */

    /* Collision box: offset + size relative to the footprint, used by
     * entity_can_move(). Starts as the sprite's authored box. */
    int col_ox;
    int col_oy;
    int col_w;
    int col_h;

    /*
     * Script-set overrides (GB Studio's "Set Actor Movement Speed",
     * "Set Actor Animation Speed" and "Actor Collisions Enable/Disable"):
     *   move_speed: px per frame for scripted moves (default 1)
     *   anim_speed: VBlanks per animation frame, overriding the
     *               sprite's own (0 = no override)
     *   collide:    0 = ignores tile collision and doesn't block (or get
     *               blocked by) other actors
     */
    uint8_t move_speed;
    uint8_t anim_speed;
    uint8_t collide;

    /* Pinned (GB Studio's actor "pin" toggle): x/y are screen pixels,
     * so the actor stays put on screen whatever the camera does. */
    uint8_t pinned;

    ASprite sprite;
} Entity;

void entity_system_init(void);

Entity *entity_create(EntityType type, int x, int y, int width, int height);

void entity_destroy(Entity *entity);

/* Give the entity a sprite, drawn with OBJ palette `palette_bank`
 * (loading the palette is the caller's job). Starts in state 0, showing
 * the animation for its current direction. */
void entity_set_sprite(Entity *entity, const SpriteDef *def, int palette_bank);

/* Set facing and whether the entity is walking; picks the matching
 * animation of its current state. */
void entity_animate(Entity *entity, Direction direction, int moving);

/* Extra animation slots after a state's 8 direction/moving ones (see
 * compiler/sprites.py): the Platformer's wall slide and wall kick. */
#define ENTITY_STATE_SLOTS 12
enum { ENTITY_SLOT_WALL_SLIDE_R, ENTITY_SLOT_WALL_SLIDE_L, ENTITY_SLOT_WALL_KICK_R, ENTITY_SLOT_WALL_KICK_L };

/* Show extra slot `slot` (ENTITY_SLOT_*, -1 = none) - it stays until the
 * next entity_animate() call. */
void entity_animate_slot(Entity *entity, Direction direction, int slot);

/* "Set Actor Animation State": switch to another of the sprite's states
 * (out of range = ignored). */
void entity_set_anim_state(Entity *entity, int state);

/* "Set Actor Animate": 0 freezes on the current frame. */
void entity_set_animate(Entity *entity, int enabled);

/* "Set Actor Frame": show frame `frame` (wrapping) of the current
 * animation and stop animating, until animation is re-enabled or the
 * direction or moving flag next changes. */
void entity_set_frame(Entity *entity, int frame);

void entity_set_collision_box(Entity *entity, int ox, int oy, int w, int h);

void entity_update(Entity *entity);

void entity_update_camera(Entity *entity, int camera_x, int camera_y);

int entity_can_move(Entity *entity, int x, int y);

Entity *entity_get(int index);

#endif
