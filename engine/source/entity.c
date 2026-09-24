#include <stdint.h>

#include "entity.h"
#include "collision.h"

static Entity entities[ENTITY_MAX];

void entity_system_init(void)
{
    for (int i = 0; i < ENTITY_MAX; i++)
    {
        entities[i].active = 0;
        entities[i].type = ENTITY_NONE;
        entities[i].x = 0;
        entities[i].y = 0;
        entities[i].width = 0;
        entities[i].height = 0;
        entities[i].solid = 0;
    }
}

Entity *entity_create(
    EntityType type,
    int x,
    int y,
    int width,
    int height
)
{
    for (int i = 0; i < ENTITY_MAX; i++)
    {
        if (!entities[i].active)
        {
            Entity *entity =
                &entities[i];

            entity->active = 1;
            entity->type = type;

            entity->x = x;
            entity->y = y;

            entity->width = width;
            entity->height = height;

            entity->solid = 1;

            entity->direction = DIR_DOWN;
            entity->moving = 0;
            entity->anim_timer = 0;
            entity->anim_step = 0;

            entity->states = 0;
            entity->state_count = 0;
            entity->state_index = -1;
            entity->anim_enabled = 1;
            entity->state_frame = 0;
            entity->state_timer = 0;
            entity->anim_map = 0;
            entity->state_hold = 0;

            /* Collision box defaults to the full sprite rect - see the
             * doc comment on Entity's col_ox/col_oy/col_w/col_h. */
            entity->col_ox = 0;
            entity->col_oy = 0;
            entity->col_w = width;
            entity->col_h = height;

            entity->move_speed = 1;
            entity->anim_speed = 0;
            entity->collide = 1;

            sprite_init(
                &entity->sprite,
                x,
                y,
                width,
                height
            );

            return entity;
        }
    }

    return 0;
}

void entity_destroy(
    Entity *entity
)
{
    if (entity == 0)
        return;

    entity->active = 0;

    sprite_hide(
        &entity->sprite
    );
}

void entity_set_graphics(
    Entity *entity,
    const uint8_t *data,
    uint32_t size
)
{
    if (entity == 0)
        return;

    sprite_set_graphics(
        &entity->sprite,
        data,
        size
    );
}

void entity_set_frames(
    Entity *entity,
    const uint8_t *frames,
    uint16_t frame_count,
    int palette_bank
)
{
    if (entity == 0)
        return;

    sprite_set_palette_bank(
        &entity->sprite,
        palette_bank
    );

    sprite_set_frames(
        &entity->sprite,
        frames,
        frame_count
    );
}

void entity_animate(
    Entity *entity,
    Direction direction,
    int moving
)
{
    if (entity == 0)
        return;

    uint8_t new_direction = (uint8_t)direction;
    uint8_t new_moving = moving ? 1 : 0;
    int changed =
        new_direction != entity->direction ||
        new_moving != entity->moving;

    entity->direction = new_direction;
    entity->moving = new_moving;

    /* Direction map (Animation Type): pick the authored state for this
     * direction/moving combination instead of the legacy frame formula. */
    if (entity->anim_map != 0 && entity->states != 0)
    {
        if (changed)
            entity->state_hold = 0;

        if (entity->state_hold || (new_direction & ~3u))
            return;

        uint8_t s = entity->anim_map[new_moving * 4 + new_direction];
        if (s != ANIM_MAP_KEEP)
            entity_set_state(entity, s);
        return;
    }

    if (entity->moving)
    {
        entity->anim_timer++;

        if (entity->anim_timer >=
            (entity->anim_speed ? entity->anim_speed : ENTITY_ANIM_SPEED))
        {
            entity->anim_timer = 0;
            entity->anim_step =
                (entity->anim_step + 1) % ENTITY_WALK_FRAMES;
        }
    }
    else
    {
        /* Standing still: rest on the first frame. */
        entity->anim_timer = 0;
        entity->anim_step = 0;
    }

    sprite_show_frame(
        &entity->sprite,
        entity->direction * ENTITY_WALK_FRAMES +
        entity->anim_step
    );
}

void entity_set_multi_frames(
    Entity *entity,
    const ASpriteMultiFrame *frames,
    uint16_t frame_count,
    uint8_t max_sub_tiles,
    uint16_t max_vram_tiles
)
{
    if (entity == 0)
        return;

    sprite_init_multi(
        &entity->sprite,
        entity->x,
        entity->y,
        entity->width,
        entity->height,
        max_sub_tiles,
        max_vram_tiles
    );

    sprite_set_multi_frames(
        &entity->sprite,
        frames,
        frame_count
    );
}

