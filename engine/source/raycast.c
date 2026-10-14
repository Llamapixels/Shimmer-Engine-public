#include <gba.h>
#include <stdint.h>

#include "raycast.h"
#include "entity.h"
#include "sprite.h"   /* sprite_sin() */
#include "world.h"

#define VIEW_W      120
#define VIEW_H      80
#define HORIZON     (VIEW_H / 2)
#define TILES_X     (VIEW_W / 8)          /* 15 x 10 tiles of 8bpp */
#define BLANK_TILE  (TILES_X * (VIEW_H / 8))
#define MAP_SB      24                    /* free in raycast scenes (front tiles / layers) */
#define TEX         32                    /* textures are 32x32, one cell high */
#define MAX_STEPS   64                    /* cells a ray crosses before giving up */
#define MAX_SEGS    24                    /* clip windows kept per column, for actors */
#define MAX_CELLS   (128 * 128)
#define MAX_MOVERS  8

#define SPRITE_PAL  128                   /* OBJ palette banks 0-6 copied to 128-239 */
#define SPRITE_BANKS 7
#define MAX_ACTORS  16
#define CANVAS      64                    /* actors: a 64x64 canvas; the 16x16 footprint
                                           * sits bottom-centre (24 px either side, 48 above) */
#define FOOT_X      24
#define FOOT_Y      48

#define BG_PAL      ((volatile uint16_t *)0x05000000)
#define OBJ_PAL     ((volatile uint16_t *)0x05000200)
#define VRAM_TILES  ((volatile uint32_t *)0x06000000)
#define VRAM_MAP    ((volatile uint16_t *)(0x06000000 + MAP_SB * 0x800))

/* The view, as the 8bpp tiles VRAM shows (tile-ordered, not rows). */
static uint32_t view_words[VIEW_W * VIEW_H / 4];   /* IWRAM: one-cycle writes */
#define VIEW ((uint8_t *)view_words)

static volatile int frame_ready;   /* drawn, waiting for VBlank */
static int active, dirty;
static const SceneDef *cur;
static const RaycastDef *rc;
static int map_w, map_h;
static int cam_x, cam_y, cam_angle;   /* 1/256 px, 1024ths of a turn */
static int cam_eye;                   /* eye height, Q12 cells */
/* The camera a frame is being drawn from (it's drawn in two halves). */
static int view_x, view_y, view_angle, view_eye;
static int half;                      /* 0: next draw starts a frame */

/* Heights, 1/8 cell units: copied to RAM so doors and lifts can move. */
/* Each cell packed in one word, so a ray reads one value per cell and
 * can tell "nothing changes" with one compare: floor | ceiling << 8 |
 * floor colour << 16 | ceiling colour << 24. */
static uint32_t cells[MAX_CELLS] EWRAM_BSS;
#define CELL_FLOOR(i) (cells[i] & 255)
#define CELL_CEIL(i)  ((cells[i] >> 8) & 255)
static void set_floor(int i, int v) { cells[i] = (cells[i] & ~0xFFu) | (uint32_t)v; }
static void set_ceil(int i, int v)  { cells[i] = (cells[i] & ~0xFF00u) | ((uint32_t)v << 8); }

/* Reciprocals instead of divisions in the inner loops (the GBA has no
 * divide instruction): screen height of one cell at a distance, by the
 * distance (Q12) / 4 up to 4 cells, / 64 beyond; and each column's
 * camera-plane position. */
#define NEAR_LIMIT  16384
static uint16_t line_near[4096] EWRAM_BSS;
static uint16_t line_far[4096] EWRAM_BSS;
static int16_t col_cam[VIEW_W];
static int32_t inv_small[1024] EWRAM_BSS;   /* (1 << 24) / v, v < 1024 */
static int32_t inv_big[1024] EWRAM_BSS;     /* (1 << 24) / v, v = 1024..8191 by eighths */

