#include <gba.h>

#include "transition.h"
#include "sprite.h"   /* sprite_set_mosaic() - the mosaic transition */

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

/* ------------------------------------------------------------------ */
/* Effects (TRANSITION_FLASH and up), for scene switches.               */

#define WIN0_ENABLE   (1 << 13)
#define FLASH_FRAMES  24            /* 3 white flashes, 4 frames on, 4 off */

static int effect_kind;             /* 0 = none running */
static int effect_dir;              /* +1 = covering the screen, -1 = uncovering */
static int effect_total, effect_elapsed;

static void effect_window(int x1, int y1, int x2, int y2)
{
    /* Inside: everything as normal. Outside: only the backdrop, darkened
     * all the way to black. */
    if (x2 < x1) x2 = x1;
    if (y2 < y1) y2 = y1;
    REG_WIN0H = (uint16_t)((x1 << 8) | x2);
    REG_WIN0V = (uint16_t)((y1 << 8) | y2);
}

static void effect_off(void)
{
    REG_DISPCNT &= ~WIN0_ENABLE;
    REG_BLDCNT = 0;
    REG_BLDY = 0;
    REG_MOSAIC = 0;
    REG_BG0CNT &= (uint16_t)~(1 << 6);
    REG_BG2CNT &= (uint16_t)~(1 << 6);
    REG_BG3CNT &= (uint16_t)~(1 << 6);
    sprite_set_mosaic(0);
}

/* p = 0 (clear) .. 16 (fully covered). */
static void effect_draw(int p)
{
    switch (effect_kind)
    {
    case TRANSITION_FLASH:
        if (effect_dir > 0 && effect_elapsed <= FLASH_FRAMES)
        {
            int on = ((effect_elapsed - 1) / 4) % 2 == 0;
            REG_BLDCNT = BLDCNT_BG0_1ST | BLDCNT_BG2_1ST | BLDCNT_BG3_1ST | BLDCNT_OBJ_1ST | BLDCNT_BD_1ST |
                         BLDCNT_BRIGHTEN;
            REG_BLDY = (uint16_t)(on ? 16 : 0);
        }
        else
        {
            int rest = effect_total - FLASH_FRAMES;
            int level = effect_dir > 0 ? (effect_elapsed - FLASH_FRAMES) * 16 / (rest > 0 ? rest : 1) : p;
            REG_BLDCNT = BLDCNT_BG0_1ST | BLDCNT_BG2_1ST | BLDCNT_BG3_1ST | BLDCNT_OBJ_1ST | BLDCNT_BD_1ST |
                         BLDCNT_DARKEN;
            REG_BLDY = (uint16_t)(level > 16 ? 16 : level);
        }
        break;
    case TRANSITION_MOSAIC:
    {
        int m = p > 15 ? 15 : p;
        REG_MOSAIC = (uint16_t)(m | (m << 4) | (m << 8) | (m << 12));
        REG_BG0CNT |= 1 << 6;
        REG_BG2CNT |= 1 << 6;
        REG_BG3CNT |= 1 << 6;
        sprite_set_mosaic(1);
        REG_BLDCNT = BLDCNT_BG0_1ST | BLDCNT_BG2_1ST | BLDCNT_BG3_1ST | BLDCNT_OBJ_1ST | BLDCNT_BD_1ST |
                     BLDCNT_DARKEN;
        /* Mostly pixelate first, darken towards the end. */
        int dark = p * 2 - 16;
        REG_BLDY = (uint16_t)(dark < 0 ? 0 : dark);
        break;
    }
    default:
    {
        /* Window effects. */
        REG_WININ = 0x1F;                       /* window 0: all layers, no effect (bit 5 off) */
        REG_WINOUT = (1 << 5);                  /* outside: backdrop only, effect on */
        REG_BLDCNT = BLDCNT_BD_1ST | BLDCNT_DARKEN;
        REG_BLDY = 16;
        REG_DISPCNT |= WIN0_ENABLE;
        if (effect_kind == TRANSITION_BOX)
            effect_window(p * 120 / 16, p * 80 / 16, 240 - p * 120 / 16, 160 - p * 80 / 16);
        else if (effect_kind == TRANSITION_BARS)
            effect_window(0, p * 80 / 16, 240, 160 - p * 80 / 16);
        else
            effect_window(p * 240 / 16, 0, 240, 160);
        break;
    }
    }
}

static void effect_start(int kind, int frames, int dir)
{
    effect_kind = kind;
    effect_dir = dir;
    effect_total = frames < 1 ? 1 : frames;
    if (kind == TRANSITION_FLASH && dir > 0 && effect_total < FLASH_FRAMES + 8)
        effect_total = FLASH_FRAMES + 8;
    effect_elapsed = 0;
    effect_draw(dir > 0 ? 0 : 16);
}

/* One frame of the running effect; ends it when done. */
static void effect_update(void)
{
    effect_elapsed++;
    int p = effect_elapsed * 16 / effect_total;
    if (p > 16)
        p = 16;
    effect_draw(effect_dir > 0 ? p : 16 - p);
    if (effect_elapsed >= effect_total)
    {
        if (effect_dir < 0)
            effect_off();
        else
        {
            /* Covered: hold plain black while the next scene loads. */
            effect_off();
            REG_BLDCNT = BLDCNT_BG0_1ST | BLDCNT_BG2_1ST | BLDCNT_BG3_1ST | BLDCNT_OBJ_1ST | BLDCNT_BD_1ST |
                         BLDCNT_DARKEN;
            REG_BLDY = 16;
        }
        effect_kind = 0;
    }
}

void transition_set_next_scene(TransitionColor color, int frames)
{
    scene_color = color;
    scene_frames = frames < 1 ? 1 : frames;
}

static void scene_fade(int dir)
{
    if (scene_color >= TRANSITION_FLASH)
    {
        fade_dir = 0;
        effect_start(scene_color, scene_frames, dir);
        return;
    }
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
    return fade_dir != 0 || effect_kind != 0;
}

void transition_update(void)
{
    if (effect_kind)
    {
        effect_update();
        return;
    }
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
