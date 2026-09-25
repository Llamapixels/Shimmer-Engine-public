#include <gba.h>
#include <stdint.h>

#include "wav.h"

/*
 * Channel A: DMA 1 -> FIFO A. Channel B: DMA 2 -> FIFO B. Both clocked by
 * timer 0 at WAV_RATE, so each DMA refills its FIFO (16 bytes at a time)
 * straight from ROM with no CPU work. The end of a sound is found by
 * counting frames: WAV_RATE samples per second is exactly 274.3125 per
 * frame (280896 cycles), kept in 1/16ths.
 */
#define SAMPLES_PER_FRAME_16 4389   /* 274.3125 * 16 */

#define DMA_CTRL (0x8000 | (3 << 12) | (1 << 10) | (1 << 9) | (2 << 5))   /* on, FIFO timing, 32-bit, repeat, fixed dest */

#define SND_PSG_FULL  0x0002
#define SND_A_FULL    (1 << 2)
#define SND_B_FULL    (1 << 3)
#define SND_A_ON      ((1 << 8) | (1 << 9))
#define SND_B_ON      ((1 << 12) | (1 << 13))
#define SND_A_RESET   (1 << 11)
#define SND_B_RESET   (1 << 15)

typedef struct
{
    int sound;           /* -1 = idle */
    int flags;
    uint32_t played16;   /* samples played so far, in 1/16ths */
    uint32_t started;    /* frame it started, for WAV_CHANNEL_AUTO */
} Voice;

static Voice voices[2];
static uint32_t frame = 0;

static void apply_mix(void)
{
    uint16_t cnt = SND_PSG_FULL;
    if (voices[0].sound >= 0)
        cnt |= SND_A_ON | ((voices[0].flags & WAV_FLAG_HALF) ? 0 : SND_A_FULL);
    if (voices[1].sound >= 0)
        cnt |= SND_B_ON | ((voices[1].flags & WAV_FLAG_HALF) ? 0 : SND_B_FULL);
    /* Keep the PSG volume bits other code set. */
    REG_SOUNDCNT_H = (REG_SOUNDCNT_H & 0x0003) | (cnt & ~0x0003);
}

static void stop_voice(int v)
{
    if (v == 0)
    {
        REG_DMA1CNT = 0;
        REG_SOUNDCNT_H |= SND_A_RESET;
    }
    else
    {
        REG_DMA2CNT = 0;
        REG_SOUNDCNT_H |= SND_B_RESET;
    }
    voices[v].sound = -1;
    apply_mix();
}

static void start_voice(int v)
{
    const WavSound *s = &wav_sounds[voices[v].sound];
    voices[v].played16 = 0;
    voices[v].started = frame;
    if (v == 0)
    {
        REG_DMA1CNT = 0;
        REG_SOUNDCNT_H |= SND_A_RESET;
        REG_DMA1SAD = (uint32_t)s->data;
        REG_DMA1DAD = (uint32_t)&REG_FIFO_A;
        REG_DMA1CNT = ((uint32_t)DMA_CTRL << 16) | 4;
    }
    else
    {
        REG_DMA2CNT = 0;
        REG_SOUNDCNT_H |= SND_B_RESET;
        REG_DMA2SAD = (uint32_t)s->data;
        REG_DMA2DAD = (uint32_t)&REG_FIFO_B;
        REG_DMA2CNT = ((uint32_t)DMA_CTRL << 16) | 4;
    }
    apply_mix();
}

void wav_init(void)
{
    voices[0].sound = voices[1].sound = -1;
    REG_TM0CNT_H = 0;
    REG_TM0CNT_L = (uint16_t)(65536 - (16777216 / WAV_RATE));
    REG_TM0CNT_H = TIMER_START;
    apply_mix();
}

void wav_play(int sound, int channel, int flags)
{
    if (sound < 0 || sound >= wav_sound_count)
        return;
    int v;
    if (channel == WAV_CHANNEL_A)
        v = 0;
    else if (channel == WAV_CHANNEL_B)
        v = 1;
    else if (voices[0].sound < 0)
        v = 0;
    else if (voices[1].sound < 0)
        v = 1;
    else
        v = voices[0].started <= voices[1].started ? 0 : 1;
    voices[v].sound = sound;
    voices[v].flags = flags;
    start_voice(v);
}

void wav_stop(int channel)
{
    if (channel != WAV_CHANNEL_B && voices[0].sound >= 0)
        stop_voice(0);
    if (channel != WAV_CHANNEL_A && voices[1].sound >= 0)
        stop_voice(1);
}

void wav_vblank(void)
{
    frame++;
    for (int v = 0; v < 2; v++)
    {
        if (voices[v].sound < 0)
            continue;
        voices[v].played16 += SAMPLES_PER_FRAME_16;
        if (voices[v].played16 >= wav_sounds[voices[v].sound].length * 16)
        {
            if (voices[v].flags & WAV_FLAG_LOOP)
                start_voice(v);
            else
                stop_voice(v);
        }
    }
}
