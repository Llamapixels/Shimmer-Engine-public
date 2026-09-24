#include <stdint.h>

#include "modes.h"
#include "world.h"
#include "input.h"
#include "collision.h"
#include "camera.h"

/*
 * The scene types. Each one's update function moves the player for a
 * frame of normal play; everything else (scripts, dialogue, the pause
 * menu, actors' own movement) is main.c's.
 *
 * Positions are kept in 1/256 px (pos_x/pos_y) so slow speeds and
 * accelerations work; if something else moves the player (a script, a
 * scene change) the fractional position is re-synced from the Entity.
 */

int16_t mode_settings[MS_COUNT];

static int mode = SCENE_MODE_TOPDOWN;
static const SceneDef *cur_scene = 0;

static int32_t pos_x, pos_y;          /* 1/256 px */
static int vel_x, vel_y;               /* 1/256 px per frame */
static int facing_left;
static int grounded;
static int coyote, jump_buffer, hold_timer, air_jumps, wall_jumps;
static int climbing, drop_timer;
static int dash_timer, dash_cooldown, dash_vx, dash_vy;
static int kb_timer;
static int push_timer;
static int running, wall_sliding, floating, crouching, pushing;
static int tap_timer[2], tap_dir;     /* double-tap dash (left, right) */
static int look_offset;
static int grid_left, grid_dx, grid_dy;
static int standing_on = -1, standing_x, standing_y;   /* moving platforms */
static int32_t cam_x, cam_y;          /* Shoot Em' Up camera, 1/256 px */
static int cam_ready;
static uint32_t triggers_fired[2];    /* Shoot Em' Up on-screen triggers */

/* ------------------------------------------------------------------ */

void modes_set_setting(int index, int value)
{
    if (index >= 0 && index < MS_COUNT)
        mode_settings[index] = (int16_t)value;
}

int modes_current(void)
{
    return mode;
}

int modes_player_visible(void)
{
    return mode != SCENE_MODE_LOGO;
}

int modes_uses_step_triggers(void)
{
    if (mode == SCENE_MODE_POINTNCLICK || mode == SCENE_MODE_LOGO)
        return 0;
    if (mode == SCENE_MODE_SHMUP && MSET(SH_TRIGGERS_ON_SCREEN))
        return 0;
    return 1;
}

void modes_scene_enter(const SceneDef *scene, Entity *player)
{
    cur_scene = scene;
    mode = scene->mode;
    for (int i = 0; i < MS_COUNT; i++)
        mode_settings[i] = scene->settings ? scene->settings[i] : 0;

    pos_x = player->x << 8;
    pos_y = player->y << 8;
    vel_x = vel_y = 0;
    grounded = coyote = jump_buffer = hold_timer = air_jumps = wall_jumps = 0;
    climbing = drop_timer = dash_timer = dash_cooldown = kb_timer = push_timer = 0;
    running = wall_sliding = floating = crouching = pushing = 0;
    tap_timer[0] = tap_timer[1] = 0;
    look_offset = 0;
    grid_left = 0;
    standing_on = -1;
    cam_ready = 0;
    triggers_fired[0] = triggers_fired[1] = 0;
    facing_left = player->direction == DIR_LEFT;
    collision_set_ignore_top(0);
    player->sprite.visible = mode != SCENE_MODE_LOGO;
    if (mode == SCENE_MODE_SHMUP)
        player->direction = scene->player_start_direction;
}

/* Something else moved the player: pick up its new position. */
static void sync_position(Entity *p)
{
    if ((pos_x >> 8) != p->x)
        pos_x = p->x << 8;
    if ((pos_y >> 8) != p->y)
        pos_y = p->y << 8;
}

/* ------------------------------------------------------------------ */
/* Collision                                                           */

/* 1 + the index of an NPC in the way of the player at (nx, ny), else
 * 0. Platform NPCs (Platformer) only block landing on them from above. */
static int npc_in_way(Entity *p, int nx, int ny)
{
    int px = nx + p->col_ox, py = ny + p->col_oy;
    for (int i = 0; i < world_npc_count(); i++)
    {
        if (!world_npc_solid(i))
            continue;
        Entity *n = world_npc(i);
        int x0 = n->x + n->col_ox, y0 = n->y + n->col_oy;
        if (!(px < x0 + n->col_w && px + p->col_w > x0 && py < y0 + n->col_h && py + p->col_h > y0))
            continue;
        if (mode == SCENE_MODE_PLATFORM && world_npc_def(i)->platform)
        {
            int old_bottom = p->y + p->col_oy + p->col_h;
            if (!(ny > p->y && old_bottom <= y0))
                continue;
        }
        return i + 1;
    }
    return 0;
}

static int tile_at_px(int x, int y)
{
    if (x < 0 || y < 0)
        return COLLISION_SOLID;
    return collision_get_tile(x >> 3, y >> 3);
}

