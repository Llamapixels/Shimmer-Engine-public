#include <stddef.h>
#include <gba_base.h>   /* EWRAM_BSS */
#include <stdint.h>

#include "script.h"
#include "dialogue.h"
#include "audio.h"
#include "music.h"
#include "state.h"
#include "actor.h"
#include "input.h"
#include "camera.h"
#include "rng.h"
#include "timer.h"
#include "transition.h"
#include "save.h"
#include "background.h"
#include "scene.h"
#include "game.h"
#include "ui.h"
#include "modes.h"
#include "projectile.h"
#include "world.h"
#include "collision.h"
#include "wav.h"

/*
 * One running script. Slot 0 is the "main" script (script_start) -
 * the one the player waits on; slots 1..SCRIPT_MAX_THREADS are
 * background threads. Everything a script can be paused on lives in
 * here, so any number of them can be mid-wait at once.
 */
typedef struct
{
    const ScriptEvent *base;    /* start of the running script */
    const ScriptEvent *ip;      /* next instruction; 0 = not running */
    int wait_frames;

    /* SCRIPT_ACTOR_MOVE_TO and friends: which actor is mid-walk and
     * where it's headed. -1 = no actor moving. (PLAYER_ACTOR_INDEX is
     * -2, so "moving" is tracked separately.) */
    int moving;
    int moving_actor;
    int moving_x;
    int moving_y;

    /* SCRIPT_WAIT_BUTTON: which buttons (ORed INPUT_* bits) the script
     * is waiting on. 0 = not waiting. */
    uint16_t waiting_buttons;

    /* This thread opened the dialogue box currently on screen and
     * waits for it to close. pending_choice_jump: SCRIPT_CHOICE's
     * option-B target, resolved when it does (-1 = none). */
    int owns_dialogue;
    int pending_choice_jump;

    /* SCRIPT_CAMERA_MOVE_TO. */
    int camera_panning;
    int camera_x;
    int camera_y;
    int camera_speed;

    /* SCRIPT_FADE_OUT/IN with "wait" set. */
    int fade_waiting;

    /* SCRIPT_ACTOR_MOVE_EX: 0x80 | its MOVE_F_* flags (0 = plain move). */
    int move_flags;
} ScriptThread;

#define THREAD_COUNT (1 + SCRIPT_MAX_THREADS)
static ScriptThread threads[THREAD_COUNT];

static int pending_switch = 0;
static int pending_scene = 0;
static int pending_x = 0;
static int pending_y = 0;
static int pending_dir = -1;

/* Frame counter for SCRIPT_RATE_LIMIT / EXPR_TIME / reseeding. */
static uint16_t frame_time = 0;

/* GB Studio-style timer scripts (SCRIPT_TIMER_SET): rerun `script` in
 * a background thread every `interval` frames. */
#define TIMER_SLOTS 4
static struct
{
    const ScriptEvent *script;
    int interval;
    int left;
    int thread;     /* handle of the last run, to avoid overlapping it */
} timer_slots[TIMER_SLOTS];

/* Input scripts, one per button bit (INPUT_A .. INPUT_L). */
#define INPUT_BITS 10
static const ScriptEvent *input_scripts[INPUT_BITS];
static uint16_t input_override_mask = 0;
/* Per button: freeze the player while its script runs (else it runs as a
 * background thread, whose handle is kept so it never runs twice at once). */
static uint8_t input_freeze[INPUT_BITS];
static int input_thread[INPUT_BITS];

static void play_sound_effect(int id)
{
    switch ((SoundEffect)id)
    {
    case SOUND_DOOR: audio_play_door(); break;
    case SOUND_SAVE: audio_play_save(); break;
    case SOUND_ITEM: audio_play_item(); break;
    case SOUND_BLIP: default: audio_play_blip(); break;
    }
}

static void thread_begin(ScriptThread *t, const ScriptEvent *script)
{
    t->base = script;
    t->ip = script;
    t->wait_frames = 0;
    t->moving = 0;
    t->waiting_buttons = 0;
    t->owns_dialogue = 0;
    t->pending_choice_jump = -1;
    t->camera_panning = 0;
    t->fade_waiting = 0;
    t->move_flags = 0;
}

void script_start(const ScriptEvent *script)
{
    thread_begin(&threads[0], script);
}

int script_thread_start(const ScriptEvent *script)
{
    if (!script)
        return 0;

    for (int i = 1; i < THREAD_COUNT; i++)
    {
        if (!threads[i].ip)
        {
            thread_begin(&threads[i], script);
            return i;
        }
    }
    return 0;
}

static void thread_stop(int handle)
{
    if (handle < 1 || handle >= THREAD_COUNT)
        return;
    threads[handle].ip = 0;
}

int script_active(void)
{
    return threads[0].ip != 0;
}

void script_request_scene_switch(int scene_index, int x, int y, int direction)
{
    pending_scene = scene_index;
    pending_x = x;
    pending_y = y;
    pending_dir = direction;
    pending_switch = 1;
}

