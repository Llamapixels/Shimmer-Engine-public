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
/* The camera's centre, 1/256 px. */
void raycast_camera(int *x, int *y);

/*
 * Heights: every cell has a floor and a ceiling height in 1/8 cell units
 * (a ceiling at or below the floor is a solid wall; under the sky a wall
 * is a block as tall as its floor value). Ceiling colour 255 is the sky.
 */

/* The player's eye height, how high it steps up and the room it needs
 * under a ceiling, in units (defaults 4, 3, 5). */
void raycast_set_body(int eye, int step, int headroom);
/* Field of view (0 narrow, 1 normal, 2 wide), distance shading (0 off,
 * 1 far, 2 near), actors turned to the camera, a crosshair. */
void raycast_set_options(int fov, int fog, int turn_actors, int crosshair);
/* The feet's height, in 1/256 units (the eye is above it). */
void raycast_set_eye(int floor);
/* Lowest ceiling over a box (px), in units. */
int raycast_ceil_over(int x, int y, int w, int h);
/* Does the cell at (px) stop a projectile at eye height - a wall, a
 * closed door, a block higher than the eye or a ceiling lower? */
int raycast_solid_at(int x, int y);
/* The actor under the crosshair in the last frame drawn, or -1. */
int raycast_aimed(void);
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
