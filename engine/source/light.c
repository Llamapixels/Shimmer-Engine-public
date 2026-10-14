#include <gba.h>
#include <stdint.h>

#include "light.h"
#include "actor.h"
#include "camera.h"
#include "entity.h"
#include "raycast.h"
#include "transition.h"
#include "world.h"

#define LINES 160

static int on;
static int radius, target_radius, speed;   /* px; speed px a frame, 0 = at once */
static int darkness;                       /* 0-16 */
static int actors_mode;                    /* LIGHT_ACTORS_* */
static int follow;                         /* actor index, PLAYER_ACTOR_INDEX = the player */
static int flicker;
static int flicker_t;

/* Window 0's edges for each line (x1 << 8 | x2), two buffers: the one
 * shown and the one being worked out. half[] is the circle's half-width
 * per line from its centre, for `half_r`. */
static uint16_t edges[2][LINES + 1];
static int shown_buf;
static uint8_t half[LINES + 1];
static int half_r = -1;

#define WIN0_ON (1 << 13)

static int isqrt(int v)
{
    int r = 0;
    while ((r + 1) * (r + 1) <= v)
        r++;
    return r;
}

static void stop_dma(void)
{
    REG_DMA0CNT = 0;
}

void light_reset(void)
{
    if (on)
    {
        stop_dma();
        REG_DISPCNT &= ~WIN0_ON;
        REG_BLDCNT = 0;
        REG_BLDY = 0;
    }
    on = 0;
}

int light_on(void)
{
    return on;
}

void light_set(const int16_t *p)
{
    if (!p[0])
    {
        light_reset();
        return;
    }
    int was_on = on;
    on = 1;
    target_radius = p[1] < 0 ? 0 : p[1] > 255 ? 255 : p[1];
    darkness = p[2] < 0 ? 0 : p[2] > 16 ? 16 : p[2];
    actors_mode = p[3];
    follow = p[4];
    flicker = p[5];
    speed = p[6];
    if (!was_on || speed <= 0)
        radius = was_on ? target_radius : (speed > 0 ? 0 : target_radius);
    light_update();
}

void light_update(void)
{
    if (!on)
        return;
    if (radius != target_radius)
    {
        int step = speed > 0 ? speed : 255;
        radius += radius < target_radius ? (target_radius - radius < step ? target_radius - radius : step)
                                         : -(radius - target_radius < step ? radius - target_radius : step);
    }
    /* The circle's centre: the actor's middle, on screen. */
    Entity *e = follow == PLAYER_ACTOR_INDEX ? world_player() : world_npc(follow);
    int cx = 120, cy = 80;
    if (e)
    {
        cx = e->x + e->width / 2 - camera_get_display_x();
        cy = e->y + e->height / 2 - camera_get_display_y();
    }
    int r = radius;
    if (flicker && r > 4)
    {
        /* A torch: the edge wavers a pixel or two. */
        flicker_t++;
        static const int8_t WOBBLE[16] = { 0, 1, 1, 2, 1, 0, -1, 0, 1, 2, 2, 1, 0, -1, -1, 0 };
        r += WOBBLE[(flicker_t >> 2) & 15];
    }
    if (r != half_r)
    {
        for (int dy = 0; dy <= LINES; dy++)
            half[dy] = (uint8_t)(dy < r ? isqrt(r * r - dy * dy) : 0);
        half_r = r;
    }
    uint16_t *out = edges[shown_buf ^ 1];
    for (int y = 0; y <= LINES; y++)
    {
        int dy = y - cy;
        if (dy < 0)
            dy = -dy;
        int x1 = 0, x2 = 0;
        if (dy < r && dy <= LINES)
        {
            int h = half[dy];
            x1 = cx - h;
            x2 = cx + h;
            if (x1 < 0) x1 = 0;
            if (x2 > 240) x2 = 240;
            if (x2 <= x1) x1 = x2 = 0;
        }
        out[y] = (uint16_t)((x1 << 8) | x2);
    }
}

void light_vblank(void)
{
    if (!on)
        return;
    stop_dma();
    /* Scene fades and First Person 3D use these registers themselves. */
    if (transition_active() || raycast_active())
        return;
    shown_buf ^= 1;
    const uint16_t *t = edges[shown_buf];

    /* Inside the circle: everything, no darkening. Outside: darkened, and
     * actors shown, darkened or hidden. BG1 (dialogue, screen text) is
     * never darkened. */
    int outside = 0x1F | (1 << 5);
    if (actors_mode == LIGHT_ACTORS_HIDDEN)
        outside &= ~(1 << 4);
    int targets = (1 << 0) | (1 << 2) | (1 << 3) | (1 << 5);   /* BG0, BG2, BG3, backdrop */
    if (actors_mode == LIGHT_ACTORS_DARK)
        targets |= 1 << 4;
    REG_WIN0V = LINES;   /* lines 0-159 */
    REG_WININ = (uint16_t)((REG_WININ & 0xFF00) | 0x1F);
    REG_WINOUT = (uint16_t)((REG_WINOUT & 0xFF00) | outside);
    REG_BLDCNT = (uint16_t)(targets | (3 << 6));   /* darken */
    REG_BLDY = (uint16_t)darkness;
    REG_DISPCNT |= WIN0_ON;

    /* Line 0 now; lines 1-159 at each H-Blank. */
    REG_WIN0H = t[0];
    REG_DMA0SAD = (uint32_t)&t[1];
    REG_DMA0DAD = (uint32_t)&REG_WIN0H;
    REG_DMA0CNT = 1 | DMA_DST_RELOAD | DMA_SRC_INC | DMA_REPEAT | DMA16 | DMA_HBLANK | DMA_ENABLE;
}
