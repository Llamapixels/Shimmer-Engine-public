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
    int32_t x, y;            /* 1/256 px: the path's position */
    int vx, vy;
    int life;
    uint8_t group, target, flags;
    uint8_t front;           /* e's sprite is in the front OAM block */
    int8_t source;           /* NPC index that fired it, -1 = none */
    uint8_t from_player;
    uint16_t hit_npcs;       /* piercing: each actor only once */

    uint8_t path;            /* PROJ_PATH_* */
    uint8_t landed;          /* stuck or lingering: not moving any more */
    uint8_t returning;       /* boomerang / recalled: homing on the source */
    uint8_t bounces_left;    /* 255 = forever */
    uint8_t land;            /* PROJ_LAND_* */
    uint8_t land_state;      /* animation state + 1 after landing, 0 = keep */
    int16_t amp, period, gravity, ret, linger, speed, off_x, off_y;
    uint16_t age;            /* frames since launch (wave phase, boomerang turn) */
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
static Projectile *take_slot(const SpriteDef *def, int bank, int front)
{
    for (int i = 0; i < PROJECTILE_MAX; i++)
        if (!shots[i].active && shots[i].e && shots[i].def == def && shots[i].front == front)
            return &shots[i];
    for (int i = 0; i < PROJECTILE_MAX; i++)
    {
        if (!shots[i].active && !shots[i].e)
        {
            Entity *e = entity_create(ENTITY_OBJECT, 0, 0, 16, 16);
            if (!e)
                return 0;
            e->solid = 0;
            sprite_use_front(front);
            entity_set_sprite(e, def, bank);
            sprite_use_front(0);
            shots[i].e = e;
            shots[i].def = def;
            shots[i].front = (uint8_t)front;
            return &shots[i];
        }
    }
    return 0;
}

static Entity *source_entity(const Projectile *s)
{
    return s->from_player ? world_player() : world_npc(s->source);
}

/* Integer square root (for normalising directions). */
static int isqrt(int v)
{
    int r = 0, bit = 1 << 30;
    if (v <= 0)
        return 0;
    while (bit > v)
        bit >>= 2;
    while (bit)
    {
        if (v >= r + bit)
        {
            v -= r + bit;
            r = (r >> 1) + bit;
        }
        else
            r >>= 1;
        bit >>= 2;
    }
    return r;
}

