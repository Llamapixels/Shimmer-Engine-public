#include <gba.h>
#include <stdint.h>

#include "raycast.h"
#include "entity.h"
#include "sprite.h"   /* sprite_sin() */
#include "world.h"
#include "projectile.h"

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
#define SKY         255                   /* a cell's ceiling colour: the sky */
#define CROSSHAIR   120                   /* palette: the crosshair's colour */

#define SPRITE_PAL  128                   /* OBJ palette banks 0-6 copied to 128-239 */
#define SPRITE_BANKS 7
#define MAX_ACTORS  28                    /* actors and projectiles */
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

/* Engine options (raycast_set_options / raycast_set_body). */
static int fov_q = 2731;              /* camera plane, Q12 (2/3: ~67 degrees) */
static int turn_px = 641;             /* view columns in a full turn */
static int fog_d = 0x7FFFFFFF;        /* walls farther than this (Q12) are darker */
static int actor_turn = 1;            /* actors show their side / back */
static int crosshair;
static int eye_units = 4, step_units = 3, headroom_units = 5;
/* Sky: the picture's first column at the view's left edge, and the
 * picture's width in view columns per full turn. */
static int sky_x0, sky_span;
static int aim_next = -1, aimed = -1;
static int scene_has_sky;            /* some cell shows the sky: render_sky() */
static int draw_phase;               /* raycast_draw(): 0 starts a frame, 1 columns, 2 actors */

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
    int n;                 /* actor index, -1 = a projectile */
    int lift;              /* drawn this far above the floor (Q12) */
    int frame;             /* frame to show (turned to the camera) */
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
    scene_has_sky = 0;
    for (int i = 0; i < map_w * map_h; i++)
    {
        cells[i] = rc->floor_h[i] | (rc->ceil_h[i] << 8) | (rc->floor_col[i] << 16) | ((uint32_t)rc->ceil_col[i] << 24);
        scene_has_sky |= rc->ceil_col[i] == SKY;
    }
    mover_count = 0;
    active = 1;
    dirty = 1;
    aimed = aim_next = -1;
    raycast_set_options(1, 0, 1, 0);
    frame_ready = 0;
    draw_phase = 0;
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
    draw_phase = 0;
    frame_ready = 0;
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
    int eye = floor * 2 + (eye_units << 9);   /* 1/256 units -> Q12 cells, plus the eye height */
    if (eye != cam_eye)
    {
        cam_eye = eye;
        dirty = 1;
    }
}

static int solid_cell(int i);

void raycast_set_body(int eye, int step, int headroom)
{
    eye_units = eye;
    step_units = step;
    headroom_units = headroom;
}

void raycast_set_options(int fov, int fog, int turn_actors, int show_crosshair)
{
    static const int16_t FOV_Q[3] = { 2048, 2731, 3482 };   /* plane: 1/2, 2/3, 0.85 */
    static const int16_t TURN_PX[3] = { 813, 641, 535 };    /* VIEW_W * pi / atan(plane) */
    static const int32_t FOG[3] = { 0x7FFFFFFF, 8 << 12, 4 << 12 };
    fov = fov >= 0 && fov < 3 ? fov : 1;
    fov_q = FOV_Q[fov];
    turn_px = TURN_PX[fov];
    fog_d = FOG[fog >= 0 && fog < 3 ? fog : 0];
    actor_turn = turn_actors;
    crosshair = show_crosshair;
    sky_span = 0;
    if (rc && rc->sky && rc->sky_w)
    {
        int k = (turn_px + rc->sky_w / 2) / rc->sky_w;   /* whole repeats a turn: no seam */
        sky_span = rc->sky_w * (k < 1 ? 1 : k);
    }
    dirty = 1;
}

int raycast_solid_at(int x, int y)
{
    int cx = x >> 3, cy = y >> 3;
    if (!active || cx < 0 || cy < 0 || cx >= map_w || cy >= map_h)
        return 0;
    return solid_cell(cy * map_w + cx);
}

int raycast_aimed(void)
{
    return active ? aimed : -1;
}

int raycast_ceil_over(int x, int y, int w, int h)
{
    int low = 255;
    for (int cy = y >> 3; cy <= (y + h - 1) >> 3; cy++)
        for (int cx = x >> 3; cx <= (x + w - 1) >> 3; cx++)
        {
            if (cx < 0 || cy < 0 || cx >= map_w || cy >= map_h)
                continue;
            int i = cy * map_w + cx;
            if (!solid_cell(i) && (int)CELL_CEIL(i) < low)
                low = CELL_CEIL(i);
        }
    return low;
}

