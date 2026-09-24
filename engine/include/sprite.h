#ifndef ADVANCE_SPRITE_H
#define ADVANCE_SPRITE_H

#include <stdint.h>

/*
 * Hardware sprites for actors.
 *
 * A sprite sheet's frames are compiled (compiler/build_project.py) into
 * lists of GBA hardware OBJs - each any legal OBJ size from 8x8 up to
 * 64x64 - so a big sprite costs a handful of OAM entries instead of one
 * per 8x8 tile. Each ASprite reserves, once, enough OAM entries and OBJ
 * VRAM tiles for its sheet's largest frame, and "streams" frames: when
 * the frame changes, that frame's pixels are copied into its reserved
 * VRAM block. VRAM use is therefore one frame per actor, however many
 * frames the sheet has.
 */

/* Most OBJs one frame may use. OAM has 128 entries in total. */
#define ASPRITE_MAX_OBJS 32

/* One hardware OBJ within a frame. */
typedef struct
{
    int16_t dx, dy;         /* offset from the actor's position (the
                             * top-left of its 16x16 footprint), px -
                             * the compiler has already anchored the
                             * sprite's canvas */
    uint16_t tile_offset;   /* first 8x8 VRAM tile, counted from the
                             * start of the frame's tile_data */
    uint16_t attr0;         /* shape bits (bits 14-15) */
    uint16_t attr1;         /* size bits (14-15) | flip bits (12-13) */
    uint8_t w, h;           /* size in px, for off-screen culling */
    uint8_t behind;         /* 1 = draw behind the scene's BG0 layer */
} ASpriteObj;

/* One compiled frame: its OBJs and their 4bpp pixel data (tiles*32
 * bytes, 1D-mapped, each OBJ's tiles consecutive). Mirrored frames
 * share tile_data with the frame they mirror. An empty frame has no
 * OBJs. */
typedef struct
{
    const ASpriteObj *objs;
    uint8_t obj_count;
    const uint8_t *tile_data;
    uint16_t vram_tiles;
} ASpriteFrame;

typedef struct
{
    int x;
    int y;
    int visible;
    uint8_t palette_bank;       /* 0-15 */

    const ASpriteFrame *frames;
    uint16_t frame_count;
    int current_frame;          /* -1 = none shown yet */

    uint16_t oam[ASPRITE_MAX_OBJS];   /* OAM entries reserved once */
    uint8_t oam_count;
    uint16_t tile_index;        /* first reserved OBJ VRAM tile */
    uint16_t vram_count;        /* reserved VRAM tiles */
} ASprite;

void sprite_system_init(void);

/*
 * OAM/VRAM allocator watermark. The allocator is a simple bump pointer
 * (sprite_init() never frees), so anything created per scene must be
 * released in bulk: take a mark once everything that lives for the
 * whole game (the player) has been created, then call
 * sprite_alloc_reset(mark) whenever a scene's sprites are torn down.
 */
uint32_t sprite_alloc_mark(void);
void sprite_alloc_reset(uint32_t mark);

/* Load a 16-color palette into OBJ palette bank 0-15. */
void sprite_load_palette(int bank, const uint16_t *palette);

/*
 * Set up `sprite` to show `frames`, reserving `max_objs` OAM entries
 * and `max_vram_tiles` OBJ VRAM tiles (the largest frame's needs - the
 * compiler works both out). Shows frame 0. If OAM or VRAM has run out
 * the sprite is simply never drawn.
 */
void sprite_init(
    ASprite *sprite,
    int x,
    int y,
    const ASpriteFrame *frames,
    uint16_t frame_count,
    uint8_t max_objs,
    uint16_t max_vram_tiles,
    int palette_bank
);

/* Show a frame. Only copies to VRAM if the frame actually changed. */
void sprite_show_frame(ASprite *sprite, int frame);

void sprite_set_position(ASprite *sprite, int x, int y);
void sprite_show(ASprite *sprite);
void sprite_hide(ASprite *sprite);

/* Write to OAM using x/y as screen coordinates. */
void sprite_update(ASprite *sprite);

/* Write to OAM using x/y as world coordinates. */
void sprite_update_camera(ASprite *sprite, int camera_x, int camera_y);

#endif