static inline int inv_of(int v)
{
    if (v < 0)
        v = -v;
    if (v < 1024)
        return inv_small[v];
    v >>= 3;
    return inv_big[v < 1024 ? v : 1023];
}

static inline int line_of(int d)
{
    if (d < NEAR_LIMIT)
        return line_near[d >> 2];
    d >>= 6;
    return d < 4096 ? line_far[d] : 1;
}

static int16_t sin_tab[1024] EWRAM_BSS;   /* Q12 */
static uint16_t row_off[VIEW_H];   /* row y -> its offset in the tile buffer */
static int tables_ready;

/* After each height change a ray crossed: how far, and the rows still
 * open (actors behind it only show inside them). */
static int32_t seg_d[VIEW_W][MAX_SEGS] EWRAM_BSS;
static uint8_t seg_top[VIEW_W][MAX_SEGS] EWRAM_BSS;
static uint8_t seg_bot[VIEW_W][MAX_SEGS] EWRAM_BSS;
static uint8_t seg_n[VIEW_W];

/* Actors this frame, farthest first. */
typedef struct
{
    Entity *e;
    int depth, screen_x, line, bottom;
} Billboard;
static Billboard boards[MAX_ACTORS];
static int board_count;
static uint32_t canvas_words[CANVAS * CANVAS / 4] EWRAM_BSS;
#define CANVAS_PX ((uint8_t *)canvas_words)

/* Set Cell Heights in progress. */
typedef struct
{
    uint8_t x, y, w, h;
    int16_t floor, ceil;   /* target, -1 = leave */
    int16_t speed;         /* units per frame, Q8 */
    int16_t acc;
} Mover;
static Mover movers[MAX_MOVERS];
static int mover_count;

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
    for (int i = 0; i < 4096; i++)
    {
        int n = (VIEW_H << 12) / (i * 4 + 2);
        line_near[i] = (uint16_t)(n > 65535 ? 65535 : n);
        line_far[i] = (uint16_t)((VIEW_H << 12) / (i * 64 + 32));
    }
    for (int x = 0; x < VIEW_W; x++)
        col_cam[x] = (int16_t)((x * 2 * 4096 + 4096) / VIEW_W - 4096);
    for (int v = 0; v < 1024; v++)
    {
        inv_small[v] = v ? (1 << 24) / v : (1 << 24);
        inv_big[v] = v >= 128 ? (1 << 24) / (v * 8 + 4) : (1 << 24) / 1024;
    }
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
    if (!scene->raycast || (int)scene->width * scene->height > MAX_CELLS)
    {
        raycast_leave();
        return;
    }
    if (!tables_ready)
        build_tables();
    cur = scene;
    rc = scene->raycast;
    map_w = scene->width;
    map_h = scene->height;
    for (int i = 0; i < map_w * map_h; i++)
        cells[i] = rc->floor_h[i] | (rc->ceil_h[i] << 8) | (rc->floor_col[i] << 16) | ((uint32_t)rc->ceil_col[i] << 24);
    mover_count = 0;
    active = 1;
    dirty = 1;
    half = 0;
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
    mover_count = 0;
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
    half = 0;
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

void raycast_set_eye(int floor)
{
    int eye = floor * 2 + 2048;   /* (1/256 units -> Q12 cells) + half a cell */
    if (eye != cam_eye)
    {
        cam_eye = eye;
        dirty = 1;
    }
}

int raycast_angle(void)
{
    return cam_angle;
}

/* ------------------------------------------------------------------ */
/* Heights                                                             */

static int solid_cell(int i)
{
    return CELL_CEIL(i) <= CELL_FLOOR(i);
}

int raycast_floor_under(int x, int y, int w, int h)
{
    int top = 0;
    for (int cy = y >> 3; cy <= (y + h - 1) >> 3; cy++)
        for (int cx = x >> 3; cx <= (x + w - 1) >> 3; cx++)
        {
            if (cx < 0 || cy < 0 || cx >= map_w || cy >= map_h)
                continue;
            int i = cy * map_w + cx;
            if (!solid_cell(i) && (int)CELL_FLOOR(i) > top)
                top = CELL_FLOOR(i);
        }
    return top;
}