void raycast_camera(int *x, int *y)
{
    *x = cam_x;
    *y = cam_y;
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
            if (cf - floor > step_units)
                return 0;   /* too high to step up */
            int stand = cf > floor ? cf : floor;
            if (cc - stand < headroom_units)
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

/* The sky in this column: the picture's column (else its colour). Kept
 * out of render()'s registers - it's only needed where the sky shows. */
static const uint8_t *sky_column;

__attribute__((section(".iwram"), long_call, target("arm"), noinline))
static void fill_sky(uint8_t *dst, int y0, int y1)
{
    const uint8_t *col = sky_column;
    if (!col)
    {
        fill(dst, y0, y1, rc->sky_col);
        return;
    }
    int h = rc->sky_h;
    for (; y0 < y1; y0++)
        dst[row_off[y0]] = col[y0 < h ? y0 : h - 1];
}

/* A ceiling: its colour, or the sky (scenes with sky cells only). */
static inline __attribute__((always_inline)) void fill_ceil(uint8_t *dst, int y0, int y1, uint8_t c, const int with_sky)
{
    if (!with_sky || c != SKY)
        fill(dst, y0, y1, c);
    else if (y0 < y1)
        fill_sky(dst, y0, y1);
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
static inline __attribute__((always_inline)) void render_columns(int col0, int col1, const int with_sky)
{
    const int w = map_w, h = map_h;
    const uint8_t *texmap = rc->tex;
    const int darken = rc->dark, tex_count = rc->tex_count;
    const int dir_x = sin_tab[(view_angle + 256) & 1023], dir_y = sin_tab[view_angle & 1023];
    const int plane_x = (-dir_y * fov_q) >> 12, plane_y = (dir_x * fov_q) >> 12;
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
        if (with_sky && rc->sky)
        {
            int sx = sky_x0 + x;
            while (sx >= rc->sky_w)
                sx -= rc->sky_w;
            sky_column = rc->sky + sx * rc->sky_h;
        }
        else
            sky_column = 0;
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
            uint8_t n_cc = (uint8_t)(n_info >> 24);
            int solid = out || n_ceil <= n_floor;
            if (with_sky && solid && c_cc == SKY && !out)
            {
                /* Under the sky a wall is a block: a solid collision tile
                 * (ceiling 0) as tall as its floor value, anything else
                 * closed (a door) up to the sky. What's behind shows over it. */
                solid = 0;
                if (n_ceil)
                    n_floor = c_ceil;
                n_ceil = c_ceil;
                n_cc = SKY;
            }

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
                fill_ceil(dst, a, b, c_cc, with_sky);
                if (yf < ybot)
                    ybot = yf;
                if (yc > ytop)
                    ytop = yc;
            }

            /* Texture column where the ray met this edge. */
            int t = out ? rc->edge_tex : texmap[ni];
            if (t >= tex_count)
                t = 0;
            int wall = side == 0 ? pos_y + (int)(((int64_t)d * ray_y) >> 12)
                                 : pos_x + (int)(((int64_t)d * ray_x) >> 12);
            int tex_x = ((wall & 4095) * TEX) >> 12;
            if ((side == 0 && ray_x > 0) || (side == 1 && ray_y < 0))
                tex_x = TEX - 1 - tex_x;
            const uint8_t *col = rc->textures + (t * TEX + tex_x) * TEX;
            int shade = (side || d > fog_d) ? darken : 0;

            if (with_sky && solid && out && c_cc == SKY)
            {
                /* The edge of the world under the sky: sky down to the
                 * horizon, endless ground below it. */
                int h = HORIZON < ybot ? HORIZON : ybot;
                fill_ceil(dst, ytop, h, SKY, with_sky);
                fill(dst, h > ytop ? h : ytop, ybot, c_fc);
                ytop = ybot;
                closed = 1;
            }
            else if (solid)
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
                if (with_sky && c_cc == SKY && n_cc == SKY && nyc > ytop)
                    nyc = ytop;   /* sky to sky: no wall between them */
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
                c_cc = n_cc;
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
            fill_ceil(dst, a, b, c_cc, with_sky);
        }
        seg_n[x] = (uint8_t)nseg;
    }
}

/* render_columns() twice: without any sky code (it costs the inner loop
 * registers), and with it for scenes that have sky cells. */
__attribute__((section(".iwram"), long_call, target("arm"), noinline))
static void render_indoor(int col0, int col1)
{
    render_columns(col0, col1, 0);
}

__attribute__((section(".iwram"), long_call, target("arm"), noinline))
static void render_sky(int col0, int col1)
{
    render_columns(col0, col1, 1);
}



static void render(int col0, int col1)
{
    if (scene_has_sky)
        render_sky(col0, col1);
    else
        render_indoor(col0, col1);
}

