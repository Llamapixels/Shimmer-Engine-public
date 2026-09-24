#include <gba.h>
#include <stdint.h>

#include "sprite.h"

#define SPRITE_MAX 128

/*
 * GBA hardware addresses.
 *
 * OBJ VRAM:     0x06010000  (tiles for sprites)
 * OAM:          0x07000000  (128 entries x 4 halfwords)
 * OBJ palette:  0x05000200  (16 banks x 16 colors)
 */
/* #ifndef so a host-side unit test can point these at plain arrays
 * (-DADV_OAM=...); the GBA build always uses the real addresses. */
#ifndef ADV_OBJ_VRAM
#define ADV_OBJ_VRAM \
    ((volatile uint16_t *)0x06010000)
#endif

#ifndef ADV_OBJ_PALETTE
#define ADV_OBJ_PALETTE \
    ((volatile uint16_t *)0x05000200)
#endif

#ifndef ADV_OAM
#define ADV_OAM \
    ((volatile uint16_t *)0x07000000)
#endif

/* Attribute 0: bit 9 set (with bit 8 clear) hides the object. */
#define ADV_ATTR0_HIDE   0x0200

/* Attribute 1: bit 12 = horizontal flip, bit 13 = vertical flip. */
#define ADV_ATTR1_HFLIP  0x1000
#define ADV_ATTR1_VFLIP  0x2000

/* Attribute 2: bits 10-11 = priority. Sprites normally sit at priority
 * 1, between the dialogue box (BG1, priority 0, always on top) and the
 * scene background (BG0, priority 2). ADV_ATTR2_PRIORITY_BEHIND (3) is
 * used for a tile/sprite authored with "display behind background
 * layer" on - still behind the dialogue box, but now also behind BG0. */
#define ADV_ATTR2_PRIORITY_NORMAL (1 << 10)
#define ADV_ATTR2_PRIORITY_BEHIND (3 << 10)
/* Old name, kept so nothing else needs to change. */
#define ADV_ATTR2_PRIORITY ADV_ATTR2_PRIORITY_NORMAL

/* In 1D mapping there are 1024 4bpp tiles of OBJ VRAM
 * (512 when using bitmap modes 3-5). */
#define OBJ_TILE_MAX 1024


static uint16_t next_oam = 0;
static uint16_t next_tile = 0;


/*
 * Every legal GBA sprite size, as
 * { width, height, attr0 shape bits, attr1 size bits }.
 */
static const uint16_t size_table[12][4] =
{
    {  8,  8, 0x0000, 0x0000 },
    { 16, 16, 0x0000, 0x4000 },
    { 32, 32, 0x0000, 0x8000 },
    { 64, 64, 0x0000, 0xC000 },

    { 16,  8, 0x4000, 0x0000 },   /* wide */
    { 32,  8, 0x4000, 0x4000 },
    { 32, 16, 0x4000, 0x8000 },
    { 64, 32, 0x4000, 0xC000 },

    {  8, 16, 0x8000, 0x0000 },   /* tall */
    {  8, 32, 0x8000, 0x4000 },
    { 16, 32, 0x8000, 0x8000 },
    { 32, 64, 0x8000, 0xC000 },
};


static void set_size_bits(
    ASprite *sprite
)
{
    for (int i = 0; i < 12; i++)
    {
        if (size_table[i][0] == sprite->width &&
            size_table[i][1] == sprite->height)
        {
            sprite->attr0 = size_table[i][2];
            sprite->attr1 = size_table[i][3];
            return;
        }
    }

    /* Not a legal size: fall back to 16x16. */
    sprite->width = 16;
    sprite->height = 16;
    sprite->attr0 = 0x0000;
    sprite->attr1 = 0x4000;
}


static void copy_to_vram(
    volatile uint16_t *dest,
    const uint8_t *data,
    uint32_t size
)
{
    /*
     * VRAM can't take 8-bit writes, so write 16 bits at a time.
     * Built from bytes so the source doesn't need to be aligned.
     */
    uint32_t halfwords = size / 2;

    for (uint32_t i = 0; i < halfwords; i++)
    {
        dest[i] =
            data[i * 2] |
            ((uint16_t)data[i * 2 + 1] << 8);
    }
}


