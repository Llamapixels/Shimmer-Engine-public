#include <stdint.h>

#include "modes.h"
#include "world.h"
#include "input.h"
#include "collision.h"
#include "camera.h"
#include "wav.h"
#include "script.h"
#include "projectile.h"
#include "raycast.h"

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
/* The player's sprite when the scene started: "state" engine settings
 * name its states (after Set Player Sprite they fall back to names). */
static const SpriteDef *scene_sprite = 0;
/* Platformer: an air jump / wall jump is showing its animation. */
static int air_jumped, kick_show;
/* "Crouch height": the standing collision box while crouched low. */
static int crouch_low, crouch_oy, crouch_h, crouch_stuck;
static const SpriteDef *crouch_def;

static int32_t pos_x, pos_y;          /* 1/256 px */
static int vel_x, vel_y;               /* 1/256 px per frame */
static int facing_left;
static int grounded;
static int coyote, jump_buffer, hold_timer, air_jumps, wall_jumps;
static int climbing, drop_timer;
static int dash_timer, dash_cooldown, dash_vx, dash_vy;
static int kb_timer;
static int step_done;   /* Top Down grid: a step just finished */
/* First Person 3D: the feet's height and speed up (1/256 units), on the
 * ground?, head bob, the weapon (actor index, where it sits, its Fire /
 * Alt Fire animation time left) and the time until the next shot. */
static int rc_h, rc_vz, rc_ground, rc_bob_phase, rc_bob_amp;
static int rc_weapon = -1, rc_weapon_x, rc_weapon_y, rc_weapon_timer, rc_fire_wait;
static int rc_jump_v;
static int kick_timer;                /* wall kick: gravity/steering off */
static int kick_anim;                 /* frames left of the wall kick animation */
static int was_grounded, was_sliding; /* for the land / wall slide sounds */
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
    scene_sprite = player->def;
    air_jumped = kick_show = crouch_low = crouch_stuck = 0;
    for (int i = 0; i < MS_COUNT; i++)
        mode_settings[i] = scene->settings ? scene->settings[i] : 0;

    pos_x = player->x << 8;
    pos_y = player->y << 8;
    vel_x = vel_y = 0;
    grounded = coyote = jump_buffer = hold_timer = air_jumps = wall_jumps = 0;
    climbing = drop_timer = dash_timer = dash_cooldown = kb_timer = push_timer = kick_timer = 0;
    step_done = 0;
    running = wall_sliding = floating = crouching = pushing = 0;
    tap_timer[0] = tap_timer[1] = 0;
    look_offset = 0;
    grid_left = 0;
    standing_on = -1;
    cam_ready = 0;
    triggers_fired[0] = triggers_fired[1] = 0;
    facing_left = player->direction == DIR_LEFT;
    was_grounded = 1;
    was_sliding = 0;
    collision_set_ignore_top(0);
    player->sprite.visible = mode != SCENE_MODE_LOGO;
    if (mode == SCENE_MODE_SHMUP)
        player->direction = scene->player_start_direction;

    if (mode == SCENE_MODE_RAYCAST && scene->raycast)
    {
        /* A small body (6x6) centred in the start cell, so one-cell
         * corridors fit. */
        if (player->width == 16)
        {
            player->x += 1;
            player->y += 1;
        }
        player->width = player->height = 6;
        entity_set_collision_box(player, 0, 0, 6, 6);
        pos_x = player->x << 8;
        pos_y = player->y << 8;
        static const int16_t FACING[4] = { 256, 768, 0, 512 };   /* down, up, right, left */
        raycast_enter(scene);
        raycast_set_body(MSET(RC_EYE), MSET(RC_STEP), MSET(RC_EYE) + 1);
        raycast_set_options(MSET(RC_FOV), MSET(RC_FOG), MSET(RC_ACTOR_TURN), MSET(RC_CROSSHAIR));
        rc_h = raycast_floor_under(player->x, player->y, 6, 6) << 8;
        rc_vz = 0;
        rc_ground = 1;
        rc_bob_phase = rc_bob_amp = 0;
        rc_fire_wait = rc_weapon_timer = 0;
        /* Jump speed for the jump height: v = sqrt(2 g h). */
        {
            static const int16_t GRAV[3] = { 16, 24, 36 };
            int g = GRAV[MSET(RC_GRAVITY) >= 0 && MSET(RC_GRAVITY) < 3 ? MSET(RC_GRAVITY) : 1];
            int want = 2 * g * (MSET(RC_JUMP_HEIGHT) << 8), v = 0;
            while ((v + 1) * (v + 1) <= want)
                v++;
            rc_jump_v = v + g / 2;
        }
        rc_weapon = scene->raycast ? scene->raycast->weapon : -1;
        if (rc_weapon >= 0)
        {
            Entity *w = world_npc(rc_weapon);
            if (w)
            {
                rc_weapon_x = w->x + scene->raycast->weapon_dx;
                rc_weapon_y = w->y + scene->raycast->weapon_dy;
            }
            else
                rc_weapon = -1;
        }
        raycast_set_eye(rc_h);
        raycast_set_view(pos_x + (3 << 8), pos_y + (3 << 8), FACING[player->direction & 3]);
    }
    else
    {
        raycast_leave();
        player->width = player->height = 16;
    }
}