/* An actor's current frame, decoded into the canvas. */
static void decode_frame(const ASprite *spr, int frame)
{
    static const uint32_t zero = 0;
    static int dirty_top = 0, dirty_bottom = CANVAS;   /* rows the last actor used */
    if (dirty_top < dirty_bottom)
        CpuFastSet(&zero, canvas_words + dirty_top * CANVAS / 4,
                   ((dirty_bottom - dirty_top) * CANVAS / 4) | (1 << 24));
    dirty_top = CANVAS;
    dirty_bottom = 0;
    if (frame < 0 || frame >= spr->frame_count)
        return;
    const ASpriteFrame *f = &spr->frames[frame];
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

/* The frame an actor shows seen from (vx, vy) away (the camera, minus
 * its position): its front, back or a side, as if it faced that way -
 * its own direction is left alone. */
static int turned_frame(const Entity *e, int vx, int vy)
{
    static const int8_t FX[4] = { 0, 0, 1, -1 }, FY[4] = { 1, -1, 0, 0 };   /* down, up, right, left */
    const SpriteDef *d = e->def;
    int cur = e->sprite.current_frame;
    if (!actor_turn || !d || e->extra_slot || e->anim_hold || e->anim_state >= d->state_count)
        return cur;
    int f = e->direction & 3;
    vx >>= 8;
    vy >>= 8;
    int dot = FX[f] * vx + FY[f] * vy, cross = FX[f] * vy - FY[f] * vx;
    int adot = dot < 0 ? -dot : dot, across = cross < 0 ? -cross : cross;
    int rel = adot >= across ? (dot >= 0 ? DIR_DOWN : DIR_UP) : (cross > 0 ? DIR_RIGHT : DIR_LEFT);
    int ai = d->state_maps[e->anim_state * ENTITY_STATE_SLOTS + (e->moving ? 4 : 0) + rel];
    if (ai >= d->anim_count || !d->anims[ai].frame_count)
        return cur;
    const EntityAnimation *a = &d->anims[ai];
    return a->frames[e->anim_frame % a->frame_count];
}

/* One billboard for entity e (actor n, or -1 for a projectile drawn
 * `lift` above the floor), if it's in view. */
static void add_board(Entity *e, int n, int lift, int32_t x, int32_t y, int dir_x, int dir_y, int plane_x, int plane_y, int det)
{
    /* x, y: the footprint's top-left in 1/256 px (sub-pixel, so a
     * projectile right in front of the camera stays under the crosshair). */
    int ex = (x >> 8) + 8, ey = (y >> 8) + 8;
    int sx = (x + (8 << 8)) * 2 - view_x * 2;
    int sy = (y + (8 << 8)) * 2 - view_y * 2;
    int tx = (int)(((int64_t)(dir_y * sx - dir_x * sy) >> 12) * 4096 / det);
    int ty = (int)(((int64_t)(-plane_y * sx + plane_x * sy) >> 12) * 4096 / det);
    if (ty < (n < 0 ? 4096 : 256))
        return;   /* behind the camera, or right on top of it (a projectile
                   * shows from a cell away) */
    Billboard *b = &boards[board_count];
    b->e = e;
    b->n = n;
    b->lift = lift;
    b->frame = turned_frame(e, view_x - (ex << 8), view_y - (ey << 8));
    b->depth = ty;
    b->screen_x = (VIEW_W / 2) * (4096 + (int)(((int64_t)tx << 12) / ty)) >> 12;
    b->line = (VIEW_H << 12) / ty;
    /* Actors stand on the floor under them; projectiles fly level, from
     * the camera's feet (they don't hop over steps and window sills). */
    int cx = ex >> 3, cy = ey >> 3;
    int fl = n < 0 ? view_eye - (eye_units << 9)
             : (cx >= 0 && cy >= 0 && cx < map_w && cy < map_h) ? (int)CELL_FLOOR(cy * map_w + cx) << 9 : 0;
    b->bottom = HORIZON + (((view_eye - fl - lift) * b->line) >> 12);
    if (b->line < 1 || b->screen_x + b->line * 2 < 0 || b->screen_x - b->line * 2 >= VIEW_W)
        return;
    board_count++;
}

/* Every visible actor and projectile: where it is on screen (camera
 * space, like the walls), farthest first. 16 sprite pixels = one cell. */
static void gather_actors(void)
{
    const int dir_x = sin_tab[(view_angle + 256) & 1023], dir_y = sin_tab[view_angle & 1023];
    const int plane_x = (-dir_y * fov_q) >> 12, plane_y = (dir_x * fov_q) >> 12;
    const int det = (plane_x * dir_y - dir_x * plane_y) >> 12;
    board_count = 0;
    if (!det)
        return;
    for (int i = 0; i < world_npc_count() && board_count < MAX_ACTORS; i++)
    {
        Entity *e = world_npc(i);
        if (!e || !e->solid || e->pinned || !e->sprite.visible)
            continue;
        add_board(e, i, 0, e->x << 8, e->y << 8, dir_x, dir_y, plane_x, plane_y, det);
    }
    /* Projectiles fly at eye height: a sprite centred in its 16x16 cell
     * (4 units up) sits a unit under the crosshair. */
    Entity *shots[PROJECTILE_MAX];
    int32_t at[PROJECTILE_MAX * 2];
    int count = projectile_entities(shots, at, PROJECTILE_MAX);
    for (int i = 0; i < count && board_count < MAX_ACTORS; i++)
        add_board(shots[i], -1, (eye_units << 9) - 2560, at[i * 2], at[i * 2 + 1], dir_x, dir_y, plane_x, plane_y, det);
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
        if (b->n >= 0 && x == VIEW_W / 2 && y0 <= HORIZON && HORIZON < y1 && col[(((HORIZON - top) * step) >> 16) * CANVAS])
            aim_next = b->n;   /* under the crosshair (nearest drawn last) */
        int v = (y0 - top) * step;
        for (int y = y0; y < y1; y++, v += step)
        {
            uint8_t c = col[(v >> 16) * CANVAS];
            if (c)
                dst[row_off[y]] = c;
        }
    }
}