static void write_hidden(
    int oam
)
{
    if (oam >= SPRITE_MAX)
        return;

    ADV_OAM[oam * 4] = ADV_ATTR0_HIDE;
}


static void write_oam(
    ASprite *sprite,
    int screen_x,
    int screen_y
)
{
    int oam = sprite->oam_index;

    if (oam >= SPRITE_MAX)
        return;

    /* Attribute 0: Y + shape (4bpp, normal mode). */
    ADV_OAM[oam * 4] =
        (uint16_t)(screen_y & 0xFF) |
        sprite->attr0;

    /* Attribute 1: X + flip + size. */
    ADV_OAM[oam * 4 + 1] =
        (uint16_t)(screen_x & 0x1FF) |
        (sprite->hflip ? ADV_ATTR1_HFLIP : 0) |
        (sprite->vflip ? ADV_ATTR1_VFLIP : 0) |
        sprite->attr1;

    /* Attribute 2: tile index + palette bank (bits 12-15). */
    ADV_OAM[oam * 4 + 2] =
        (uint16_t)(sprite->tile_index & 0x3FF) |
        (sprite->priority ? ADV_ATTR2_PRIORITY_BEHIND : ADV_ATTR2_PRIORITY_NORMAL) |
        ((uint16_t)(sprite->palette_bank & 0xF) << 12);
}


/* Attribute 0 bit 15 (with bit 14 clear) = "tall" shape; with attr1
 * size bits 0 that is an 8x16 OBJ. */
#define ADV_ATTR0_SHAPE_TALL 0x8000

/* Visible screen area - an OBJ entirely outside it is hidden rather than
 * written, because the hardware wraps OBJ coordinates (x is 9 bits, y is
 * 8 bits), so e.g. an OBJ at y = 200 would reappear at the top. */
#define ADV_SCREEN_W 240
#define ADV_SCREEN_H 160


/*
 * Write one multi-tile sprite's sub-tile OAM entry (already allocated at
 * sprite->sub_oam[i]) at screen position (screen_x, screen_y) - the
 * entity's screen origin plus that sub-tile's dx/dy. Shape is 8x8, or 8x16
 * "tall" when st->tall (size bits are 0 either way). Hides the slot
 * instead when the OBJ lies entirely off-screen.
 */
static void write_sub_oam(
    uint16_t oam,
    int screen_x,
    int screen_y,
    const ASpriteSubTile *st,
    uint16_t tile_index
)
{
    if (oam >= SPRITE_MAX)
        return;

    int h = st->tall ? 16 : 8;

    if (screen_x + 8 <= 0 ||
        screen_x >= ADV_SCREEN_W ||
        screen_y + h <= 0 ||
        screen_y >= ADV_SCREEN_H)
    {
        write_hidden(oam);
        return;
    }

    ADV_OAM[oam * 4] =
        (uint16_t)(screen_y & 0xFF) |
        (st->tall ? ADV_ATTR0_SHAPE_TALL : 0);   /* 4bpp, normal mode */

    ADV_OAM[oam * 4 + 1] =
        (uint16_t)(screen_x & 0x1FF) |          /* size bits 0 */
        (st->flip_h ? ADV_ATTR1_HFLIP : 0) |
        (st->flip_v ? ADV_ATTR1_VFLIP : 0);

    ADV_OAM[oam * 4 + 2] =
        (uint16_t)(tile_index & 0x3FF) |
        (st->priority ? ADV_ATTR2_PRIORITY_BEHIND : ADV_ATTR2_PRIORITY_NORMAL) |
        ((uint16_t)(st->palette_bank & 0xF) << 12);
}


/* Hide every reserved sub_oam[] slot (0..sub_oam_count) - used when a
 * multi-tile sprite is invisible/off-screen, or for any slot beyond the
 * current frame's tile_count. */
static void hide_sub_oam(
    ASprite *sprite,
    uint8_t from
)
{
    for (uint8_t i = from; i < sprite->sub_oam_count; i++)
        write_hidden(sprite->sub_oam[i]);
}