void entity_set_states(
    Entity *entity,
    const EntityAnimState *states,
    uint8_t state_count
)
{
    if (entity == 0)
        return;

    entity->states = states;
    entity->state_count = state_count;
    entity->state_index = -1;
    entity->state_frame = 0;
    entity->state_timer = 0;
}

void entity_set_state(
    Entity *entity,
    int state_index
)
{
    if (entity == 0 ||
        entity->states == 0 ||
        state_index < 0 ||
        state_index >= entity->state_count)
        return;

    if (entity->state_index == state_index)
        return;

    entity->state_index = (int8_t)state_index;
    entity->state_frame = 0;
    entity->state_timer = 0;

    const EntityAnimState *st = &entity->states[state_index];
    if (st->frame_count > 0)
        sprite_show_frame(&entity->sprite, st->frames[0]);
}

void entity_hold_state(
    Entity *entity,
    int state_index
)
{
    if (entity == 0 ||
        entity->states == 0 ||
        state_index < 0 ||
        state_index >= entity->state_count)
        return;

    entity_set_state(entity, state_index);
    if (entity->anim_map != 0)
        entity->state_hold = 1;
}

void entity_set_anim_map(
    Entity *entity,
    const uint8_t *anim_map
)
{
    if (entity == 0)
        return;

    entity->anim_map = anim_map;
    entity->state_hold = 0;

    if (anim_map == 0 || entity->states == 0)
        return;

    uint8_t s = ANIM_MAP_KEEP;
    if (entity->direction < 4)
        s = anim_map[(entity->moving ? 4 : 0) + entity->direction];

    if (s != ANIM_MAP_KEEP)
        entity_set_state(entity, s);
    else if (entity->state_index < 0)
        entity_set_state(entity, 0);
}

void entity_set_animate(
    Entity *entity,
    int enabled
)
{
    if (entity == 0)
        return;

    entity->anim_enabled = enabled ? 1 : 0;
}

void entity_set_frame(
    Entity *entity,
    int frame
)
{
    if (entity == 0)
        return;

    entity->anim_enabled = 0;
    if (entity->anim_map != 0)
        entity->state_hold = 1;
    sprite_show_frame(&entity->sprite, frame);
}

void entity_set_collision_box(
    Entity *entity,
    int ox,
    int oy,
    int w,
    int h
)
{
    if (entity == 0)
        return;

    entity->col_ox = ox;
    entity->col_oy = oy;
    entity->col_w = w;
    entity->col_h = h;
}

/* Step the currently-selected authored state's frame timer by one
 * VBlank. Called from entity_update()/entity_update_camera() every
 * frame; a no-op unless entity_set_states()+entity_set_state() have
 * both been used and entity_set_animate(1) (the default) is in
 * effect. */
static void entity_step_state_animation(
    Entity *entity
)
{
    if (entity->states == 0 ||
        entity->state_index < 0 ||
        !entity->anim_enabled)
        return;

    const EntityAnimState *st =
        &entity->states[entity->state_index];

    if (st->frame_count == 0)
        return;

    uint8_t speed =
        entity->anim_speed ? entity->anim_speed :
        st->speed > 0 ? st->speed : ENTITY_ANIM_SPEED;

    entity->state_timer++;

    if (entity->state_timer >= speed)
    {
        entity->state_timer = 0;
        entity->state_frame =
            (uint8_t)((entity->state_frame + 1) % st->frame_count);

        sprite_show_frame(
            &entity->sprite,
            st->frames[entity->state_frame]
        );
    }
}

int entity_can_move(
    Entity *entity,
    int x,
    int y
)
{
    if (entity == 0)
        return 0;

    if (!entity->solid || !entity->collide)
        return 1;

    return collision_can_move(
        x + entity->col_ox,
        y + entity->col_oy,
        entity->col_w,
        entity->col_h
    );
}

void entity_update(
    Entity *entity
)
{
    if (entity == 0 ||
        !entity->active)
        return;

    entity->sprite.x =
        entity->x;

    entity->sprite.y =
        entity->y;

    entity_step_state_animation(entity);

    sprite_update(
        &entity->sprite
    );
}

void entity_update_camera(
    Entity *entity,
    int camera_x,
    int camera_y
)
{
    if (entity == 0 ||
        !entity->active)
        return;

    entity->sprite.x =
        entity->x;

    entity->sprite.y =
        entity->y;

    entity_step_state_animation(entity);

    sprite_update_camera(
        &entity->sprite,
        camera_x,
        camera_y
    );
}

Entity *entity_get(
    int index
)
{
    if (index < 0 ||
        index >= ENTITY_MAX)
        return 0;

    if (!entities[index].active)
        return 0;

    return &entities[index];
}