/* Lines since the last VBlank began (0-227): the main loop has until
 * DEADLINE to finish before the next VBlank, or the game loses a frame. */
#define DEADLINE 218
#define COLUMN_CHUNK 8

static int lines_since_vblank(void)
{
    int v = REG_VCOUNT;
    return v >= 160 ? v - 160 : v + 68;
}

/* The crosshair, over the finished view. */
static void draw_crosshair(void)
{
    static const int8_t CX[8] = { -3, -2, 2, 3, 0, 0, 0, 0 }, CY[8] = { 0, 0, 0, 0, -3, -2, 2, 3 };
    for (int k = 0; k < 8; k++)
    {
        int x = VIEW_W / 2 + CX[k], y = HORIZON + CY[k];
        VIEW[(x >> 3) * 64 + (x & 7) + row_off[y]] = CROSSHAIR;
    }
}

/*
 * A frame is drawn a few columns at a time, then the actors one at a time,
 * for as long as this game frame has time left (the game itself always
 * keeps its 60 frames a second), and carries on in the next. Simple views
 * finish in one game frame, busy ones take two or three. Each chunk is
 * started only if the last one of its kind would still fit.
 */
void raycast_draw(void)
{

    static int next_col, next_actor;
    static int col_cost = 8, actor_cost = 4;   /* lines the last chunk / actor took */
    if (!active)
        return;
    tick_movers();
    if (frame_ready)
        return;
    if (draw_phase == 0)
    {
        /* Actors move and animate: redraw every frame while there are any. */
        if (world_npc_count() > 0)
            dirty = 1;
        if (!dirty)
            return;
        view_x = cam_x;
        view_y = cam_y;
        view_angle = cam_angle;
        view_eye = cam_eye;
        if (rc->sky && sky_span)
            sky_x0 = (int)(((uint32_t)view_angle * (uint32_t)sky_span) >> 10) % rc->sky_w;
        dirty = 0;
        next_col = 0;
        draw_phase = 1;
    }
    int start = lines_since_vblank(), first = 1;
    while (draw_phase == 1)
    {
        int t = lines_since_vblank();
        if (!first && (t < start || t + col_cost > DEADLINE))
            return;
        int c1 = next_col + COLUMN_CHUNK < VIEW_W ? next_col + COLUMN_CHUNK : VIEW_W;
        render(next_col, c1);
        next_col = c1;
        int took = lines_since_vblank() - t;
        col_cost = took < 0 ? took + 228 : took;
        first = 0;
        if (next_col >= VIEW_W)
        {
            gather_actors();
            aim_next = -1;
            next_actor = 0;
            draw_phase = 2;
        }
    }
    while (draw_phase == 2)
    {
        if (next_actor >= board_count)
        {
            aimed = aim_next;
            if (crosshair)
                draw_crosshair();
            frame_ready = 1;
            draw_phase = 0;
            return;
        }
        int t = lines_since_vblank();
        if (!first && (t < start || t + actor_cost > DEADLINE))
            return;
        Billboard *b = &boards[next_actor++];
        decode_frame(&b->e->sprite, b->frame);
        draw_actor(b);
        int took = lines_since_vblank() - t;
        actor_cost = took < 0 ? took + 228 : took;
        first = 0;
    }
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
