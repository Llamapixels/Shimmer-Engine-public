#ifndef ADVANCE_TILE_H
#define ADVANCE_TILE_H

#include <stdint.h>

#define TILE_WALKABLE  0
#define TILE_SOLID     1
#define TILE_WATER     2
#define TILE_DAMAGE    3

typedef struct
{
    uint8_t collision;
    uint8_t behavior;
} TileDefinition;

void tile_system_init(void);

void tile_set(
    uint16_t tile_id,
    uint8_t collision,
    uint8_t behavior
);

const TileDefinition *tile_get(
    uint16_t tile_id
);

#endif