#include <gba.h>

#include "transition.h"

/*
 * GBA brightness blend registers:
 *   REG_BLDCNT  (0x04000050) - blend control
 *   REG_BLDY    (0x04000054) - brightness coefficient (0-16)
 *
 * Mode 1 = brightness increase (brighten toward white).
 * Mode 2 = brightness decrease (darken toward black).
 * We target BG0 + OBJ + backdrop so everything fades together.
 */

#define BLDCNT_BG0_1ST   (1 << 0)
#define BLDCNT_OBJ_1ST   (1 << 4)
#define BLDCNT_BD_1ST    (1 << 5)
#define BLDCNT_BRIGHTEN  (1 << 6)
#define BLDCNT_DARKEN    (2 << 6)

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
        BLDCNT_OBJ_1ST |
        BLDCNT_BD_1ST |
        (color == TRANSITION_WHITE ? BLDCNT_BRIGHTEN : BLDCNT_DARKEN);

    REG_BLDY = (uint16_t)(dir > 0 ? 0 : FADE_STEPS);
}

void transition_fade_out(void)
{
    start_fade(TRANSITION_BLACK, FADE_DEFAULT_FRAMES, 1);
}

void transition_fade_in(void)
{
    start_fade(TRANSITION_BLACK, FADE_DEFAULT_FRAMES, -1);
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
