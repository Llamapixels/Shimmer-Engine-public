#ifndef ADVANCE_RAYCAST_H
#define ADVANCE_RAYCAST_H

#include <stdint.h>

#include "scene.h"

/*
 * First Person 3D scenes (SCENE_MODE_RAYCAST): Wolfenstein-style walls
 * drawn by casting one ray per column across the scene's wall map.
 *
 * The view is 120x80 pixels, drawn into a buffer of 8bpp tiles and
 * shown on affine BG2 at 2x (Mode 1), so the dialogue layer (BG1) and
 * sprites still work on top. The buffer is copied to VRAM in VBlank.
 *
 * World units: one map cell = one 8px collision tile.
 */

/* Scene loaded as a raycast scene: set the display up (call after
 * scene_load()). raycast_leave() puts Mode 0 back. */
void raycast_enter(const SceneDef *scene);
void raycast_leave(void);
int raycast_active(void);

/* Where the camera is: centre in 1/256 px, angle 0-1023 (0 = right,
 * 256 = down). */
void raycast_set_view(int x, int y, int angle);
int raycast_angle(void);

/*
 * Heights: every cell has a floor and a ceiling height in 1/8 cell units
 * (a ceiling at or below the floor is a solid wall). The player's eye is
 * half a cell above the floor under it; it steps up at most RAYCAST_STEP
 * and needs RAYCAST_HEADROOM under a ceiling.
 */
#define RAYCAST_STEP     3
#define RAYCAST_HEADROOM 5

/* The floor the eye stands on, in 1/256 units (it moves smoothly). */
void raycast_set_eye(int floor);
/* Highest floor under a box (px), in units. */
int raycast_floor_under(int x, int y, int w, int h);
/* Can a box (px) standing at `floor` (units) be here? */
int raycast_box_ok(int x, int y, int w, int h, int floor);
/* "Set Cell Heights": p = x, y, w, h (cells), floor, ceiling (units,
 * -1 = leave), speed (units per frame, Q8; 0 = at once). */
void raycast_heights(const int16_t *p);

/* Draw the view into the buffer, if it changed (once a frame at most). */
void raycast_draw(void);

/* In VBlank: copy a finished frame to VRAM. */
void raycast_vblank(void);

/* After something else used the display (a cutscene): set it up again. */
void raycast_restore(void);

/* Q12 sine / cosine of an angle in 1024ths of a turn. */
int raycast_sin(int angle);
int raycast_cos(int angle);

#endif
