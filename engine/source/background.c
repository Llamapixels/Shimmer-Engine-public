#include <gba.h>

#include "background.h"
#include "scene.h"   /* ParallaxLayer, PARALLAX_FIXED */

/*
 * VRAM layout for BG0:
 *
 *   char base block 0   0x06000000  tile graphics (up to 1024 tiles,
 *                                    running into block 1)
 *   screen blocks 28-31 0x0600E000  map (up to 64x64 = 4 blocks)
 *
 * Screen block n lives at 0x06000000 + n * 0x800.
 */
#define BG_TILES      ((volatile uint16_t *)0x06000000)
#define BG_MAP_BLOCK  28
#define BG_MAP        ((volatile uint16_t *)(0x06000000 + BG_MAP_BLOCK * 0x800))

#define BG_PAL        ((volatile uint16_t *)0x05000000)

/* Hardware background size, in tiles - the max a single BG supports. */
#define HW_SIZE 64

/*
 * Streaming state (see background_stream_begin's comment in the
 * header for how this works). stream_active is checked from
 * background_set_scroll() on every camera move.
 */
static int stream_active = 0;

static const uint16_t *stream_map = 0;
static uint32_t stream_width = 0;
static uint32_t stream_height = 0;

/* Last camera tile position streaming has caught up to. */
static int stream_last_tile_x = 0;
static int stream_last_tile_y = 0;
static int stream_initialized = 0;

/*
 * Tiles swapped at runtime by the "Replace Tile" script event (see
 * background_set_tile()). The scene's map lives in ROM, so changes are
 * kept here and win over it - both when writing VRAM right away and
 * whenever streaming redraws that tile later. Cleared on every map
 * load, so they only last for the current visit to a scene, like GB
 * Studio's own replaced tiles.
 */
#define TILE_OVERRIDE_MAX 64
static struct { uint16_t x, y, entry; } tile_overrides[TILE_OVERRIDE_MAX];
static int tile_override_count = 0;

/*
 * Parallax (GB Studio's scene setting): the screen is split into up to 3
 * horizontal bands, each scrolled at its own fraction of the camera's x.
 * One BG layer does it all - a VCOUNT interrupt changes BG0HOFS on the
 * scanline where each band starts. Streamed (big) maps keep every band's
 * visible rows filled around that band's own scroll position.
 */
#define BAND_MAX     3
#define SCREEN_ROWS  20
static int band_count = 0;               /* 0 = no parallax */
static uint8_t band_top[BAND_MAX];       /* first screen tile row */
static uint8_t band_speed[BAND_MAX];
static volatile int band_x[BAND_MAX];    /* current scroll of each band */
static int band_last_tx[BAND_MAX];       /* streaming: last tile x per band */
static volatile int irq_band = 0;

/*
 * Background layers on BG2/BG3: same tiles and palettes as BG0 (char
 * block 0), maps in screen blocks 24-25 and 26-27 (free: BG0's map is
 * 28-31, the dialogue box uses char block 2 and screen block 23).
 */
#define LAYER_MAX 2
static const uint8_t LAYER_SB[LAYER_MAX] = { 24, 26 };
static int layer_count = 0;
static BgLayer layer_def[LAYER_MAX];
static int32_t layer_drift_x[LAYER_MAX], layer_drift_y[LAYER_MAX];   /* 1/256 px */
static int layer_cam_x = 0, layer_cam_y = 0;

static const uint16_t *loaded_map = 0;
static uint32_t loaded_width = 0;
static uint32_t loaded_height = 0;

static int find_override(int x, int y)
{
    for (int i = 0; i < tile_override_count; i++)
        if (tile_overrides[i].x == x && tile_overrides[i].y == y)
            return i;
    return -1;
}

void background_init(void)
{
    /* Size bits get set by background_load_map / background_stream_begin. */
    REG_BG0CNT =
        (2 << 0) |                 /* priority 2 - behind sprites (1) and the dialogue box (0) */
        (0 << 2) |                 /* char base block 0 */
        (BG_MAP_BLOCK << 8);       /* screen base block 28, 4bpp */

    REG_DISPCNT |= BG0_ENABLE;

    REG_BG0HOFS = 0;
    REG_BG0VOFS = 0;
}