int raycast_box_ok(int x, int y, int w, int h, int floor)
{
    for (int cy = y >> 3; cy <= (y + h - 1) >> 3; cy++)
        for (int cx = x >> 3; cx <= (x + w - 1) >> 3; cx++)
        {
            if (cx < 0 || cy < 0 || cx >= map_w || cy >= map_h)
                return 0;
            int i = cy * map_w + cx;
            if (solid_cell(i))
                return 0;
            int cf = CELL_FLOOR(i), cc = CELL_CEIL(i);
            if (cf - floor > RAYCAST_STEP)
                return 0;   /* too high to step up */
            int stand = cf > floor ? cf : floor;
            if (cc - stand < RAYCAST_HEADROOM)
                return 0;   /* too low to fit under */
        }
    return 1;
}

void raycast_heights(const int16_t *p)
{
    Mover m = { (uint8_t)p[0], (uint8_t)p[1], (uint8_t)p[2], (uint8_t)p[3], p[4], p[5], p[6], 0 };
    if (m.speed <= 0 || mover_count >= MAX_MOVERS)
    {
        /* At once. */
        for (int y = m.y; y < m.y + m.h && y < map_h; y++)
            for (int x = m.x; x < m.x + m.w && x < map_w; x++)
            {
                if (m.floor >= 0)
                    set_floor(y * map_w + x, m.floor);
                if (m.ceil >= 0)
                    set_ceil(y * map_w + x, m.ceil);
            }
        dirty = 1;
        return;
    }
    /* A new move of the same area replaces the old one. */
    for (int i = 0; i < mover_count; i++)
        if (movers[i].x == m.x && movers[i].y == m.y && movers[i].w == m.w && movers[i].h == m.h)
        {
            movers[i] = m;
            return;
        }
    movers[mover_count++] = m;
}

static int toward(int v, int target, int n)
{
    if (v < target)
        return v + n > target ? target : v + n;
    if (v > target)
        return v - n < target ? target : v - n;
    return v;
}