/* Line Of Sight watchers (SCRIPT_LINE_OF_SIGHT), one per actor. */
#define SIGHT_SLOTS 8
typedef struct
{
    const ScriptEvent *script;   /* 0 = free */
    int8_t actor;
    uint8_t range;               /* tiles */
    uint8_t walls;               /* solid tiles block the view */
    uint8_t in_view;             /* fire again only after the player leaves */
} SightWatch;
static SightWatch sight[SIGHT_SLOTS];

void script_reset_scene(void)
{
    for (int i = 0; i < SIGHT_SLOTS; i++)
        sight[i].script = 0;
    for (int i = 1; i < THREAD_COUNT; i++)
        threads[i].ip = 0;
    for (int i = 0; i < TIMER_SLOTS; i++)
        timer_slots[i].script = 0;
    for (int i = 0; i < INPUT_BITS; i++)
    {
        input_scripts[i] = 0;
        input_freeze[i] = 0;
        input_thread[i] = 0;
    }
    input_override_mask = 0;
}

/* ------------------------------------------------------------------ */
/* Snapshots for the scene stack's "real pause" (game_scene_push full). */

#define SNAP_SLOTS 8
static ScriptThread snap_threads[SNAP_SLOTS][THREAD_COUNT] EWRAM_BSS;
static const ScriptEvent *snap_inputs[SNAP_SLOTS][INPUT_BITS] EWRAM_BSS;
static uint8_t snap_input_freeze[SNAP_SLOTS][INPUT_BITS] EWRAM_BSS;
static uint16_t snap_override[SNAP_SLOTS] EWRAM_BSS;

void script_snapshot_save(int slot, int exclude_thread)
{
    if (slot < 0 || slot >= SNAP_SLOTS)
        return;
    for (int i = 0; i < THREAD_COUNT; i++)
    {
        snap_threads[slot][i] = threads[i];
        /* No dialogue survives a scene change. */
        snap_threads[slot][i].owns_dialogue = 0;
    }
    /* The script storing the scene is about to leave it: when the scene
     * comes back, it must not carry on and leave again. */
    if (exclude_thread >= 0 && exclude_thread < THREAD_COUNT)
        snap_threads[slot][exclude_thread].ip = 0;
    for (int i = 0; i < INPUT_BITS; i++)
    {
        snap_inputs[slot][i] = input_scripts[i];
        snap_input_freeze[slot][i] = input_freeze[i];
    }
    snap_override[slot] = input_override_mask;
}

void script_snapshot_restore(int slot)
{
    if (slot < 0 || slot >= SNAP_SLOTS)
        return;
    for (int i = 0; i < THREAD_COUNT; i++)
        threads[i] = snap_threads[slot][i];
    for (int i = 0; i < INPUT_BITS; i++)
    {
        input_scripts[i] = snap_inputs[slot][i];
        input_freeze[i] = snap_input_freeze[slot][i];
        input_thread[i] = 0;
    }
    input_override_mask = snap_override[slot];
}

/* ------------------------------------------------------------------ */
/* Expressions                                                          */
/* ------------------------------------------------------------------ */

static int isqrt(int v)
{
    if (v <= 0)
        return 0;
    int r = 0;
    int bit = 1 << 30;
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
        {
            r >>= 1;
        }
        bit >>= 2;
    }
    return r;
}

static int saved_slot_value(int slot, int var, int want_var)
{
    SaveData data;
    if (!save_read_slot(slot, &data))
        return 0;
    if (!want_var)
        return 1;
    if (var < 0 || var >= MAX_VARIABLES)
        return 0;
    return data.variables[var];
}

#define EXPR_STACK 16