void background_load_palettes(
    const uint16_t *palettes,
    int count
)
{
    for (int i = 0; i < count * 16; i++)
        BG_PAL[i] = palettes[i];
}

void background_load_tiles(
    const uint8_t *data,
    uint32_t size
)
{
    uint32_t halfwords = size / 2;

    for (uint32_t i = 0; i < halfwords; i++)
    {
        BG_TILES[i] =
            data[i * 2] |
            ((uint16_t)data[i * 2 + 1] << 8);
    }
}

void background_load_map(
    const uint16_t *map,
    uint32_t width,
    uint32_t height
)
{
    stream_active = 0;   /* this scene fits in VRAM directly */
    tile_override_count = 0;
    loaded_map = map;
    loaded_width = width;
    loaded_height = height;

    /*
     * Hardware BG sizes (in tiles) and their REG_BGxCNT size bits:
     *   32x32 = 0, 64x32 = 1, 32x64 = 2, 64x64 = 3
     */
    uint32_t hw_w = (width  > 32) ? 64 : 32;
    uint32_t hw_h = (height > 32) ? 64 : 32;

    uint16_t size_bits =
        (hw_w == 64 ? 1 : 0) |
        (hw_h == 64 ? 2 : 0);

    REG_BG0CNT = (REG_BG0CNT & 0x3FFF) | (size_bits << 14);

    /*
     * Big maps are made of 32x32 screen blocks placed left-to-right,
     * then top-to-bottom, so write each tile into the right block.
     */
    uint32_t blocks_across = hw_w / 32;

    for (uint32_t y = 0; y < hw_h; y++)
    {
        for (uint32_t x = 0; x < hw_w; x++)
        {
            uint16_t entry = 0;   /* tile 0 = blank backdrop */

            if (x < width && y < height)
                entry = map[y * width + x];

            uint32_t block = (x / 32) + (y / 32) * blocks_across;

            BG_MAP[block * 1024 + (y % 32) * 32 + (x % 32)] = entry;
        }
    }
}

/* ------------------------------------------------------------------- */
/* Streaming                                                            */
/* ------------------------------------------------------------------- */

static uint16_t stream_tile_at(int wx, int wy)
{
    if (wx < 0 || wy < 0 ||
        (uint32_t)wx >= stream_width ||
        (uint32_t)wy >= stream_height)
        return 0;   /* outside the map: blank tile */

    if (tile_override_count > 0)
    {
        int o = find_override(wx, wy);
        if (o >= 0)
            return tile_overrides[o].entry;
    }

    return stream_map[(uint32_t)wy * stream_width + (uint32_t)wx];
}

static void stream_put(int phys_col, int phys_row, uint16_t entry)
{
    uint32_t block = (uint32_t)(phys_col / 32) + (uint32_t)(phys_row / 32) * 2;

    BG_MAP[block * 1024 + (phys_row % 32) * 32 + (phys_col % 32)] = entry;
}

/*
 * Given a physical VRAM row/column (0-63) and the camera's CURRENT
 * tile position on that axis, work out which world tile it should
 * currently hold. The window always spans exactly HW_SIZE world
 * tiles, centered on the camera (HW_SIZE/2 tiles of slack on each
 * side - far more than the 30x20 tile screen needs), so this can be
 * computed fresh every time with no extra state to keep in sync.
 */
static int world_for_phys(int phys, int cam_tile)
{
    int base = cam_tile - HW_SIZE / 2;
    int base_phys = ((base % HW_SIZE) + HW_SIZE) % HW_SIZE;
    int offset = ((phys - base_phys) % HW_SIZE + HW_SIZE) % HW_SIZE;
    return base + offset;
}

/* Fill one physical column (all 64 rows) from the logical map. */
static void stream_write_col(int world_x, int cam_tile_y)
{
    int phys_col = ((world_x % HW_SIZE) + HW_SIZE) % HW_SIZE;

    for (int row = 0; row < HW_SIZE; row++)
    {
        int world_y = world_for_phys(row, cam_tile_y);
        stream_put(phys_col, row, stream_tile_at(world_x, world_y));
    }
}