static void tick_movers(void)
{
    for (int k = 0; k < mover_count;)
    {
        Mover *m = &movers[k];
        m->acc += m->speed;
        int n = m->acc >> 8;
        m->acc &= 255;
        int done = 1;
        for (int y = m->y; y < m->y + m->h && y < map_h; y++)
            for (int x = m->x; x < m->x + m->w && x < map_w; x++)
            {
                int i = y * map_w + x;
                if (m->floor >= 0)
                {
                    set_floor(i, toward(CELL_FLOOR(i), m->floor, n));
                    done &= (int)CELL_FLOOR(i) == m->floor;
                }
                if (m->ceil >= 0)
                {
                    set_ceil(i, toward(CELL_CEIL(i), m->ceil, n));
                    done &= (int)CELL_CEIL(i) == m->ceil;
                }
            }
        if (n)
            dirty = 1;
        if (done)
            movers[k] = movers[--mover_count];
        else
            k++;
    }
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */

static inline int iabs(int v)
{
    return v < 0 ? -v : v;
}

static inline __attribute__((always_inline)) void fill(uint8_t *dst, int y0, int y1, uint8_t c)
{
    for (; y0 < y1; y0++)
        dst[row_off[y0]] = c;
}

/* Rows y0..y1 of a wall face whose top (unclipped) is at row `top`:
 * one texture height per cell, `line` px. */
static inline __attribute__((always_inline)) void face(uint8_t *dst, int y0, int y1, int top, int d,
                                                       const uint8_t *col, int shade)
{
    if (y0 >= y1)
        return;
    /* Texels per row = TEX / line = TEX * d / (VIEW_H << 12): d * 6.4 in Q16. */
    int step = (d * 6553) >> 10;
    int v = (y0 - top) * step;
    for (; y0 < y1; y0++, v += step)
        dst[row_off[y0]] = (uint8_t)(col[(v >> 16) & (TEX - 1)] + shade);
}

/*
 * One frame. Each column casts a ray across the cells (DDA). Between
 * height changes it fills the floor and ceiling it passed over; at a
 * change it draws the step up (lower face) or the lower ceiling (upper
 * face) and narrows the column's open window; a solid cell ends it.
 * Positions and heights are Q12 cells.
 */
__attribute__((section(".iwram"), long_call, target("arm"), noinline))
static void render(int col0, int col1)
{
    const int w = map_w, h = map_h;
    const uint8_t *texmap = rc->tex;
    const int darken = rc->dark, tex_count = rc->tex_count;
    const int dir_x = sin_tab[(view_angle + 256) & 1023], dir_y = sin_tab[view_angle & 1023];
    const int plane_x = -dir_y * 2 / 3, plane_y = dir_x * 2 / 3;   /* ~67 degree view */
    const int pos_x = view_x * 2, pos_y = view_y * 2;              /* 1/256 px -> Q12 cells */
    const int map_x0 = pos_x >> 12, map_y0 = pos_y >> 12;
    const int eye = view_eye;

    for (int x = col0; x < col1; x++)
    {
        int cam = col_cam[x];
        int ray_x = dir_x + ((plane_x * cam) >> 12);
        int ray_y = dir_y + ((plane_y * cam) >> 12);
        int dd_x = inv_of(ray_x);
        int dd_y = inv_of(ray_y);
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

        uint8_t *dst = VIEW + (x >> 3) * 64 + (x & 7);
        int ci = (map_x0 >= 0 && map_y0 >= 0 && map_x0 < w && map_y0 < h) ? map_y0 * w + map_x0 : 0;
        uint32_t c_info = cells[ci];
        int c_floor = (c_info & 255) << 9, c_ceil = ((c_info >> 8) & 255) << 9;
        uint8_t c_fc = (uint8_t)(c_info >> 16), c_cc = (uint8_t)(c_info >> 24);
        int ytop = 0, ybot = VIEW_H;      /* rows still open */
        int near_f = VIEW_H, near_c = 0;  /* this stretch's floor / ceiling rows where it starts */
        int nseg = 0;
        int closed = 0;

        for (int n = 0; n < MAX_STEPS && !closed; n++)
        {
            int side;
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
            int out = (unsigned)map_x >= (unsigned)w || (unsigned)map_y >= (unsigned)h;
            int ni = out ? 0 : map_y * w + map_x;
            uint32_t n_info = cells[ni];
            if (!out && n_info == c_info)
                continue;   /* nothing changes here */
            int n_floor = out ? c_floor : (int)(n_info & 255) << 9;
            int n_ceil = out ? c_floor : (int)((n_info >> 8) & 255) << 9;
            int solid = out || n_ceil <= n_floor;

            int d = side == 0 ? side_x - dd_x : side_y - dd_y;
            if (d < 64)
                d = 64;
            int line = line_of(d);
            int yf = HORIZON + (((eye - c_floor) * line) >> 12);
            int yc = HORIZON - (((c_ceil - eye) * line) >> 12);

            /* The floor and ceiling of the stretch just crossed. */
            {
                int a = yf > ytop ? yf : ytop, b = near_f < ybot ? near_f : ybot;
                fill(dst, a, b, c_fc);
                a = near_c > ytop ? near_c : ytop;
                b = yc < ybot ? yc : ybot;
                fill(dst, a, b, c_cc);
                if (yf < ybot)
                    ybot = yf;
                if (yc > ytop)
                    ytop = yc;
            }

            /* Texture column where the ray met this edge. */
            int t = out ? 0 : texmap[ni];
            if (t >= tex_count)
                t = 0;
            int wall = side == 0 ? pos_y + (int)(((int64_t)d * ray_y) >> 12)
                                 : pos_x + (int)(((int64_t)d * ray_x) >> 12);
            int tex_x = ((wall & 4095) * TEX) >> 12;
            if ((side == 0 && ray_x > 0) || (side == 1 && ray_y < 0))
                tex_x = TEX - 1 - tex_x;
            const uint8_t *col = rc->textures + (t * TEX + tex_x) * TEX;
            int shade = side ? darken : 0;

            if (solid)
            {
                if (ytop < ybot)
                    face(dst, ytop > yc ? ytop : yc, ybot < yf ? ybot : yf, yc, d, col, shade);
                ytop = ybot;
                closed = 1;
            }
            else
            {
                int nyc = HORIZON - (((n_ceil - eye) * line) >> 12);
                int nyf = HORIZON + (((eye - n_floor) * line) >> 12);
                if (n_ceil < c_ceil && nyc > ytop)
                {
                    face(dst, ytop > yc ? ytop : yc, ybot < nyc ? ybot : nyc, yc, d, col, shade);
                    ytop = nyc;
                }
                if (n_floor > c_floor && nyf < ybot)
                {
                    face(dst, ytop > nyf ? ytop : nyf, ybot < yf ? ybot : yf, nyf, d, col, shade);
                    ybot = nyf;
                }
                c_floor = n_floor;
                c_ceil = n_ceil;
                c_info = n_info;
                c_fc = (uint8_t)(n_info >> 16);
                c_cc = (uint8_t)(n_info >> 24);
                near_f = nyf;
                near_c = nyc;
                if (ytop >= ybot)
                    closed = 1;
            }
            if (nseg < MAX_SEGS)
            {
                seg_d[x][nseg] = d;
                seg_top[x][nseg] = (uint8_t)(ytop < 0 ? 0 : ytop > VIEW_H ? VIEW_H : ytop);
                seg_bot[x][nseg] = (uint8_t)(ybot < 0 ? 0 : ybot > VIEW_H ? VIEW_H : ybot);
                nseg++;
            }
        }
        if (!closed)
        {
            /* Ran out of reach: floor and ceiling to the horizon. */
            int a = HORIZON > ytop ? HORIZON : ytop, b = near_f < ybot ? near_f : ybot;
            fill(dst, a, b, c_fc);
            a = near_c > ytop ? near_c : ytop;
            b = HORIZON < ybot ? HORIZON : ybot;
            fill(dst, a, b, c_cc);
        }
        seg_n[x] = (uint8_t)nseg;
    }
}

/* An actor's current frame, decoded into the canvas. */
static void decode_frame(const ASprite *spr)
{
    static const uint32_t zero = 0;
    static int dirty_top = 0, dirty_bottom = CANVAS;   /* rows the last actor used */
    if (dirty_top < dirty_bottom)
        CpuFastSet(&zero, canvas_words + dirty_top * CANVAS / 4,
                   ((dirty_bottom - dirty_top) * CANVAS / 4) | (1 << 24));
    dirty_top = CANVAS;
    dirty_bottom = 0;
    if (spr->current_frame < 0 || spr->current_frame >= spr->frame_count)
        return;
    const ASpriteFrame *f = &spr->frames[spr->current_frame];
    for (int o = 0; o < f->obj_count; o++)
    {
        int t = f->objs[o].dy + FOOT_Y, b = t + f->objs[o].h;
        if (t < 0) t = 0;
        if (b > CANVAS) b = CANVAS;
        if (t < dirty_top) dirty_top = t;
        if (b > dirty_bottom) dirty_bottom = b;
    }
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
            int cy = obj->dy + FOOT_Y + (vflip ? obj->h - 1 - py : py);
            if (cy < 0 || cy >= CANVAS)
                continue;
            for (int px = 0; px < obj->w; px++)
            {
                int cx = obj->dx + FOOT_X + (hflip ? obj->w - 1 - px : px);
                if (cx < 0 || cx >= CANVAS)
                    continue;
                const uint8_t *tile = tiles + ((py >> 3) * tw + (px >> 3)) * 32;
                int b = tile[(py & 7) * 4 + ((px & 7) >> 1)];
                int c = (px & 1) ? b >> 4 : b & 15;
                if (c)
                    CANVAS_PX[cy * CANVAS + cx] = (uint8_t)(base + c);
            }
        }
    }
}

