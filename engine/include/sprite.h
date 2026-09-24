#ifndef ADVANCE_SPRITE_H
#define ADVANCE_SPRITE_H

#include <stdint.h>

/*
 * Max placed tiles a single authored "metasprite" (tile-composed) frame
 * may use - see ASpriteMultiFrame/sprite_init_multi() below. Also the
 * number of extra OAM slots reserved, once, for a multi-tile sprite -
 * kept small since OAM is a shared, scarce, 128-entry-wide budget.
 */
#define ASPRITE_MAX_SUBTILES 16

/*
 * One tile placed within an authored multi-tile ("metasprite") frame -
 * the engine-side counterpart of the editor/compiler's PlacedTileJSON
 * (shared/projectTypes.ts). Unlike the legacy single-OAM frame-
 * streaming path below (which has to bake a horizontally-mirrored copy
 * of a whole frame's pixel data at compile time to get a flipped frame -
 * see build_project.py's per-frame "flips" baking), each placed tile
 * here is its own hardware OBJ, so flip_h/flip_v are just OAM flip bits
 * applied directly at runtime - no baked pixel variants needed.
 */
typedef struct
{
    int8_t dx, dy;          /* position offset from the entity's origin
                             * (top-left of its 16x16 footprint cell), px -
                             * already anchored by the compiler (canvas
                             * size/origin), any pixel, may be negative */
    uint16_t tile_offset;   /* first VRAM tile of this OBJ, counted in 8x8
                             * (32-byte) tiles from the start of this
                             * frame's tile_data */
    uint8_t flip_h;
    uint8_t flip_v;
    uint8_t palette_bank;   /* 0-15 */
    uint8_t priority;       /* 1 = draw behind the scene's BG0 layer */
    uint8_t tall;           /* 0 = one 8x8 OBJ (1 VRAM tile);
                             * 1 = one 8x16 "tall" OBJ (attr0 shape tall,
                             * attr1 size 0) using 2 consecutive VRAM tiles
                             * - top then bottom, GBA 1D OBJ mapping
                             * (main.c sets OBJ_1D_MAP in DISPCNT) */
} ASpriteSubTile;

/*
 * One authored composed ("metasprite") frame: a list of placed tiles
 * plus their raw (unflipped - flip is a per-sub-tile OAM bit, see
 * ASpriteSubTile) 4bpp pixel data, vram_tiles*32 bytes. Each sub-tile
 * addresses its own pixels via tile_offset (a tall sub-tile uses 2
 * consecutive 8x8 tiles; identical tiles may share VRAM). An EMPTY frame
 * is { 0, 0, 0, 0 } - no OBJs shown.
 */
typedef struct
{
    const ASpriteSubTile *tiles;
    uint8_t tile_count;         /* OBJs (OAM entries) this frame shows */
    const uint8_t *tile_data;
    uint16_t vram_tiles;        /* 8x8 VRAM tiles in tile_data */
} ASpriteMultiFrame;

/*
 * One hardware OBJ (OAM slot) plus the VRAM tiles it owns.
 *
 * Animation works by "frame streaming": each sprite owns exactly
 * one frame's worth of tiles in OBJ VRAM, and when the frame changes
 * we copy the new frame's pixels into that slot. This keeps VRAM use
 * flat no matter how many animation frames a sprite sheet has, which
 * matters once there are lots of NPCs on screen.
 *
 * A sprite whose authored frames were composed from multiple
 * independently-placed/flipped/palette'd tiles (see ASpriteMultiFrame
 * above) instead uses the multi_frames/sub_oam fields below - see
 * sprite_init_multi()'s doc comment for exactly how that stays
 * backward compatible with the single-OAM path for the common case.
 */
typedef struct
{
    int x;
    int y;

    uint16_t oam_index;     /* 0xFFFF = no single-OAM slot (multi-tile sprite) */
    uint16_t tile_index;
    uint16_t attr0;         /* shape bits (square/wide/tall) */
    uint16_t attr1;         /* size bits */

    int width;
    int height;

    int visible;

    uint8_t palette_bank;   /* 0-15, which 16-color OBJ palette */
    uint8_t hflip;
    uint8_t vflip;
    uint8_t priority;       /* legacy single-OAM path: 1 = behind BG0 */

    /* Animation source (optional). */
    const uint8_t *frames;  /* all frames, back to back */
    uint16_t frame_bytes;   /* bytes per frame (w*h/2 for 4bpp) */
    uint16_t frame_count;
    int current_frame;      /* -1 = nothing uploaded yet */

    /*
     * Multi-tile ("metasprite") animation source (optional) - see
     * ASpriteMultiFrame above. NULL (the default) means every frame
     * uses the single-OAM path above exactly as before this feature
     * existed - sprite_set_frame()/sprite_update()/sprite_update_camera()
     * are all unaffected for such a sprite.
     */
    const ASpriteMultiFrame *multi_frames;
    uint16_t multi_frame_count;
    int current_multi_frame;
    uint16_t sub_oam[ASPRITE_MAX_SUBTILES];  /* OAM slots reserved once */
    uint8_t sub_oam_count;                   /* how many of the above are valid */
    uint16_t sub_tile_index;                 /* base VRAM tile for sub-tile gfx */
    uint16_t sub_vram_count;                 /* VRAM tiles reserved at sub_tile_index */
} ASprite;