int16_t script_eval_expr(const int16_t *rpn)
{
    int stack[EXPR_STACK];
    int sp = 0;

    if (!rpn)
        return 0;

    /* The compiler checks stack depth, so these guards only protect
     * against hand-edited data. */
#define POP()   (sp > 0 ? stack[--sp] : 0)
#define PUSH(v) do { if (sp < EXPR_STACK) stack[sp++] = (v); } while (0)

    for (;;)
    {
        int tok = *rpn++;
        int x, y;

        switch ((ExprToken)tok)
        {
        case EXPR_END:
            return (int16_t)(sp > 0 ? stack[sp - 1] : 0);

        case EXPR_CONST: PUSH(*rpn++); break;
        case EXPR_VAR:   PUSH(var_get(*rpn++)); break;

        case EXPR_ADD: y = POP(); x = POP(); PUSH(x + y); break;
        case EXPR_SUB: y = POP(); x = POP(); PUSH(x - y); break;
        case EXPR_MUL: y = POP(); x = POP(); PUSH(x * y); break;
        case EXPR_DIV: y = POP(); x = POP(); PUSH(y ? x / y : 0); break;
        case EXPR_MOD: y = POP(); x = POP(); PUSH(y ? x % y : 0); break;
        case EXPR_EQ:  y = POP(); x = POP(); PUSH(x == y); break;
        case EXPR_NE:  y = POP(); x = POP(); PUSH(x != y); break;
        case EXPR_LT:  y = POP(); x = POP(); PUSH(x < y); break;
        case EXPR_LE:  y = POP(); x = POP(); PUSH(x <= y); break;
        case EXPR_GT:  y = POP(); x = POP(); PUSH(x > y); break;
        case EXPR_GE:  y = POP(); x = POP(); PUSH(x >= y); break;
        case EXPR_AND: y = POP(); x = POP(); PUSH(x && y); break;
        case EXPR_OR:  y = POP(); x = POP(); PUSH(x || y); break;
        case EXPR_NOT: x = POP(); PUSH(!x); break;
        case EXPR_BAND: y = POP(); x = POP(); PUSH(x & y); break;
        case EXPR_BOR:  y = POP(); x = POP(); PUSH(x | y); break;
        case EXPR_BXOR: y = POP(); x = POP(); PUSH(x ^ y); break;
        case EXPR_BNOT: x = POP(); PUSH(~x); break;
        case EXPR_SHL: y = POP(); x = POP(); PUSH((y >= 0 && y < 32) ? x << y : 0); break;
        case EXPR_SHR: y = POP(); x = POP(); PUSH((y >= 0 && y < 32) ? x >> y : 0); break;
        case EXPR_NEG: x = POP(); PUSH(-x); break;
        case EXPR_ABS: x = POP(); PUSH(x < 0 ? -x : x); break;
        case EXPR_MIN: y = POP(); x = POP(); PUSH(x < y ? x : y); break;
        case EXPR_MAX: y = POP(); x = POP(); PUSH(x > y ? x : y); break;
        case EXPR_RND: x = POP(); PUSH(x > 0 ? rng_range(0, x - 1) : 0); break;
        case EXPR_ISQRT: x = POP(); PUSH(isqrt(x)); break;

        case EXPR_ACTOR_X:   x = POP(); PUSH(actor_get_x(x)); break;
        case EXPR_ACTOR_Y:   x = POP(); PUSH(actor_get_y(x)); break;
        case EXPR_ACTOR_DIR: x = POP(); PUSH(actor_get_direction(x)); break;
        case EXPR_HELD:      x = POP(); PUSH((input_held_mask() & (uint16_t)x) != 0); break;
        case EXPR_PRESSED:   x = POP(); PUSH(input_pressed((uint16_t)x) != 0); break;
        case EXPR_FLAG:      x = POP(); PUSH(flag_get(x)); break;
        case EXPR_ITEM:      x = POP(); PUSH(item_has(x)); break;
        case EXPR_SAVED:     x = POP(); PUSH(saved_slot_value(x, 0, 0)); break;
        case EXPR_PEEK:      y = POP(); x = POP(); PUSH(saved_slot_value(x, y, 1)); break;
        case EXPR_SCENE:     PUSH(game_scene_index()); break;
        case EXPR_TIME:      PUSH(frame_time); break;

        default:
            return 0;   /* unknown token - bad data */
        }
    }
#undef POP
#undef PUSH
}

/* ------------------------------------------------------------------ */
/* Stepping one thread                                                  */
/* ------------------------------------------------------------------ */

static void start_move(ScriptThread *t, int actor, int x, int y)
{
    t->moving = 1;
    t->moving_actor = actor;
    t->moving_x = x;
    t->moving_y = y;
    t->move_flags = 0;
}

/* Runs `t` until it pauses or ends. Returns without doing anything if
 * it's still waiting on something. */
