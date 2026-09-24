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

#endif
