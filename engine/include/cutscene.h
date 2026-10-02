#ifndef ADVANCE_CUTSCENE_H
#define ADVANCE_CUTSCENE_H

#include <stdint.h>

/*
 * Full-screen video cutscenes ("Play Cutscene"). The editor's Cutscenes
 * tab converts a video into a .cut file (assets/cutscenes): one 256-colour
 * palette, then every frame as the 8x8 tiles that changed since the frame
 * before, LZ77-compressed (the BIOS decompresses them). Audio is a WAV
 * sound (wav.h) played alongside, both timed from the GBA's own clock so
 * they stay in sync.
 *
 * File layout (little endian):
 *   0   "SHCV"
 *   4   u16 version (1)
 *   6   u8  mode: 0 = full screen 240x160 (BG0, 8bpp tiles),
 *               1 = half size 120x80 shown 2x (affine BG2)
 *   7   u8  frames per second
 *   8   u16 frame count
 *   10  u8  tiles across, u8 tiles down
 *   12  u16 palette[256] (GBA BGR555)
 *   524 u32 frame offsets[frame count + 1] from the file start
 *   ... frames: GBA LZ77 streams, each 4-byte aligned. Unpacked, a frame
 *       is a bitmap of changed tiles (one bit per tile, rounded up to 4
 *       bytes) then 64 bytes of 8bpp pixels per changed tile, in order.
 */

typedef struct
{
    const uint8_t *video;
    int16_t sound;     /* wav_sounds[] index, -1 = silent */
} CutsceneDef;

extern const CutsceneDef cutscenes[];
extern const uint16_t cutscene_count;

#define CUTSCENE_SKIPPABLE  1   /* A or START ends it early */
#define CUTSCENE_STOP_MUSIC 2   /* stop the .uge music first */

/* Plays a cutscene to the end (or until skipped), then restores the
 * current scene's graphics. Blocks: nothing else runs meanwhile. */
void cutscene_play(int index, int flags);

#endif
