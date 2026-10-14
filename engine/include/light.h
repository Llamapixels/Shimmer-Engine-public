#ifndef ADVANCE_LIGHT_H
#define ADVANCE_LIGHT_H

#include <stdint.h>

/*
 * Lighting: a circle of light around an actor (the player by default),
 * everything else darker - Pokemon's dark caves. Window 0's left/right
 * edges are rewritten every scanline by H-Blank DMA (channel 0) to make
 * the circle; outside it the scene is darkened with the brightness
 * effect (the dialogue layer, BG1, never is). Not in First Person 3D.
 */

enum { LIGHT_ACTORS_VISIBLE, LIGHT_ACTORS_DARK, LIGHT_ACTORS_HIDDEN };

/* "Set Light": p = on, radius (px), darkness (0-16), actors outside the
 * light (LIGHT_ACTORS_*), actor index (PLAYER_ACTOR_INDEX = the player),
 * flicker, speed (px a frame the radius moves, 0 = at once). */
void light_set(const int16_t *p);
/* A new scene: the light is off. */
void light_reset(void);
/* Every frame after the camera moved: where the circle is now. */
void light_update(void);
/* In VBlank: the registers, and the DMA for the next frame. */
void light_vblank(void);
int light_on(void);

#endif
