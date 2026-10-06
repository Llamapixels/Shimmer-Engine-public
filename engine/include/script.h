#ifndef ADVANCE_SCRIPT_H
#define ADVANCE_SCRIPT_H

#include <stdint.h>

/*
 * A tiny, resumable event-script interpreter - the generic mechanism
 * that GB-Studio-style visual scripting compiles down to. This is
 * what an NPC's "on interact" behavior, a door's "on enter" behavior,
 * or a scene's "on init" behavior actually runs, instead of any of
 * that being a fixed, hardcoded engine feature.
 *
 * A script is a flat array of ScriptEvent instructions, terminated
 * by SCRIPT_END. Branches (SCRIPT_IF_FLAG/SCRIPT_IF_ITEM) and
 * SCRIPT_GOTO reference OTHER INSTRUCTIONS BY INDEX within the same
 * array (not byte offsets) - resolved at compile time by
 * compiler/build_project.py from nested "then"/"else" JSON, so the
 * interpreter itself never has to understand branch structure, only
 * "jump to instruction N".
 *
 * Only one script runs at a time, the same way only one dialogue box
 * is ever open at a time - starting a new script replaces whatever
 * was running. A script pauses the same way plain dialogue already
 * did: SCRIPT_TEXT shows a page and waits for it to be dismissed,
 * SCRIPT_WAIT pauses for a fixed number of frames; everything else
 * runs instantly and falls through to the next instruction.
 */
