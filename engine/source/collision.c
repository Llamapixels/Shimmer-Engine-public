#include <stdint.h>

#include "collision.h"

#define TILE_SIZE 8

static const uint8_t *collision_grid = 0;

static uint32_t map_width = 0;
static uint32_t map_height = 0;

void collision_init(void)
{
    collision_grid = 0;
    map_width = 0;
    map_height = 0;
}

void collision_set_map(
    const uint8_t *grid,
    uint32_t width,
    uint32_t height
)
{
    collision_grid = grid;
    map_width = width;
    map_height = height;
}

uint8_t collision_get_tile(
    int tile_x,
    int tile_y
)
{
    if (collision_grid == 0 ||
        tile_x < 0 ||
        tile_y < 0 ||
        tile_x >= (int)map_width ||
        tile_y >= (int)map_height)
    {
        return COLLISION_SOLID;
    }

    return collision_grid[tile_y * map_width + tile_x];
}

int collision_test_point(
    int x,
    int y
)
{
    if (x < 0 || y < 0)
        return 1;

    uint8_t c = collision_get_tile(
        x / TILE_SIZE,
        y / TILE_SIZE
    );

    /* Water blocks walking too, until there's swimming/surfing. */
    return c == COLLISION_SOLID ||
           c == COLLISION_WATER;
}

int collision_test_rect(
    int x,
    int y,
    int width,
    int height
)
{
    int left   = x;
    int right  = x + width - 1;
    int top    = y;
    int bottom = y + height - 1;

    /*
     * Check every 8 px along each edge, not just the corners,
     * so objects bigger than a tile can't pass through thin walls.
     */
    for (int px = left; ; px += TILE_SIZE)
    {
        if (px > right) px = right;

        if (collision_test_point(px, top) ||
            collision_test_point(px, bottom))
            return 1;

        if (px == right) break;
    }

    for (int py = top; ; py += TILE_SIZE)
    {
        if (py > bottom) py = bottom;

        if (collision_test_point(left, py) ||
            collision_test_point(right, py))
            return 1;

        if (py == bottom) break;
    }

    return 0;
}

int collision_can_move(
    int x,
    int y,
    int width,
    int height
)
{
    return !collision_test_rect(x, y, width, height);
}

int collision_can_move_from(
    int from_x,
    int from_y,
    int x,
    int y,
    int width,
    int height
)
{
    if (collision_test_rect(x, y, width, height))
        return 0;
    if (x < 0 || y < 0)
        return 0;

    int dx = x - from_x;
    int dy = y - from_y;
    int tx0 = x / TILE_SIZE;
    int ty0 = y / TILE_SIZE;
    int tx1 = (x + width - 1) / TILE_SIZE;
    int ty1 = (y + height - 1) / TILE_SIZE;

    for (int ty = ty0; ty <= ty1; ty++)
    {
        for (int tx = tx0; tx <= tx1; tx++)
        {
            uint8_t c = collision_get_tile(tx, ty);
            int left = tx * TILE_SIZE;
            int top = ty * TILE_SIZE;
            /* Blocked when the box crosses the solid edge on this move. */
            if ((c == COLLISION_TOP && dy > 0 && from_y + height <= top) ||
                (c == COLLISION_BOTTOM && dy < 0 && from_y >= top + TILE_SIZE) ||
                (c == COLLISION_LEFT && dx > 0 && from_x + width <= left) ||
                (c == COLLISION_RIGHT && dx < 0 && from_x >= left + TILE_SIZE))
                return 0;
        }
    }
    return 1;
}
