#ifndef ADVANCE_EMOTE_H
#define ADVANCE_EMOTE_H

#include <stdint.h>

/* Emote bubbles over actors (Show Emote): exclaim, question, heart, dots,
 * music, anger, sweat, sleep - 16x16 each (emote_gfx.c). */
#define EMOTE_COUNT 8
#define EMOTE_BANK  14   /* the OBJ palette bank an emote borrows while shown */

extern const uint16_t emote_palette[16];
extern const uint32_t emote_tiles[EMOTE_COUNT][32];

#endif
