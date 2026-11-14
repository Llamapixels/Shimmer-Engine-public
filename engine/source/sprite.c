#include <stdint.h>

#include "sprite.h"
#include "emote.h"
#include "tint.h"

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
#define FRONT_OAM 32

/* Attribute 0: bit 8 = affine (rotation/scaling), bit 9 with it =
 * double-size box. Attribute 1 bits 9-13 = affine matrix. */
#define ADV_ATTR0_AFFINE_DOUBLE 0x0300
#define ADV_MATRIX_MAX 32

/* sin() for whole degrees 0-90, scaled by 4096. */
static const int16_t SIN_Q12[91] =
{
    0, 71, 143, 214, 286, 357, 428, 499, 570, 641, 711, 782,
    852, 921, 991, 1060, 1129, 1198, 1266, 1334, 1401, 1468, 1534, 1600,
    1666, 1731, 1796, 1860, 1923, 1986, 2048, 2110, 2171, 2231, 2290, 2349,
    2408, 2465, 2522, 2578, 2633, 2687, 2741, 2793, 2845, 2896, 2946, 2996,
    3044, 3091, 3138, 3183, 3228, 3271, 3314, 3355, 3396, 3435, 3474, 3511,
    3547, 3582, 3617, 3650, 3681, 3712, 3742, 3770, 3798, 3824, 3849, 3873,
    3896, 3917, 3937, 3956, 3974, 3991, 4006, 4021, 4034, 4046, 4056, 4065,
    4074, 4080, 4086, 4090, 4094, 4095, 4096,
};

static int sin_deg(int a)
{
    a %= 360;
    if (a < 0) a += 360;
    if (a <= 90)  return SIN_Q12[a];
    if (a <= 180) return SIN_Q12[180 - a];
    if (a <= 270) return -SIN_Q12[a - 180];
    return -SIN_Q12[360 - a];
}

/* sprite_set_mosaic(): attribute 0 bit 12 on every OBJ written. */
static uint16_t obj_mosaic = 0;

/* sprite_reserve_portrait(): the normal allocator's limits. */
static uint16_t oam_limit = SPRITE_MAX;
static uint16_t tile_limit = OBJ_TILE_MAX;

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


int sprite_sin(int degrees)
{
    return sin_deg(degrees);
}

