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
    }
}

Entity *entity_create(EntityType type, int x, int y, int width, int height)
{
    for (int i = 0; i < ENTITY_MAX; i++)
    {
        if (entities[i].active)
            continue;

        Entity *e = &entities[i];
        e->active = 1;
        e->type = type;
        e->x = x;
        e->y = y;
        e->width = width;
        e->height = height;
        e->solid = 1;
        e->direction = DIR_DOWN;
        e->moving = 0;
        e->def = 0;
        e->anim_state = 0;
        e->anim_index = -1;
        e->anim_frame = 0;
        e->anim_timer = 0;
        e->anim_enabled = 1;
        e->anim_hold = 0;
        e->col_ox = 0;
        e->col_oy = 0;
        e->col_w = width;
        e->col_h = height;
        e->move_speed = 1;
        e->anim_speed = 0;
        e->collide = 1;
        e->pinned = 0;
        sprite_init(&e->sprite, x, y, 0, 0, 0, 0, 0);
        return e;
    }
    return 0;
}

void entity_destroy(Entity *entity)
{
    if (entity == 0)
        return;
    entity->active = 0;
    sprite_hide(&entity->sprite);
}

/* Start animation `anim` from its first frame. */
static void play_animation(Entity *e, int anim)
{
    if (e->def == 0 || anim < 0 || anim >= e->def->anim_count || anim == e->anim_index)
        return;
    e->anim_index = (int16_t)anim;
    e->anim_frame = 0;
    e->anim_timer = 0;
    const EntityAnimation *a = &e->def->anims[anim];
    if (a->frame_count > 0)
        sprite_show_frame(&e->sprite, a->frames[0]);
}

/* The animation the current state maps the direction/moving flag to. */
static void apply_state_map(Entity *e)
{
    if (e->def == 0 || e->def->state_count == 0 || e->anim_hold)
        return;
    uint8_t dir = e->direction & 3;
    play_animation(e, e->def->state_maps[e->anim_state * 8 + (e->moving ? 4 : 0) + dir]);
}

void entity_set_sprite(Entity *entity, const SpriteDef *def, int palette_bank)
{
    if (entity == 0 || def == 0)
        return;
    entity->def = def;
    entity->anim_state = 0;
    entity->anim_index = -1;
    entity->anim_hold = 0;
    sprite_init(&entity->sprite, entity->x, entity->y, def->frames, def->frame_count,
                def->max_objs, def->max_vram_tiles, palette_bank);
    entity_set_collision_box(entity, def->col_ox, def->col_oy, def->col_w, def->col_h);
    apply_state_map(entity);
}

void entity_animate(Entity *entity, Direction direction, int moving)
{
    if (entity == 0)
        return;
    uint8_t d = (uint8_t)direction;
    uint8_t m = moving ? 1 : 0;
    if (d != entity->direction || m != entity->moving)
        entity->anim_hold = 0;
    entity->direction = d;
    entity->moving = m;
    apply_state_map(entity);
}

void entity_set_anim_state(Entity *entity, int state)
{
    if (entity == 0 || entity->def == 0 || state < 0 || state >= entity->def->state_count)
        return;
    entity->anim_state = (uint8_t)state;
    entity->anim_hold = 0;
    entity->anim_enabled = 1;
    apply_state_map(entity);
}

void entity_set_animate(Entity *entity, int enabled)
{
    if (entity == 0)
        return;
    entity->anim_enabled = enabled ? 1 : 0;
    if (enabled && entity->anim_hold)
    {
        entity->anim_hold = 0;
        apply_state_map(entity);
    }
}

void entity_set_frame(Entity *entity, int frame)
{
    if (entity == 0 || entity->def == 0 || entity->anim_index < 0 || frame < 0)
        return;
    const EntityAnimation *a = &entity->def->anims[entity->anim_index];
    if (a->frame_count == 0)
        return;
    entity->anim_enabled = 0;
    entity->anim_hold = 1;
    entity->anim_frame = (uint8_t)(frame % a->frame_count);
    entity->anim_timer = 0;
    sprite_show_frame(&entity->sprite, a->frames[entity->anim_frame]);
}

void entity_set_collision_box(Entity *entity, int ox, int oy, int w, int h)
{
    if (entity == 0)
        return;
    entity->col_ox = ox;
    entity->col_oy = oy;
    entity->col_w = w;
    entity->col_h = h;
}

/* Advance the current animation by one VBlank. */
static void step_animation(Entity *e)
{
    if (e->def == 0 || e->anim_index < 0 || !e->anim_enabled)
        return;
    const EntityAnimation *a = &e->def->anims[e->anim_index];
    if (a->frame_count < 2)
        return;
    uint8_t speed = e->anim_speed ? e->anim_speed : a->speed ? a->speed : ENTITY_ANIM_SPEED;
    if (++e->anim_timer < speed)
        return;
    e->anim_timer = 0;
    e->anim_frame = (uint8_t)((e->anim_frame + 1) % a->frame_count);
    sprite_show_frame(&e->sprite, a->frames[e->anim_frame]);
}

int entity_can_move(Entity *entity, int x, int y)
{
    if (entity == 0)
        return 0;
    if (!entity->solid || !entity->collide)
        return 1;
    return collision_can_move_from(entity->x + entity->col_ox, entity->y + entity->col_oy,
                                   x + entity->col_ox, y + entity->col_oy, entity->col_w, entity->col_h);
}

void entity_update(Entity *entity)
{
    if (entity == 0 || !entity->active)
        return;
    sprite_set_position(&entity->sprite, entity->x, entity->y);
    step_animation(entity);
    sprite_update(&entity->sprite);
}

void entity_update_camera(Entity *entity, int camera_x, int camera_y)
{
    if (entity == 0 || !entity->active)
        return;
    sprite_set_position(&entity->sprite, entity->x, entity->y);
    step_animation(entity);
    if (entity->pinned)
        sprite_update_camera(&entity->sprite, 0, 0);
    else
        sprite_update_camera(&entity->sprite, camera_x, camera_y);
}

Entity *entity_get(int index)
{
    if (index < 0 || index >= ENTITY_MAX || !entities[index].active)
        return 0;
    return &entities[index];
}
