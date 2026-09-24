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