typedef enum
{
    SCRIPT_END = 0,        /* stop - no operands */
    SCRIPT_TEXT,             /* str = dialogue text, a = box options (dialogue.h
                              * DIALOGUE_OPT_*), b = custom box place
                              * (DIALOGUE_PLACE); pauses until dismissed */
    SCRIPT_SET_FLAG,          /* a = flag index */
    SCRIPT_CLEAR_FLAG,        /* a = flag index */
    SCRIPT_IF_FLAG,           /* a = flag index, b = instruction index to
                                * jump to if that flag is NOT set */
    SCRIPT_GIVE_ITEM,         /* a = item index */
    SCRIPT_IF_ITEM,           /* a = item index, b = jump-if-not-held index */
    SCRIPT_GOTO,              /* a = instruction index to jump to */
    SCRIPT_PLAY_SOUND,        /* a = SoundEffect id (below) */
    SCRIPT_SWITCH_SCENE,      /* a = scene index, b = target x (px),
                                * c = target y (px), d = direction to
                                * face (-1 = keep) - ends the script;
                                * see script_wants_scene_switch() */
    SCRIPT_WAIT,              /* a = frames to pause */

    SCRIPT_SET_VAR,           /* a = variable index, b = value to set */
    SCRIPT_ADD_VAR,           /* a = variable index, b = delta (may be
                                * negative - there's no separate
                                * "subtract") */

    /*
     * The rest of the "math" event's literal-operand ops (a = variable
     * index, b = literal operand) - ADD_VAR above already covers "add".
     * Divide/modulo by 0 sets the variable to 0 rather than faulting -
     * see script.c.
     */
    SCRIPT_SUB_VAR,
    SCRIPT_MUL_VAR,
    SCRIPT_DIV_VAR,
    SCRIPT_MOD_VAR,

    /*
     * a = variable index, b = literal value to compare against,
     * c = instruction index to jump to if the comparison is FALSE.
     * One op per operator (folded into the opcode, same reason as
     * splitting SET_FLAG/CLEAR_FLAG) rather than a single "if_var"
     * with an operator operand, since a,b,c are already spoken for
     * by index/value/jump.
     */
    SCRIPT_IF_VAR_EQ,
    SCRIPT_IF_VAR_NE,
    SCRIPT_IF_VAR_LT,
    SCRIPT_IF_VAR_LE,
    SCRIPT_IF_VAR_GT,
    SCRIPT_IF_VAR_GE,

    /*
     * Runtime control over an NPC actor already placed by the current
     * scene (see actor.h) - "a" is the NPC's index within its scene's
     * npcs[] list (same order as scene JSON's "npcs" array; resolved
     * from a name or "self" at compile time - see
     * compiler/build_project.py).
     */
    SCRIPT_ACTOR_SHOW,           /* a = actor index */
    SCRIPT_ACTOR_HIDE,           /* a = actor index - also stops it
                                   * blocking movement or being talked
                                   * to until shown again */
    SCRIPT_ACTOR_SET_POSITION,   /* a = actor index, b = x (px), c = y (px) */
    SCRIPT_ACTOR_SET_DIRECTION,  /* a = actor index, b = Direction (0-3) */
    SCRIPT_ACTOR_MOVE_TO,        /* a = actor index, b = target x (px),
                                  * c = target y (px) - pauses the script
                                  * for as many frames as it takes the
                                   * actor to walk there (see
                                   * actor_step_toward() in actor.h).
                                   * Ignores collision entirely, same as
                                   * SCRIPT_ACTOR_SET_POSITION - this is
                                   * author-directed movement, not the
                                   * player's collision-checked movement. */

    /*
     * Authored animation control (see EntityAnimState in entity.h and
     * actor_set_state()/actor_set_animate()/actor_set_frame()/
     * actor_set_collision_box() in actor.h). No-op on an actor whose
     * sprite has no authored states/collision box - i.e. every sprite
     * already in a project before this feature existed keeps behaving
     * exactly as before, since it never emits these ops for them.
     */
    SCRIPT_ACTOR_SET_STATE,      /* a = actor index, b = state index
                                   * (resolved from a name at compile
                                   * time, same pattern as resolve_actor()/
                                   * resolve_timer() in build_project.py) */
    SCRIPT_ACTOR_SET_ANIMATE,    /* a = actor index, b = 0 (stop, hold
                                   * current frame) or 1 (resume) */
    SCRIPT_ACTOR_SET_FRAME,      /* a = actor index, b = frame index
                                   * (into the actor's sprite sheet) */
    SCRIPT_ACTOR_SET_COLLISION_BOX,
                                  /* a = actor index. b/c pack four small
                                   * (int8/uint8) values two-to-a-field,
                                   * since ScriptEvent only has a/b/c:
                                   *   b = (ox & 0xFF) | (oy & 0xFF) << 8
                                   *   c = (w  & 0xFF) | (h  & 0xFF) << 8
                                   * See build_project.py's compile_events()
                                   * "actor_set_collision_box" case for how
                                   * these get packed, and script.c's
                                   * SCRIPT_ACTOR_SET_COLLISION_BOX case for
                                   * how they get unpacked. */

    SCRIPT_ACTOR_GET_POSITION,   /* a = actor index, b = dest var index
                                   * for x (px), c = dest var index for
                                   * y (px) - the read-back counterpart
                                   * to SCRIPT_ACTOR_SET_POSITION. */
    SCRIPT_ACTOR_GET_DIRECTION,  /* a = actor index, b = dest var index -
                                   * stores the actor's current Direction
                                   * (0-3, see entity.h) as a plain
                                   * variable value. */

    SCRIPT_WAIT_BUTTON,          /* a = INPUT_* bitmask (input.h), OR'd
                                   * together if more than one button
                                   * counts - pauses until one of them
                                   * is freshly pressed (not just held) */

    /*
     * A two-option prompt. str = "prompt\x01optionA\x01optionB" (three
     * parts packed into ScriptEvent's one string field, split with a
     * 0x01 byte - see compiler/build_project.py's c_string_literal()
     * and dialogue.h's dialogue_show_choice()). Reuses the same
     * then/jump shape as SCRIPT_IF_FLAG etc: choosing option A falls
     * through into the instructions right after this one; choosing
     * option B jumps to instruction "b". "a" is unused.
     */
    SCRIPT_CHOICE,

    /*
     * A general 2-4 option menu (see dialogue.h's dialogue_show_menu()).
     * a = option count, str = "option1\x01option2\x01..." (no prompt -
     * put a SCRIPT_TEXT before this for one). Unlike SCRIPT_CHOICE this
     * doesn't branch by itself: the compiler follows it with a chain of
     * SCRIPT_IF_MENU_EQ instructions, one per option (see below),
     * because there's nowhere to fit more than one jump target in a
     * single instruction's a/b/c.
     */
    SCRIPT_MENU,
    SCRIPT_IF_MENU_EQ,        /* a = option index, b = jump-if-not-this-
                                * one index. Reads whichever option
                                * dialogue_show_menu() (or, just as well,
                                * dialogue_show_choice()) was last closed
                                * with - always run immediately after
                                * that pause has already cleared, never
                                * on its own. */

    /*
     * Variable-to-variable versions of SET_VAR/ADD_VAR/IF_VAR_* above,
     * for when the right-hand side is another variable instead of a
     * literal (compiler/build_project.py picks these automatically
     * when "value"/"delta" is {"var": "<name>"} instead of a number).
     * "b" is the SOURCE variable's index in all of these, not a value.
     */
    SCRIPT_COPY_VAR,          /* a = dest var index, b = source var index */
    SCRIPT_ADD_VAR_VAR,       /* a = dest var index, b = source var index */

    /* Variable-operand versions of SUB_VAR/MUL_VAR/DIV_VAR/MOD_VAR
     * above, same "b is the SOURCE variable's index, not a value"
     * convention as ADD_VAR_VAR. */
    SCRIPT_SUB_VAR_VAR,
    SCRIPT_MUL_VAR_VAR,
    SCRIPT_DIV_VAR_VAR,
    SCRIPT_MOD_VAR_VAR,

    SCRIPT_IF_VAR_VAR_EQ,     /* a, b = the two var indices being
                                * compared, c = jump-if-false index */
    SCRIPT_IF_VAR_VAR_NE,
    SCRIPT_IF_VAR_VAR_LT,
    SCRIPT_IF_VAR_VAR_LE,
    SCRIPT_IF_VAR_VAR_GT,
    SCRIPT_IF_VAR_VAR_GE,

    SCRIPT_RANDOM_VAR,        /* a = variable index, b = min, c = max
                                * (inclusive) - see engine/include/rng.h */

    /*
     * Arms a background timer (see engine/include/timer.h) - it counts
     * down independently of whatever script is running (including this
     * one, which carries straight on to its next instruction) and
     * fires its own separate script once it reaches 0, unless another
     * script is still active at that exact moment (that firing is then
     * simply skipped, not queued - see timer.h). "a" is the timer's
     * index within the current scene's "timers" list (see scene.h's
     * TimerDef and compiler/build_project.py).
     */
    SCRIPT_START_TIMER,       /* a = timer index */

    /*
     * Runtime camera control (see engine/include/camera.h's
     * camera_lock_to_actor()/camera_lock_to_point()/camera_step_to()/
     * camera_release()). While locked, ordinary gameplay stops calling
     * camera_follow(player) every frame - see main.c's main loop.
     */
    SCRIPT_CAMERA_LOCK_ACTOR,  /* a = actor index - camera follows this
                                 * actor every frame from now on */
    SCRIPT_CAMERA_LOCK_POINT,  /* b = x (px), c = y (px) - instant, "a"
                                 * unused */
    SCRIPT_CAMERA_MOVE_TO,     /* b = target x (px), c = target y (px) -
                                 * pans there over several frames,
                                 * pausing the script until it arrives
                                 * (like SCRIPT_ACTOR_MOVE_TO), then
                                 * stays locked there. a = speed in px
                                 * per frame (0 = 1). */
    SCRIPT_CAMERA_RELEASE,     /* back to following the player every
                                 * frame, as normal. No operands. */

    SCRIPT_CAMERA_SHAKE,       /* a = frames, b = magnitude (px, each
                                 * axis independently randomized every
                                 * frame within +/-magnitude) - see
                                 * camera_shake_start() in camera.h.
                                 * Non-blocking: the script carries on to
                                 * its next instruction immediately, the
                                 * shake plays out over the following
                                 * frames in the background. */

    /*
     * Array/list variable math: treats a contiguous run of named
     * variables as an array. "a" is the array's own first variable's
     * index (the array's base - fixed at compile time, since it's
     * just a named variable). "b" is the index of ANOTHER variable
     * holding the runtime offset into that array - the whole reason
     * these ops exist: if the offset were a compile-time constant
     * too, the compiler would resolve base+offset straight to one of
     * the plain SCRIPT_*_VAR ops above instead of ever emitting one
     * of these (see compile_events()'s "array_var_math" case). The
     * array slot actually touched is var_get(a + var_get(b)) - see
     * state.h's var_get()/var_set(), which already treat an
     * out-of-range index as a safe no-op/0, so there's no separate
     * bounds check here, and no "array length" needed either.
     */
    SCRIPT_ARRAY_GET_VAR,      /* c = dest var index */
    SCRIPT_ARRAY_SET,          /* c = literal value to write */
    SCRIPT_ARRAY_SET_VAR,      /* c = source var index */
    SCRIPT_ARRAY_ADD,          /* c = literal delta */
    SCRIPT_ARRAY_ADD_VAR,      /* c = source var index */
    SCRIPT_ARRAY_SUB,
    SCRIPT_ARRAY_SUB_VAR,
    SCRIPT_ARRAY_MUL,
    SCRIPT_ARRAY_MUL_VAR,
    SCRIPT_ARRAY_DIV,          /* divide by literal 0 sets the slot to 0 */
    SCRIPT_ARRAY_DIV_VAR,      /* divide by a source var currently 0
                                 * sets the slot to 0 */
    SCRIPT_ARRAY_MOD,
    SCRIPT_ARRAY_MOD_VAR,

    /*
     * Screen brightness fade (see engine/include/transition.h) -
     * reuses the exact fade the engine already runs for scene
     * switches (transition_fade_out()/_in()), just with a color and
     * a duration an author can pick, instead of the fixed black/
     * 8-frame default those keep using for scene transitions.
     * a = 0 (toward black) or 1 (toward white), b = duration in
     * frames, c = 1 to pause the script until the fade finishes, 0
     * to start it and carry straight on to the next instruction
     * immediately (like SCRIPT_CAMERA_SHAKE).
     */
    SCRIPT_FADE_OUT,
    SCRIPT_FADE_IN,

    /*
     * Runtime music control (see engine/include/music.h) - the
     * script-authorable counterpart to a scene's own "music" property
     * (SceneDef.music_track in scene.h), for changing/looping/stopping
     * music from anywhere a script runs (an On Init, a door, an NPC,
     * a timer), not just on scene load.
     */
    SCRIPT_PLAY_MUSIC,        /* a = UGE_* track id (compiler
                                * resolves a music asset name to this at
                                * compile time - see build_project.py's
                                * "play_music" case), b = 1 to loop
                                * forever, 0 to play once and stop. */
    SCRIPT_STOP_MUSIC,         /* no operands - silences whatever music
                                 * is currently playing. */

    /*
     * ---- Added for GB Studio event parity ----
     * Operands d and ptr (see ScriptEvent below) are used from here on;
     * "ptr" is either a compiled expression (an ExprToken array, see
     * below) or another ScriptEvent array (a sub-script: a thread body,
     * a timer/input/music-routine script).
     */
    SCRIPT_IF_EXPR,            /* ptr = expression, b = jump-if-false (0) */
    SCRIPT_SET_VAR_EXPR,       /* a = var, ptr = expression */
    SCRIPT_RATE_LIMIT,         /* a = var holding the last run's frame
                                 * time, b = interval (frames), c = jump
                                 * if called again too soon */
    SCRIPT_VARS_RESET,         /* every variable back to 0 */
    SCRIPT_SEED_RNG,           /* reseed from the frame counter */

    SCRIPT_THREAD_START,       /* ptr = script, a = var to receive its
                                 * handle (-1 = don't store) */
    SCRIPT_THREAD_STOP,        /* a = var holding a thread handle */
    SCRIPT_TIMER_SET,          /* a = slot (0-3), b = interval (frames),
                                 * ptr = script, rerun every interval */
    SCRIPT_TIMER_RESTART,      /* a = slot */
    SCRIPT_TIMER_DISABLE,      /* a = slot */
    SCRIPT_INPUT_SCRIPT_SET,   /* a = INPUT_* mask, b = 1 to override the
                                 * button's normal action, c = 1 to freeze
                                 * the player while it runs (else it runs
                                 * in the background, like GB Studio),
                                 * ptr = script */
    SCRIPT_INPUT_SCRIPT_REMOVE,/* a = INPUT_* mask */

    SCRIPT_ACTOR_SET_POSITION_VARS, /* a = actor, b = x var, c = y var,
                                      * d = 1 if the vars hold pixels,
                                      * 0 if tiles */
    SCRIPT_ACTOR_MOVE_TO_VARS,      /* same operands, walks there */
    SCRIPT_ACTOR_SET_POSITION_REL,  /* a = actor, b = dx, c = dy (px) */
    SCRIPT_ACTOR_MOVE_REL,          /* a = actor, b = dx, c = dy (px) */
    SCRIPT_ACTOR_SET_FRAME_VAR,     /* a = actor, b = var */
    SCRIPT_ACTOR_SET_MOVE_SPEED,    /* a = actor, b = px per frame */
    SCRIPT_ACTOR_SET_ANIM_SPEED,    /* a = actor, b = frames per anim
                                      * frame (0 = sprite default) */
    SCRIPT_ACTOR_SET_COLLISIONS,    /* a = actor, b = 0/1 */
    SCRIPT_ACTOR_PUSH,              /* a = actor, b = 1 to slide until
                                      * it hits something */

    SCRIPT_SCENE_PUSH,         /* remember scene + player position; a = 1
                                 * to also remember every actor, running
                                 * script and timer (a real pause) */
    SCRIPT_SCENE_POP,          /* a = 1 to pop all the way to the first */
    SCRIPT_SCENE_RESET,        /* forget every remembered scene */

    SCRIPT_DATA_SAVE,          /* a = save slot */
    SCRIPT_DATA_LOAD,          /* a = save slot (ends the script if it
                                 * held a save) */
    SCRIPT_DATA_CLEAR,         /* a = save slot */

    SCRIPT_SPRITES_SHOW,
    SCRIPT_SPRITES_HIDE,
    SCRIPT_PALETTE_SET,        /* a = (is_sprite << 8) | (bank << 4) |
                                 * color index, b = GBA BGR555 color */
    SCRIPT_REPLACE_TILE,       /* a, b = target tile, c, d = source tile
                                 * (both in the current scene's map) */

    SCRIPT_SOUND_TONE,         /* a = Hz, b = frames */
    SCRIPT_SOUND_BEEP,         /* a = pitch 1-8, b = frames */
    SCRIPT_SOUND_CRASH,        /* b = frames */
    SCRIPT_MUTE_CHANNEL,       /* a = PSG channel 0-3, b = 1 mute / 0 */
    SCRIPT_MUSIC_ROUTINE,      /* a = routine 0-15, ptr = script (0 =
                                 * clear) */

    SCRIPT_TEXT_SET_FONT,      /* a = font index (ui.h) */
    SCRIPT_TEXT_SET_FRAME,     /* a = frame index */
    SCRIPT_TEXT_SET_SPEED,     /* a = frames per character */

    SCRIPT_SET_ENGINE_SETTING, /* a = MS_* index, b = value (modes.h) */
    SCRIPT_LAUNCH_PROJECTILE,  /* ptr = int16 PROJ_P_* array (projectile.h) */

    SCRIPT_PLAY_WAV,           /* a = wav_sounds[] index, b = WAV_CHANNEL_*,
                                 * c = WAV_FLAG_* (wav.h) */
    SCRIPT_STOP_WAV,           /* a = WAV_CHANNEL_* (AUTO = both) */

    SCRIPT_LINE_OF_SIGHT,      /* a = NPC index, b = range in tiles,
                                 * c = 1 if solid tiles block the view,
                                 * ptr = script (0 = stop watching) */

    /* GB Studio-style Move To / Set Position with every option: a =
     * actor, b/c = x/y (numbers, variable indices or - for an actor
     * target - b = that actor), d = MOVE_F_* flags. */
    SCRIPT_ACTOR_MOVE_EX,
    SCRIPT_ACTOR_SET_POSITION_EX,

    SCRIPT_PLAY_CUTSCENE,      /* a = cutscenes[] index, b = CUTSCENE_*
                                 * flags (cutscene.h); blocks until done */

    SCRIPT_ACTOR_TRANSFORM,    /* a = actor, b = angle (degrees clockwise),
                                 * c = scale x %, d = scale y %; a scale
                                 * of 0 keeps the current one */
    SCRIPT_ACTOR_ROTATE_BY,    /* a = actor, b = degrees to add */

    SCRIPT_SCENE_TRANSITION    /* a = TransitionColor (transition.h),
                                 * b = frames: how the next scene switch
                                 * fades out and in */
} ScriptOp;

