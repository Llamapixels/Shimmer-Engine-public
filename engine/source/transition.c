#include <gba.h>

#include "transition.h"

/*
 * GBA brightness blend registers:
 *   REG_BLDCNT  (0x04000050) - blend control
 *   REG_BLDY    (0x04000054) - brightness coefficient (0-16)
 *
 * BLDCNT bits 6-7 pick the effect: 2 = brightness increase (toward
 * white), 3 = brightness decrease (toward black). (1 is alpha blending,
 * which needs BLDALPHA and does nothing here.)
 * We target BG0, the background layers (BG2/BG3), OBJ and the backdrop
 * so everything but the dialogue box fades together.
 */

#define BLDCNT_BG0_1ST   (1 << 0)
#define BLDCNT_BG2_1ST   (1 << 2)
#define BLDCNT_BG3_1ST   (1 << 3)
#define BLDCNT_OBJ_1ST   (1 << 4)
#define BLDCNT_BD_1ST    (1 << 5)
#define BLDCNT_BRIGHTEN  (2 << 6)
#define BLDCNT_DARKEN    (3 << 6)

#define FADE_STEPS               16
/* The engine's original fixed scene-switch duration (16 steps at 2
 * per VBlank = 8 frames) - transition_fade_out()/_in() keep using
 * this exact timing so scene transitions are unchanged. */
#define FADE_DEFAULT_FRAMES      8

static int fade_frames_total = 1;   /* never 0 - divides fade_frames_elapsed */
static int fade_frames_elapsed;
static int fade_dir;                /* +1 = fading out, -1 = fading in, 0 = idle */

static void start_fade(TransitionColor color, int frames, int dir)
{
    if (frames < 1)
        frames = 1;

    fade_frames_total = frames;
    fade_frames_elapsed = 0;
    fade_dir = dir;

    REG_BLDCNT =
        BLDCNT_BG0_1ST |
        BLDCNT_BG2_1ST |
        BLDCNT_BG3_1ST |
        BLDCNT_OBJ_1ST |
        BLDCNT_BD_1ST |
        (color == TRANSITION_WHITE ? BLDCNT_BRIGHTEN : BLDCNT_DARKEN);

    REG_BLDY = (uint16_t)(dir > 0 ? 0 : FADE_STEPS);
}

/* The next scene switch's transition (transition_set_next_scene()). */
static TransitionColor scene_color = TRANSITION_BLACK;
static int scene_frames = FADE_DEFAULT_FRAMES;

void transition_set_next_scene(TransitionColor color, int frames)
{
    scene_color = color;
    scene_frames = frames < 1 ? 1 : frames;
}

static void scene_fade(int dir)
{
    if (scene_color == TRANSITION_NONE)
    {
        fade_dir = 0;
        REG_BLDCNT = 0;
        REG_BLDY = 0;
        return;
    }
    start_fade(scene_color, scene_frames, dir);
}

void transition_fade_out(void)
{
    scene_fade(1);
}

void transition_fade_in(void)
{
    scene_fade(-1);
    scene_color = TRANSITION_BLACK;
    scene_frames = FADE_DEFAULT_FRAMES;
}

void transition_fade_out_ex(TransitionColor color, int frames)
{
    start_fade(color, frames, 1);
}

void transition_fade_in_ex(TransitionColor color, int frames)
{
    start_fade(color, frames, -1);
}

int transition_active(void)
{
    return fade_dir != 0;
}

void transition_update(void)
{
    if (fade_dir == 0)
        return;

    fade_frames_elapsed++;

    int level;

    if (fade_dir > 0)
    {
        level = (fade_frames_elapsed * FADE_STEPS) / fade_frames_total;

        if (level >= FADE_STEPS)
        {
            level = FADE_STEPS;
            fade_dir = 0;
            /* Stay blended (screen held at the target color) - same
             * as the original fixed fade-out did. */
        }
    }
    else
    {
        level = FADE_STEPS - (fade_frames_elapsed * FADE_STEPS) / fade_frames_total;

        if (level <= 0)
        {
            level = 0;
            fade_dir = 0;
            REG_BLDCNT = 0;   /* fully back to normal, blend off */
        }
    }

    REG_BLDY = (uint16_t)level;
}