static void write_multi_oam(
    ASprite *sprite,
    int screen_x,
    int screen_y
)
{
    if (sprite->multi_frames == 0 ||
        sprite->current_multi_frame < 0 ||
        sprite->current_multi_frame >= sprite->multi_frame_count)
    {
        hide_sub_oam(sprite, 0);
        return;
    }

    const ASpriteMultiFrame *mf =
        &sprite->multi_frames[sprite->current_multi_frame];

    uint8_t count = mf->tile_count;
    if (mf->tiles == 0)
        count = 0;
    if (count > sprite->sub_oam_count)
        count = sprite->sub_oam_count;   /* shouldn't happen if authored correctly */

    for (uint8_t i = 0; i < count; i++)
    {
        const ASpriteSubTile *st = &mf->tiles[i];

        /* Never point an OBJ past this sprite's reserved VRAM block
         * (another sprite's tiles) - shouldn't happen if compiled
         * correctly, see sprite_init_multi(). */
        if ((uint32_t)st->tile_offset + (st->tall ? 2u : 1u) > sprite->sub_vram_count)
        {
            write_hidden(sprite->sub_oam[i]);
            continue;
        }

        write_sub_oam(
            sprite->sub_oam[i],
            screen_x + st->dx,
            screen_y + st->dy,
            st,
            (uint16_t)(sprite->sub_tile_index + st->tile_offset)
        );
    }

    hide_sub_oam(sprite, count);
}


void sprite_system_init(void)
{
    next_oam = 0;
    next_tile = 0;

    /* Hide all 128 hardware sprites. */
    for (int i = 0; i < SPRITE_MAX; i++)
    {
        ADV_OAM[i * 4]     = ADV_ATTR0_HIDE;
        ADV_OAM[i * 4 + 1] = 0;
        ADV_OAM[i * 4 + 2] = 0;
        ADV_OAM[i * 4 + 3] = 0;
    }
}


uint32_t sprite_alloc_mark(void)
{
    return ((uint32_t)next_oam << 16) | next_tile;
}


void sprite_alloc_reset(uint32_t mark)
{
    uint16_t mark_oam = (uint16_t)(mark >> 16);
    uint16_t mark_tile = (uint16_t)(mark & 0xFFFF);

    /* Only ever rewinds - a mark taken later than the current position
     * (shouldn't happen) is ignored rather than skipping slots. */
    if (mark_oam > next_oam || mark_tile > next_tile)
        return;

    for (uint16_t i = mark_oam; i < next_oam && i < SPRITE_MAX; i++)
        write_hidden(i);

    next_oam = mark_oam;
    next_tile = mark_tile;
}


void sprite_init(
    ASprite *sprite,
    int x,
    int y,
    int width,
    int height
)
{
    sprite->x = x;
    sprite->y = y;

    sprite->width = width;
    sprite->height = height;

    set_size_bits(sprite);

    sprite->visible = 1;
    sprite->palette_bank = 0;
    sprite->hflip = 0;
    sprite->vflip = 0;
    sprite->priority = 0;

    sprite->frames = 0;
    sprite->frame_bytes = 0;
    sprite->frame_count = 0;
    sprite->current_frame = -1;

    sprite->multi_frames = 0;
    sprite->multi_frame_count = 0;
    sprite->current_multi_frame = -1;
    sprite->sub_oam_count = 0;
    sprite->sub_tile_index = 0;
    sprite->sub_vram_count = 0;

    int tiles =
        (sprite->width / 8) * (sprite->height / 8);

    /* Out of OAM slots or VRAM: keep the sprite hidden. */
    if (next_oam >= SPRITE_MAX ||
        next_tile + tiles > OBJ_TILE_MAX)
    {
        sprite->visible = 0;
        sprite->oam_index = 0xFFFF;   /* no OAM slot */
        sprite->tile_index = 0;
        return;
    }

    sprite->oam_index = next_oam++;

    sprite->tile_index = next_tile;
    next_tile += (uint16_t)tiles;
}