/* Every visible actor: where it is on screen (camera space, like the
 * walls), farthest first. 16 sprite pixels = one cell. */
static void gather_actors(void)
{
    const int dir_x = sin_tab[(view_angle + 256) & 1023], dir_y = sin_tab[view_angle & 1023];
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
        int ex = e->x + 8, ey = e->y + 8;
        int sx = (ex << 9) - view_x * 2;
        int sy = (ey << 9) - view_y * 2;
        int tx = (int)(((int64_t)(dir_y * sx - dir_x * sy) >> 12) * 4096 / det);
        int ty = (int)(((int64_t)(-plane_y * sx + plane_x * sy) >> 12) * 4096 / det);
        if (ty < 256)
            continue;   /* behind the camera, or right on top of it */
        Billboard *b = &boards[board_count];
        b->e = e;
        b->depth = ty;
        b->screen_x = (VIEW_W / 2) * (4096 + (int)(((int64_t)tx << 12) / ty)) >> 12;
        b->line = (VIEW_H << 12) / ty;
        int cx = ex >> 3, cy = ey >> 3;
        int fl = (cx >= 0 && cy >= 0 && cx < map_w && cy < map_h) ? (int)CELL_FLOOR(cy * map_w + cx) << 9 : 0;
        b->bottom = HORIZON + (((view_eye - fl) * b->line) >> 12);
        if (b->line < 1 || b->screen_x + b->line * 2 < 0 || b->screen_x - b->line * 2 >= VIEW_W)
            continue;
        board_count++;
    }
    for (int i = 1; i < board_count; i++)
        for (int j = i; j > 0 && boards[j].depth > boards[j - 1].depth; j--)
        {
            Billboard t = boards[j];
            boards[j] = boards[j - 1];
            boards[j - 1] = t;
        }
}

