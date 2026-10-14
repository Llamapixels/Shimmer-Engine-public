#include <gba.h>
#include <stdint.h>

#include "raycast.h"
#include "entity.h"
#include "sprite.h"   /* sprite_sin() */
#include "world.h"

#define VIEW_W      120
#define VIEW_H      80
#define TILES_X     (VIEW_W / 8)          /* 15 x 10 tiles of 8bpp */
#define BLANK_TILE  (TILES_X * (VIEW_H / 8))
#define MAP_SB      24                    /* free in raycast scenes (front tiles / layers) */
#define TEX         32                    /* textures are 32x32 */
#define MAX_STEPS   64                    /* cells a ray crosses before giving up */
#define UI_COLORS   240                   /* BG palette bank 15 is the dialogue layer's */

#define SPRITE_PAL  128                   /* OBJ palette banks 0-6 copied to 128-239 */
#define SPRITE_BANKS 7
#define MAX_ACTORS  16
#define CANVAS      32                    /* actors: a 32x32 canvas around the 16x16
                                           * footprint, 8 px either side, 16 above */

#define BG_PAL      ((volatile uint16_t *)0x05000000)
#define OBJ_PAL     ((volatile uint16_t *)0x05000200)
#define VRAM_TILES  ((volatile uint32_t *)0x06000000)
#define VRAM_MAP    ((volatile uint16_t *)(0x06000000 + MAP_SB * 0x800))

/* The view, as the 8bpp tiles VRAM shows (tile-ordered, not rows). */
static uint32_t view_words[VIEW_W * VIEW_H / 4] EWRAM_BSS;
#define VIEW ((uint8_t *)view_words)

static volatile int frame_ready;   /* drawn, waiting for VBlank */
static int active, dirty;
static const SceneDef *cur;
static const RaycastDef *rc;
static int cam_x, cam_y, cam_angle;

static int16_t sin_tab[1024];      /* Q12 */
static uint16_t row_off[VIEW_H];   /* row y -> its offset in the tile buffer */
static int32_t zbuf[VIEW_W];       /* each column's wall distance (Q12) */

/* An actor to draw this frame: where, how far, and its pixels. */
typedef struct
{
    int screen_x, size, depth;
    uint8_t pixels[CANVAS * CANVAS];   /* palette indices, 0 = see-through */
} Billboard;
static Billboard boards[MAX_ACTORS] EWRAM_BSS;
static int board_count;
static int tables_ready;

static void build_tables(void)
{
    for (int a = 0; a < 1024; a++)
    {
        int d = a * 360;
        int deg = d / 1024, frac = d % 1024;
        int s0 = sprite_sin(deg), s1 = sprite_sin(deg + 1);
        sin_tab[a] = (int16_t)(s0 + (s1 - s0) * frac / 1024);
    }
    for (int y = 0; y < VIEW_H; y++)
        row_off[y] = (uint16_t)((y >> 3) * TILES_X * 64 + (y & 7) * 8);
    tables_ready = 1;
}

int raycast_sin(int angle)
{
    return sin_tab[angle & 1023];
}

int raycast_cos(int angle)
{
    return sin_tab[(angle + 256) & 1023];
}

static void setup_display(void)
{
    for (int i = 1; i < SPRITE_PAL; i++)
        BG_PAL[i] = rc->palette[i];
    for (int i = 0; i < 16; i++)
        VRAM_TILES[BLANK_TILE * 16 + i] = 0;
    /* 16x16 map of bytes: the view's 15x10 tiles, blank around them. */
    for (int i = 0; i < 128; i++)
    {
        int a = i * 2, b = i * 2 + 1;
        int ta = (a / 16 < VIEW_H / 8 && a % 16 < TILES_X) ? (a / 16) * TILES_X + a % 16 : BLANK_TILE;
        int tb = (b / 16 < VIEW_H / 8 && b % 16 < TILES_X) ? (b / 16) * TILES_X + b % 16 : BLANK_TILE;
        VRAM_MAP[i] = (uint16_t)(ta | (tb << 8));
    }
    REG_BG2CNT = 3 | (0 << 2) | (MAP_SB << 8);   /* priority 3, char block 0, 128x128 */
    REG_BG2PA = 0x80;                            /* 2x */
    REG_BG2PB = 0;
    REG_BG2PC = 0;
    REG_BG2PD = 0x80;
    REG_BG2X = 0;
    REG_BG2Y = 0x40;
    REG_DISPCNT = (REG_DISPCNT & ~(7 | BG0_ENABLE | BG3_ENABLE)) | MODE_1 | BG2_ENABLE;
}

