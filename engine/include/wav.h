#ifndef ADVANCE_WAV_H
#define ADVANCE_WAV_H

#include <stdint.h>

/*
 * WAV sound effects on the GBA's two Direct Sound channels (A and B):
 * signed 8-bit samples at WAV_RATE, fed from ROM to the sound FIFOs by
 * DMA 1 and 2, timed by timer 0. They mix with the Game Boy channels the
 * .uge music uses. compiler/wav.py converts the project's assets/sounds WAV files into
 * wav_sounds[] (sounds_data.c).
 */
#define WAV_RATE 16384

typedef struct
{
    const int8_t *data;    /* followed by a little silence */
    uint32_t length;       /* samples */
} WavSound;

extern const WavSound wav_sounds[];
extern const uint16_t wav_sound_count;

#define WAV_CHANNEL_AUTO 0  /* a free channel, else the older of the two */
#define WAV_CHANNEL_A    1
#define WAV_CHANNEL_B    2

#define WAV_FLAG_LOOP    1
#define WAV_FLAG_HALF    2  /* half volume */

void wav_init(void);
void wav_play(int sound, int channel, int flags);
void wav_stop(int channel);   /* WAV_CHANNEL_AUTO = both */
void wav_vblank(void);        /* every frame, right after VBlankIntrWait() */

#endif