void sprite_set_graphics(
    ASprite *sprite,
    const uint8_t *data,
    uint32_t size
)
{
    /* 1 tile = 32 bytes = 16 halfwords. */
    volatile uint16_t *dest =
        ADV_OBJ_VRAM + (sprite->tile_index * 16);

    copy_to_vram(dest, data, size);
}


void sprite_load_palette(
    int bank,
    const uint16_t *palette
)
{
    volatile uint16_t *dest =
        ADV_OBJ_PALETTE + ((bank & 0xF) * 16);

    for (int i = 0; i < 16; i++)
        dest[i] = palette[i];
}


void sprite_set_palette_bank(
    ASprite *sprite,
    int bank
)
{
    sprite->palette_bank = (uint8_t)(bank & 0xF);
}


void sprite_set_frames(
    ASprite *sprite,
    const uint8_t *frames,
    uint16_t frame_count
)
{
    sprite->frames = frames;
    sprite->frame_count = frame_count;
    sprite->frame_bytes =
        (uint16_t)(sprite->width * sprite->height / 2);
    sprite->current_frame = -1;

    sprite_set_frame(sprite, 0);
}


void sprite_set_frame(
    ASprite *sprite,
    int frame
)
{
    if (sprite->frames == 0 ||
        frame < 0 ||
        frame >= sprite->frame_count ||
        frame == sprite->current_frame)
        return;

    sprite->current_frame = frame;

    sprite_set_graphics(
        sprite,
        sprite->frames + (uint32_t)frame * sprite->frame_bytes,
        sprite->frame_bytes
    );
}


void sprite_show_frame(
    ASprite *sprite,
    int frame
)
{
    if (sprite->multi_frames != 0)
        sprite_set_multi_frame(sprite, frame);
    else
        sprite_set_frame(sprite, frame);
}


void sprite_set_hflip(
    ASprite *sprite,
    int flip
)
{
    sprite->hflip = flip ? 1 : 0;
}


void sprite_set_vflip(
    ASprite *sprite,
    int flip
)
{
    sprite->vflip = flip ? 1 : 0;
}


void sprite_set_priority(
    ASprite *sprite,
    int behind_background
)
{
    sprite->priority = behind_background ? 1 : 0;
}


void sprite_init_multi(
    ASprite *sprite,
    int x,
    int y,
    int width,
    int height,
    uint8_t max_sub_tiles,
    uint16_t max_vram_tiles
)
{
    sprite->x = x;
    sprite->y = y;

    /* Footprint size, kept as given (NOT forced through set_size_bits(),
     * whose 16x16 fallback would misstate a composed sprite's size). The
     * multi path never uses width/height/attr0/attr1 itself: its
     * visibility is decided per sub-tile in write_multi_oam(). */
    sprite->width = width;
    sprite->height = height;
    sprite->attr0 = 0;
    sprite->attr1 = 0;

    sprite->visible = 1;
    sprite->palette_bank = 0;
    sprite->hflip = 0;
    sprite->vflip = 0;
    sprite->priority = 0;

    sprite->frames = 0;
    sprite->frame_bytes = 0;
    sprite->frame_count = 0;
    sprite->current_frame = -1;

    /* No legacy single-OAM slot for a multi-tile sprite - every
     * existing single-OAM code path (write_oam/write_hidden) already
     * no-ops on an out-of-range OAM index. */
    sprite->oam_index = 0xFFFF;
    sprite->tile_index = 0;

    sprite->multi_frames = 0;
    sprite->multi_frame_count = 0;
    sprite->current_multi_frame = -1;

    sprite->sub_oam_count = 0;
    sprite->sub_tile_index = 0;
    sprite->sub_vram_count = 0;

    if (max_sub_tiles > ASPRITE_MAX_SUBTILES)
        max_sub_tiles = ASPRITE_MAX_SUBTILES;

    /* Every frame empty (so far): nothing to reserve, nothing drawn. */
    if (max_sub_tiles == 0)
        return;

    /* Out of OAM slots or VRAM for the worst-case frame: hide the
     * sprite (reserve nothing) rather than reserve a partial/unsafe set. */
    if (next_oam + max_sub_tiles > SPRITE_MAX ||
        next_tile + max_vram_tiles > OBJ_TILE_MAX)
    {
        sprite->visible = 0;
        return;
    }

    for (uint8_t i = 0; i < max_sub_tiles; i++)
        sprite->sub_oam[i] = next_oam++;
    sprite->sub_oam_count = max_sub_tiles;

    sprite->sub_tile_index = next_tile;
    sprite->sub_vram_count = max_vram_tiles;
    next_tile += max_vram_tiles;
}