#define MOVE_F_PIXELS     0x01   /* b/c are pixels, not tiles */
#define MOVE_F_RELATIVE   0x02   /* add to the actor's own position */
#define MOVE_F_COLLIDE    0x04   /* stop at solid tiles */
#define MOVE_F_TYPE_SHIFT 3      /* 0 = horizontal first, 1 = vertical
                                  * first, 2 = diagonal */
#define MOVE_F_SRC_SHIFT  5      /* 0 = numbers, 1 = variables, 2 = to
                                  * another actor (b) */

/*
 * Compiled expressions ("If Expression", "Evaluate Math Expression",
 * "Loop While", and the compiler's lowering of several GB Studio
 * events, e.g. "If Actor At Position") - reverse-Polish token arrays
 * of int16_t, ending in EXPR_END, evaluated on a small stack of ints.
 * EXPR_CONST and EXPR_VAR take the next int16_t as their operand;
 * everything else pops its arguments and pushes one result.
 * Comparisons/logic give 0 or 1, division/modulo by 0 give 0.
 * Keep in sync with EXPR_TOKENS in compiler/expr.py.
 */
typedef enum
{
    EXPR_END = 0,
    EXPR_CONST, EXPR_VAR,
    EXPR_ADD, EXPR_SUB, EXPR_MUL, EXPR_DIV, EXPR_MOD,
    EXPR_EQ, EXPR_NE, EXPR_LT, EXPR_LE, EXPR_GT, EXPR_GE,
    EXPR_AND, EXPR_OR, EXPR_NOT,
    EXPR_BAND, EXPR_BOR, EXPR_BXOR, EXPR_BNOT, EXPR_SHL, EXPR_SHR,
    EXPR_NEG, EXPR_ABS, EXPR_MIN, EXPR_MAX, EXPR_RND, EXPR_ISQRT,
    EXPR_ACTOR_X, EXPR_ACTOR_Y, EXPR_ACTOR_DIR,  /* (actor) -> px / 0-3 */
    EXPR_HELD, EXPR_PRESSED,                     /* (INPUT_* mask) -> 0/1 */
    EXPR_FLAG, EXPR_ITEM,                        /* (index) -> 0/1 */
    EXPR_SAVED,                                  /* (slot) -> 0/1 */
    EXPR_PEEK,                                   /* (slot, var) -> value */
    EXPR_SCENE,                                  /* () -> scene index */
    EXPR_TIME                                    /* () -> frame counter */
} ExprToken;