static void thread_step(ScriptThread *t, int is_main)
{
    if (!t->ip)
        return;

    if (t->owns_dialogue)
    {
        /* Still showing a page from a SCRIPT_TEXT, or a choice box
         * that hasn't been answered yet. */
        if (dialogue_active())
            return;

        t->owns_dialogue = 0;

        /* A choice box just closed. Resolve which branch to take
         * exactly once, then keep running this same frame. */
        if (t->pending_choice_jump >= 0)
        {
            int jump = t->pending_choice_jump;
            t->pending_choice_jump = -1;

            if (dialogue_last_choice() != 0)
                t->ip = t->base + jump;
        }
    }

    if (t->wait_frames > 0)
    {
        t->wait_frames--;
        return;
    }

    if (t->moving)
    {
        int still = t->move_flags
            ? actor_step_toward_ex(t->moving_actor, t->moving_x, t->moving_y,
                                   (t->move_flags >> MOVE_F_TYPE_SHIFT) & 3, t->move_flags & MOVE_F_COLLIDE)
            : actor_step_toward(t->moving_actor, t->moving_x, t->moving_y);
        if (still)
            return;

        t->moving = 0;   /* arrived (or blocked) - fall through and continue */
    }

    if (t->camera_panning)
    {
        if (camera_step_to(t->camera_x, t->camera_y, t->camera_speed))
            return;

        t->camera_panning = 0;
    }

    if (t->waiting_buttons != 0)
    {
        if (!input_pressed(t->waiting_buttons))
            return;

        t->waiting_buttons = 0;
    }

    if (t->fade_waiting)
    {
        if (transition_active())
            return;

        t->fade_waiting = 0;
    }

    /*
     * Safety cap: a well-formed script always hits a blocking event
     * (TEXT/WAIT/SWITCH_SCENE/...) or SCRIPT_END well before this many
     * instructions run. It exists so a loop with nothing that waits
     * in it can't freeze the game - the thread just carries on from
     * where it got to next frame, like GB Studio yielding.
     */
    int guard = 64;

    while (t->ip->op != SCRIPT_END)
    {
        if (guard-- <= 0)
            return;

        const ScriptEvent *ev = t->ip;
        t->ip++;

        switch ((ScriptOp)ev->op)
        {
        case SCRIPT_TEXT:
        case SCRIPT_CHOICE:
        case SCRIPT_MENU:
            /* Only one box at a time: if another thread's box is up,
             * wait for it (retry this instruction next frame). */
            if (dialogue_active())
            {
                t->ip--;
                return;
            }
            if (ev->op == SCRIPT_TEXT)
                dialogue_show_ex(ev->str, ev->a, ev->b);
            else if (ev->op == SCRIPT_CHOICE)
            {
                dialogue_show_choice(ev->str);
                t->pending_choice_jump = ev->b;
            }
            else
                dialogue_show_menu(ev->str, ev->a);
            audio_play_blip();
            t->owns_dialogue = 1;
            return;

        case SCRIPT_SET_FLAG:
            flag_set(ev->a);
            break;

        case SCRIPT_CLEAR_FLAG:
            flag_clear(ev->a);
            break;

        case SCRIPT_IF_FLAG:
            if (!flag_get(ev->a))
                t->ip = t->base + ev->b;
            break;

        case SCRIPT_GIVE_ITEM:
            item_give(ev->a);
            break;

        case SCRIPT_IF_ITEM:
            if (!item_has(ev->a))
                t->ip = t->base + ev->b;
            break;

        case SCRIPT_GOTO:
            t->ip = t->base + ev->a;
            break;

        case SCRIPT_PLAY_SOUND:
            play_sound_effect(ev->a);
            break;

        case SCRIPT_SWITCH_SCENE:
            script_request_scene_switch(ev->a, ev->b, ev->c, ev->d);
            t->ip = 0;
            return;

        case SCRIPT_WAIT:
            /* This frame counts as the first one waited. */
            if (ev->a <= 0)
                break;
            t->wait_frames = ev->a - 1;
            return;

        case SCRIPT_SET_VAR:
            var_set(ev->a, ev->b);
            break;

        case SCRIPT_ADD_VAR:
            var_add(ev->a, ev->b);
            break;

        case SCRIPT_SUB_VAR:
            var_set(ev->a, (int16_t)(var_get(ev->a) - ev->b));
            break;

        case SCRIPT_MUL_VAR:
            var_set(ev->a, (int16_t)(var_get(ev->a) * ev->b));
            break;

        case SCRIPT_DIV_VAR:
            var_set(ev->a, ev->b != 0 ? (int16_t)(var_get(ev->a) / ev->b) : 0);
            break;

        case SCRIPT_MOD_VAR:
            var_set(ev->a, ev->b != 0 ? (int16_t)(var_get(ev->a) % ev->b) : 0);
            break;

        case SCRIPT_IF_VAR_EQ:
            if (!(var_get(ev->a) == ev->b))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_NE:
            if (!(var_get(ev->a) != ev->b))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_LT:
            if (!(var_get(ev->a) < ev->b))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_LE:
            if (!(var_get(ev->a) <= ev->b))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_GT:
            if (!(var_get(ev->a) > ev->b))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_GE:
            if (!(var_get(ev->a) >= ev->b))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_ACTOR_SHOW:
            actor_set_visible(ev->a, 1);
            break;

        case SCRIPT_ACTOR_HIDE:
            actor_set_visible(ev->a, 0);
            break;

        case SCRIPT_ACTOR_SET_POSITION:
            actor_set_position(ev->a, ev->b, ev->c);
            break;

        case SCRIPT_ACTOR_SET_DIRECTION:
            actor_set_direction(ev->a, ev->b);
            break;

        case SCRIPT_ACTOR_MOVE_TO:
            start_move(t, ev->a, ev->b, ev->c);
            return;

        case SCRIPT_ACTOR_SET_STATE:
            actor_set_state(ev->a, ev->b);
            break;

        case SCRIPT_ACTOR_SET_ANIMATE:
            actor_set_animate(ev->a, ev->b);
            break;

        case SCRIPT_ACTOR_SET_FRAME:
            actor_set_frame(ev->a, ev->b);
            break;

        case SCRIPT_ACTOR_SET_COLLISION_BOX:
        {
            /* Unpack two int8/uint8 pairs from b/c - see script.h. */
            int ox = (int8_t)(ev->b & 0xFF);
            int oy = (int8_t)((ev->b >> 8) & 0xFF);
            int w  = (uint8_t)(ev->c & 0xFF);
            int h  = (uint8_t)((ev->c >> 8) & 0xFF);
            actor_set_collision_box(ev->a, ox, oy, w, h);
            break;
        }

        case SCRIPT_ACTOR_GET_POSITION:
            var_set(ev->b, (int16_t)actor_get_x(ev->a));
            var_set(ev->c, (int16_t)actor_get_y(ev->a));
            break;

        case SCRIPT_ACTOR_GET_DIRECTION:
            var_set(ev->b, (int16_t)actor_get_direction(ev->a));
            break;

        case SCRIPT_WAIT_BUTTON:
            t->waiting_buttons = (uint16_t)ev->a;
            return;

        case SCRIPT_IF_MENU_EQ:
            if (dialogue_last_choice() != ev->a)
                t->ip = t->base + ev->b;
            break;

        case SCRIPT_COPY_VAR:
            var_set(ev->a, var_get(ev->b));
            break;

        case SCRIPT_ADD_VAR_VAR:
            var_add(ev->a, var_get(ev->b));
            break;

        case SCRIPT_SUB_VAR_VAR:
            var_set(ev->a, (int16_t)(var_get(ev->a) - var_get(ev->b)));
            break;

        case SCRIPT_MUL_VAR_VAR:
            var_set(ev->a, (int16_t)(var_get(ev->a) * var_get(ev->b)));
            break;

        case SCRIPT_DIV_VAR_VAR:
        {
            int16_t d = var_get(ev->b);
            var_set(ev->a, d != 0 ? (int16_t)(var_get(ev->a) / d) : 0);
            break;
        }

        case SCRIPT_MOD_VAR_VAR:
        {
            int16_t d = var_get(ev->b);
            var_set(ev->a, d != 0 ? (int16_t)(var_get(ev->a) % d) : 0);
            break;
        }

        case SCRIPT_IF_VAR_VAR_EQ:
            if (!(var_get(ev->a) == var_get(ev->b)))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_VAR_NE:
            if (!(var_get(ev->a) != var_get(ev->b)))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_VAR_LT:
            if (!(var_get(ev->a) < var_get(ev->b)))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_VAR_LE:
            if (!(var_get(ev->a) <= var_get(ev->b)))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_VAR_GT:
            if (!(var_get(ev->a) > var_get(ev->b)))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_IF_VAR_VAR_GE:
            if (!(var_get(ev->a) >= var_get(ev->b)))
                t->ip = t->base + ev->c;
            break;

        case SCRIPT_RANDOM_VAR:
            var_set(ev->a, (int16_t)rng_range(ev->b, ev->c));
            break;

        case SCRIPT_START_TIMER:
            timer_start(ev->a);
            break;

        case SCRIPT_CAMERA_LOCK_ACTOR:
            camera_lock_to_actor(ev->a);
            break;

        case SCRIPT_CAMERA_LOCK_POINT:
            camera_lock_to_point(ev->b, ev->c);
            break;

        case SCRIPT_CAMERA_MOVE_TO:
            t->camera_panning = 1;
            t->camera_x = ev->b;
            t->camera_y = ev->c;
            t->camera_speed = ev->a > 0 ? ev->a : 1;
            return;

        case SCRIPT_CAMERA_RELEASE:
            camera_release();
            break;

        case SCRIPT_CAMERA_SHAKE:
            camera_shake_start(ev->a, ev->b);
            break;

        case SCRIPT_ARRAY_GET_VAR:
            var_set(ev->c, var_get((int)ev->a + var_get(ev->b)));
            break;

        case SCRIPT_ARRAY_SET:
            var_set((int)ev->a + var_get(ev->b), ev->c);
            break;

        case SCRIPT_ARRAY_SET_VAR:
            var_set((int)ev->a + var_get(ev->b), var_get(ev->c));
            break;

        case SCRIPT_ARRAY_ADD:
            var_add((int)ev->a + var_get(ev->b), ev->c);
            break;

        case SCRIPT_ARRAY_ADD_VAR:
            var_add((int)ev->a + var_get(ev->b), var_get(ev->c));
            break;

        case SCRIPT_ARRAY_SUB:
        {
            int idx = (int)ev->a + var_get(ev->b);
            var_set(idx, (int16_t)(var_get(idx) - ev->c));
            break;
        }

        case SCRIPT_ARRAY_SUB_VAR:
        {
            int idx = (int)ev->a + var_get(ev->b);
            var_set(idx, (int16_t)(var_get(idx) - var_get(ev->c)));
            break;
        }

        case SCRIPT_ARRAY_MUL:
        {
            int idx = (int)ev->a + var_get(ev->b);
            var_set(idx, (int16_t)(var_get(idx) * ev->c));
            break;
        }

        case SCRIPT_ARRAY_MUL_VAR:
        {
            int idx = (int)ev->a + var_get(ev->b);
            var_set(idx, (int16_t)(var_get(idx) * var_get(ev->c)));
            break;
        }

        case SCRIPT_ARRAY_DIV:
        {
            int idx = (int)ev->a + var_get(ev->b);
            var_set(idx, ev->c != 0 ? (int16_t)(var_get(idx) / ev->c) : 0);
            break;
        }

        case SCRIPT_ARRAY_DIV_VAR:
        {
            int idx = (int)ev->a + var_get(ev->b);
            int16_t d = var_get(ev->c);
            var_set(idx, d != 0 ? (int16_t)(var_get(idx) / d) : 0);
            break;
        }

        case SCRIPT_ARRAY_MOD:
        {
            int idx = (int)ev->a + var_get(ev->b);
            var_set(idx, ev->c != 0 ? (int16_t)(var_get(idx) % ev->c) : 0);
            break;
        }

        case SCRIPT_ARRAY_MOD_VAR:
        {
            int idx = (int)ev->a + var_get(ev->b);
            int16_t d = var_get(ev->c);
            var_set(idx, d != 0 ? (int16_t)(var_get(idx) % d) : 0);
            break;
        }

        case SCRIPT_FADE_OUT:
            transition_fade_out_ex((TransitionColor)ev->a, ev->b);
            if (ev->c)
            {
                t->fade_waiting = 1;
                return;
            }
            break;

        case SCRIPT_FADE_IN:
            transition_fade_in_ex((TransitionColor)ev->a, ev->b);
            if (ev->c)
            {
                t->fade_waiting = 1;
                return;
            }
            break;

        case SCRIPT_PLAY_MUSIC:
            music_play(ev->a, ev->b);
            break;

        case SCRIPT_STOP_MUSIC:
            music_stop();
            break;

        /* ---- GB Studio parity ops ---- */

        case SCRIPT_IF_EXPR:
            if (!script_eval_expr((const int16_t *)ev->ptr))
                t->ip = t->base + ev->b;
            break;

        case SCRIPT_SET_VAR_EXPR:
            var_set(ev->a, script_eval_expr((const int16_t *)ev->ptr));
            break;

        case SCRIPT_RATE_LIMIT:
        {
            /* GB Studio's "Rate Limit": the var remembers when the
             * guarded events last ran; skip them if that was less
             * than `interval` frames ago. */
            uint16_t last = (uint16_t)var_get(ev->a);
            if ((uint16_t)(frame_time - last) < (uint16_t)ev->b && last != 0)
                t->ip = t->base + ev->c;
            else
                var_set(ev->a, (int16_t)(frame_time ? frame_time : 1));
            break;
        }

        case SCRIPT_VARS_RESET:
            for (int i = 0; i < MAX_VARIABLES; i++)
                var_set(i, 0);
            break;

        case SCRIPT_SEED_RNG:
            rng_seed(((uint32_t)frame_time << 16) ^ (uint32_t)input_held_mask() ^ 0x9E3779B9u);
            break;

        case SCRIPT_THREAD_START:
        {
            int handle = script_thread_start((const ScriptEvent *)ev->ptr);
            if (ev->a >= 0)
                var_set(ev->a, (int16_t)handle);
            break;
        }

        case SCRIPT_THREAD_STOP:
            thread_stop(var_get(ev->a));
            break;

        case SCRIPT_TIMER_SET:
            if (ev->a >= 0 && ev->a < TIMER_SLOTS)
            {
                timer_slots[ev->a].script = (const ScriptEvent *)ev->ptr;
                timer_slots[ev->a].interval = ev->b > 0 ? ev->b : 1;
                timer_slots[ev->a].left = timer_slots[ev->a].interval;
                timer_slots[ev->a].thread = 0;
            }
            break;

        case SCRIPT_TIMER_RESTART:
            if (ev->a >= 0 && ev->a < TIMER_SLOTS)
                timer_slots[ev->a].left = timer_slots[ev->a].interval;
            break;

        case SCRIPT_TIMER_DISABLE:
            if (ev->a >= 0 && ev->a < TIMER_SLOTS)
                timer_slots[ev->a].script = 0;
            break;

        case SCRIPT_LINE_OF_SIGHT:
        {
            SightWatch *slot = 0;
            for (int i = 0; i < SIGHT_SLOTS && !slot; i++)
                if (sight[i].script && sight[i].actor == ev->a)
                    slot = &sight[i];
            for (int i = 0; i < SIGHT_SLOTS && !slot && ev->ptr; i++)
                if (!sight[i].script)
                    slot = &sight[i];
            if (slot)
            {
                slot->script = (const ScriptEvent *)ev->ptr;
                slot->actor = (int8_t)ev->a;
                slot->range = (uint8_t)ev->b;
                slot->walls = (uint8_t)ev->c;
                slot->in_view = 0;
            }
            break;
        }

        case SCRIPT_INPUT_SCRIPT_SET:
        case SCRIPT_INPUT_SCRIPT_REMOVE:
            for (int bit = 0; bit < INPUT_BITS; bit++)
            {
                uint16_t m = (uint16_t)(1u << bit);
                if (!((uint16_t)ev->a & m))
                    continue;
                if (ev->op == SCRIPT_INPUT_SCRIPT_SET)
                {
                    input_scripts[bit] = (const ScriptEvent *)ev->ptr;
                    input_freeze[bit] = ev->c ? 1 : 0;
                    input_thread[bit] = 0;
                    if (ev->b)
                        input_override_mask |= m;
                    else
                        input_override_mask &= (uint16_t)~m;
                }
                else
                {
                    input_scripts[bit] = 0;
                    input_override_mask &= (uint16_t)~m;
                }
            }
            break;

        case SCRIPT_ACTOR_SET_POSITION_VARS:
        case SCRIPT_ACTOR_MOVE_TO_VARS:
        {
            int scale = ev->d ? 1 : 8;
            int x = var_get(ev->b) * scale;
            int y = var_get(ev->c) * scale;
            if (ev->op == SCRIPT_ACTOR_SET_POSITION_VARS)
            {
                actor_set_position(ev->a, x, y);
                break;
            }
            start_move(t, ev->a, x, y);
            return;
        }

        case SCRIPT_ACTOR_SET_POSITION_REL:
            actor_set_position(ev->a, actor_get_x(ev->a) + ev->b, actor_get_y(ev->a) + ev->c);
            break;

        case SCRIPT_ACTOR_MOVE_REL:
            start_move(t, ev->a, actor_get_x(ev->a) + ev->b, actor_get_y(ev->a) + ev->c);
            return;

        case SCRIPT_ACTOR_SET_FRAME_VAR:
            actor_set_frame(ev->a, var_get(ev->b));
            break;

        case SCRIPT_ACTOR_SET_MOVE_SPEED:
            actor_set_move_speed(ev->a, ev->b);
            break;

        case SCRIPT_ACTOR_SET_ANIM_SPEED:
            actor_set_anim_speed(ev->a, ev->b);
            break;

        case SCRIPT_ACTOR_SET_COLLISIONS:
            actor_set_collisions(ev->a, ev->b);
            break;

        case SCRIPT_ACTOR_PUSH:
        {
            int tx, ty;
            if (actor_push_target(ev->a, ev->b, &tx, &ty))
            {
                start_move(t, ev->a, tx, ty);
                return;
            }
            break;
        }

        case SCRIPT_SCENE_PUSH:
            game_scene_push(ev->a, (int)(t - threads));
            break;

        case SCRIPT_ACTOR_MOVE_EX:
        case SCRIPT_ACTOR_SET_POSITION_EX:
        {
            int f = ev->d;
            int src = (f >> MOVE_F_SRC_SHIFT) & 3;
            int x, y;
            if (src == 2)
            {
                /* To another actor's position (pixels already). */
                x = actor_get_x(ev->b);
                y = actor_get_y(ev->b);
            }
            else
            {
                x = src == 1 ? var_get(ev->b) : ev->b;
                y = src == 1 ? var_get(ev->c) : ev->c;
                if (!(f & MOVE_F_PIXELS))
                {
                    x *= 8;
                    y *= 8;
                }
                if (f & MOVE_F_RELATIVE)
                {
                    x += actor_get_x(ev->a);
                    y += actor_get_y(ev->a);
                }
            }
            if (ev->op == SCRIPT_ACTOR_SET_POSITION_EX)
            {
                actor_set_position(ev->a, x, y);
                break;
            }
            start_move(t, ev->a, x, y);
            t->move_flags = 0x80 | f;
            return;
        }

        case SCRIPT_SCENE_POP:
            if (game_scene_pop(ev->a))
            {
                t->ip = 0;      /* a scene switch is on its way */
                return;
            }
            break;

        case SCRIPT_SCENE_RESET:
            game_scene_reset();
            break;

        case SCRIPT_DATA_SAVE:
            game_save_slot(ev->a);
            break;

        case SCRIPT_DATA_LOAD:
            if (game_load_slot(ev->a))
            {
                t->ip = 0;
                return;
            }
            break;

        case SCRIPT_DATA_CLEAR:
            save_clear_slot(ev->a);
            break;

        case SCRIPT_SPRITES_SHOW:
            *(volatile uint16_t *)0x04000000 |= 0x1000;
            break;

        case SCRIPT_SPRITES_HIDE:
            *(volatile uint16_t *)0x04000000 &= (uint16_t)~0x1000;
            break;

        case SCRIPT_PALETTE_SET:
        {
            volatile uint16_t *pal = (volatile uint16_t *)
                ((ev->a & 0x100) ? 0x05000200 : 0x05000000);
            pal[ev->a & 0xFF] = (uint16_t)ev->b;
            break;
        }

        case SCRIPT_REPLACE_TILE:
            background_set_tile(ev->a, ev->b, background_get_tile(ev->c, ev->d));
            break;

        case SCRIPT_SOUND_TONE:
            audio_play_tone((uint16_t)ev->a, ev->b);
            break;

        case SCRIPT_SOUND_BEEP:
            audio_play_beep(ev->a, ev->b);
            break;

        case SCRIPT_SOUND_CRASH:
            audio_play_crash(ev->b);
            break;

        case SCRIPT_MUTE_CHANNEL:
            music_set_channel_muted(ev->a, ev->b);
            break;

        case SCRIPT_MUSIC_ROUTINE:
            music_set_routine(ev->a, (const ScriptEvent *)ev->ptr);
            break;

        case SCRIPT_TEXT_SET_FONT:
            ui_set_font(ev->a);
            break;

        case SCRIPT_TEXT_SET_FRAME:
            ui_set_frame(ev->a);
            break;

        case SCRIPT_TEXT_SET_SPEED:
            ui_set_speed(ev->a);
            break;

        case SCRIPT_SET_ENGINE_SETTING:
            modes_set_setting(ev->a, ev->b);
            break;

        case SCRIPT_LAUNCH_PROJECTILE:
            projectile_launch((const int16_t *)ev->ptr);
            break;

        case SCRIPT_PLAY_WAV:
            wav_play(ev->a, ev->b, ev->c);
            break;

        case SCRIPT_STOP_WAV:
            wav_stop(ev->a);
            break;

        case SCRIPT_END:
            break;   /* unreachable - the loop condition already checks this */
        }
    }

    /* Ran off the end via SCRIPT_END. */
    (void)is_main;
    t->ip = 0;
}

