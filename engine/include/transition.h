#ifndef ADVANCE_TRANSITION_H
#define ADVANCE_TRANSITION_H

/*
 * Simple fade-to-black / fade-to-white using the GBA's brightness
 * blend (REG_BLDCNT + REG_BLDY) - the same hardware effect either
 * way, just toggled between "darken toward black" and "brighten
 * toward white".
 *
 * transition_fade_out()/_in() are the engine's own fixed ~8-frame
 * black fade, used for every scene switch (see main.c) - unchanged,
 * so scene transitions behave exactly as before. transition_fade_
 * out_ex()/_in_ex() add a color and an author-chosen duration, for
 * the "Fade Out"/"Fade In" script events (see script.h's
 * SCRIPT_FADE_OUT/SCRIPT_FADE_IN) - the four functions share one
 * fade state, so only one fade (of either kind) can run at a time.
 */

typedef enum
{
    TRANSITION_BLACK = 0,
    TRANSITION_WHITE = 1,
    TRANSITION_NONE = 2,     /* scene switches only: cut straight over */
    /* Scene switch effects (out, then in reversed); all end on black. */
    TRANSITION_FLASH = 3,    /* white flashes, then a fade to black */
    TRANSITION_MOSAIC = 4,   /* pixelates while it darkens */
    TRANSITION_BOX = 5,      /* a shrinking rectangle */
    TRANSITION_BARS = 6,     /* bars close in from the top and bottom */
    TRANSITION_WIPE = 7      /* black sweeps in from the left */
} TransitionColor;

/* The color and length (frames) of the next scene switch's fade out and
 * fade in ("Change Scene"'s Transition option). Back to the default
 * (black, 8 frames) once that switch's fade in starts. */
void transition_set_next_scene(TransitionColor color, int frames);

/* Start a fade to black, over the engine's own fixed ~8-frame scene-
 * switch duration. */
void transition_fade_out(void);

/* Start a fade from black back to normal, same fixed duration. */
void transition_fade_in(void);

/* Start a fade to black or white over `frames` frames (minimum 1). */
void transition_fade_out_ex(TransitionColor color, int frames);

/* Start a fade from black or white back to normal, over `frames`
 * frames (minimum 1) - `color` should match whichever color the
 * screen is currently faded to. */
void transition_fade_in_ex(TransitionColor color, int frames);

/* Returns 1 while a fade is still in progress. */
int transition_active(void);

/* Call once per VBlank to advance the fade. */
void transition_update(void);

#endif