/* Platformer: the top of a ladder is something to stand on. */
static int on_ladder_top(Entity *p, int ny)
{
    if (climbing || drop_timer > 0 || !MSET(PL_LADDERS))
        return 0;
    int bottom = p->y + p->col_oy + p->col_h;      /* first row below the feet */
    if (ny <= p->y || (bottom & 7))
        return 0;
    for (int x = p->x + p->col_ox; x < p->x + p->col_ox + p->col_w; x += 4)
        if (tile_at_px(x, bottom) == COLLISION_LADDER && tile_at_px(x, bottom - 1) != COLLISION_LADDER)
            return 1;
    return 0;
}

static int blocked(Entity *p, int nx, int ny)
{
    if (!entity_can_move(p, nx, ny))
        return 1;
    if (!p->collide)
        return 0;
    if (mode == SCENE_MODE_PLATFORM && on_ladder_top(p, ny))
        return 1;
    return npc_in_way(p, nx, ny) != 0;
}

/* Move up to `d` px along one axis, a pixel at a time. Returns 1 if
 * something got in the way. */
static int move_axis(Entity *p, int dx, int dy)
{
    int step_x = dx > 0 ? 1 : dx < 0 ? -1 : 0;
    int step_y = dy > 0 ? 1 : dy < 0 ? -1 : 0;
    int n = dx ? (dx < 0 ? -dx : dx) : (dy < 0 ? -dy : dy);
    for (int i = 0; i < n; i++)
    {
        if (blocked(p, p->x + step_x, p->y + step_y))
            return 1;
        p->x += step_x;
        p->y += step_y;
    }
    return 0;
}

/* Apply vel_x/vel_y to the fractional position and move. Sets *hit_x /
 * *hit_y when a wall stopped that axis. */
static void move_by_velocity(Entity *p, int *hit_x, int *hit_y)
{
    *hit_x = *hit_y = 0;
    pos_x += vel_x;
    int tx = pos_x >> 8;
    if (tx != p->x && move_axis(p, tx - p->x, 0))
    {
        *hit_x = 1;
        pos_x = p->x << 8;
    }
    pos_y += vel_y;
    int ty = pos_y >> 8;
    if (ty != p->y && move_axis(p, 0, ty - p->y))
    {
        *hit_y = 1;
        pos_y = p->y << 8;
    }
}

static int approach(int v, int target, int step)
{
    if (v < target)
        return v + step > target ? target : v + step;
    if (v > target)
        return v - step < target ? target : v - step;
    return v;
}

