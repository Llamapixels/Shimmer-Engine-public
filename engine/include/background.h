#ifndef ADVANCE_BACKGROUND_H
#define ADVANCE_BACKGROUND_H

#include <stdint.h>

#include "scene.h"   /* ParallaxLayer */

void background_init(void);

/* Load `count` 16-color palette banks into BG palette RAM. */
void background_load_palettes(
    const uint16_t *palettes,
    int count
);

void background_load_tiles(
    const uint8_t *data,
    uint32_t size
);

/*
 * Load a row-major map of GBA screen entries directly into VRAM.
 * Width/height in tiles, up to 64x64 (512x512 px) - the hardware's
 * own limit for a single background. Picks the smallest hardware
 * background size that fits and fills the rest with tile 0.
 *
 * Also turns off streaming mode, if it was on.
 */
void background_load_map(
    const uint16_t *map,
    uint32_t width,
    uint32_t height
);

/*
 * For maps bigger than 64x64 tiles: keeps the full map in ROM and
 * streams a scrolling 64x64-tile window of it into VRAM as the
 * camera moves, using the hardware's own wraparound scrolling (a
 * world tile's VRAM slot is always world_tile mod 64, so entering
 * tiles simply overwrite ones that scrolled out of range).
 *
 * Call once from scene_load() instead of background_load_map() when
 * scene->width or scene->height is over 64. After this, every call
 * to background_set_scroll() also streams in any newly-visible
 * tiles - no other code needs to know streaming is happening.
 */
void background_stream_begin(
    const uint16_t *map,
    uint32_t width,
    uint32_t height
);

/* "Replace Tile" script event: swap the map entry (tile index +
 * palette/flip bits, a GBA screen entry) at tile (x, y) of the
 * current scene until the next scene load. background_get_tile()
 * reads the current entry, including earlier replacements. */
void background_set_tile(int x, int y, uint16_t entry);
uint16_t background_get_tile(int x, int y);

/* Parallax bands for the scene being loaded (count 0 = none; see
 * ParallaxLayer in scene.h). Call before the scene's first
 * background_set_scroll(). */
void background_set_parallax(const ParallaxLayer *layers, int count);
void background_vblank(void);

/* Full background layers for the scene being loaded (BG2/BG3; count 0
 * turns them off). See BgLayer in scene.h. */
void background_set_layers(const BgLayer *layers, int count);

/* Tiles in front of actors (SceneDef.front_map, 0 = none): call after the
 * map is loaded or streaming has begun. Uses BG2 and the layers' screen
 * blocks, so a scene with it has no BG layers (the compiler checks). */
void background_set_front(const uint16_t *map);

/* Animated tiles (SceneDef.tile_anims), stepped by background_vblank(). */
void background_set_tile_anims(const TileAnim *anims, int count);   /* call right after each VBlankIntrWait() */

void background_set_scroll(
    int x,
    int y
);

#endif