/* A "sound" engine setting: a WAV index + 1, 0 = none. */
static void play_setting_sound(int setting)
{
    int v = mode_settings[setting];
    if (v > 0 && v <= wav_sound_count)
        wav_play(v - 1, WAV_CHANNEL_AUTO, 0);
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

/* Overlap (in px squared) of the player's box at (x, y) and NPC n's. */
static int npc_overlap(Entity *p, int x, int y, Entity *n)
{
    int ax = x + p->col_ox, ay = y + p->col_oy;
    int bx = n->x + n->col_ox, by = n->y + n->col_oy;
    int w = (ax + p->col_w < bx + n->col_w ? ax + p->col_w : bx + n->col_w) - (ax > bx ? ax : bx);
    int h = (ay + p->col_h < by + n->col_h ? ay + p->col_h : by + n->col_h) - (ay > by ? ay : by);
    return w > 0 && h > 0 ? w * h : 0;
}

/* 1 + the index of an NPC in the way of the player at (nx, ny), else
 * 0. Platform NPCs (Platformer) only block landing on them from above.
 * An NPC the player is already inside (it walked into the player) only
 * blocks moving further in, so the player can always walk back out. */
static int npc_in_way(Entity *p, int nx, int ny)
{
    for (int i = 0; i < world_npc_count(); i++)
    {
        if (!world_npc_solid(i))
            continue;
        Entity *n = world_npc(i);
        int area = npc_overlap(p, nx, ny, n);
        if (!area)
            continue;
        if (mode == SCENE_MODE_PLATFORM && world_npc_def(i)->platform)
        {
            int old_bottom = p->y + p->col_oy + p->col_h;
            if (!(ny > p->y && old_bottom <= n->y + n->col_oy))
                continue;
        }
        int now = npc_overlap(p, p->x, p->y, n);
        if (now && area <= now)
            continue;
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

/* Landed on a bouncy projectile this frame (projectiles_platform()). */
static int bounce_hit;

static int blocked(Entity *p, int nx, int ny)
{
    if (!entity_can_move(p, nx, ny))
        return 1;
    if (!p->collide)
        return 0;
    if (mode == SCENE_MODE_PLATFORM && on_ladder_top(p, ny))
        return 1;
    if (mode == SCENE_MODE_PLATFORM)
    {
        int on = projectiles_platform(p, nx, ny);
        if (on == 2)
            bounce_hit = 1;
        if (on)
            return 1;
    }
    return npc_in_way(p, nx, ny) != 0;
}

/* A solid tile (not an actor) right next to the player, `dx` = -1/+1:
 * what wall jumps and wall slides need. */
static int tile_wall(Entity *p, int dx)
{
    return p->collide && !entity_can_move(p, p->x + dx, p->y);
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
/* The engine setting that picks the animation state for `kind` in
 * this scene type, or -1. */
static int state_setting(int kind)
{
    if (mode == SCENE_MODE_PLATFORM)
    {
        switch (kind)
        {
        case MODE_ANIM_CROUCH:      return MS_PL_STATE_CROUCH;
        case MODE_ANIM_RUN:         return MS_PL_STATE_RUN;
        case MODE_ANIM_JUMP:        return MS_PL_STATE_JUMP;
        case MODE_ANIM_FALL:        return MS_PL_STATE_FALL;
        case MODE_ANIM_DOUBLE_JUMP: return MS_PL_STATE_DOUBLE_JUMP;
        case MODE_ANIM_WALL:        return MS_PL_STATE_WALL_SLIDE;
        case MODE_ANIM_WALL_KICK:   return MS_PL_STATE_WALL_KICK;
        case MODE_ANIM_CLIMB:       return MS_PL_STATE_CLIMB;
        case MODE_ANIM_DASH:        return MS_PL_STATE_DASH;
        case MODE_ANIM_FLOAT:       return MS_PL_STATE_FLOAT;
        case MODE_ANIM_KNOCKBACK:   return MS_PL_STATE_KNOCKBACK;
        }
    }
    else if (mode == SCENE_MODE_ADVENTURE)
    {
        switch (kind)
        {
        case MODE_ANIM_RUN:       return MS_AD_STATE_RUN;
        case MODE_ANIM_DASH:      return MS_AD_STATE_DASH;
        case MODE_ANIM_PUSH:      return MS_AD_STATE_PUSH;
        case MODE_ANIM_KNOCKBACK: return MS_AD_STATE_KNOCKBACK;
        }
    }
    else if (mode == SCENE_MODE_TOPDOWN)
    {
        switch (kind)
        {
        case MODE_ANIM_RUN:       return MS_TD_STATE_RUN;
        case MODE_ANIM_DASH:      return MS_TD_STATE_DASH;
        case MODE_ANIM_PUSH:      return MS_TD_STATE_PUSH;
        case MODE_ANIM_KNOCKBACK: return MS_TD_STATE_KNOCKBACK;
        }
    }
    return -1;
}

/* The state the player's sprite shows for `kind`: the one an engine
 * setting picked, else the state named after it. -1 = none. */
static int named_state(Entity *p, int kind)
{
    if (kind < 0 || !p->def)
        return -1;
    int s = state_setting(kind);
    if (s >= 0 && mode_settings[s] > 0 && p->def == scene_sprite && mode_settings[s] - 1 < p->def->state_count)
        return mode_settings[s] - 1;
    if (p->def->mode_states && p->def->mode_states[kind])
        return p->def->mode_states[kind] - 1;
    return -1;
}

static int use_named_state(Entity *p, int kind)
{
    if (p->script_state)
    {
        /* A script chose this state ("Set Actor State" on the player):
         * keep it, with its normal facing/moving animations. */
        if (p->anim_state != p->script_state - 1)
            entity_set_anim_state(p, p->script_state - 1);
        return 1;
    }
    int want = named_state(p, kind);
    /* Falling, an air jump and a wall jump use the jump state if they
     * have none of their own (decided before switching, so the jump
     * animation doesn't restart every frame). */
    if (want < 0 && (kind == MODE_ANIM_FALL || kind == MODE_ANIM_DOUBLE_JUMP || kind == MODE_ANIM_WALL_KICK))
        want = named_state(p, MODE_ANIM_JUMP);
    if (want < 0)
        want = 0;
    if (p->anim_state != want)
        entity_set_anim_state(p, want);
    return want != 0;
}

/* A "script" engine setting's custom script, started in the background. */
static void run_ability_script(int setting)
{
    int v = mode_settings[setting];
    if (v > 0 && cur_scene && cur_scene->ability_scripts && cur_scene->ability_scripts[v - 1])
        script_thread_start(cur_scene->ability_scripts[v - 1]);
}

/* "Crouch height": while crouching the collision box is shorter (the
 * feet stay put); standing back up waits for room overhead. */
static void crouch_box(Entity *p, int *crouching)
{
    int h = MSET(PL_CROUCH_HEIGHT);
    if (crouch_low && p->def != crouch_def)
        crouch_low = 0;   /* another sprite: its own box */
    if (*crouching && !crouch_low && h > 0 && h < p->col_h)
    {
        crouch_low = 1;
        crouch_def = p->def;
        crouch_oy = p->col_oy;
        crouch_h = p->col_h;
        p->col_oy = crouch_oy + crouch_h - h;
        p->col_h = h;
    }
    else if (!*crouching && crouch_low)
    {
        int oy = p->col_oy, ch = p->col_h;
        p->col_oy = crouch_oy;
        p->col_h = crouch_h;
        if (!entity_can_move(p, p->x, p->y))
        {
            /* No room to stand: stay down, but crawl so it can't trap. */
            p->col_oy = oy;
            p->col_h = ch;
            *crouching = 1;
            crouch_stuck = 1;
            return;
        }
        crouch_low = 0;
    }
    crouch_stuck = 0;
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

static const ScriptEvent *topdown_free_update(Entity *p);   /* below */

/* Top Down's "On step" script (grid movement): the custom script set
 * by the setting, or 0. */
static const ScriptEvent *step_script(void)
{
    int v = MSET(TD_ON_STEP);
    if (v > 0 && cur_scene && cur_scene->ability_scripts)
        return cur_scene->ability_scripts[v - 1];
    return 0;
}

static const ScriptEvent *topdown_update(Entity *p)
{
    int grid_mode = MSET(TD_GRID) != 0;
    /* Acceleration, dash, pushing, knockback or left/right-only facing:
     * the smooth free movement (Adventure's). */
    if (!grid_mode && (MSET(TD_ACC) || MSET(TD_DEC) || MSET(TD_DASH) || MSET(TD_PUSH) || MSET(TD_FACE_HORIZONTAL) ||
                       kb_timer > 0 || dash_timer > 0))
        return topdown_free_update(p);

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
                step_done = 1;
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

    /* Turn-based: a finished grid step runs "On step" (the player waits
     * for it, so enemies can take their turn). */
    if (step_done)
    {
        step_done = 0;
        const ScriptEvent *s = step_script();
        if (s)
            return s;
    }
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
        if (MSET(PL_DOUBLE_JUMP) && air_jumps < 1)
            air_jumps = 1;
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
        crouch_box(p, &crouching);
        running = MSET(PL_RUN) && input_held(MSET(PL_RUN_BUTTON));
        int max = running ? MSET(PL_RUN_VEL) : MSET(PL_WALK_VEL);
        int acc = running ? MSET(PL_RUN_ACC) : MSET(PL_WALK_ACC);

        if (grounded)
            kick_timer = 0;
        /* "Turn around in the air": 0 = only with air control, 1 = always,
         * 2 = never. */
        int air_turn = grounded || MSET(PL_AIR_TURN) == 1 || (MSET(PL_AIR_TURN) == 0 && MSET(PL_AIR_CONTROL));
        if (kick_timer > 0 || (!grounded && !MSET(PL_AIR_CONTROL)))
        {
            /* keep momentum */
            if (kick_timer == 0 && dir_x && air_turn)
                facing_left = dir_x < 0;
        }
        else if (dir_x && (!crouching || crouch_stuck))
        {
            if ((vel_x > 0 && dir_x < 0) || (vel_x < 0 && dir_x > 0))
                vel_x += dir_x * MSET(PL_TURN_ACC);
            else
                vel_x += dir_x * acc;
            if (vel_x > max || vel_x < -max)
                vel_x = approach(vel_x, dir_x * max, grounded ? MSET(PL_DEC) : MSET(PL_AIR_DEC));
            if (air_turn)
                facing_left = dir_x < 0;
        }
        else
        {
            vel_x = approach(vel_x, 0, grounded ? MSET(PL_DEC) : MSET(PL_AIR_DEC));
        }

        if (p->dir_locked && (p->direction == DIR_LEFT || p->direction == DIR_RIGHT))
            facing_left = p->direction == DIR_LEFT;

        /* Dash input "Down + Jump" (not where Down + Jump drops through
         * a platform): the jump becomes the dash. */
        int down_jump = MSET(PL_DASH) && MSET(PL_DASH_INPUT) == 5 && input_held(INPUT_DOWN) && jump_pressed &&
                        !(MSET(PL_DROP_THROUGH) && on_top_tile);
        if (down_jump)
            jump_buffer = 0;

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
            int wall = tile_wall(p, -1) ? -1 : tile_wall(p, 1) ? 1 : 0;
            if (grounded || coyote > 0)
            {
                play_setting_sound(MS_PL_SOUND_JUMP);
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
                kick_timer = MSET(PL_WALL_KICK_FRAMES);
                play_setting_sound(MSET(PL_SOUND_WALL_KICK) ? MS_PL_SOUND_WALL_KICK : MS_PL_SOUND_JUMP);
                kick_anim = kick_timer > 12 ? kick_timer : 12;
                kick_show = 12;
                air_jumped = 0;
                wall_jumps++;
                jump_buffer = 0;
            }
            else if (jump_pressed && air_jumps > 0)
            {
                play_setting_sound(MS_PL_SOUND_JUMP);
                vel_y = -MSET(PL_EXTRA_JUMP_VEL);
                hold_timer = MSET(PL_HOLD_FRAMES);
                air_jumps--;
                air_jumped = 1;
                kick_show = 0;
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
        if (kick_timer > 0)
            kick_timer--;       /* pushed up and away: no gravity yet */
        else
            vel_y += grav;
        int max_fall = MSET(PL_MAX_FALL);
        if (MSET(PL_FLOAT) && input_held(jump_btn) && vel_y > 0 && !grounded)
        {
            floating = 1;
            if (max_fall > MSET(PL_FLOAT_VEL))
                max_fall = MSET(PL_FLOAT_VEL);
        }
        if (MSET(PL_WALL_SLIDE) && !grounded && vel_y > 0 && dir_x && tile_wall(p, dir_x))
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
            (MSET(PL_DASH_INPUT) == 5 ? down_jump : dash_pressed(MSET(PL_DASH_INPUT), dir_x)))
        {
            int frames = MSET(PL_DASH_FRAMES) ? MSET(PL_DASH_FRAMES) : 1;
            dash_timer = frames;
            dash_vx = (facing_left ? -1 : 1) * (MSET(PL_DASH_DIST) * 256 / frames);
            dash_cooldown = frames + MSET(PL_DASH_READY);
            run_ability_script(MS_PL_ON_DASH);
        }
    }

    int hit_x = 0, hit_y = 0;
    int was_y = vel_y;
    bounce_hit = 0;
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
    if (hit_y && was_y > 0 && bounce_hit)
    {
        /* A bouncy projectile: springs up higher than a jump (and
         * higher still while the jump button is held). */
        play_setting_sound(MS_PL_SOUND_JUMP);
        vel_y = -(MSET(PL_JUMP_VEL) * 3 / 2);
        hold_timer = MSET(PL_HOLD_FRAMES);
        grounded = 0;
        kick_timer = 0;
    }
    else if (hit_y)
    {
        if (was_y > 0)
        {
            if (!was_grounded)
                play_setting_sound(MS_PL_SOUND_LAND);
            grounded = 1;
        }
        vel_y = 0;
        kick_timer = 0;
    }
    if (hit_x)
        kick_timer = 0;
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

    if (wall_sliding && !was_sliding)
        play_setting_sound(MS_PL_SOUND_WALL_SLIDE);
    was_sliding = wall_sliding;
    was_grounded = grounded;

    if (grounded)
        air_jumped = kick_show = 0;
    else if (kick_show > 0)
        kick_show--;

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
    else if (!grounded && vel_y < 0 && kick_show > 0)
        kind = MODE_ANIM_WALL_KICK;
    else if (!grounded && vel_y < 0 && air_jumped)
        kind = MODE_ANIM_DOUBLE_JUMP;
    else if (!grounded)
        kind = vel_y < 0 ? MODE_ANIM_JUMP : MODE_ANIM_FALL;
    else if (crouching)
        kind = MODE_ANIM_CROUCH;
    else if (running && moving)
        kind = MODE_ANIM_RUN;
    int named = use_named_state(p, kind);
    platform_sprite = is_platform_sprite(p);
    /* Lock Actor Direction: keep the facing it had. */
    if (p->dir_locked && (p->direction == DIR_LEFT || p->direction == DIR_RIGHT))
        facing_left = p->direction == DIR_LEFT;

    if (named || !platform_sprite)
    {
        entity_animate(p, facing_left ? DIR_LEFT : DIR_RIGHT, moving || climbing);
        if (climbing && !named && vel_y == 0)
            p->moving = 0;
    }
    else
    {
        /* platform_player sprites (GB Studio's order): idle 0/1,
         * jump 2/3, walk 4/5, climb 6. */
        if (grounded || wall_sliding)
            kick_anim = 0;
        else if (kick_anim > 0)
            kick_anim--;
        if (!climbing && !grounded && kb_timer == 0 && (wall_sliding || kick_anim > 0))
        {
            int extra = wall_sliding ? ENTITY_SLOT_WALL_SLIDE_R : ENTITY_SLOT_WALL_KICK_R;
            entity_animate_slot(p, facing_left ? DIR_LEFT : DIR_RIGHT, extra + (facing_left ? 1 : 0));
            slot = -1;
        }
        else if (climbing)
            slot = 6;
        else if (!grounded || kb_timer > 0)
            slot = facing_left ? 3 : 2;
        else if (moving)
            slot = facing_left ? 5 : 4;
        else
            slot = facing_left ? 1 : 0;
        if (slot >= 0)
            show_slot(p, slot);
    }

    if (grounded && input_pressed(MSET(PL_INTERACT)))
        return touching_actor_script(p);
    return 0;
}

/* ------------------------------------------------------------------ */
/* Adventure                                                           */

/* Smooth free movement with acceleration, dash, pushing and knockback:
 * Adventure's, and Top Down's when one of those options is on. Each
 * field is the mode's own setting (MS_*). */
typedef struct
{
    int eight_way, face_h, walk, acc, dec, run, run_button, run_vel;
    int dash, dash_input, dash_dist, dash_frames, dash_ready, on_dash;
    int push, push_delay, interact;
} FreeMove;

static const FreeMove ADVENTURE_MOVE = {
    MS_AD_EIGHT_WAY, MS_AD_FACE_HORIZONTAL, MS_AD_WALK_VEL, MS_AD_WALK_ACC, MS_AD_DEC, MS_AD_RUN, MS_AD_RUN_BUTTON,
    MS_AD_RUN_VEL, MS_AD_DASH, MS_AD_DASH_INPUT, MS_AD_DASH_DIST, MS_AD_DASH_FRAMES, MS_AD_DASH_READY, MS_AD_ON_DASH,
    MS_AD_PUSH, MS_AD_PUSH_DELAY, MS_AD_INTERACT,
};

static const FreeMove TOPDOWN_MOVE = {
    MS_TD_DIAGONAL, MS_TD_FACE_HORIZONTAL, MS_TD_SPEED, MS_TD_ACC, MS_TD_DEC, MS_TD_RUN, MS_TD_RUN_BUTTON,
    MS_TD_RUN_SPEED, MS_TD_DASH, MS_TD_DASH_INPUT, MS_TD_DASH_DIST, MS_TD_DASH_FRAMES, MS_TD_DASH_READY, MS_TD_ON_DASH,
    MS_TD_PUSH, MS_TD_PUSH_DELAY, MS_TD_INTERACT,
};

#define FSET(field) (mode_settings[c->field])

static const ScriptEvent *free_update(Entity *p, const FreeMove *c)
{
    int dx = input_held(INPUT_RIGHT) - input_held(INPUT_LEFT);
    int dy = input_held(INPUT_DOWN) - input_held(INPUT_UP);
    /* Acceleration / deceleration 0 = instant. */
    int acc = FSET(acc) > 0 ? FSET(acc) : 0x7FFF;
    int dec = FSET(dec) > 0 ? FSET(dec) : 0x7FFF;
    if (!FSET(eight_way) && dx && dy)
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
        vel_x = approach(vel_x, 0, dec / 2);
        vel_y = approach(vel_y, 0, dec / 2);
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
        running = FSET(run) && input_held(FSET(run_button));
        int max = running ? FSET(run_vel) : FSET(walk);
        /* Diagonals at ~0.7 of the speed, so they're not faster. */
        int axis_max = dx && dy ? max * 181 / 256 : max;
        vel_x = dx ? approach(vel_x, dx * axis_max, acc) : approach(vel_x, 0, dec);
        vel_y = dy ? approach(vel_y, dy * axis_max, acc) : approach(vel_y, 0, dec);

        if (FSET(dash) && dash_cooldown == 0 && dash_pressed(FSET(dash_input), dx))
        {
            int frames = FSET(dash_frames) ? FSET(dash_frames) : 1;
            int speed = FSET(dash_dist) * 256 / frames;
            run_ability_script(c->on_dash);
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
            dash_cooldown = frames + FSET(dash_ready);
        }
    }

    /* Facing. */
    Direction face = (Direction)p->direction;
    if (FSET(face_h))
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
    if (FSET(push) && (dx || dy) && !moved)
    {
        int n = npc_in_way(p, p->x + dx, p->y + dy);
        if (n && ++push_timer > FSET(push_delay))
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

    if (input_pressed(FSET(interact)))
        return world_npc_in_front(p);
    return 0;
}

#undef FSET

static const ScriptEvent *adventure_update(Entity *p)
{
    return free_update(p, &ADVENTURE_MOVE);
}

static const ScriptEvent *topdown_free_update(Entity *p)
{
    return free_update(p, &TOPDOWN_MOVE);
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

    /* Stay on screen; the scrolling edge pushes the player along. The
     * whole 16x16 sprite stays in view (or just the collision box). */
    int cx = camera_get_x(), cy = camera_get_y();
    int box = MSET(SH_KEEP_ON_SCREEN) == 1;
    int ox = box ? p->col_ox : 0, oy = box ? p->col_oy : 0;
    int bw = box ? p->col_w : p->width, bh = box ? p->col_h : p->height;
    int minx = cx - ox, maxx = cx + SCREEN_WIDTH - ox - bw;
    int miny = cy - oy, maxy = cy + SCREEN_HEIGHT - oy - bh;
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
/* First Person 3D                                                     */

/* How long a weapon animation slot (Fire / Alt Fire) plays once. */
static int slot_frames(const Entity *e, int slot)
{
    const SpriteDef *d = e->def;
    if (!d || e->anim_state >= d->state_count)
        return 0;
    int ai = d->state_maps[e->anim_state * ENTITY_STATE_SLOTS + 8 + slot];
    if (ai >= d->anim_count)
        return 0;
    const EntityAnimation *a = &d->anims[ai];
    int speed = e->anim_speed ? e->anim_speed : (a->speed ? a->speed : ENTITY_ANIM_SPEED);
    return a->frame_count * speed;
}

/* Fire (alt = 0) or Alt Fire: the weapon's animation, its sound and
 * script, and (Fire) the actor under the crosshair is hit. */
static void raycast_fire(int alt)
{
    if (rc_weapon >= 0)
    {
        Entity *w = world_npc(rc_weapon);
        if (w && w->def)
        {
            entity_animate_slot(w, (Direction)w->direction, alt);
            rc_weapon_timer = slot_frames(w, alt);
        }
    }
    play_setting_sound(alt ? MS_RC_SOUND_ALT : MS_RC_SOUND_FIRE);
    run_ability_script(alt ? MS_RC_ON_ALT_FIRE : MS_RC_ON_FIRE);
    if (!alt && MSET(RC_HITSCAN))
    {
        int n = raycast_aimed();
        if (n >= 0 && world_npc_def(n)->on_hit)
            world_run_script(world_npc_def(n)->on_hit);
    }
}

static const ScriptEvent *raycast_update(Entity *p)
{
    static const int TURN[3] = { 6, 10, 16 };   /* 1024ths of a turn per frame */
    int angle = raycast_angle();
    int turn = TURN[MSET(RC_TURN) >= 0 && MSET(RC_TURN) < 3 ? MSET(RC_TURN) : 1];
    int lr = input_held(INPUT_RIGHT) - input_held(INPUT_LEFT);
    int shoulder = input_held(INPUT_R) - input_held(INPUT_L);
    int turning, strafe;
    if (MSET(RC_CONTROLS) == 1)
    {
        /* Left / Right step sideways, L / R turn. */
        turning = shoulder;
        strafe = lr;
    }
    else
    {
        turning = lr;
        strafe = MSET(RC_STRAFE) ? shoulder : 0;
    }
    angle = (angle + turning * turn) & 1023;

    int fwd = input_held(INPUT_UP) - input_held(INPUT_DOWN);
    int c = raycast_cos(angle), s = raycast_sin(angle);
    int running = MSET(RC_RUN) && input_held(MSET(RC_RUN_BUTTON));
    int speed = running ? MSET(RC_RUN_SPEED) : MSET(RC_WALK);
    int dx = ((fwd * c - strafe * s) * speed) >> 12;
    int dy = ((fwd * s + strafe * c) * speed) >> 12;

    /* Heights decide where it can go (steps, ledges, low ceilings);
     * actors still block. One pixel at a time per axis. */
    int stand = rc_h >> 8;
    int ox = p->x, oy = p->y;
    pos_x += dx;
    while ((pos_x >> 8) != p->x)
    {
        int nx = p->x + ((pos_x >> 8) > p->x ? 1 : -1);
        if (!raycast_box_ok(nx, p->y, p->width, p->height, stand) || npc_in_way(p, nx, p->y))
        {
            pos_x = p->x << 8;
            break;
        }
        p->x = nx;
    }
    pos_y += dy;
    while ((pos_y >> 8) != p->y)
    {
        int ny = p->y + ((pos_y >> 8) > p->y ? 1 : -1);
        if (!raycast_box_ok(p->x, ny, p->width, p->height, stand) || npc_in_way(p, p->x, ny))
        {
            pos_y = p->y << 8;
            break;
        }
        p->y = ny;
    }
    int walked = p->x != ox || p->y != oy;

    /* Up and down: steps and lifts carry the feet up at once, small drops
     * (stairs down, a lift going down) keep them on the floor, bigger
     * ones fall; jumping. */
    static const int16_t GRAV[3] = { 16, 24, 36 };
    int g = GRAV[MSET(RC_GRAVITY) >= 0 && MSET(RC_GRAVITY) < 3 ? MSET(RC_GRAVITY) : 1];
    int under = raycast_floor_under(p->x, p->y, p->width, p->height) << 8;
    int top = (raycast_ceil_over(p->x, p->y, p->width, p->height) - MSET(RC_EYE) - 1) << 8;
    if (rc_ground)
    {
        if (under >= rc_h || rc_h - under <= 256 * MSET(RC_STEP))
            rc_h = under;
        else
        {
            rc_ground = 0;
            rc_vz = 0;
        }
    }
    if (rc_ground && MSET(RC_JUMP) && input_pressed(MSET(RC_JUMP_BUTTON)))
    {
        rc_ground = 0;
        rc_vz = rc_jump_v;
        play_setting_sound(MS_RC_SOUND_JUMP);
    }
    if (!rc_ground)
    {
        rc_vz -= g;
        rc_h += rc_vz;
        if (rc_h > top && rc_vz > 0)
        {
            rc_h = top > under ? top : under;   /* head hits the ceiling */
            rc_vz = 0;
        }
        if (rc_h <= under)
        {
            rc_h = under;
            rc_vz = 0;
            rc_ground = 1;
        }
    }

    /* Head bob while walking on the ground. */
    static const int16_t BOB[3] = { 0, 96, 192 };   /* 1/256 units */
    int bob_max = BOB[MSET(RC_BOB) >= 0 && MSET(RC_BOB) < 3 ? MSET(RC_BOB) : 0];
    int want = walked && rc_ground ? 256 : 0;
    rc_bob_amp += rc_bob_amp < want ? 32 : rc_bob_amp > want ? -32 : 0;
    if (rc_bob_amp)
        rc_bob_phase = (rc_bob_phase + ((running ? 40 : 28) * speed >> 8)) & 1023;
    int bob = (raycast_sin(rc_bob_phase * 2) * bob_max >> 12) * rc_bob_amp >> 8;
    raycast_set_eye(rc_h + bob);

    /* The nearest of the four directions, for everything else that
     * reads the player's facing (projectiles, Set Actor Direction...). */
    int q = ((angle + 128) & 1023) >> 8;   /* 0 right, 1 down, 2 left, 3 up */
    static const Direction DIRS[4] = { DIR_RIGHT, DIR_DOWN, DIR_LEFT, DIR_UP };
    entity_animate(p, DIRS[q], walked);

    raycast_set_view(pos_x + (p->width << 7), pos_y + (p->height << 7), angle);

    /* The weapon: sways while walking, Fire / Alt Fire play once. */
    if (rc_weapon >= 0)
    {
        Entity *w = world_npc(rc_weapon);
        if (w)
        {
            int sway = MSET(RC_WEAPON_BOB) ? rc_bob_amp : 0;
            w->x = rc_weapon_x + ((raycast_cos(rc_bob_phase) * 4 >> 12) * sway >> 8);
            int up = raycast_sin(rc_bob_phase * 2);
            w->y = rc_weapon_y + (((up < 0 ? -up : up) * 3 >> 12) * sway >> 8);
            if (rc_weapon_timer > 0)
            {
                if (--rc_weapon_timer == 0)
                    entity_animate(w, (Direction)w->direction, walked);
            }
            else
                entity_animate(w, (Direction)w->direction, walked);
        }
    }
    if (rc_fire_wait > 0)
        rc_fire_wait--;
    else if (MSET(RC_FIRE) && input_pressed(MSET(RC_FIRE_BUTTON)))
    {
        rc_fire_wait = MSET(RC_FIRE_RATE);
        raycast_fire(0);
    }
    else if (MSET(RC_ALT_FIRE) && input_pressed(MSET(RC_ALT_BUTTON)))
    {
        rc_fire_wait = MSET(RC_FIRE_RATE);
        raycast_fire(1);
    }

    /* Talk to the actor just ahead. */
    if (input_pressed(MSET(RC_INTERACT)))
    {
        int cx = p->x + p->width / 2 + ((c * 10) >> 12);
        int cy = p->y + p->height / 2 + ((s * 10) >> 12);
        int i = world_npc_at(cx, cy);
        if (i >= 0 && world_npc_def(i)->on_interact)
            return world_npc_def(i)->on_interact;
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
    case SCENE_MODE_RAYCAST:     return raycast_update(player);
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
        run_ability_script(MS_PL_ON_KNOCKBACK);
    }
    else if ((mode == SCENE_MODE_ADVENTURE && MSET(AD_KNOCKBACK)) ||
             (mode == SCENE_MODE_TOPDOWN && MSET(TD_KNOCKBACK) && !MSET(TD_GRID)))
    {
        int adv = mode == SCENE_MODE_ADVENTURE;
        int kb_vel = adv ? MSET(AD_KB_VEL) : MSET(TD_KB_VEL);
        kb_timer = adv ? MSET(AD_KB_FRAMES) : MSET(TD_KB_FRAMES);
        int dxs = p->x + p->width / 2 - from_x, dys = p->y + p->height / 2 - from_y;
        if (dxs < 0) dxs = -dxs;
        if (dys < 0) dys = -dys;
        /* Mostly along the axis it came from. */
        vel_x = dxs >= dys / 2 ? away_x * kb_vel : 0;
        vel_y = dys >= dxs / 2 ? away_y * kb_vel : 0;
        dash_timer = 0;
        run_ability_script(adv ? MS_AD_ON_KNOCKBACK : MS_TD_ON_KNOCKBACK);
    }
}