static void face_velocity(Entity *e, int vx, int vy, Direction fallback)
{
    int ax = vx < 0 ? -vx : vx, ay = vy < 0 ? -vy : vy;
    Direction d = (!vx && !vy) ? fallback : ax >= ay ? (vx < 0 ? DIR_LEFT : DIR_RIGHT) : (vy < 0 ? DIR_UP : DIR_DOWN);
    entity_animate(e, d, 1);
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
    Projectile *s = take_slot(def, p[PROJ_P_BANK], (p[PROJ_P_FLAGS] & PROJ_FLAG_FRONT) != 0);
    if (!s)
        return;

    int vx = p[PROJ_P_VX], vy = p[PROJ_P_VY];
    int dir_x = 0, dir_y = 0;   /* facing, for arcs and waves */
    if (p[PROJ_P_FACING])
    {
        int speed = p[PROJ_P_SPEED];
        dir_x = from->direction == DIR_RIGHT ? 1 : from->direction == DIR_LEFT ? -1 : 0;
        dir_y = from->direction == DIR_DOWN ? 1 : from->direction == DIR_UP ? -1 : 0;
        vx = dir_x * speed;
        vy = dir_y * speed;
    }

    /* Start at the source's centre, plus the offset (with "mirror",
     * flipped when it fires to the left, so a hitbox sits in front). */
    int off_x = p[PROJ_P_OFF_X];
    if ((p[PROJ_P_FLAGS] & PROJ_FLAG_MIRROR) && p[PROJ_P_FACING] && from->direction == DIR_LEFT)
        off_x = -off_x;
    int x = from->x + from->width / 2 - 8 + off_x;
    int y = from->y + from->height / 2 - 8 + p[PROJ_P_OFF_Y];
    s->x = x << 8;
    s->y = y << 8;
    s->vx = vx;
    s->vy = vy - p[PROJ_P_LIFT];
    s->life = p[PROJ_P_LIFE];
    s->group = (uint8_t)p[PROJ_P_GROUP];
    s->target = (uint8_t)p[PROJ_P_TARGET];
    s->flags = (uint8_t)p[PROJ_P_FLAGS];
    s->source = source == PLAYER_ACTOR_INDEX ? -1 : (int8_t)source;
    s->from_player = source == PLAYER_ACTOR_INDEX;
    s->hit_npcs = 0;
    s->path = (uint8_t)p[PROJ_P_PATH];
    s->landed = 0;
    s->returning = 0;
    s->bounces_left = (uint8_t)p[PROJ_P_BOUNCES];
    s->land = (uint8_t)p[PROJ_P_LAND];
    s->land_state = (uint8_t)p[PROJ_P_LAND_STATE];
    s->amp = p[PROJ_P_AMP];
    s->period = p[PROJ_P_PERIOD] > 0 ? p[PROJ_P_PERIOD] : 1;
    s->gravity = p[PROJ_P_GRAVITY];
    s->ret = p[PROJ_P_RETURN];
    s->linger = p[PROJ_P_LINGER];
    s->speed = p[PROJ_P_SPEED];
    s->off_x = (int16_t)off_x;
    s->off_y = p[PROJ_P_OFF_Y];
    s->age = 0;
    s->active = 1;

    Entity *e = s->e;
    e->x = x;
    e->y = y;
    e->anim_state = 0;
    face_velocity(e, vx, vy, (Direction)from->direction);
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

/* Is the projectile's centre (at path position x, y, 1/256 px) in a wall? */
static int in_wall(Projectile *s, int32_t x, int32_t y)
{
    Entity *e = s->e;
    return collision_test_rect((x >> 8) + e->col_ox + e->col_w / 2 - 1, (y >> 8) + e->col_oy + e->col_h / 2 - 1, 2, 2);
}

/* It hit a wall or the ground (not bouncing any more): what now? */
static int land(Projectile *s)
{
    if (s->land == PROJ_LAND_VANISH)
    {
        kill(s);
        return 0;
    }
    s->landed = 1;
    s->vx = s->vy = 0;
    if (s->land_state)
        entity_set_anim_state(s->e, s->land_state - 1);
    if (s->land == PROJ_LAND_LINGER)
        s->life = s->linger > 0 ? s->linger : 1;
    else
        s->life = 0;   /* stuck: stays until recalled or removed */
    return 1;
}

/* Move one step along its path; 0 = it's gone. */
static int step(Projectile *s)
{
    Entity *from = source_entity(s);

    if (s->flags & PROJ_FLAG_FOLLOW)
    {
        /* Melee: stays at its offset from whoever threw it. */
        if (!from)
        {
            kill(s);
            return 0;
        }
        s->x = (int32_t)(from->x + from->width / 2 - 8 + s->off_x) << 8;
        s->y = (int32_t)(from->y + from->height / 2 - 8 + s->off_y) << 8;
        return 1;
    }

    if (s->returning || (s->path == PROJ_PATH_BOOMERANG && s->age >= s->ret))
    {
        /* Home in on the thrower; caught when close. */
        if (!from)
        {
            kill(s);
            return 0;
        }
        s->returning = 1;
        int dx = ((from->x + from->width / 2 - 8) << 8) - s->x;
        int dy = ((from->y + from->height / 2 - 8) << 8) - s->y;
        int dist = isqrt((dx >> 4) * (dx >> 4) + (dy >> 4) * (dy >> 4)) << 4;
        int speed = s->speed > 0 ? s->speed : 512;
        if (dist <= speed + (6 << 8))
        {
            kill(s);
            return 0;
        }
        s->vx = (int)((int64_t)dx * speed / dist);
        s->vy = (int)((int64_t)dy * speed / dist);
        s->x += s->vx;
        s->y += s->vy;
        return 1;
    }

    s->vy += s->gravity;
    int32_t nx = s->x + s->vx, ny = s->y + s->vy;
    if (!(s->flags & PROJ_FLAG_WALLS))
    {
        int hit_x = in_wall(s, nx, s->y);
        int hit_y = !hit_x && in_wall(s, s->x, ny);
        if (hit_x && hit_y == 0 && in_wall(s, s->x, ny))
            hit_y = 1;
        if (hit_x || hit_y || in_wall(s, nx, ny))
        {
            if (s->bounces_left)
            {
                if (s->bounces_left != 255)
                    s->bounces_left--;
                if (hit_x)
                    s->vx = -s->vx;
                if (hit_y || !hit_x)
                    /* Off the ground with gravity, it loses some height. */
                    s->vy = s->gravity ? -s->vy * 3 / 4 : -s->vy;
                face_velocity(s->e, s->vx, s->vy, (Direction)s->e->direction);
                return 1;
            }
            return land(s);
        }
    }
    s->x = nx;
    s->y = ny;
    return 1;
}

/* The wave's sideways offset this frame, in px. */
static void wave_offset(const Projectile *s, int *ox, int *oy)
{
    *ox = *oy = 0;
    if (s->path != PROJ_PATH_WAVE || !s->amp || s->returning)
        return;
    int len = isqrt((s->vx >> 4) * (s->vx >> 4) + (s->vy >> 4) * (s->vy >> 4));
    if (!len)
        return;
    int sn = sprite_sin(s->age * 360 / s->period);   /* scaled by 4096 */
    int side = s->amp * sn / 4096;
    /* Perpendicular to the direction of travel. */
    *ox = -(s->vy >> 4) * side / len;
    *oy = (s->vx >> 4) * side / len;
}

void projectiles_command(int command, int sprite)
{
    for (int i = 0; i < PROJECTILE_MAX; i++)
    {
        Projectile *s = &shots[i];
        if (!s->active || (sprite >= 0 && s->def != &sprite_defs[sprite]))
            continue;
        if (command == PROJ_CMD_RECALL)
        {
            s->returning = 1;
            s->landed = 0;
            s->flags |= PROJ_FLAG_WALLS;   /* flies back through walls */
            if (s->life < 0)
                s->life = 0;
        }
        else
            kill(s);
    }
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
            s->age++;
            if (!s->landed && !step(s))
                continue;
            int ox, oy;
            wave_offset(s, &ox, &oy);
            e->x = (s->x >> 8) + ox;
            e->y = (s->y >> 8) + oy;
            if (s->life > 0 && --s->life == 0)
            {
                kill(s);
                continue;
            }
            /* Off screen (with a margin) - not ones stuck in place. */
            if (!(s->landed && s->land == PROJ_LAND_STICK) && !(s->flags & PROJ_FLAG_FOLLOW) && !s->returning &&
                (e->x < camera_x - 32 || e->x > camera_x + SCREEN_WIDTH + 16 ||
                 e->y < camera_y - 32 || e->y > camera_y + SCREEN_HEIGHT + 16))
            {
                kill(s);
                continue;
            }
            /* Stuck ones don't hurt anyone. */
            if (s->landed && s->land == PROJ_LAND_STICK)
            {
                entity_update_camera(e, camera_x, camera_y);
                continue;
            }

            int hit = 0;
            if (s->target & PROJ_TARGET_PLAYER)
            {
                Entity *p = world_player();
                if (p && p->solid && overlaps(e, p))
                {
                    const ScriptEvent *script = scene && s->group >= 1 && s->group <= 3 ? scene->player_hit[s->group - 1] : 0;
                    world_player_hit(script, e->x + 8, e->y + 8);
                    hit = 1;
                }
            }
            if (!hit && ((s->target & ~PROJ_TARGET_PLAYER) || (s->flags & PROJ_FLAG_ACTOR_BOUNCE)))
            {
                for (int n = 0; n < world_npc_count() && !hit; n++)
                {
                    const NpcDef *d = world_npc_def(n);
                    if (n == s->source || !world_npc_solid(n))
                        continue;
                    int damages = d->collision_group && ((s->target >> d->collision_group) & 1) &&
                                  !((s->hit_npcs >> n) & 1);
                    if (!damages && !(s->flags & PROJ_FLAG_ACTOR_BOUNCE))
                        continue;
                    Entity *npc = world_npc(n);
                    if (!overlaps(e, npc))
                        continue;
                    if (damages)
                    {
                        s->hit_npcs |= (uint16_t)(1u << n);
                        world_run_script(d->on_hit);
                        hit = 1;
                    }
                    if ((s->flags & PROJ_FLAG_ACTOR_BOUNCE) && !s->landed && !s->returning)
                    {
                        /* Bounce off it along the side it was hit from. */
                        int cx = (e->x + 8) - (npc->x + npc->width / 2);
                        int cy = (e->y + 8) - (npc->y + npc->height / 2);
                        if ((cx < 0 ? -cx : cx) >= (cy < 0 ? -cy : cy))
                            s->vx = cx < 0 ? -(s->vx < 0 ? -s->vx : s->vx) : (s->vx < 0 ? -s->vx : s->vx);
                        else
                            s->vy = cy < 0 ? -(s->vy < 0 ? -s->vy : s->vy) : (s->vy < 0 ? -s->vy : s->vy);
                        face_velocity(e, s->vx, s->vy, (Direction)e->direction);
                        if (!damages)
                            break;
                        hit = 0;   /* bounced: keeps going */
                        break;
                    }
                }
            }
            if (hit && !(s->flags & PROJ_FLAG_PIERCE) && !(s->landed && s->land == PROJ_LAND_LINGER) &&
                !(s->flags & PROJ_FLAG_FOLLOW))
            {
                kill(s);
                continue;
            }
        }
        entity_update_camera(e, camera_x, camera_y);
    }
}