void raycast_enter(const SceneDef *scene)
{
    if (!scene->raycast)
    {
        raycast_leave();
        return;
    }
    if (!tables_ready)
        build_tables();
    cur = scene;
    rc = scene->raycast;
    active = 1;
    dirty = 1;
    frame_ready = 0;
    entity_world_hidden = 1;
    setup_display();
}

void raycast_leave(void)
{
    if (!active)
        return;
    active = 0;
    frame_ready = 0;
    entity_world_hidden = 0;
    REG_DISPCNT = (REG_DISPCNT & ~7) | MODE_0 | BG0_ENABLE;
}

int raycast_active(void)
{
    return active;
}

void raycast_restore(void)
{
    if (!active)
        return;
    setup_display();
    dirty = 1;
}

void raycast_set_view(int x, int y, int angle)
{
    angle &= 1023;
    if (x != cam_x || y != cam_y || angle != cam_angle)
    {
        cam_x = x;
        cam_y = y;
        cam_angle = angle;
        dirty = 1;
    }
}

int raycast_angle(void)
{
    return cam_angle;
}

static inline int iabs(int v)
{
    return v < 0 ? -v : v;
}

/* One frame: a ray per column through the wall map (DDA), each wall a
 * textured column, ceiling above and floor below. Positions are in map
 * cells, Q12. */
__attribute__((section(".iwram"), long_call, target("arm"), noinline))
static void render(void)
{
    const int w = cur->width, h = cur->height;
    const uint8_t *walls = rc->walls;
    const uint8_t ceil = rc->ceiling, floor = rc->floor, darken = rc->dark;
    const int dir_x = sin_tab[(cam_angle + 256) & 1023], dir_y = sin_tab[cam_angle & 1023];
    const int plane_x = -dir_y * 2 / 3, plane_y = dir_x * 2 / 3;   /* ~67 degree view */
    const int pos_x = cam_x * 2, pos_y = cam_y * 2;                /* 1/256 px -> Q12 cells */
    const int map_x0 = pos_x >> 12, map_y0 = pos_y >> 12;

    for (int x = 0; x < VIEW_W; x++)
    {
        int cam = (x * 2 * 4096 + 4096) / VIEW_W - 4096;
        int ray_x = dir_x + ((plane_x * cam) >> 12);
        int ray_y = dir_y + ((plane_y * cam) >> 12);
        int dd_x = ray_x ? iabs((1 << 24) / ray_x) : (1 << 24);
        int dd_y = ray_y ? iabs((1 << 24) / ray_y) : (1 << 24);
        int map_x = map_x0, map_y = map_y0;
        int step_x, step_y, side_x, side_y;
        if (ray_x < 0)
        {
            step_x = -1;
            side_x = (int)(((int64_t)(pos_x - (map_x << 12)) * dd_x) >> 12);
        }
        else
        {
            step_x = 1;
            side_x = (int)(((int64_t)(((map_x + 1) << 12) - pos_x) * dd_x) >> 12);
        }
        if (ray_y < 0)
        {
            step_y = -1;
            side_y = (int)(((int64_t)(pos_y - (map_y << 12)) * dd_y) >> 12);
        }
        else
        {
            step_y = 1;
            side_y = (int)(((int64_t)(((map_y + 1) << 12) - pos_y) * dd_y) >> 12);
        }

        int side = 0, tex = -1;
        for (int n = 0; n < MAX_STEPS; n++)
        {
            if (side_x < side_y)
            {
                side_x += dd_x;
                map_x += step_x;
                side = 0;
            }
            else
            {
                side_y += dd_y;
                map_y += step_y;
                side = 1;
            }
            if (map_x < 0 || map_y < 0 || map_x >= w || map_y >= h)
            {
                tex = 0;   /* the edge of the map is a wall */
                break;
            }
            int c = walls[map_y * w + map_x];
            if (c)
            {
                tex = c - 1;
                break;
            }
        }

        uint8_t *dst = VIEW + (x >> 3) * 64 + (x & 7);
        int y = 0;
        if (tex < 0)
        {
            zbuf[x] = 1 << 30;
            /* Nothing within reach: just ceiling and floor. */
            for (; y < VIEW_H / 2; y++)
                dst[row_off[y]] = ceil;
            for (; y < VIEW_H; y++)
                dst[row_off[y]] = floor;
            continue;
        }
        if (tex >= rc->tex_count)
            tex = 0;

        int perp = side == 0 ? side_x - dd_x : side_y - dd_y;
        if (perp < 64)
            perp = 64;
        zbuf[x] = perp;
        int line = (VIEW_H << 12) / perp;
        int top = (VIEW_H - line) / 2;
        int y0 = top < 0 ? 0 : top;
        int y1 = top + line > VIEW_H ? VIEW_H : top + line;

        /* Where along the wall the ray hit: the texture's column. */
        int wall = side == 0 ? pos_y + (int)(((int64_t)perp * ray_y) >> 12)
                             : pos_x + (int)(((int64_t)perp * ray_x) >> 12);
        int tex_x = ((wall & 4095) * TEX) >> 12;
        if ((side == 0 && ray_x > 0) || (side == 1 && ray_y < 0))
            tex_x = TEX - 1 - tex_x;
        const uint8_t *col = rc->textures + (tex * TEX + tex_x) * TEX;
        int step_t = (TEX << 16) / line;
        int t = (y0 - top) * step_t;
        int shade = side ? darken : 0;

        for (; y < y0; y++)
            dst[row_off[y]] = ceil;
        for (; y < y1; y++)
        {
            dst[row_off[y]] = (uint8_t)(col[(t >> 16) & (TEX - 1)] + shade);
            t += step_t;
        }
        for (; y < VIEW_H; y++)
            dst[row_off[y]] = floor;
    }
}