static void timers_tick(void)
{
    for (int i = 0; i < TIMER_SLOTS; i++)
    {
        if (!timer_slots[i].script)
            continue;
        if (--timer_slots[i].left > 0)
            continue;

        timer_slots[i].left = timer_slots[i].interval;

        /* Skip this run if the last one is still going. */
        int h = timer_slots[i].thread;
        if (h > 0 && threads[h].ip && threads[h].base == timer_slots[i].script)
            continue;

        timer_slots[i].thread = script_thread_start(timer_slots[i].script);
    }
}

void script_update(void)
{
    frame_time++;
    timers_tick();

    for (int i = 0; i < THREAD_COUNT; i++)
    {
        thread_step(&threads[i], i == 0);

        /* A scene switch ends every script - don't run the rest. */
        if (pending_switch)
        {
            for (int j = 0; j < THREAD_COUNT; j++)
                threads[j].ip = 0;
            return;
        }
    }
}

int script_check_input(void)
{
    for (int bit = 0; bit < INPUT_BITS; bit++)
    {
        if (input_scripts[bit] && input_pressed((uint16_t)(1u << bit)))
        {
            if (input_freeze[bit])
            {
                script_start(input_scripts[bit]);
                return 1;
            }
            /* Like GB Studio: runs alongside play, the player keeps
             * moving - but never two copies of the same button's script. */
            int h = input_thread[bit];
            if (h > 0 && threads[h].ip && threads[h].base == input_scripts[bit])
                continue;
            input_thread[bit] = script_thread_start(input_scripts[bit]);
        }
    }
    return 0;
}

