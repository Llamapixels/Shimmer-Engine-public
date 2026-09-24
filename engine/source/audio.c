#include <stdint.h>

#include "audio.h"
#include "music.h"

/*
 * Raw GBA sound registers (same style as sprite.c's OAM/VRAM
 * pointers - avoids depending on exact libgba macro names).
 * Addresses and bit layout from GBATEK's PSG channel 1 (square
 * wave with envelope + optional sweep).
 */
#define REG_SOUND1CNT_L  (*(volatile uint16_t *)0x04000060)
#define REG_SOUND1CNT_H  (*(volatile uint16_t *)0x04000062)
#define REG_SOUND1CNT_X  (*(volatile uint16_t *)0x04000064)
#define REG_SOUND4CNT_L  (*(volatile uint16_t *)0x04000078)
#define REG_SOUND4CNT_H  (*(volatile uint16_t *)0x0400007C)
#define REG_SOUNDCNT_L   (*(volatile uint16_t *)0x04000080)
#define REG_SOUNDCNT_H   (*(volatile uint16_t *)0x04000082)
#define REG_SOUNDCNT_X   (*(volatile uint16_t *)0x04000084)

#define SOUND_MASTER_ENABLE 0x0080
#define SOUND1_RESTART      (1 << 15)

void audio_init(void)
{
    /* Turn on the sound chip. Must happen before touching any other
     * sound register. */
    REG_SOUNDCNT_X = SOUND_MASTER_ENABLE;

    /* Master volume (max both sides), route channels 1 (tones/blips)
     * and 4 (noise - beep/crash effects) to both. */
    REG_SOUNDCNT_L =
        0x07 |          /* right volume: 0-7 */
        (0x07 << 4) |   /* left volume: 0-7 */
        (0x09 << 8) |   /* channels 1 + 4 -> right speaker */
        (0x09 << 12);   /* channels 1 + 4 -> left speaker */

    /* DMG (PSG) channels at full volume, no DMA sample channels. */
    REG_SOUNDCNT_H = 0x0002;

    /* No frequency sweep on channel 1. */
    REG_SOUND1CNT_L = 0;
}

/*
 * Play a short square-wave tone on channel 1. volume is 0-15; the
 * envelope decreases it to 0 over a few frames, giving a natural
 * "blip" decay instead of an abrupt cutoff.
 */
static void play_tone(uint16_t gba_freq, uint16_t volume)
{
    /* The envelope drops one volume step every 3/64 s, so the tone
     * lasts volume * 3/64 s. Keep a .uge song off channel 1 until
     * then (see music_sfx_claim_channel1). */
    music_sfx_claim_channel1((volume * 3 * 60 + 63) / 64);

    REG_SOUND1CNT_H =
        (8 << 0)  |            /* length (ignored - see bit 14 below) */
        (2 << 6)  |            /* 50% duty cycle */
        (3 << 8)  |            /* envelope step time */
        (0 << 11) |            /* envelope direction: decrease */
        (volume << 12);        /* initial volume */

    REG_SOUND1CNT_X =
        (gba_freq & 0x7FF) |   /* 11-bit frequency value */
        SOUND1_RESTART;        /* bit 14 = 0: play regardless of length */
}

/* GBA tone register value for a frequency in Hz. */
#define GBA_FREQ(hz) (2048 - (131072 / (hz)))

void audio_play_blip(void)
{
    play_tone(GBA_FREQ(880), 12);
}

void audio_play_door(void)
{
    play_tone(GBA_FREQ(440), 10);
}

void audio_play_save(void)
{
    /* Bright and a bit longer than the interact blip, so a save
     * reads as distinct from talking to an NPC. */
    play_tone(GBA_FREQ(660), 14);
}

void audio_play_item(void)
{
    /* Higher and brighter than any of the above, so getting an item
     * reads as a little reward rather than another UI click. */
    play_tone(GBA_FREQ(1319), 15);
}

/*
 * GB Studio's "Play Sound Effect" presets (tone / beep / crash), with a
 * duration in frames. Each stops itself after `frames` via
 * audio_update(), and claims its PSG channel from a playing .uge song
 * for that long.
 */
static int tone_frames_left;
static int noise_frames_left;

void audio_play_tone(int hz, int frames)
{
    if (hz < 64)
        hz = 64;
    if (hz > 131071)
        hz = 131071;
    if (frames < 1)
        frames = 1;

    music_sfx_claim_channel(0, frames + 1);
    tone_frames_left = frames;

    REG_SOUND1CNT_L = 0;                   /* no sweep */
    REG_SOUND1CNT_H =
        (2 << 6) |                         /* 50% duty */
        (0 << 8) |                         /* envelope off: hold volume */
        (15 << 12);                        /* full volume */
    REG_SOUND1CNT_X = (GBA_FREQ(hz) & 0x7FF) | SOUND1_RESTART;
}

static void play_noise(uint16_t poly, int volume, int step, int frames)
{
    if (frames < 1)
        frames = 1;

    music_sfx_claim_channel(3, frames + 1);
    noise_frames_left = frames;

    REG_SOUND4CNT_L =
        (0 << 11) |                        /* envelope: decrease */
        ((step & 7) << 8) |
        ((volume & 15) << 12);
    REG_SOUND4CNT_H = poly | (1 << 15);    /* restart */
}

void audio_play_beep(int pitch, int frames)
{
    /* pitch 1 (low) .. 8 (high), like GB Studio: a short, bright
     * 7-bit noise "beep" whose shift clock drops as pitch rises. */
    if (pitch < 1) pitch = 1;
    if (pitch > 8) pitch = 8;
    play_noise((uint16_t)(((8 - pitch) << 4) | 0x08), 15, 0, frames);
}

void audio_play_crash(int frames)
{
    /* Full 15-bit noise, fading out over the effect's length. */
    int step = frames / 15;
    if (step < 1) step = 1;
    if (step > 7) step = 7;
    play_noise((uint16_t)((3 << 4) | 0x01), 15, step, frames);
}

void audio_update(void)
{
    if (tone_frames_left > 0 && --tone_frames_left == 0)
    {
        REG_SOUND1CNT_H = 0;               /* volume 0 */
        REG_SOUND1CNT_X = SOUND1_RESTART;
    }
    if (noise_frames_left > 0 && --noise_frames_left == 0)
    {
        REG_SOUND4CNT_L = 0;
        REG_SOUND4CNT_H = (1 << 15);
    }
}
