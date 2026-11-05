#ifndef ADVANCE_TINT_H
#define ADVANCE_TINT_H

#include <stdint.h>

/*
 * Screen tint (day / night): every BG and OBJ palette color is kept as
 * written (its "base") and shown multiplied toward a tint color, so
 * night darkens and blues the scene while keeping its contrast. The
 * dialogue box's palette bank is never tinted.
 *
 * All palette writes that should follow the tint go through
 * tint_write_color(); reading a color back (to restore it later) uses
 * tint_base_color().
 */

/* Palette index 0-255 = BG, 256-511 = OBJ. */
void tint_write_color(int index, uint16_t color);
uint16_t tint_base_color(int index);

/* Tint toward `color` (BGR555) at `strength` 0-16 (0 = none), fading
 * there over `frames` (0 = at once). Stops a day / night cycle. */
void tint_set(uint16_t color, int strength, int frames);

/* Day / night following the playtime clock: a whole day lasts
 * `day_frames` (0 = stop the cycle and clear the tint). */
void tint_cycle(uint32_t day_frames);

/* The cycle's hour, 0-23 (12 = noon), or 12 with no cycle running. */
int tint_hour(void);

/* Once a frame: fades and the cycle; rewrites the palettes on a change. */
void tint_update(void);

#endif