/* Does actor `n` see the player right now? Its view is a strip as wide as
 * its collision box, `range` tiles long, in the way it's facing. */
static int actor_sees_player(const SightWatch *w)
{
    Entity *n = world_npc(w->actor);
    Entity *p = world_player();
    if (!n || !p || !world_npc_solid(w->actor) || !p->sprite.visible)
        return 0;
    int len = w->range * 8;
    int x0 = n->x + n->col_ox, y0 = n->y + n->col_oy;
    int x1 = x0 + n->col_w, y1 = y0 + n->col_h;
    int dx = 0, dy = 0;
    switch (n->direction)
    {
    case DIR_RIGHT: x0 = x1; x1 += len; dx = 1; break;
    case DIR_LEFT:  x1 = x0; x0 -= len; dx = -1; break;
    case DIR_UP:    y1 = y0; y0 -= len; dy = -1; break;
    default:        y0 = y1; y1 += len; dy = 1; break;
    }
    int px0 = p->x + p->col_ox, py0 = p->y + p->col_oy;
    int px1 = px0 + p->col_w, py1 = py0 + p->col_h;
    if (!(px0 < x1 && px1 > x0 && py0 < y1 && py1 > y0))
        return 0;
    if (!w->walls)
        return 1;
    /* Walk from the actor's edge toward the player a tile at a time, down
     * the middle of the strip: any solid tile in between blocks it. */
    int cx = dx ? (dx > 0 ? x0 : x1 - 1) : n->x + n->col_ox + n->col_w / 2;
    int cy = dy ? (dy > 0 ? y0 : y1 - 1) : n->y + n->col_oy + n->col_h / 2;
    int dist = dx > 0 ? px0 - x0 : dx < 0 ? x1 - px1 : dy > 0 ? py0 - y0 : y1 - py1;
    for (int d = 0; d < dist; d += 8)
        if (collision_test_point(cx + dx * d, cy + dy * d))
            return 0;
    return 1;
}

int script_check_sight(void)
{
    for (int i = 0; i < SIGHT_SLOTS; i++)
    {
        SightWatch *w = &sight[i];
        if (!w->script)
            continue;
        int seen = actor_sees_player(w);
        if (seen && !w->in_view)
        {
            w->in_view = 1;
            script_start(w->script);
            return 1;
        }
        w->in_view = (uint8_t)seen;
    }
    return 0;
}

int script_input_overridden(uint16_t mask)
{
    return (input_override_mask & mask) != 0;
}

int script_wants_scene_switch(int *scene_index, int *target_x, int *target_y,
                              int *direction)
{
    if (!pending_switch)
        return 0;

    *scene_index = pending_scene;
    *target_x = pending_x;
    *target_y = pending_y;
    *direction = pending_dir;
    pending_switch = 0;
    return 1;
}
