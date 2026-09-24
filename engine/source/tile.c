#include <stdint.h>

#include "tile.h"

#define TILE_MAX 256

static TileDefinition tiles[TILE_MAX];

void tile_system_init(void)
{
    for (int i = 0; i < TILE_MAX; i++)
    {
        tiles[i].collision = TILE_WALKABLE;
        tiles[i].behavior = 0;
    }
}

void tile_set(
    uint16_t tile_id,
    uint8_t collision,
    uint8_t behavior
)
{
    if (tile_id >= TILE_MAX)
        return;

    tiles[tile_id].collision =
        collision;

    tiles[tile_id].behavior =
        behavior;
}

const TileDefinition *tile_get(
    uint16_t tile_id
)
{
    if (tile_id >= TILE_MAX)
        return 0;

    return &tiles[tile_id];
}