int16_t script_eval_expr(const int16_t *rpn);

/* The engine's small fixed set of sound effects - see audio.h. A
 * "Play Sound" event picks one of these, the same way GB Studio's
 * own Play Sound Effect event picks from a short preset list. */
typedef enum
{
    SOUND_BLIP = 0,
    SOUND_DOOR,
    SOUND_SAVE,
    SOUND_ITEM
} SoundEffect;

typedef struct ScriptEvent
{
    uint8_t     op;      /* ScriptOp */
    int16_t     a;
    int16_t     b;
    int16_t     c;
    int16_t     d;       /* 4th operand, for ops that need one */
    const void *ptr;     /* expression or sub-script - see ScriptOp */
    const char *str;     /* SCRIPT_TEXT/SCRIPT_CHOICE/SCRIPT_MENU only;
                           * 0 otherwise. May contain a variable
                           * reference: a 0x02 byte followed by a
                           * variable index byte, substituted with that
                           * variable's current decimal value when
                           * shown (see compiler/build_project.py's
                           * interpolate_vars() and dialogue.c's
                           * expand_word()/expand_range()) - source of
                           * a JSON "{varname}" in text/prompt/option/
                           * label fields. */
} ScriptEvent;

/*
 * Threads. The "main" script (script_start) is the one the player
 * waits on: while it runs, normal movement/interaction is paused, the
 * same as before threads existed. Background threads (Start Thread,
 * timer scripts, music routines) run alongside it and alongside
 * normal play, like GB Studio's. All of them end on a scene change.
 */

