#include <gba.h>

#include "background.h"

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