/* Fill one physical row (all 64 columns) from the logical map. */
static void stream_write_row(int world_y, int cam_tile_x)
{
    int phys_row = ((world_y % HW_SIZE) + HW_SIZE) % HW_SIZE;

    for (int col = 0; col < HW_SIZE; col++)
    {
        int world_x = world_for_phys(col, cam_tile_x);
        stream_put(col, phys_row, stream_tile_at(world_x, world_y));
    }
}

static int band_of_screen_row(int row)
{
    int b = 0;
    while (b + 1 < band_count && row >= band_top[b + 1])
        b++;
    return b;
}

static int band_scroll(int b, int camera_x)
{
    if (band_speed[b] == PARALLAX_FIXED)
        return 0;
    return camera_x >> band_speed[b];
}

/* Parallax streaming: redraw the rows on screen (plus one either side),
 * each around its own band's scroll position. */
static void stream_write_visible_rows(int cam_ty)
{
    for (int r = -1; r <= SCREEN_ROWS; r++)
        stream_write_row(cam_ty + r, band_x[band_of_screen_row(r)] >> 3);
}

/* One newly exposed column of band b: only its rows on screen. */
static void stream_write_band_col(int world_x, int b, int cam_ty)
{
    int phys_col = ((world_x % HW_SIZE) + HW_SIZE) % HW_SIZE;
    for (int r = -1; r <= SCREEN_ROWS; r++)
    {
        if (band_of_screen_row(r) != b)
            continue;
        int world_y = cam_ty + r;
        stream_put(phys_col, ((world_y % HW_SIZE) + HW_SIZE) % HW_SIZE, stream_tile_at(world_x, world_y));
    }
}

static void stream_update_parallax(int camera_y_px)
{
    int cam_ty = camera_y_px >> 3;

    if (!stream_initialized || cam_ty != stream_last_tile_y)
    {
        if (!stream_initialized)
            for (int r = -HW_SIZE / 2; r < HW_SIZE / 2; r++)
                stream_write_row(cam_ty + r, band_x[r < 0 ? 0 : band_of_screen_row(r)] >> 3);
        else
            stream_write_visible_rows(cam_ty);
        for (int b = 0; b < band_count; b++)
            band_last_tx[b] = band_x[b] >> 3;
        stream_last_tile_y = cam_ty;
        stream_initialized = 1;
        return;
    }

    for (int b = 0; b < band_count; b++)
    {
        int tx = band_x[b] >> 3;
        while (tx > band_last_tx[b])
        {
            band_last_tx[b]++;
            stream_write_band_col(band_last_tx[b] + HW_SIZE / 2 - 1, b, cam_ty);
        }
        while (tx < band_last_tx[b])
        {
            band_last_tx[b]--;
            stream_write_band_col(band_last_tx[b] - HW_SIZE / 2, b, cam_ty);
        }
    }
}

/* VCOUNT interrupt, one scanline before a band starts: wait for that
 * line's HBlank, then switch the scroll for the rest of the screen. */
static void parallax_isr(void)
{
    int b = irq_band;
    if (b <= 0 || b >= band_count)
        return;
    while (!(REG_DISPSTAT & LCDC_HBL_FLAG))
        ;
    REG_BG0HOFS = (uint16_t)band_x[b];
    irq_band = ++b;
    if (b < band_count)
        REG_DISPSTAT = (REG_DISPSTAT & 0x00FF) | (uint16_t)((band_top[b] * 8 - 1) << 8);
}

void background_set_parallax(const ParallaxLayer *layers, int count)
{
    if (count > BAND_MAX)
        count = BAND_MAX;
    int top = 0;
    band_count = 0;
    for (int i = 0; i < count; i++)
    {
        if (top >= SCREEN_ROWS)
            break;
        band_top[i] = (uint8_t)top;
        band_speed[i] = layers[i].speed;
        band_x[i] = 0;
        band_count++;
        top += layers[i].rows ? layers[i].rows : 1;
    }
    irq_band = 0;
    if (band_count > 1)
    {
        irqSet(IRQ_VCOUNT, parallax_isr);
        irqEnable(IRQ_VCOUNT);
    }
    else
    {
        irqDisable(IRQ_VCOUNT);
    }
}

