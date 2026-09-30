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
/* #ifndef so a host-side test can point these at plain arrays
 * (-DADV_OAM=...); the GBA build always uses the real addresses. */
#ifndef ADV_OBJ_VRAM
#define ADV_OBJ_VRAM ((volatile uint16_t *)0x06010000)
#endif

#ifndef ADV_OBJ_PALETTE
#define ADV_OBJ_PALETTE ((volatile uint16_t *)0x05000200)
#endif

#ifndef ADV_OAM
#define ADV_OAM ((volatile uint16_t *)0x07000000)
#endif

/* Attribute 0: bit 9 set (with bit 8 clear) hides the object. */
#define ADV_ATTR0_HIDE 0x0200

/* Attribute 2: bits 10-11 = priority. Sprites normally sit at priority
 * 1, between the dialogue box (BG1, priority 0, always on top) and the
 * scene background (BG0, priority 2); "behind" (3) puts an OBJ behind
 * BG0 too. */
#define ADV_ATTR2_PRIORITY_NORMAL (1 << 10)
#define ADV_ATTR2_PRIORITY_BEHIND (3 << 10)

/* In 1D mapping there are 1024 4bpp tiles of OBJ VRAM
 * (512 when using bitmap modes 3-5). */
#define OBJ_TILE_MAX 1024

/* Visible screen area - an OBJ entirely outside it is hidden rather than
 * written, because the hardware wraps OBJ coordinates (x is 9 bits, y is
 * 8 bits), so e.g. an OBJ at y = 200 would reappear at the top. */
#define SCREEN_W 240
#define SCREEN_H 160

/* OAM entries 0..FRONT_OAM-1 are kept for sprites drawn in front of all
 * others (the GBA draws lower OAM entries on top): see sprite_use_front(). */
#define FRONT_OAM 16

static uint16_t next_oam = FRONT_OAM;
static uint16_t next_tile = 0;
static uint16_t next_front = 0;
static int use_front = 0;


static void copy_to_vram(volatile uint16_t *dest, const uint8_t *data, uint32_t size)
{
    /* VRAM can't take 8-bit writes, so write 16 bits at a time. Built
     * from bytes so the source doesn't need to be aligned. */
    uint32_t halfwords = size / 2;
    for (uint32_t i = 0; i < halfwords; i++)
        dest[i] = data[i * 2] | ((uint16_t)data[i * 2 + 1] << 8);
}


static void write_hidden(int oam)
{
    if (oam >= SPRITE_MAX)
        return;
    ADV_OAM[oam * 4] = ADV_ATTR0_HIDE;
}


static void hide_from(ASprite *sprite, uint8_t from)
{
    for (uint8_t i = from; i < sprite->oam_count; i++)
        write_hidden(sprite->oam[i]);
}


void sprite_use_front(int on)
{
    use_front = on;
}

void sprite_system_init(void)
{
    next_oam = FRONT_OAM;
    next_tile = 0;
    next_front = 0;

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

    /* Only ever rewinds. */
    if (mark_oam > next_oam || mark_tile > next_tile)
        return;

    for (uint16_t i = mark_oam; i < next_oam && i < SPRITE_MAX; i++)
        write_hidden(i);
    /* The front block belongs to the scene too. */
    for (uint16_t i = 0; i < next_front; i++)
        write_hidden(i);
    next_front = 0;

    next_oam = mark_oam;
    next_tile = mark_tile;
}


void sprite_load_palette(int bank, const uint16_t *palette)
{
    volatile uint16_t *dest = ADV_OBJ_PALETTE + ((bank & 0xF) * 16);
    for (int i = 0; i < 16; i++)
        dest[i] = palette[i];
}


