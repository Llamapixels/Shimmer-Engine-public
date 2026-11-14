#include <stdint.h>

#include "tint.h"
#include "game.h"   /* game_playtime_frames() - the day / night cycle */

#define PAL_RAM   ((volatile uint16_t *)0x05000000)
#define UI_BANK   15   /* ui.c's PALETTE_BANK: the dialogue box, never tinted */

static uint16_t base[512];
static uint16_t tint_color = 0x7FFF;     /* white = no change */
static int strength_q8;                  /* 0-16 in 1/256 */
static int target_q8, step_q8;
static uint16_t target_color = 0x7FFF;
static uint32_t cycle_frames;            /* 0 = no day / night cycle */
static int shown_strength = -1;
static uint16_t shown_color;

static uint16_t tinted(uint16_t c)
{
    int s = strength_q8 >> 8;
    if (s <= 0)
        return c;
    int r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
    int tr = tint_color & 31, tg = (tint_color >> 5) & 31, tb = (tint_color >> 10) & 31;
    /* Multiply toward the tint: 16 = fully multiplied by it. */
    r = r * (31 * (16 - s) + tr * s) / (31 * 16);
    g = g * (31 * (16 - s) + tg * s) / (31 * 16);
    b = b * (31 * (16 - s) + tb * s) / (31 * 16);
    return (uint16_t)(r | (g << 5) | (b << 10));
}

static int keep_portrait;   /* OBJ bank 15 while a portrait shows */

static int untinted(int index)
{
    return index >> 4 == UI_BANK || (keep_portrait && index >> 4 == 16 + 15);   /* BG bank 15, OBJ bank 15 */
}

void tint_keep_portrait_bank(int on)
{
    keep_portrait = on;
    for (int i = 256 + 15 * 16; i < 512; i++)
        PAL_RAM[i] = untinted(i) ? base[i] : tinted(base[i]);
}

void tint_write_color(int index, uint16_t color)
{
    if (index < 0 || index >= 512)
        return;
    base[index] = color;
    PAL_RAM[index] = untinted(index) ? color : tinted(color);
}

uint16_t tint_base_color(int index)
{
    return index >= 0 && index < 512 ? base[index] : 0;
}

static void apply_all(void)
{
    for (int i = 0; i < 512; i++)
        if (!untinted(i))
            PAL_RAM[i] = tinted(base[i]);
    shown_strength = strength_q8 >> 8;
    shown_color = tint_color;
}

void tint_set(uint16_t color, int strength, int frames)
{
    cycle_frames = 0;
    if (strength < 0) strength = 0;
    if (strength > 16) strength = 16;
    target_q8 = strength << 8;
    target_color = color;
    /* The new color takes over at once; its strength fades. */
    if (frames <= 0)
    {
        strength_q8 = target_q8;
        tint_color = color;
        step_q8 = 0;
    }
    else
    {
        step_q8 = (target_q8 - strength_q8) / frames;
        if (step_q8 == 0 && target_q8 != strength_q8)
            step_q8 = target_q8 > strength_q8 ? 1 : -1;
        tint_color = color;
    }
}

void tint_cycle(uint32_t day_frames)
{
    cycle_frames = day_frames;
    if (!day_frames)
        tint_set(0x7FFF, 0, 0);
}

int tint_hour(void)
{
    if (!cycle_frames)
        return 12;
    return (int)((game_playtime_frames() % cycle_frames) * 24 / cycle_frames);
}

#define BGR(r, g, b) ((uint16_t)((r) | ((g) << 5) | ((b) << 10)))

/* The cycle's tint for a moment of the day (0-1023 = midnight to midnight). */
static void cycle_tint(int t, uint16_t *color, int *strength_q8_out)
{
    /* Key moments: night until 5am, dawn 6am, day 8am-5pm, sunset 6-7pm,
     * night from 8pm. Strength in 1/256 of 16. */
    static const struct { int at; uint16_t color; int s; } keys[] = {
        {   0, BGR(10, 12, 24), 11 << 8 },   /* midnight: dark blue */
        { 213, BGR(10, 12, 24), 11 << 8 },   /* 5am */
        { 256, BGR(31, 22, 24),  5 << 8 },   /* 6am dawn: pink */
        { 341, BGR(31, 31, 31),  0 },        /* 8am day */
        { 725, BGR(31, 31, 31),  0 },        /* 5pm */
        { 768, BGR(31, 20, 12),  6 << 8 },   /* 6pm sunset: orange */
        { 811, BGR(20, 14, 24),  8 << 8 },   /* 7pm dusk: purple */
        { 853, BGR(10, 12, 24), 11 << 8 },   /* 8pm night */
        {1024, BGR(10, 12, 24), 11 << 8 },
    };
    int k = 0;
    while (k < 7 && t >= keys[k + 1].at)
        k++;
    int span = keys[k + 1].at - keys[k].at;
    int f = span ? (t - keys[k].at) * 256 / span : 0;
    *strength_q8_out = keys[k].s + (keys[k + 1].s - keys[k].s) * f / 256;
    /* Color: blend each channel. */
    uint16_t a = keys[k].color, b = keys[k + 1].color;
    int r = (a & 31) + (((b & 31) - (a & 31)) * f >> 8);
    int g = ((a >> 5) & 31) + ((((b >> 5) & 31) - ((a >> 5) & 31)) * f >> 8);
    int bl = ((a >> 10) & 31) + ((((b >> 10) & 31) - ((a >> 10) & 31)) * f >> 8);
    *color = BGR(r, g, bl);
}

void tint_update(void)
{
    if (cycle_frames)
    {
        int t = (int)((game_playtime_frames() % cycle_frames) * 1024 / cycle_frames);
        cycle_tint(t, &tint_color, &strength_q8);
    }
    else if (strength_q8 != target_q8)
    {
        strength_q8 += step_q8;
        if ((step_q8 > 0 && strength_q8 > target_q8) || (step_q8 < 0 && strength_q8 < target_q8))
            strength_q8 = target_q8;
    }
    if ((strength_q8 >> 8) != shown_strength || (strength_q8 >> 8 && tint_color != shown_color))
        apply_all();
}