static void layers_apply(void)
{
    for (int i = 0; i < layer_count; i++)
    {
        const BgLayer *l = &layer_def[i];
        int x = (int)(((int32_t)layer_cam_x * l->speed_x + layer_drift_x[i]) >> 8);
        int y = (int)(((int32_t)layer_cam_y * l->speed_y + layer_drift_y[i]) >> 8);
        if (i == 0)
        {
            REG_BG2HOFS = (uint16_t)x;
            REG_BG2VOFS = (uint16_t)y;
        }
        else
        {
            REG_BG3HOFS = (uint16_t)x;
            REG_BG3VOFS = (uint16_t)y;
        }
    }
}

void background_set_layers(const BgLayer *layers, int count)
{
    if (count > LAYER_MAX)
        count = LAYER_MAX;
    layer_count = count;
    REG_DISPCNT &= ~(BG2_ENABLE | BG3_ENABLE);

    for (int i = 0; i < count; i++)
    {
        const BgLayer *l = &layers[i];
        layer_def[i] = *l;
        layer_drift_x[i] = layer_drift_y[i] = 0;

        /* size 0 = 32x32, 1 = 64x32, 2 = 32x64: 1 or 2 screen blocks,
         * one after the other (left/right or top/bottom). */
        int entries = l->size ? 2048 : 1024;
        volatile uint16_t *dst = (volatile uint16_t *)(0x06000000 + LAYER_SB[i] * 0x800);
        if (l->size == 1)
        {
            /* 64 wide: the compiler's map is row-major 64x32; the
             * hardware wants the left 32 columns, then the right. */
            for (int y = 0; y < 32; y++)
                for (int x = 0; x < 64; x++)
                    dst[(x / 32) * 1024 + y * 32 + (x % 32)] = l->map[y * 64 + x];
        }
        else
        {
            for (int j = 0; j < entries; j++)
                dst[j] = l->map[j];
        }

        uint16_t cnt = (uint16_t)((l->front ? 0 : 3) |       /* priority */
                                  (0 << 2) |                  /* char block 0, BG0's tiles */
                                  (LAYER_SB[i] << 8) |
                                  (l->size << 14));
        if (i == 0)
            REG_BG2CNT = cnt;
        else
            REG_BG3CNT = cnt;
        REG_DISPCNT |= i == 0 ? BG2_ENABLE : BG3_ENABLE;
    }
    layers_apply();
}

void background_vblank(void)
{
    if (layer_count > 0)
    {
        for (int i = 0; i < layer_count; i++)
        {
            layer_drift_x[i] += layer_def[i].auto_x;
            layer_drift_y[i] += layer_def[i].auto_y;
        }
        layers_apply();
    }

    if (band_count < 2)
        return;
    REG_BG0HOFS = (uint16_t)band_x[0];
    irq_band = 1;
    REG_DISPSTAT = (REG_DISPSTAT & 0x00FF) | (uint16_t)((band_top[1] * 8 - 1) << 8);
}

void background_stream_begin(
    const uint16_t *map,
    uint32_t width,
    uint32_t height
)
{
    stream_map = map;
    stream_width = width;
    stream_height = height;
    stream_active = 1;
    stream_initialized = 0;
    tile_override_count = 0;
    loaded_map = map;
    loaded_width = width;
    loaded_height = height;

    /* Streaming always uses the full 64x64 hardware buffer. */
    REG_BG0CNT = (REG_BG0CNT & 0x3FFF) | (3 << 14);
}

/*
 * Bring the streamed window up to date with the camera's current
 * pixel position. Called from background_set_scroll() every time
 * the camera moves, so this only needs to draw whatever changed
 * since last time - normally nothing, or one column/row when the
 * camera crosses a tile boundary.
 */