void sprite_system_init(void);

/*
 * OAM/VRAM allocator watermark. The allocator is a simple bump pointer
 * (sprite_init()/sprite_init_multi() never free), so anything created
 * per scene must be released in bulk: take a mark once everything that
 * lives for the whole game (the player) has been created, then call
 * sprite_alloc_reset(mark) whenever a scene's sprites are torn down.
 * Every OAM entry allocated after the mark is hidden and its OAM/VRAM
 * becomes free for the next scene's sprites. Without this, each scene
 * change leaked the previous scene's NPC OAM entries and tiles - and a
 * tile-composed NPC holds several OAM entries, so it ran out quickly.
 */
uint32_t sprite_alloc_mark(void);
void sprite_alloc_reset(uint32_t mark);

void sprite_init(
    ASprite *sprite,
    int x,
    int y,
    int width,
    int height
);

/* Upload raw tile data straight into this sprite's VRAM slot. */
void sprite_set_graphics(
    ASprite *sprite,
    const uint8_t *data,
    uint32_t size
);

/* Load a 16-color palette into OBJ palette bank 0-15. */
void sprite_load_palette(
    int bank,
    const uint16_t *palette
);

void sprite_set_palette_bank(
    ASprite *sprite,
    int bank
);

/* Attach a sprite sheet and show frame 0. */
void sprite_set_frames(
    ASprite *sprite,
    const uint8_t *frames,
    uint16_t frame_count
);

/* Show a frame. Only copies to VRAM if the frame actually changed. */
void sprite_set_frame(
    ASprite *sprite,
    int frame
);

void sprite_set_hflip(
    ASprite *sprite,
    int flip
);

void sprite_set_vflip(
    ASprite *sprite,
    int flip
);

/* Legacy single-OAM path only (see ASprite's `priority` field) - for a
 * multi-tile sprite, priority is authored per placed tile instead (see
 * ASpriteSubTile.priority). 1 = draw behind the scene's BG0 layer. */
void sprite_set_priority(
    ASprite *sprite,
    int behind_background
);

/*
 * Re-initialize `sprite` as a multi-tile ("metasprite") sprite: reserves
 * `max_sub_tiles` OAM slots and `max_vram_tiles` 8x8 OBJ VRAM tiles (from
 * the same next_oam/next_tile pools sprite_init() uses) up front, once,
 * sized to the LARGEST authored frame this sprite will ever show (the
 * compiler computes both maxima across all of a sheet's composed frames -
 * they differ because an 8x16 tall sub-tile is 1 OAM entry but 2 VRAM
 * tiles). Both may be 0 (a sheet whose frames are all still empty):
 * nothing is reserved and nothing is drawn. A frame that uses fewer tiles than that
 * simply leaves the remaining reserved slots hidden - so a sheet whose
 * frames are mostly/all single full-canvas tiles still shows exactly
 * one ACTIVE OAM entry per frame, at the cost of reserving (not
 * necessarily using) up to `max_sub_tiles` OAM slots for that sprite's
 * whole lifetime. A sprite that never calls this (every sprite from
 * before this feature existed) reserves zero extra OAM - purely
 * additive, opt-in per entity.
 *
 * Does NOT allocate a legacy single oam_index/tile_index slot (unlike
 * sprite_init()) - a multi-tile sprite's visible pixels all come from
 * its sub_oam[] entries, so oam_index is set to 0xFFFF (which every
 * existing single-OAM code path - write_oam/write_hidden - already
 * treats as "no slot, skip").
 */
void sprite_init_multi(
    ASprite *sprite,
    int x,
    int y,
    int width,
    int height,
    uint8_t max_sub_tiles,
    uint16_t max_vram_tiles
);

/* Attach a multi-tile sprite's authored composed frames (see
 * ASpriteMultiFrame) and show frame 0. sprite_init_multi() must have
 * been called first. */
void sprite_set_multi_frames(
    ASprite *sprite,
    const ASpriteMultiFrame *frames,
    uint16_t frame_count
);

/* Show frame `frame`, whichever path this sprite uses: dispatches to
 * sprite_set_multi_frame() if sprite_init_multi()/sprite_set_multi_frames()
 * were used (sprite->multi_frames != 0), otherwise sprite_set_frame() -
 * lets calling code (see entity.c) stay agnostic of which path a given
 * sprite/entity uses. */
void sprite_show_frame(
    ASprite *sprite,
    int frame
);

/* Show one of this sprite's authored composed frames by index. Like
 * sprite_set_frame() but for the multi-tile path - uploads that frame's
 * vram_tiles*32 bytes of tile_data into the reserved sub-tile VRAM block;
 * the next sprite_update()/sprite_update_camera() rewrites each reserved
 * sub_oam[] entry's attributes (any slot beyond this frame's tile_count,
 * or whose OBJ lies fully off-screen, is hidden). */
void sprite_set_multi_frame(
    ASprite *sprite,
    int frame
);

void sprite_set_position(
    ASprite *sprite,
    int x,
    int y
);

void sprite_show(
    ASprite *sprite
);

void sprite_hide(
    ASprite *sprite
);

/* Write to OAM using x/y as screen coordinates. */
void sprite_update(
    ASprite *sprite
);

/* Write to OAM using x/y as world coordinates. */
void sprite_update_camera(
    ASprite *sprite,
    int camera_x,
    int camera_y
);

#endif