void sprite_set_multi_frames(
    ASprite *sprite,
    const ASpriteMultiFrame *frames,
    uint16_t frame_count
)
{
    sprite->multi_frames = frames;
    sprite->multi_frame_count = frame_count;
    sprite->current_multi_frame = -1;

    sprite_set_multi_frame(sprite, 0);
}


void sprite_set_multi_frame(
    ASprite *sprite,
    int frame
)
{
    if (sprite->multi_frames == 0 ||
        frame < 0 ||
        frame >= sprite->multi_frame_count ||
        frame == sprite->current_multi_frame)
        return;

    sprite->current_multi_frame = frame;

    const ASpriteMultiFrame *mf = &sprite->multi_frames[frame];
    uint16_t vram_tiles = mf->vram_tiles;
    if (mf->tile_data == 0)
        vram_tiles = 0;   /* empty frame */
    if (vram_tiles > sprite->sub_vram_count)
        vram_tiles = sprite->sub_vram_count;   /* shouldn't happen if compiled correctly */

    /* Upload this frame's raw (unflipped) tile pixel data into the
     * reserved sub-tile VRAM block - same "frame streaming" idea as
     * sprite_set_frame()'s legacy path, just per-frame tile set instead
     * of one whole-frame OBJ. OAM attributes follow on the next
     * sprite_update()/sprite_update_camera(). */
    if (vram_tiles > 0)
    {
        volatile uint16_t *dest =
            ADV_OBJ_VRAM + (sprite->sub_tile_index * 16);
        copy_to_vram(dest, mf->tile_data, (uint32_t)vram_tiles * 32);
    }
}


void sprite_set_position(
    ASprite *sprite,
    int x,
    int y
)
{
    sprite->x = x;
    sprite->y = y;
}


void sprite_show(
    ASprite *sprite
)
{
    sprite->visible = 1;
}


void sprite_hide(
    ASprite *sprite
)
{
    sprite->visible = 0;
    write_hidden(sprite->oam_index);
    hide_sub_oam(sprite, 0);   /* no-op for a single-OAM sprite */
}


void sprite_update(
    ASprite *sprite
)
{
    if (!sprite->visible)
    {
        write_hidden(sprite->oam_index);
        hide_sub_oam(sprite, 0);
        return;
    }

    write_oam(sprite, sprite->x, sprite->y);
    write_multi_oam(sprite, sprite->x, sprite->y);
}


void sprite_update_camera(
    ASprite *sprite,
    int camera_x,
    int camera_y
)
{
    if (!sprite->visible)
    {
        write_hidden(sprite->oam_index);
        hide_sub_oam(sprite, 0);
        return;
    }

    /* World -> screen. */
    int screen_x = sprite->x - camera_x;
    int screen_y = sprite->y - camera_y;

    /* Multi-tile sprite: its sub-tiles can extend well beyond the 16x16
     * footprint (any dx/dy in -128..127), so the whole-sprite cull below
     * would be wrong - write_multi_oam() culls each sub-tile against the
     * screen instead. */
    if (sprite->multi_frames != 0)
    {
        write_multi_oam(sprite, screen_x, screen_y);
        return;
    }

    /* Fully off screen: hide it. */
    if (screen_x <= -sprite->width ||
        screen_x >= 240 ||
        screen_y <= -sprite->height ||
        screen_y >= 160)
    {
        write_hidden(sprite->oam_index);
        hide_sub_oam(sprite, 0);
        return;
    }

    write_oam(sprite, screen_x, screen_y);
    write_multi_oam(sprite, screen_x, screen_y);
}