/* Starts running `script` as the main script, replacing whatever
 * main script (if any) was already running. Pass 0 to do nothing
 * (e.g. an NPC with no on_interact script at all). */
void script_start(const ScriptEvent *script);

/* Starts `script` as a background thread. Returns its handle
 * (1..SCRIPT_MAX_THREADS), or 0 if every slot is busy. */
#define SCRIPT_MAX_THREADS 8

/* The scene stack's "real pause": copy every running script, input
 * script and thread out (exclude_thread = the one doing the storing,
 * which won't resume) / back in. */
void script_snapshot_save(int slot, int exclude_thread);
void script_snapshot_restore(int slot);
int script_thread_start(const ScriptEvent *script);

/* Is the main script running (including paused on dialogue or a
 * SCRIPT_WAIT)? */
int script_active(void);

/* Call once per frame (while in normal play): steps the main script
 * and every background thread, and ticks timer scripts. */
void script_update(void);

/* Scene changed: stop background threads, timer and input scripts
 * (like GB Studio, they belong to the scene that set them). */
void script_reset_scene(void);

/* Input scripts ("Attach Script To Button"). script_check_input()
 * starts the attached script for a button pressed this frame and
 * returns 1 if it did; script_input_overridden(mask) says whether a
 * button's normal action (A = talk, START = pause menu) is replaced. */
int script_check_input(void);

/* "Line Of Sight" watchers: starts the script of an actor that has just
 * seen the player (the player stepped into the tiles in front of it, up
 * to its range). Returns 1 if one started. Checked during normal play. */
int script_check_sight(void);
int script_input_overridden(uint16_t mask);

/* Ask for a scene switch from outside a script (loading a save,
 * popping the scene stack). direction < 0 keeps the player's facing. */
void script_request_scene_switch(int scene_index, int x, int y, int direction);

/*
 * True exactly once, right after a running script hits
 * SCRIPT_SWITCH_SCENE (which ends that script). Fills the outputs
 * and clears the internal flag, so it must be polled every frame
 * script_active() might be true - the caller (main.c) is what
 * actually knows how to run the fade-out/load/fade-in transition;
 * script.c intentionally doesn't reach into that state machine
 * directly.
 */
int script_wants_scene_switch(int *scene_index, int *target_x, int *target_y,
                              int *direction);

#endif