/* One actor over the view: each column only inside the window still open
 * at its distance (so it hides behind walls and shows through holes). */
__attribute__((section(".iwram"), long_call, target("arm"), noinline))
static void draw_actor(const Billboard *b)
{
    int span = b->line * 4;                      /* the canvas is 4 cells */
    int left = b->screen_x - b->line * 2;
    int top = b->bottom - span;
    int step = (CANVAS << 16) / span;
    int x0 = left < 0 ? 0 : left, x1 = left + span > VIEW_W ? VIEW_W : left + span;
    for (int x = x0; x < x1; x++)
    {
        int wt = 0, wb = VIEW_H;
        for (int k = 0; k < seg_n[x] && seg_d[x][k] < b->depth; k++)
        {
            wt = seg_top[x][k];
            wb = seg_bot[x][k];
        }
        int y0 = top > wt ? top : wt, y1 = b->bottom < wb ? b->bottom : wb;
        if (y0 >= y1)
            continue;
        const uint8_t *col = CANVAS_PX + (((x - left) * step) >> 16);
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


void raycast_draw(void)
{
    if (!active)
        return;
    tick_movers();
    if (frame_ready)
        return;
    /* The second half of the frame started last time. */
    if (half)
    {
        render(VIEW_W / 2, VIEW_W);
        gather_actors();
        for (int i = 0; i < board_count; i++)
        {
            decode_frame(&boards[i].e->sprite);
            draw_actor(&boards[i]);
        }
        half = 0;
        frame_ready = 1;
        return;
    }
    /* Actors move and animate: redraw every frame while there are any. */
    if (world_npc_count() > 0)
        dirty = 1;
    if (!dirty)
        return;
    /* A new frame, over two game frames (the game keeps its 60 a second):
     * the left half now, the right half and the actors next time. */
    view_x = cam_x;
    view_y = cam_y;
    view_angle = cam_angle;
    view_eye = cam_eye;
    dirty = 0;
    render(0, VIEW_W / 2);
    half = 1;
    return;
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