/* The script of an actor with On Interact that the player is touching. */
static const ScriptEvent *touching_actor_script(Entity *p)
{
    int px = p->x + p->col_ox - 2, py = p->y + p->col_oy - 2;
    int pw = p->col_w + 4, ph = p->col_h + 4;
    for (int i = 0; i < world_npc_count(); i++)
    {
        if (!world_npc_solid(i) || !world_npc_def(i)->on_interact)
            continue;
        Entity *n = world_npc(i);
        int x0 = n->x + n->col_ox, y0 = n->y + n->col_oy;
        if (px < x0 + n->col_w && px + pw > x0 && py < y0 + n->col_h && py + ph > y0)
            return world_npc_def(i)->on_interact;
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* Animation                                                           */

/* Switch to the sprite's state named for `kind` ("jump", "run"...), or
 * back to its first state when it has none. Returns 1 if it had one. */
static int use_named_state(Entity *p, int kind)
{
    int want = 0;
    if (kind >= 0 && p->def && p->def->mode_states && p->def->mode_states[kind])
        want = p->def->mode_states[kind] - 1;
    if (p->anim_state != want)
        entity_set_anim_state(p, want);
    return want != 0;
}

static int is_platform_sprite(Entity *p)
{
    return p->def && (p->def->platform_mask >> p->anim_state) & 1;
}

/* GB Studio's 8 animation slots (idle R/L/U/D, moving R/L/U/D) as
 * facing + moving. */
static void show_slot(Entity *p, int slot)
{
    static const uint8_t dir[4] = { DIR_RIGHT, DIR_LEFT, DIR_UP, DIR_DOWN };
    entity_animate(p, (Direction)dir[slot & 3], slot >= 4);
}

static int dash_pressed(int choice, int dir_x)
{
    switch (choice)
    {
    case 0:   /* double tap */
    {
        int hit = 0;
        for (int i = 0; i < 2; i++)
        {
            uint16_t key = i ? INPUT_RIGHT : INPUT_LEFT;
            if (tap_timer[i] > 0)
                tap_timer[i]--;
            if (input_pressed(key))
            {
                if (tap_timer[i] > 0 && tap_dir == i)
                    hit = 1;
                tap_timer[i] = 15;
                tap_dir = i;
            }
        }
        (void)dir_x;
        return hit;
    }
    case 1: return input_pressed(INPUT_A);
    case 2: return input_pressed(INPUT_B);
    case 3: return input_pressed(INPUT_L);
    default: return input_pressed(INPUT_R);
    }
}

/* ------------------------------------------------------------------ */
/* Top Down                                                            */

static const ScriptEvent *topdown_update(Entity *p)
{
    int speed = MSET(TD_SPEED);
    running = MSET(TD_RUN) && input_held(MSET(TD_RUN_BUTTON));
    if (running)
        speed = MSET(TD_RUN_SPEED);

    int dx = input_held(INPUT_RIGHT) - input_held(INPUT_LEFT);
    int dy = input_held(INPUT_DOWN) - input_held(INPUT_UP);
    int grid = MSET(TD_GRID) == 1 ? 8 : MSET(TD_GRID) == 2 ? 16 : 0;

    if ((grid || !MSET(TD_DIAGONAL)) && dx && dy)
    {
        /* One axis at a time: keep the way we're already facing. */
        if (p->direction == DIR_LEFT || p->direction == DIR_RIGHT)
            dy = 0;
        else
            dx = 0;
    }

    int moved = 0;
    Direction face = (Direction)p->direction;
    if (grid)
    {
        if (grid_left == 0 && (dx || dy))
        {
            face = dx > 0 ? DIR_RIGHT : dx < 0 ? DIR_LEFT : dy > 0 ? DIR_DOWN : DIR_UP;
            /* Walk to the next grid line. */
            int target_x = p->x, target_y = p->y;
            if (dx > 0) target_x = (p->x / grid + 1) * grid;
            if (dx < 0) target_x = ((p->x + grid - 1) / grid - 1) * grid;
            if (dy > 0) target_y = (p->y / grid + 1) * grid;
            if (dy < 0) target_y = ((p->y + grid - 1) / grid - 1) * grid;
            int dist = (target_x - p->x) + (target_y - p->y);
            if (dist < 0) dist = -dist;
            /* Only step if the whole way is clear. */
            int ok = 1;
            for (int i = 1; i <= dist && ok; i++)
                ok = !blocked(p, p->x + dx * i, p->y + dy * i);
            if (ok && dist)
            {
                grid_left = dist << 8;
                grid_dx = dx;
                grid_dy = dy;
            }
        }
        if (grid_left > 0)
        {
            int step = speed < grid_left ? speed : grid_left;
            grid_left -= step;
            pos_x += grid_dx * step;
            pos_y += grid_dy * step;
            int tx = pos_x >> 8, ty = pos_y >> 8;
            if (grid_left == 0)
            {
                /* Land exactly on the line. */
                pos_x = (int32_t)tx << 8;
                pos_y = (int32_t)ty << 8;
            }
            if (move_axis(p, tx - p->x, 0) || move_axis(p, 0, ty - p->y))
            {
                grid_left = 0;
                pos_x = p->x << 8;
                pos_y = p->y << 8;
            }
            moved = 1;
        }
    }
    else if (dx || dy)
    {
        face = dx > 0 ? DIR_RIGHT : dx < 0 ? DIR_LEFT : dy > 0 ? DIR_DOWN : DIR_UP;
        /* Keep facing the old way along a held axis (diagonals). */
        if (dx && dy && ((p->direction == DIR_UP && dy < 0) || (p->direction == DIR_DOWN && dy > 0)))
            face = (Direction)p->direction;
        vel_x = dx * speed;
        vel_y = dy * speed;
        int hx, hy;
        int ox = p->x, oy = p->y;
        move_by_velocity(p, &hx, &hy);
        moved = p->x != ox || p->y != oy;
    }
    else
    {
        pos_x = p->x << 8;
        pos_y = p->y << 8;
    }

    use_named_state(p, running && moved ? MODE_ANIM_RUN : -1);
    entity_animate(p, face, moved);

    if (grid_left == 0 && input_pressed(MSET(TD_INTERACT)))
        return world_npc_in_front(p);
    return 0;
}

/* ------------------------------------------------------------------ */
/* Platformer                                                          */

static int ladder_at(int x, int y)
{
    return tile_at_px(x, y) == COLLISION_LADDER;
}

static const ScriptEvent *platform_update(Entity *p)
{
    int cx = p->x + p->col_ox + p->col_w / 2;
    int feet = p->y + p->col_oy + p->col_h;      /* first pixel below */
    int dir_x = input_held(INPUT_RIGHT) - input_held(INPUT_LEFT);
    int jump_btn = MSET(PL_JUMP_BUTTON);

    /* Carried by a moving platform. */
    if (standing_on >= 0 && standing_on < world_npc_count())
    {
        Entity *n = world_npc(standing_on);
        int dx = n->x - standing_x, dy = n->y - standing_y;
        if (dx)
            move_axis(p, dx, 0);
        if (dy)
            move_axis(p, 0, dy);
        pos_x = p->x << 8;
        pos_y = p->y << 8;
        feet = p->y + p->col_oy + p->col_h;
        cx = p->x + p->col_ox + p->col_w / 2;
    }

    collision_set_ignore_top(drop_timer > 0);
    grounded = vel_y >= 0 && blocked(p, p->x, p->y + 1);
    int on_top_tile = 0;
    if (grounded)
    {
        coyote = MSET(PL_COYOTE);
        air_jumps = MSET(PL_EXTRA_JUMPS);
        wall_jumps = 0;
        for (int x = p->x + p->col_ox; x < p->x + p->col_ox + p->col_w; x += 4)
            if (tile_at_px(x, feet) == COLLISION_TOP)
                on_top_tile = 1;
    }
    else if (coyote > 0)
    {
        coyote--;
    }
    if (dash_cooldown > 0)
        dash_cooldown--;
    if (drop_timer > 0)
        drop_timer--;

    int jump_pressed = input_pressed(jump_btn);
    if (jump_pressed)
        jump_buffer = MSET(PL_JUMP_BUFFER) + 1;

    running = floating = wall_sliding = crouching = 0;

    if (kb_timer > 0)
    {
        kb_timer--;
        vel_y += MSET(PL_GRAV);
        if (vel_y > MSET(PL_MAX_FALL))
            vel_y = MSET(PL_MAX_FALL);
    }
    else if (dash_timer > 0)
    {
        dash_timer--;
        vel_x = dash_vx;
        vel_y = 0;
    }
    else if (climbing)
    {
        vel_x = 0;
        vel_y = 0;
        int dy = input_held(INPUT_DOWN) - input_held(INPUT_UP);
        vel_y = dy * MSET(PL_CLIMB_VEL);
        /* Off the ladder at the top or bottom, or by jumping / walking off. */
        int still = ladder_at(cx, p->y + p->col_oy + p->col_h / 2) || ladder_at(cx, feet);
        if (!still || (dy > 0 && grounded && !ladder_at(cx, feet)))
            climbing = 0;
        else if (jump_pressed && MSET(PL_JUMP))
        {
            climbing = 0;
            vel_y = -MSET(PL_JUMP_VEL);
            hold_timer = MSET(PL_HOLD_FRAMES);
            jump_buffer = 0;
        }
        else if (dir_x && !dy)
        {
            climbing = 0;
        }
    }
    else
    {
        crouching = MSET(PL_CROUCH) && grounded && input_held(INPUT_DOWN);
        running = MSET(PL_RUN) && input_held(MSET(PL_RUN_BUTTON));
        int max = running ? MSET(PL_RUN_VEL) : MSET(PL_WALK_VEL);
        int acc = running ? MSET(PL_RUN_ACC) : MSET(PL_WALK_ACC);

        if (!grounded && !MSET(PL_AIR_CONTROL))
        {
            /* keep momentum */
        }
        else if (dir_x && !crouching)
        {
            if ((vel_x > 0 && dir_x < 0) || (vel_x < 0 && dir_x > 0))
                vel_x += dir_x * MSET(PL_TURN_ACC);
            else
                vel_x += dir_x * acc;
            if (vel_x > max || vel_x < -max)
                vel_x = approach(vel_x, dir_x * max, grounded ? MSET(PL_DEC) : MSET(PL_AIR_DEC));
            facing_left = dir_x < 0;
        }
        else
        {
            vel_x = approach(vel_x, 0, grounded ? MSET(PL_DEC) : MSET(PL_AIR_DEC));
        }

        /* Drop through a one-way platform: Down + Jump. */
        if (MSET(PL_DROP_THROUGH) && on_top_tile && input_held(INPUT_DOWN) && jump_pressed)
        {
            drop_timer = 8;
            jump_buffer = 0;
            grounded = 0;
            coyote = 0;
        }

        if (jump_buffer > 0 && MSET(PL_JUMP))
        {
            int wall = blocked(p, p->x - 1, p->y) ? -1 : blocked(p, p->x + 1, p->y) ? 1 : 0;
            if (grounded || coyote > 0)
            {
                vel_y = -MSET(PL_JUMP_VEL);
                hold_timer = MSET(PL_HOLD_FRAMES);
                coyote = 0;
                jump_buffer = 0;
                grounded = 0;
            }
            else if (jump_pressed && MSET(PL_WALL_JUMP) && wall &&
                     (MSET(PL_WALL_JUMPS_MAX) == 0 || wall_jumps < MSET(PL_WALL_JUMPS_MAX)))
            {
                vel_y = -MSET(PL_JUMP_VEL);
                vel_x = -wall * MSET(PL_WALL_KICK);
                facing_left = wall > 0;
                hold_timer = MSET(PL_HOLD_FRAMES);
                wall_jumps++;
                jump_buffer = 0;
            }
            else if (jump_pressed && air_jumps > 0)
            {
                vel_y = -MSET(PL_EXTRA_JUMP_VEL);
                hold_timer = MSET(PL_HOLD_FRAMES);
                air_jumps--;
                jump_buffer = 0;
            }
        }
        if (jump_buffer > 0)
            jump_buffer--;

        /* Gravity; lighter while the jump button is held on the way up. */
        int grav = MSET(PL_GRAV);
        if (input_held(jump_btn) && vel_y < 0 && hold_timer > 0)
        {
            grav = MSET(PL_HOLD_GRAV);
            hold_timer--;
        }
        if (!input_held(jump_btn))
            hold_timer = 0;
        vel_y += grav;
        int max_fall = MSET(PL_MAX_FALL);
        if (MSET(PL_FLOAT) && input_held(jump_btn) && vel_y > 0 && !grounded)
        {
            floating = 1;
            if (max_fall > MSET(PL_FLOAT_VEL))
                max_fall = MSET(PL_FLOAT_VEL);
        }
        if (MSET(PL_WALL_SLIDE) && !grounded && vel_y > 0 && dir_x && blocked(p, p->x + dir_x, p->y))
        {
            wall_sliding = 1;
            if (max_fall > MSET(PL_WALL_SLIDE_VEL))
                max_fall = MSET(PL_WALL_SLIDE_VEL);
        }
        if (vel_y > max_fall)
            vel_y = max_fall;

        /* Grab a ladder: Up on one, or Down from the top of one. */
        if (MSET(PL_LADDERS) &&
            ((input_held(INPUT_UP) && ladder_at(cx, p->y + p->col_oy + p->col_h / 2)) ||
             (input_held(INPUT_DOWN) && ladder_at(cx, feet) && !crouching)))
        {
            climbing = 1;
            vel_x = vel_y = 0;
            /* Centre on the ladder column. */
            int col = (cx >> 3) * 8 + 4;
            int nx = col - p->col_ox - p->col_w / 2;
            if (!blocked(p, nx, p->y))
            {
                p->x = nx;
                pos_x = p->x << 8;
            }
        }

        /* Dash. */
        if (MSET(PL_DASH) && dash_cooldown == 0 && (grounded || MSET(PL_DASH_AIR)) &&
            dash_pressed(MSET(PL_DASH_INPUT), dir_x))
        {
            int frames = MSET(PL_DASH_FRAMES) ? MSET(PL_DASH_FRAMES) : 1;
            dash_timer = frames;
            dash_vx = (facing_left ? -1 : 1) * (MSET(PL_DASH_DIST) * 256 / frames);
            dash_cooldown = frames + MSET(PL_DASH_READY);
        }
    }

    int hit_x = 0, hit_y = 0;
    int was_y = vel_y;
    if (climbing)
    {
        /* On a ladder only its own column matters, so a ladder through
         * a one-tile gap works for players wider than a tile. */
        pos_y += vel_y;
        int ty = pos_y >> 8, step = ty > p->y ? 1 : -1;
        while (p->y != ty)
        {
            int top = p->y + step + p->col_oy, bottom = top + p->col_h - 1;
            if (collision_test_point(cx, step < 0 ? top : bottom))
            {
                pos_y = p->y << 8;
                break;
            }
            p->y += step;
        }
    }
    else
        move_by_velocity(p, &hit_x, &hit_y);
    if (hit_x)
    {
        vel_x = 0;
        if (dash_timer > 0)
            dash_timer = 0;
    }
    if (hit_y)
    {
        if (was_y > 0)
            grounded = 1;
        vel_y = 0;
    }
    collision_set_ignore_top(0);

    /* What are we standing on (for moving platforms)? */
    standing_on = -1;
    if (vel_y >= 0)
    {
        int n = npc_in_way(p, p->x, p->y + 1);
        if (n)
        {
            standing_on = n - 1;
            standing_x = world_npc(standing_on)->x;
            standing_y = world_npc(standing_on)->y;
        }
    }

    /* Animation. */
    int moving = vel_x != 0;
    int kind = -1, slot;
    int platform_sprite;
    if (kb_timer > 0)
        kind = MODE_ANIM_KNOCKBACK;
    else if (climbing)
        kind = MODE_ANIM_CLIMB;
    else if (dash_timer > 0)
        kind = MODE_ANIM_DASH;
    else if (!grounded && wall_sliding)
        kind = MODE_ANIM_WALL;
    else if (!grounded && floating)
        kind = MODE_ANIM_FLOAT;
    else if (!grounded)
        kind = vel_y < 0 ? MODE_ANIM_JUMP : MODE_ANIM_FALL;
    else if (crouching)
        kind = MODE_ANIM_CROUCH;
    else if (running && moving)
        kind = MODE_ANIM_RUN;
    int named = use_named_state(p, kind);
    if (!named && kind == MODE_ANIM_FALL)
        named = use_named_state(p, MODE_ANIM_JUMP);
    platform_sprite = is_platform_sprite(p);

    if (named || !platform_sprite)
    {
        entity_animate(p, facing_left ? DIR_LEFT : DIR_RIGHT, moving || climbing);
        if (climbing && !named && vel_y == 0)
            p->moving = 0;
    }
    else
    {
        /* platform_player sprites: idle 0/1, walk 2/3, jump 4/5, climb 6. */
        if (climbing)
            slot = 6;
        else if (!grounded || kb_timer > 0)
            slot = facing_left ? 5 : 4;
        else if (moving)
            slot = facing_left ? 3 : 2;
        else
            slot = facing_left ? 1 : 0;
        show_slot(p, slot);
    }

    if (grounded && input_pressed(MSET(PL_INTERACT)))
        return touching_actor_script(p);
    return 0;
}

/* ------------------------------------------------------------------ */
/* Adventure                                                           */

static const ScriptEvent *adventure_update(Entity *p)
{
    int dx = input_held(INPUT_RIGHT) - input_held(INPUT_LEFT);
    int dy = input_held(INPUT_DOWN) - input_held(INPUT_UP);
    if (!MSET(AD_EIGHT_WAY) && dx && dy)
    {
        if (p->direction == DIR_LEFT || p->direction == DIR_RIGHT)
            dy = 0;
        else
            dx = 0;
    }
    if (dash_cooldown > 0)
        dash_cooldown--;
    running = pushing = 0;

    if (kb_timer > 0)
    {
        kb_timer--;
        vel_x = approach(vel_x, 0, MSET(AD_DEC) / 2);
        vel_y = approach(vel_y, 0, MSET(AD_DEC) / 2);
    }
    else if (dash_timer > 0)
    {
        dash_timer--;
        vel_x = dash_vx;
        vel_y = dash_vy;
        if (dash_timer == 0)
            vel_x = vel_y = 0;
    }
    else
    {
        running = MSET(AD_RUN) && input_held(MSET(AD_RUN_BUTTON));
        int max = running ? MSET(AD_RUN_VEL) : MSET(AD_WALK_VEL);
        /* Diagonals at ~0.7 of the speed, so they're not faster. */
        int axis_max = dx && dy ? max * 181 / 256 : max;
        vel_x = dx ? approach(vel_x, dx * axis_max, MSET(AD_WALK_ACC)) : approach(vel_x, 0, MSET(AD_DEC));
        vel_y = dy ? approach(vel_y, dy * axis_max, MSET(AD_WALK_ACC)) : approach(vel_y, 0, MSET(AD_DEC));

        if (MSET(AD_DASH) && dash_cooldown == 0 && dash_pressed(MSET(AD_DASH_INPUT), dx))
        {
            int frames = MSET(AD_DASH_FRAMES) ? MSET(AD_DASH_FRAMES) : 1;
            int speed = MSET(AD_DASH_DIST) * 256 / frames;
            int fx = dx, fy = dy;
            if (!fx && !fy)
            {
                fx = p->direction == DIR_RIGHT ? 1 : p->direction == DIR_LEFT ? -1 : 0;
                fy = p->direction == DIR_DOWN ? 1 : p->direction == DIR_UP ? -1 : 0;
            }
            if (fx && fy)
                speed = speed * 181 / 256;
            dash_vx = fx * speed;
            dash_vy = fy * speed;
            dash_timer = frames;
            dash_cooldown = frames + MSET(AD_DASH_READY);
        }
    }

    /* Facing. */
    Direction face = (Direction)p->direction;
    if (MSET(AD_FACE_HORIZONTAL))
    {
        if (dx)
            face = dx > 0 ? DIR_RIGHT : DIR_LEFT;
        else if (face != DIR_LEFT && face != DIR_RIGHT)
            face = DIR_RIGHT;
    }
    else if (dx || dy)
    {
        int keep = (face == DIR_UP && dy < 0) || (face == DIR_DOWN && dy > 0) ||
                   (face == DIR_LEFT && dx < 0) || (face == DIR_RIGHT && dx > 0);
        if (!keep)
            face = dx > 0 ? DIR_RIGHT : dx < 0 ? DIR_LEFT : dy > 0 ? DIR_DOWN : DIR_UP;
    }

    int ox = p->x, oy = p->y;
    int hit_x, hit_y;
    move_by_velocity(p, &hit_x, &hit_y);
    if (hit_x) vel_x = 0;
    if (hit_y) vel_y = 0;
    int moved = p->x != ox || p->y != oy;

    /* Pushing an actor. */
    if (MSET(AD_PUSH) && (dx || dy) && !moved)
    {
        int n = npc_in_way(p, p->x + dx, p->y + dy);
        if (n && ++push_timer > MSET(AD_PUSH_DELAY))
        {
            Entity *npc = world_npc(n - 1);
            pushing = 1;
            int step_x = dx, step_y = dy;
            if (step_x && step_y)
                step_y = 0;
            if (entity_can_move(npc, npc->x + step_x, npc->y + step_y))
            {
                npc->x += step_x;
                npc->y += step_y;
            }
        }
        else if (n)
            pushing = 1;
    }
    else
    {
        push_timer = 0;
    }

    int kind = kb_timer > 0 ? MODE_ANIM_KNOCKBACK : dash_timer > 0 ? MODE_ANIM_DASH :
               pushing ? MODE_ANIM_PUSH : running && moved ? MODE_ANIM_RUN : -1;
    use_named_state(p, kind);
    entity_animate(p, face, moved || pushing);

    if (input_pressed(MSET(AD_INTERACT)))
        return world_npc_in_front(p);
    return 0;
}

/* ------------------------------------------------------------------ */
/* Shoot Em' Up                                                        */

static void shmup_scroll(void)
{
    if (!cam_ready)
    {
        cam_x = camera_get_x() << 8;
        cam_y = camera_get_y() << 8;
        cam_ready = 1;
    }
    int s = MSET(SH_SCROLL_SPEED);
    switch (cur_scene->player_start_direction)
    {
    case DIR_RIGHT: cam_x += s; break;
    case DIR_LEFT:  cam_x -= s; break;
    case DIR_UP:    cam_y -= s; break;
    default:        cam_y += s; break;
    }
    camera_set_position(cam_x >> 8, cam_y >> 8);
    /* At the end of the map: stop there. */
    if (camera_get_x() != (cam_x >> 8))
        cam_x = camera_get_x() << 8;
    if (camera_get_y() != (cam_y >> 8))
        cam_y = camera_get_y() << 8;
}

static const ScriptEvent *shmup_update(Entity *p)
{
    shmup_scroll();
    int horizontal = cur_scene->player_start_direction == DIR_LEFT || cur_scene->player_start_direction == DIR_RIGHT;
    int dx = input_held(INPUT_RIGHT) - input_held(INPUT_LEFT);
    int dy = input_held(INPUT_DOWN) - input_held(INPUT_UP);
    if (MSET(SH_LOCK_PERPENDICULAR))
    {
        if (horizontal)
            dx = 0;
        else
            dy = 0;
    }
    int speed = MSET(SH_PLAYER_SPEED);
    if (dx && dy)
        speed = speed * 181 / 256;
    vel_x = dx * speed;
    vel_y = dy * speed;
    int hit_x, hit_y;
    move_by_velocity(p, &hit_x, &hit_y);

    /* Stay on screen; the scrolling edge pushes the player along. */
    int cx = camera_get_x(), cy = camera_get_y();
    int minx = cx - p->col_ox, maxx = cx + SCREEN_WIDTH - p->col_ox - p->col_w;
    int miny = cy - p->col_oy, maxy = cy + SCREEN_HEIGHT - p->col_oy - p->col_h;
    int want_x = p->x < minx ? minx : p->x > maxx ? maxx : p->x;
    int want_y = p->y < miny ? miny : p->y > maxy ? maxy : p->y;
    int crushed = 0;
    if (want_x != p->x && move_axis(p, want_x - p->x, 0))
        crushed = 1;
    if (want_y != p->y && move_axis(p, 0, want_y - p->y))
        crushed = 1;
    if (crushed)
    {
        /* Pushed into a wall by the screen: squeeze through it. */
        p->x = want_x;
        p->y = want_y;
    }
    pos_x = p->x << 8;
    pos_y = p->y << 8;

    if ((hit_x || hit_y || crushed) && MSET(SH_WALL_HIT_GROUP) && cur_scene)
        world_player_hit(cur_scene->player_hit[MSET(SH_WALL_HIT_GROUP) - 1], p->x + dx * 8, p->y + dy * 8);

    use_named_state(p, -1);
    entity_animate(p, (Direction)cur_scene->player_start_direction, dx || dy);

    /* Triggers as they scroll into view. */
    if (MSET(SH_TRIGGERS_ON_SCREEN) && cur_scene->doors)
    {
        for (int i = 0; i < cur_scene->door_count && i < 64; i++)
        {
            const DoorDef *d = &cur_scene->doors[i];
            if (triggers_fired[i >> 5] & (1u << (i & 31)))
                continue;
            int x = d->x * 8, y = d->y * 8, w = d->width * 8, h = d->height * 8;
            if (x < cx + SCREEN_WIDTH && x + w > cx && y < cy + SCREEN_HEIGHT && y + h > cy)
            {
                triggers_fired[i >> 5] |= 1u << (i & 31);
                return d->on_enter;
            }
        }
    }
    return 0;
}

/* ------------------------------------------------------------------ */
/* Point and Click                                                     */

static const DoorDef *door_at(int x, int y)
{
    if (!cur_scene || !cur_scene->doors)
        return 0;
    for (int i = 0; i < cur_scene->door_count; i++)
    {
        const DoorDef *d = &cur_scene->doors[i];
        if (x >= d->x * 8 && x < (d->x + d->width) * 8 && y >= d->y * 8 && y < (d->y + d->height) * 8)
            return d;
    }
    return 0;
}

static const ScriptEvent *pointnclick_update(Entity *p)
{
    int dx = input_held(INPUT_RIGHT) - input_held(INPUT_LEFT);
    int dy = input_held(INPUT_DOWN) - input_held(INPUT_UP);
    int speed = MSET(PC_SPEED);
    if (dx && dy)
        speed = speed * 181 / 256;
    pos_x += dx * speed;
    pos_y += dy * speed;
    /* The cursor goes anywhere on the map. */
    int maxx = (cur_scene->width * 8 - 1) << 8, maxy = (cur_scene->height * 8 - 1) << 8;
    if (pos_x < 0) pos_x = 0;
    if (pos_y < 0) pos_y = 0;
    if (pos_x > maxx) pos_x = maxx;
    if (pos_y > maxy) pos_y = maxy;
    p->x = pos_x >> 8;
    p->y = pos_y >> 8;

    /* The cursor's tip is its top-left corner. */
    int n = world_npc_at(p->x, p->y);
    const ScriptEvent *npc_script = n >= 0 ? world_npc_def(n)->on_interact : 0;
    const DoorDef *door = npc_script ? 0 : door_at(p->x, p->y);
    int hover = npc_script || door;

    if (!use_named_state(p, hover ? MODE_ANIM_HOVER : -1))
    {
        if (p->def && (p->def->cursor_mask >> p->anim_state) & 1)
            entity_animate(p, hover ? DIR_RIGHT : DIR_DOWN, 0);   /* cursor sprites: slot 0 = hover */
        else
            entity_animate(p, (Direction)p->direction, dx || dy);
    }

    if (input_pressed(MSET(PC_INTERACT)))
        return npc_script ? npc_script : door ? door->on_enter : 0;
    return 0;
}

/* ------------------------------------------------------------------ */

const ScriptEvent *modes_update(Entity *player)
{
    sync_position(player);
    switch (mode)
    {
    case SCENE_MODE_PLATFORM:    return platform_update(player);
    case SCENE_MODE_ADVENTURE:   return adventure_update(player);
    case SCENE_MODE_SHMUP:       return shmup_update(player);
    case SCENE_MODE_POINTNCLICK: return pointnclick_update(player);
    case SCENE_MODE_LOGO:        return 0;
    default:                     return topdown_update(player);
    }
}

int modes_camera(Entity *player, int *center_x, int *center_y)
{
    if (mode == SCENE_MODE_SHMUP && cam_ready)
    {
        *center_x = (cam_x >> 8) + SCREEN_WIDTH / 2;
        *center_y = (cam_y >> 8) + SCREEN_HEIGHT / 2;
        return 1;
    }
    if (mode == SCENE_MODE_LOGO)
    {
        *center_x = SCREEN_WIDTH / 2;
        *center_y = SCREEN_HEIGHT / 2;
        return 1;
    }
    if (mode == SCENE_MODE_PLATFORM && MSET(PL_LOOK_AHEAD))
    {
        int target = facing_left ? -MSET(PL_LOOK_AHEAD) : MSET(PL_LOOK_AHEAD);
        look_offset = approach(look_offset, target, 1);
        *center_x = player->x + player->width / 2 + look_offset;
        *center_y = player->y + player->height / 2;
        return 1;
    }
    return 0;
}

void modes_player_hit(Entity *p, int from_x, int from_y)
{
    int away_x = p->x + p->width / 2 >= from_x ? 1 : -1;
    int away_y = p->y + p->height / 2 >= from_y ? 1 : -1;
    if (mode == SCENE_MODE_PLATFORM && MSET(PL_KNOCKBACK))
    {
        kb_timer = MSET(PL_KB_FRAMES);
        vel_x = away_x * MSET(PL_KB_VEL_X);
        vel_y = -MSET(PL_KB_VEL_Y);
        climbing = dash_timer = 0;
        facing_left = away_x > 0;
    }
    else if (mode == SCENE_MODE_ADVENTURE && MSET(AD_KNOCKBACK))
    {
        kb_timer = MSET(AD_KB_FRAMES);
        int dxs = p->x + p->width / 2 - from_x, dys = p->y + p->height / 2 - from_y;
        if (dxs < 0) dxs = -dxs;
        if (dys < 0) dys = -dys;
        /* Mostly along the axis it came from. */
        vel_x = dxs >= dys / 2 ? away_x * MSET(AD_KB_VEL) : 0;
        vel_y = dys >= dxs / 2 ? away_y * MSET(AD_KB_VEL) : 0;
        dash_timer = 0;
    }
}
