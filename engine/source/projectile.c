#include <stdint.h>

#include "projectile.h"
#include "entity.h"
#include "scene.h"
#include "sprite.h"
#include "collision.h"
#include "camera.h"
#include "world.h"
#include "actor.h"
#include "scenes_data.h"

typedef struct
{
    Entity *e;               /* 0 = slot never used this scene */
    const SpriteDef *def;    /* what e's sprite was set up with */
    uint8_t active;
    int32_t x, y;            /* 1/256 px */
    int vx, vy;
    int life;
    uint8_t group, target, flags;
    int8_t source;           /* NPC index that fired it, -1 = none */
    uint8_t from_player;
    uint16_t hit_npcs;       /* piercing: each actor only once */
} Projectile;

static Projectile shots[PROJECTILE_MAX];

void projectiles_reset(void)
{
    for (int i = 0; i < PROJECTILE_MAX; i++)
    {
        if (shots[i].e)
            entity_destroy(shots[i].e);
        shots[i].e = 0;
        shots[i].def = 0;
        shots[i].active = 0;
    }
}

/* A free slot already showing `def`, else a never-used one (sprites
 * can't be freed one by one, so slots keep their sprite). */
static Projectile *take_slot(const SpriteDef *def, int bank)
{
    for (int i = 0; i < PROJECTILE_MAX; i++)
        if (!shots[i].active && shots[i].e && shots[i].def == def)
            return &shots[i];
    for (int i = 0; i < PROJECTILE_MAX; i++)
    {
        if (!shots[i].active && !shots[i].e)
        {
            Entity *e = entity_create(ENTITY_OBJECT, 0, 0, 16, 16);
            if (!e)
                return 0;
            e->solid = 0;
            entity_set_sprite(e, def, bank);
            shots[i].e = e;
            shots[i].def = def;
            return &shots[i];
        }
    }
    return 0;
}

void projectile_launch(const int16_t *p)
{
    if (p[PROJ_P_SPRITE] < 0 || p[PROJ_P_SPRITE] >= SPRITE_COUNT)
        return;
    int source = p[PROJ_P_SOURCE];
    Entity *from = source == PLAYER_ACTOR_INDEX ? world_player() : world_npc(source);
    if (!from)
        return;
    const SpriteDef *def = &sprite_defs[p[PROJ_P_SPRITE]];
    sprite_load_palette(p[PROJ_P_BANK], def->palette);
    Projectile *s = take_slot(def, p[PROJ_P_BANK]);
    if (!s)
        return;

    int vx = p[PROJ_P_VX], vy = p[PROJ_P_VY];
    if (p[PROJ_P_FACING])
    {
        int speed = p[PROJ_P_SPEED];
        vx = from->direction == DIR_RIGHT ? speed : from->direction == DIR_LEFT ? -speed : 0;
        vy = from->direction == DIR_DOWN ? speed : from->direction == DIR_UP ? -speed : 0;
    }

    /* Start at the source's centre, plus the offset. */
    int x = from->x + from->width / 2 - 8 + p[PROJ_P_OFF_X];
    int y = from->y + from->height / 2 - 8 + p[PROJ_P_OFF_Y];
    s->x = x << 8;
    s->y = y << 8;
    s->vx = vx;
    s->vy = vy;
    s->life = p[PROJ_P_LIFE];
    s->group = (uint8_t)p[PROJ_P_GROUP];
    s->target = (uint8_t)p[PROJ_P_TARGET];
    s->flags = (uint8_t)p[PROJ_P_FLAGS];
    s->source = source == PLAYER_ACTOR_INDEX ? -1 : (int8_t)source;
    s->from_player = source == PLAYER_ACTOR_INDEX;
    s->hit_npcs = 0;
    s->active = 1;

    Entity *e = s->e;
    e->x = x;
    e->y = y;
    int ax = vx < 0 ? -vx : vx, ay = vy < 0 ? -vy : vy;
    Direction d = ax >= ay ? (vx < 0 ? DIR_LEFT : DIR_RIGHT) : (vy < 0 ? DIR_UP : DIR_DOWN);
    e->anim_state = 0;
    entity_animate(e, d, 1);
    sprite_show(&e->sprite);
}

static int overlaps(Entity *a, Entity *b)
{
    int ax = a->x + a->col_ox, ay = a->y + a->col_oy;
    int bx = b->x + b->col_ox, by = b->y + b->col_oy;
    return ax < bx + b->col_w && ax + a->col_w > bx && ay < by + b->col_h && ay + a->col_h > by;
}

static void kill(Projectile *s)
{
    s->active = 0;
    sprite_hide(&s->e->sprite);
}

void projectiles_update(int move, int camera_x, int camera_y)
{
    const SceneDef *scene = scene_current();
    for (int i = 0; i < PROJECTILE_MAX; i++)
    {
        Projectile *s = &shots[i];
        if (!s->active)
            continue;
        Entity *e = s->e;

        if (move)
        {
            s->x += s->vx;
            s->y += s->vy;
            e->x = s->x >> 8;
            e->y = s->y >> 8;
            if (s->life > 0 && --s->life == 0)
            {
                kill(s);
                continue;
            }
            /* Off screen (with a margin), or into a wall. */
            if (e->x < camera_x - 32 || e->x > camera_x + SCREEN_WIDTH + 16 ||
                e->y < camera_y - 32 || e->y > camera_y + SCREEN_HEIGHT + 16)
            {
                kill(s);
                continue;
            }
            if (!(s->flags & PROJ_FLAG_WALLS) &&
                collision_test_rect(e->x + e->col_ox + e->col_w / 2 - 1, e->y + e->col_oy + e->col_h / 2 - 1, 2, 2))
            {
                kill(s);
                continue;
            }

            int hit = 0;
            if (s->target == PROJ_TARGET_PLAYER)
            {
                Entity *p = world_player();
                if (p && p->solid && overlaps(e, p))
                {
                    const ScriptEvent *script = scene && s->group >= 1 && s->group <= 3 ? scene->player_hit[s->group - 1] : 0;
                    world_player_hit(script, e->x + 8, e->y + 8);
                    hit = 1;
                }
            }
            else
            {
                for (int n = 0; n < world_npc_count() && !hit; n++)
                {
                    const NpcDef *d = world_npc_def(n);
                    if (n == s->source || !d->collision_group || !world_npc_solid(n))
                        continue;
                    if (s->target != PROJ_TARGET_ANY && d->collision_group != s->target)
                        continue;
                    if ((s->hit_npcs >> n) & 1)
                        continue;
                    if (overlaps(e, world_npc(n)))
                    {
                        s->hit_npcs |= (uint16_t)(1u << n);
                        world_run_script(d->on_hit);
                        hit = 1;
                    }
                }
            }
            if (hit && !(s->flags & PROJ_FLAG_PIERCE))
            {
                kill(s);
                continue;
            }
        }
        entity_update_camera(e, camera_x, camera_y);
    }
}