/* An actor's current frame, decoded into its 32x32 canvas. */
static void decode_frame(const ASprite *spr, uint8_t *out)
{
    for (int i = 0; i < CANVAS * CANVAS; i++)
        out[i] = 0;
    if (spr->current_frame < 0 || spr->current_frame >= spr->frame_count)
        return;
    const ASpriteFrame *f = &spr->frames[spr->current_frame];
    int bank = spr->palette_bank < SPRITE_BANKS ? spr->palette_bank : SPRITE_BANKS - 1;
    int base = SPRITE_PAL + bank * 16;
    for (int o = 0; o < f->obj_count; o++)
    {
        const ASpriteObj *obj = &f->objs[o];
        const uint8_t *tiles = f->tile_data + obj->tile_offset * 32;
        int hflip = (obj->attr1 >> 12) & 1, vflip = (obj->attr1 >> 13) & 1;
        int tw = obj->w / 8;
        for (int py = 0; py < obj->h; py++)
        {
            int cy = obj->dy + 16 + (vflip ? obj->h - 1 - py : py);
            if (cy < 0 || cy >= CANVAS)
                continue;
            for (int px = 0; px < obj->w; px++)
            {
                int cx = obj->dx + 8 + (hflip ? obj->w - 1 - px : px);
                if (cx < 0 || cx >= CANVAS)
                    continue;
                const uint8_t *tile = tiles + ((py >> 3) * tw + (px >> 3)) * 32;
                int b = tile[(py & 7) * 4 + ((px & 7) >> 1)];
                int c = (px & 1) ? b >> 4 : b & 15;
                if (c)
                    out[cy * CANVAS + cx] = (uint8_t)(base + c);
            }
        }
    }
}

/* Every visible actor: where it is on screen and how big (camera space,
 * like the walls), farthest first. */