void sprite_set_mosaic(int on)
{
    obj_mosaic = on ? 0x1000 : 0;
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


/* The blocks at the top of OAM / OBJ VRAM: the portrait's (always that
 * place), then the rope's just below it. */
static int portrait_reserved, rope_reserved, emote_reserved;
#define ROPE_OAM   (SPRITE_MAX - SPRITE_PORTRAIT_OBJS - SPRITE_ROPE_DOTS)
#define ROPE_TILE  (OBJ_TILE_MAX - SPRITE_PORTRAIT_TILES - 1)
#define EMOTE_OAM  (ROPE_OAM - 1)
#define EMOTE_TILE (ROPE_TILE - 4)

static void set_limits(void)
{
    oam_limit = emote_reserved ? EMOTE_OAM : rope_reserved ? ROPE_OAM
              : portrait_reserved ? SPRITE_MAX - SPRITE_PORTRAIT_OBJS : SPRITE_MAX;
    tile_limit = emote_reserved ? EMOTE_TILE : rope_reserved ? ROPE_TILE
               : portrait_reserved ? OBJ_TILE_MAX - SPRITE_PORTRAIT_TILES : OBJ_TILE_MAX;
}

static int emote_loaded = -1;   /* which emote's tiles are in EMOTE_TILE */

void sprite_reserve_emote(int on)
{
    emote_reserved = on;
    set_limits();
    emote_loaded = -1;
    if (on)
        write_hidden(EMOTE_OAM);
}

void sprite_emote_draw(int kind, int x, int y)
{
    if (!emote_reserved)
        return;
    if (kind < 0 || kind >= EMOTE_COUNT || x <= -16 || x >= SCREEN_W || y <= -16 || y >= SCREEN_H)
    {
        write_hidden(EMOTE_OAM);
        return;
    }
    if (kind != emote_loaded)
    {
        volatile uint32_t *t = (volatile uint32_t *)(ADV_OBJ_VRAM + EMOTE_TILE * 16);
        for (int i = 0; i < 32; i++)
            t[i] = emote_tiles[kind][i];
        emote_loaded = kind;
    }
    ADV_OAM[EMOTE_OAM * 4] = (uint16_t)(y & 0xFF);                              /* square, 4bpp */
    ADV_OAM[EMOTE_OAM * 4 + 1] = (uint16_t)((x & 0x1FF) | (1 << 14));            /* 16x16 */
    ADV_OAM[EMOTE_OAM * 4 + 2] = (uint16_t)(EMOTE_TILE | (EMOTE_BANK << 12));    /* priority 0: on top */
}

void sprite_reserve_portrait(int on)
{
    portrait_reserved = on;
    set_limits();
}

void sprite_reserve_rope(int on)
{
    rope_reserved = on;
    set_limits();
    if (!on)
        return;
    /* The dot: a 2x2 block of color 1 in the middle of an 8x8 tile.
     * 4bpp: row r is t[r*2] (px 0-3) and t[r*2+1] (px 4-7); px 3 and 4. */
    volatile uint16_t *t = ADV_OBJ_VRAM + ROPE_TILE * 16;
    for (int i = 0; i < 16; i++)
        t[i] = 0;
    t[3 * 2 + 0] = 0x1000;
    t[3 * 2 + 1] = 0x0001;
    t[4 * 2 + 0] = 0x1000;
    t[4 * 2 + 1] = 0x0001;
    sprite_rope_draw(0, 0, 0);
}

void sprite_rope_draw(int n, const int16_t *xs, const int16_t *ys)
{
    if (!rope_reserved)
        return;
    for (int i = 0; i < SPRITE_ROPE_DOTS; i++)
    {
        int oam = ROPE_OAM + i;
        if (i >= n || xs[i] < -8 || xs[i] >= SCREEN_W || ys[i] < -8 || ys[i] >= SCREEN_H)
        {
            write_hidden(oam);
            continue;
        }
        ADV_OAM[oam * 4] = (uint16_t)((ys[i] - 4) & 0xFF);              /* 8x8, 4bpp */
        ADV_OAM[oam * 4 + 1] = (uint16_t)((xs[i] - 4) & 0x1FF);
        ADV_OAM[oam * 4 + 2] = (uint16_t)(ROPE_TILE | ADV_ATTR2_PRIORITY_NORMAL);   /* the player's palette */
    }
}

void sprite_save_palette(int bank, uint16_t *out)
{
    /* The colors as written, not as tinted (tint.h). */
    for (int i = 0; i < 16; i++)
        out[i] = tint_base_color(256 + (bank & 0xF) * 16 + i);
}

void sprite_load_palette(int bank, const uint16_t *palette)
{
    for (int i = 0; i < 16; i++)
        tint_write_color(256 + (bank & 0xF) * 16 + i, palette[i]);   /* follows the screen tint */
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
    sprite->matrix = -1;
    sprite->angle = 0;
    sprite->scale_x = 100;
    sprite->scale_y = 100;
    sprite->pivot_x = 8;
    sprite->pivot_y = 8;
    sprite->on_top = 0;
    sprite->see_through = 0;

    if (max_objs > ASPRITE_MAX_OBJS)
        max_objs = ASPRITE_MAX_OBJS;

    /* Out of OAM entries or VRAM for the largest frame: reserve nothing
     * (the sprite is never drawn) rather than a partial set. */
    int front = use_front && next_front + max_objs <= FRONT_OAM;
    if (max_objs == 0 ||
        (!front && next_oam + max_objs > oam_limit) ||
        next_tile + max_vram_tiles > tile_limit)
        return;

    for (uint8_t i = 0; i < max_objs; i++)
        sprite->oam[i] = front ? next_front++ : next_oam++;
    sprite->oam_count = max_objs;
    sprite->tile_index = next_tile;
    sprite->vram_count = max_vram_tiles;
    next_tile += max_vram_tiles;

    sprite_show_frame(sprite, 0);
}


void sprite_init_portrait(ASprite *sprite, const ASpriteFrame *frames, uint16_t frame_count,
                          uint8_t max_objs, uint16_t max_vram_tiles, int palette_bank)
{
    if (sprite->oam_count)
        hide_from(sprite, 0);
    sprite->x = sprite->y = 0;
    sprite->visible = 1;
    sprite->palette_bank = (uint8_t)(palette_bank & 0xF);
    sprite->frames = frames;
    sprite->frame_count = frame_count;
    sprite->current_frame = -1;
    sprite->matrix = -1;
    sprite->angle = 0;
    sprite->scale_x = sprite->scale_y = 100;
    sprite->pivot_x = sprite->pivot_y = 8;
    sprite->on_top = 1;
    sprite->oam_count = 0;
    if (max_objs > SPRITE_PORTRAIT_OBJS || max_vram_tiles > SPRITE_PORTRAIT_TILES)
        return;   /* too big for the reserved block: not shown */
    for (uint8_t i = 0; i < max_objs; i++)
        sprite->oam[i] = SPRITE_MAX - SPRITE_PORTRAIT_OBJS + i;
    sprite->oam_count = max_objs;
    sprite->tile_index = OBJ_TILE_MAX - SPRITE_PORTRAIT_TILES;
    sprite->vram_count = max_vram_tiles;
}


void sprite_change(
    ASprite *sprite,
    const ASpriteFrame *frames,
    uint16_t frame_count,
    uint8_t max_objs,
    uint16_t max_vram_tiles,
    int palette_bank)
{
    if (max_objs > ASPRITE_MAX_OBJS)
        max_objs = ASPRITE_MAX_OBJS;
    if (sprite->oam_count == 0 || max_objs > sprite->oam_count || max_vram_tiles > sprite->vram_count)
    {
        int visible = sprite->visible;
        int8_t matrix = sprite->matrix;
        int16_t angle = sprite->angle;
        uint8_t sx = sprite->scale_x, sy = sprite->scale_y;
        hide_from(sprite, 0);
        sprite_init(sprite, sprite->x, sprite->y, frames, frame_count, max_objs, max_vram_tiles, palette_bank);
        sprite->visible = visible;
        sprite->matrix = matrix;
        sprite->angle = angle;
        sprite->scale_x = sx;
        sprite->scale_y = sy;
        return;
    }
    hide_from(sprite, 0);
    sprite->frames = frames;
    sprite->frame_count = frame_count;
    sprite->palette_bank = (uint8_t)(palette_bank & 0xF);
    sprite->current_frame = -1;
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


void sprite_set_transform(ASprite *sprite, int matrix, int angle, int scale_x, int scale_y,
                          int pivot_x, int pivot_y)
{
    angle %= 360;
    if (angle < 0) angle += 360;
    if (scale_x < 25) scale_x = 25;
    if (scale_x > 200) scale_x = 200;
    if (scale_y < 25) scale_y = 25;
    if (scale_y > 200) scale_y = 200;

    sprite->angle = (int16_t)angle;
    sprite->scale_x = (uint8_t)scale_x;
    sprite->scale_y = (uint8_t)scale_y;
    sprite->pivot_x = (int16_t)pivot_x;
    sprite->pivot_y = (int16_t)pivot_y;
    sprite->matrix = (angle == 0 && scale_x == 100 && scale_y == 100) ||
                     matrix < 0 || matrix >= ADV_MATRIX_MAX ? -1 : (int8_t)matrix;
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


/* write_objs() for a rotated/scaled sprite. */
static void write_affine_objs(ASprite *sprite, const ASpriteFrame *f, uint8_t count,
                              int screen_x, int screen_y)
{
    int m = sprite->matrix;
    int sn = sin_deg(sprite->angle);
    int cs = sin_deg(sprite->angle + 90);
    int sx = sprite->scale_x;
    int sy = sprite->scale_y;

    /* The hardware maps screen to texture, so it takes the inverse of
     * "scale, then rotate": rows of the inverse rotation divided by the
     * scale, in 8.8 fixed point. A mirrored frame (its OBJs are all
     * flipped) has the flip folded in, since affine OBJs ignore the
     * flip bits. */
    int pa = (cs * 25600 / sx) >> 12;
    int pb = (sn * 25600 / sx) >> 12;
    int pc = (-sn * 25600 / sy) >> 12;
    int pd = (cs * 25600 / sy) >> 12;
    uint16_t flip = f->objs[0].attr1;
    if (flip & 0x1000) { pa = -pa; pb = -pb; }
    if (flip & 0x2000) { pc = -pc; pd = -pd; }
    ADV_OAM[m * 16 + 3] = (uint16_t)pa;
    ADV_OAM[m * 16 + 7] = (uint16_t)pb;
    ADV_OAM[m * 16 + 11] = (uint16_t)pc;
    ADV_OAM[m * 16 + 15] = (uint16_t)pd;

    int px = sprite->pivot_x;
    int py = sprite->pivot_y;
    for (uint8_t i = 0; i < count; i++)
    {
        const ASpriteObj *o = &f->objs[i];
        uint16_t oam = sprite->oam[i];
        uint32_t tiles = (uint32_t)(o->w / 8) * (o->h / 8);

        /* Move the OBJ's centre the same way the pixels move. */
        int ox = (o->dx + o->w / 2 - px) * sx;
        int oy = (o->dy + o->h / 2 - py) * sy;
        int cx = screen_x + px + (ox * cs - oy * sn) / (100 * 4096);
        int cy = screen_y + py + (ox * sn + oy * cs) / (100 * 4096);

        /* Double-size: the OBJ's box is 2w x 2h around its centre. */
        int x = cx - o->w;
        int y = cy - o->h;
        if (x + o->w * 2 <= 0 || x >= SCREEN_W || y + o->h * 2 <= 0 || y >= SCREEN_H ||
            o->tile_offset + tiles > sprite->vram_count)
        {
            write_hidden(oam);
            continue;
        }

        ADV_OAM[oam * 4] = (uint16_t)(y & 0xFF) | (o->attr0 & 0xC000) | ADV_ATTR0_AFFINE_DOUBLE | obj_mosaic |
                           (sprite->see_through ? 0x0400 : 0);
        ADV_OAM[oam * 4 + 1] = (uint16_t)(x & 0x1FF) | (o->attr1 & 0xC000) | (uint16_t)(m << 9);
        ADV_OAM[oam * 4 + 2] =
            (uint16_t)((sprite->tile_index + o->tile_offset) & 0x3FF) |
            (o->behind ? ADV_ATTR2_PRIORITY_BEHIND : ADV_ATTR2_PRIORITY_NORMAL) |
            ((uint16_t)sprite->palette_bank << 12);
    }
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

    if (sprite->matrix >= 0 && count > 0)
    {
        write_affine_objs(sprite, f, count, screen_x, screen_y);
        hide_from(sprite, count);
        return;
    }

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

        ADV_OAM[oam * 4] = (uint16_t)(y & 0xFF) | o->attr0 | obj_mosaic |   /* 4bpp */
                           (sprite->see_through ? 0x0400 : 0);                /* semi-transparent */
        ADV_OAM[oam * 4 + 1] = (uint16_t)(x & 0x1FF) | o->attr1;
        ADV_OAM[oam * 4 + 2] =
            (uint16_t)((sprite->tile_index + o->tile_offset) & 0x3FF) |
            (sprite->on_top ? 0 : o->behind ? ADV_ATTR2_PRIORITY_BEHIND : ADV_ATTR2_PRIORITY_NORMAL) |
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
