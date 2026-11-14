#ifndef ADVANCE_COLLISION_H
#define ADVANCE_COLLISION_H

#include <stdint.h>

/*
 * Collision is its own grid, one value per 8x8 tile, separate from
 * the graphics (like GB Studio). It comes from the scene's
 * "collision" grid in the project files.
 */
#define COLLISION_WALKABLE 0
#define COLLISION_SOLID    1
#define COLLISION_WATER    2
#define COLLISION_DAMAGE   3

/* One-way tiles (GB Studio's top/bottom/left/right collisions): the
 * named edge is solid, so the tile can't be entered across that edge
 * but can be walked out of, or entered from the other sides. */
#define COLLISION_TOP      4
#define COLLISION_BOTTOM   5
#define COLLISION_LEFT     6
#define COLLISION_RIGHT    7
#define COLLISION_LADDER   8   /* walkable; platformer scenes climb it */
#define COLLISION_STAIRS_R 9   /* walkable; platformer stairs rising to the right ("/") */
#define COLLISION_STAIRS_L 10  /* ... rising to the left ("\\") */
/* Slopes: solid below a diagonal. 45 degrees rising right / left, and
 * gentle (half as steep, two tiles: low half then high half). */
#define COLLISION_SLOPE_R     11
#define COLLISION_SLOPE_L     12
#define COLLISION_SLOPE_R_LO  13
#define COLLISION_SLOPE_R_HI  14
#define COLLISION_SLOPE_L_HI  15
#define COLLISION_SLOPE_L_LO  16
/* Ceiling slopes: the upper triangle is solid (Top Down diagonal walls
 * the other way round; in platformers a sloped ceiling). */
#define COLLISION_CEIL_R      17   /* top-right solid */
#define COLLISION_CEIL_L      18   /* top-left solid */
#define COLLISION_CEIL_R_LO   19   /* gentle, top-right, thin half */
#define COLLISION_CEIL_R_HI   20   /* ... thick half */
#define COLLISION_CEIL_L_HI   21   /* gentle, top-left, thick half */
#define COLLISION_CEIL_L_LO   22   /* ... thin half */

/* A ceiling slope's solid depth (1-8 px from its top) at column 0-7, or
 * -1 if `tile` isn't one. */
int collision_ceiling_height(int tile, int x_in_tile);

/* A slope tile's solid height (1-8 px from its bottom) at column 0-7 of
 * the tile, or -1 if `tile` isn't a slope. */
int collision_slope_height(int tile, int x_in_tile);

/* While on, slope tiles don't block (the platformer player walks on them
 * by their surface instead). Otherwise their solid triangle blocks. */
void collision_set_slopes_soft(int on);

/* The y (world px) of the slope surface under column fx, for feet whose
 * first pixel below is row fy; -1 if no slope there. */
int collision_slope_surface(int fx, int fy);

/* Any slope tile touching this box, or the 1 px around it? */
int collision_near_slope(int x, int y, int w, int h);

/* Platformer drop-through: while on, one-way "top" tiles don't block. */
void collision_set_ignore_top(int ignore);

void collision_init(void);

void collision_set_map(
    const uint8_t *grid,
    uint32_t width,
    uint32_t height
);

/* Collision value at a tile. Outside the map counts as solid. */
uint8_t collision_get_tile(
    int tile_x,
    int tile_y
);

/* Does this pixel block movement? */
int collision_test_point(
    int x,
    int y
);

int collision_test_rect(
    int x,
    int y,
    int width,
    int height
);

int collision_can_move(
    int x,
    int y,
    int width,
    int height
);

/* Like collision_can_move(), for a box moving from (from_x, from_y) to
 * (x, y) - also honours one-way tiles. */
int collision_can_move_from(
    int from_x,
    int from_y,
    int x,
    int y,
    int width,
    int height
);

#endif