static void gather_actors(void)
{
    const int dir_x = sin_tab[(cam_angle + 256) & 1023], dir_y = sin_tab[cam_angle & 1023];
    const int plane_x = -dir_y * 2 / 3, plane_y = dir_x * 2 / 3;
    const int det = (plane_x * dir_y - dir_x * plane_y) >> 12;
    board_count = 0;
    if (!det)
        return;
    for (int i = 0; i < world_npc_count() && board_count < MAX_ACTORS; i++)
    {
        Entity *e = world_npc(i);
        if (!e || !e->solid || e->pinned || !e->sprite.visible)
            continue;
        /* The middle of its footprint, relative to the camera, in Q12 cells. */
        int sx = ((e->x + 8) << 9) - cam_x * 2;
        int sy = ((e->y + 8) << 9) - cam_y * 2;
        int tx = (int)(((int64_t)(dir_y * sx - dir_x * sy) >> 12) * 4096 / det);
        int ty = (int)(((int64_t)(-plane_y * sx + plane_x * sy) >> 12) * 4096 / det);
        if (ty < 256)
            continue;   /* behind the camera, or right on top of it */
        Billboard *b = &boards[board_count];
        b->depth = ty;
        b->screen_x = (VIEW_W / 2) * (4096 + (int)(((int64_t)tx << 12) / ty)) >> 12;
        b->size = (VIEW_H << 12) / ty;   /* one wall high */
        if (b->size < 1 || b->screen_x + b->size < 0 || b->screen_x - b->size >= VIEW_W)
            continue;
        decode_frame(&e->sprite, b->pixels);
        board_count++;
    }
    /* Farthest first, so nearer ones draw over them. */
    for (int i = 1; i < board_count; i++)
        for (int j = i; j > 0 && boards[j].depth > boards[j - 1].depth; j--)
        {
            Billboard t = boards[j];
            boards[j] = boards[j - 1];
            boards[j - 1] = t;
        }
}

/* Draw the gathered actors over the walls, column by column, hidden
 * wherever a wall is nearer. The canvas is two cells wide and tall, its
 * footprint's bottom on the floor. */
__attribute__((section(".iwram"), long_call, target("arm"), noinline))
static void render_actors(void)
{
    for (int k = 0; k < board_count; k++)
    {
        const Billboard *b = &boards[k];
        int span = b->size * 2;                     /* canvas = 2 cells */
        int left = b->screen_x - b->size;
        int bottom = (VIEW_H + b->size) / 2;        /* the floor under it */
        int top = bottom - span;
        int step = (CANVAS << 16) / span;
        int x0 = left < 0 ? 0 : left, x1 = left + span > VIEW_W ? VIEW_W : left + span;
        int y0 = top < 0 ? 0 : top, y1 = bottom > VIEW_H ? VIEW_H : bottom;
        for (int x = x0; x < x1; x++)
        {
            if (b->depth >= zbuf[x])
                continue;
            const uint8_t *col = b->pixels + (((x - left) * step) >> 16);
            uint8_t *dst = VIEW + (x >> 3) * 64 + (x & 7);
            int v = (y0 - top) * step;
            for (int y = y0; y < y1; y++, v += step)
            {
                uint8_t c = col[(v >> 16) * CANVAS];
                if (c)
                    dst[row_off[y]] = c;
            }
        }
    }
}

void raycast_draw(void)
{
    if (!active || frame_ready)
        return;
    /* Actors move and animate: redraw every frame while there are any. */
    if (world_npc_count() > 0)
        dirty = 1;
    if (!dirty)
        return;
    render();
    gather_actors();
    render_actors();
    dirty = 0;
    frame_ready = 1;
}

void raycast_vblank(void)
{
    if (!active)
        return;
    /* Re-latched every frame; a quarter texel down so the first line
     * samples the view's first row, not the edge above it. */
    REG_BG2X = 0;
    REG_BG2Y = 0x40;
    /* Actors' colours: the OBJ palette banks they use. */
    for (int i = 0; i < SPRITE_BANKS * 16; i++)
        BG_PAL[SPRITE_PAL + i] = OBJ_PAL[i];
    if (!frame_ready)
        return;
    DMA3COPY(view_words, VRAM_TILES, DMA32 | (VIEW_W * VIEW_H / 4));
    frame_ready = 0;
}