static void stream_update(int camera_x_px, int camera_y_px)
{
    int cam_tx = camera_x_px >> 3;
    int cam_ty = camera_y_px >> 3;

    if (!stream_initialized)
    {
        for (int i = -HW_SIZE / 2; i < HW_SIZE / 2; i++)
            stream_write_col(cam_tx + i, cam_ty);

        stream_last_tile_x = cam_tx;
        stream_last_tile_y = cam_ty;
        stream_initialized = 1;
        return;
    }

    while (cam_tx > stream_last_tile_x)
    {
        stream_last_tile_x++;
        stream_write_col(stream_last_tile_x + HW_SIZE / 2 - 1, cam_ty);
    }
    while (cam_tx < stream_last_tile_x)
    {
        stream_last_tile_x--;
        stream_write_col(stream_last_tile_x - HW_SIZE / 2, cam_ty);
    }
    while (cam_ty > stream_last_tile_y)
    {
        stream_last_tile_y++;
        stream_write_row(stream_last_tile_y + HW_SIZE / 2 - 1, cam_tx);
    }
    while (cam_ty < stream_last_tile_y)
    {
        stream_last_tile_y--;
        stream_write_row(stream_last_tile_y - HW_SIZE / 2, cam_tx);
    }
}

void background_set_scroll(
    int x,
    int y
)
{
    layer_cam_x = x;
    layer_cam_y = y;
    if (layer_count > 0)
        layers_apply();

    if (band_count > 0)
    {
        for (int b = 0; b < band_count; b++)
            band_x[b] = band_scroll(b, x);
        if (stream_active)
            stream_update_parallax(y);
        /* Bands below the first are set by parallax_isr() - but if this
         * runs late in the frame, after the last band has started, keep
         * that band's scroll rather than jumping back to the first's. */
        int b = irq_band > 0 ? irq_band - 1 : 0;
        REG_BG0HOFS = (uint16_t)band_x[b];
        REG_BG0VOFS = (uint16_t)y;
        return;
    }

    if (stream_active)
        stream_update(x, y);

    REG_BG0HOFS = (uint16_t)x;
    REG_BG0VOFS = (uint16_t)y;
}

uint16_t background_get_tile(int x, int y)
{
    if (x < 0 || y < 0 || (uint32_t)x >= loaded_width || (uint32_t)y >= loaded_height || !loaded_map)
        return 0;

    int o = find_override(x, y);
    if (o >= 0)
        return tile_overrides[o].entry;

    return loaded_map[(uint32_t)y * loaded_width + (uint32_t)x];
}

void background_set_tile(int x, int y, uint16_t entry)
{
    if (x < 0 || y < 0 || (uint32_t)x >= loaded_width || (uint32_t)y >= loaded_height)
        return;

    int o = find_override(x, y);
    if (o < 0)
    {
        if (tile_override_count >= TILE_OVERRIDE_MAX)
            return;   /* full - ignore, same as GB Studio running out */
        o = tile_override_count++;
        tile_overrides[o].x = (uint16_t)x;
        tile_overrides[o].y = (uint16_t)y;
    }
    tile_overrides[o].entry = entry;

    if (!stream_active)
    {
        uint32_t blocks_across = loaded_width > 32 ? 2 : 1;
        uint32_t block = (uint32_t)(x / 32) + (uint32_t)(y / 32) * blocks_across;
        BG_MAP[block * 1024 + (y % 32) * 32 + (x % 32)] = entry;
        return;
    }

    /* Streaming: only redraw it now if it's inside the 64x64 window
     * currently in VRAM - otherwise stream_tile_at() picks the
     * override up when the camera brings it into view. */
    if (stream_initialized &&
        x >= stream_last_tile_x - HW_SIZE / 2 && x < stream_last_tile_x + HW_SIZE / 2 &&
        y >= stream_last_tile_y - HW_SIZE / 2 && y < stream_last_tile_y + HW_SIZE / 2)
    {
        stream_put(((x % HW_SIZE) + HW_SIZE) % HW_SIZE,
                   ((y % HW_SIZE) + HW_SIZE) % HW_SIZE, entry);
    }
}