void sprite_init(
    ASprite *sprite,
    int x,
    int y,
    const ASpriteFrame *frames,
    uint16_t frame_count,
    uint8_t max_objs,
    uint16_t max_vram_tiles,
    int palette_bank)
{
    sprite->x = x;
    sprite->y = y;
    sprite->visible = 1;
    sprite->palette_bank = (uint8_t)(palette_bank & 0xF);
    sprite->frames = frames;
    sprite->frame_count = frame_count;
    sprite->current_frame = -1;
    sprite->oam_count = 0;
    sprite->tile_index = 0;
    sprite->vram_count = 0;

    if (max_objs > ASPRITE_MAX_OBJS)
        max_objs = ASPRITE_MAX_OBJS;

    /* Out of OAM entries or VRAM for the largest frame: reserve nothing
     * (the sprite is never drawn) rather than a partial set. */
    int front = use_front && next_front + max_objs <= FRONT_OAM;
    if (max_objs == 0 ||
        (!front && next_oam + max_objs > SPRITE_MAX) ||
        next_tile + max_vram_tiles > OBJ_TILE_MAX)
        return;

    for (uint8_t i = 0; i < max_objs; i++)
        sprite->oam[i] = front ? next_front++ : next_oam++;
    sprite->oam_count = max_objs;
    sprite->tile_index = next_tile;
    sprite->vram_count = max_vram_tiles;
    next_tile += max_vram_tiles;

    sprite_show_frame(sprite, 0);
}


void sprite_show_frame(ASprite *sprite, int frame)
{
    if (sprite->frames == 0 ||
        frame < 0 ||
        frame >= sprite->frame_count ||
        frame == sprite->current_frame)
        return;

    sprite->current_frame = frame;

    const ASpriteFrame *f = &sprite->frames[frame];
    uint16_t tiles = f->tile_data ? f->vram_tiles : 0;
    if (tiles > sprite->vram_count)
        tiles = sprite->vram_count;   /* shouldn't happen if compiled correctly */

    /* OAM attributes follow on the next sprite_update*(). */
    if (tiles > 0)
        copy_to_vram(ADV_OBJ_VRAM + sprite->tile_index * 16, f->tile_data, (uint32_t)tiles * 32);
}


void sprite_set_position(ASprite *sprite, int x, int y)
{
    sprite->x = x;
    sprite->y = y;
}


void sprite_show(ASprite *sprite)
{
    sprite->visible = 1;
}


void sprite_hide(ASprite *sprite)
{
    sprite->visible = 0;
    hide_from(sprite, 0);
}


static void write_objs(ASprite *sprite, int screen_x, int screen_y)
{
    if (!sprite->visible ||
        sprite->current_frame < 0 ||
        sprite->current_frame >= sprite->frame_count)
    {
        hide_from(sprite, 0);
        return;
    }

    const ASpriteFrame *f = &sprite->frames[sprite->current_frame];
    uint8_t count = f->objs ? f->obj_count : 0;
    if (count > sprite->oam_count)
        count = sprite->oam_count;   /* shouldn't happen if compiled correctly */

    for (uint8_t i = 0; i < count; i++)
    {
        const ASpriteObj *o = &f->objs[i];
        uint16_t oam = sprite->oam[i];
        int x = screen_x + o->dx;
        int y = screen_y + o->dy;
        uint32_t tiles = (uint32_t)(o->w / 8) * (o->h / 8);

        if (x + o->w <= 0 || x >= SCREEN_W || y + o->h <= 0 || y >= SCREEN_H ||
            o->tile_offset + tiles > sprite->vram_count)
        {
            write_hidden(oam);
            continue;
        }

        ADV_OAM[oam * 4] = (uint16_t)(y & 0xFF) | o->attr0;   /* 4bpp, normal mode */
        ADV_OAM[oam * 4 + 1] = (uint16_t)(x & 0x1FF) | o->attr1;
        ADV_OAM[oam * 4 + 2] =
            (uint16_t)((sprite->tile_index + o->tile_offset) & 0x3FF) |
            (o->behind ? ADV_ATTR2_PRIORITY_BEHIND : ADV_ATTR2_PRIORITY_NORMAL) |
            ((uint16_t)sprite->palette_bank << 12);
    }

    hide_from(sprite, count);
}


void sprite_update(ASprite *sprite)
{
    write_objs(sprite, sprite->x, sprite->y);
}


void sprite_update_camera(ASprite *sprite, int camera_x, int camera_y)
{
    write_objs(sprite, sprite->x - camera_x, sprite->y - camera_y);
}
