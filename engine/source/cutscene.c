#include <gba.h>
#include <stdint.h>

#include "cutscene.h"
#include "input.h"
#include "music.h"
#include "scene.h"
#include "ui.h"
#include "wav.h"
#include "audio.h"

/* See cutscene.h for the file format. */

#define CUT_MODE_FULL 0
#define CUT_MODE_HALF 1
#define MAX_TILES     600            /* 30 x 20 */
#define MAP_BLOCK     31
#define BG_PAL_MEM    ((volatile uint16_t *)0x05000000)
#define VRAM_TILES    ((volatile uint32_t *)0x06000000)
#define VRAM_MAP16    ((volatile uint16_t *)(0x06000000 + MAP_BLOCK * 0x800))

/* One unpacked frame: bitmap (76 bytes for 600 tiles, rounded to 4) plus
 * every tile. Word-aligned for the BIOS and fast copies. */
static uint32_t frame_buf[(80 + MAX_TILES * 64) / 4] EWRAM_BSS;

static uint16_t rd16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static uint32_t rd32(const uint8_t *p) { return (uint32_t)(p[0] | (p[1] << 8) | (p[2] << 16) | ((uint32_t)p[3] << 24)); }

/* Unpack frame `n` and copy the tiles it changed into VRAM. */
static void show_frame(const uint8_t *file, int n, int tiles)
{
    const uint8_t *offsets = file + 524;
    const uint8_t *src = file + rd32(offsets + n * 4);
    LZ77UnCompWram(src, frame_buf);

    const uint8_t *bits = (const uint8_t *)frame_buf;
    int bitmap_bytes = (((tiles + 7) / 8) + 3) & ~3;
    const uint32_t *data = frame_buf + bitmap_bytes / 4;
    for (int t = 0; t < tiles; t++)
    {
        if (!(bits[t >> 3] & (1 << (t & 7))))
            continue;
        volatile uint32_t *dst = VRAM_TILES + t * 16;
        for (int i = 0; i < 16; i++)
            dst[i] = data[i];
        data += 16;
    }
}

void cutscene_play(int index, int flags)
{
    if (index < 0 || index >= cutscene_count)
        return;
    const CutsceneDef *c = &cutscenes[index];
    const uint8_t *file = c->video;
    if (!file || file[0] != 'S' || file[1] != 'H' || file[2] != 'C' || file[3] != 'V')
        return;

    int mode = file[6];
    int fps = file[7] ? file[7] : 1;
    int frames = rd16(file + 8);
    int tw = file[10];
    int th = file[11];
    int tiles = tw * th;
    if (tiles > MAX_TILES || frames == 0)
        return;

    /* Remember the display set-up to put back afterwards. */
    uint16_t dispcnt = REG_DISPCNT;
    uint16_t bgcnt[4] = { REG_BG0CNT, REG_BG1CNT, REG_BG2CNT, REG_BG3CNT };

    if (flags & CUTSCENE_STOP_MUSIC)
        music_stop();
    wav_stop(WAV_CHANNEL_AUTO);

    REG_DISPCNT = 0x0080;   /* forced blank while setting up */

    for (int i = 0; i < 256; i++)
        BG_PAL_MEM[i] = rd16(file + 12 + i * 2);

    if (mode == CUT_MODE_HALF)
    {
        /* Affine BG2, 16x16-tile (128x128) map of bytes, shown at 2x. */
        for (int i = 0; i < 128; i++)
        {
            int a = i * 2, b = i * 2 + 1;
            int ta = (a / 16 < th && a % 16 < tw) ? (a / 16) * tw + a % 16 : 0;
            int tb = (b / 16 < th && b % 16 < tw) ? (b / 16) * tw + b % 16 : 0;
            VRAM_MAP16[i] = (uint16_t)(ta | (tb << 8));
        }
        REG_BG2CNT = (0 << 0) | (0 << 2) | (1 << 7) | (MAP_BLOCK << 8) | (0 << 14);
        REG_BG2PA = 0x80;
        REG_BG2PB = 0;
        REG_BG2PC = 0;
        REG_BG2PD = 0x80;
        REG_BG2X = 0;
        REG_BG2Y = 0;
    }
    else
    {
        /* Text BG0, 8bpp: map cell (x, y) shows tile y * 30 + x. */
        for (int y = 0; y < 32; y++)
            for (int x = 0; x < 32; x++)
                VRAM_MAP16[y * 32 + x] = (uint16_t)((y < th && x < tw) ? y * tw + x : 0);
        REG_BG0CNT = (0 << 0) | (0 << 2) | (1 << 7) | (MAP_BLOCK << 8);
        REG_BG0HOFS = 0;
        REG_BG0VOFS = 0;
    }

    show_frame(file, 0, tiles);
    REG_DISPCNT = mode == CUT_MODE_HALF ? (MODE_1 | BG2_ENABLE) : (MODE_0 | BG0_ENABLE);
    if (c->sound >= 0)
        wav_play(c->sound, WAV_CHANNEL_A, 0);

    /* Frame k is due at k / fps seconds; the GBA refreshes at exactly
     * 16777216 / 280896 Hz, the same clock the audio runs from. */
    uint32_t vblanks = 0;
    int shown = 0;
    input_block_presses(10);
    while (shown < frames - 1)
    {
        VBlankIntrWait();
        wav_vblank();
        if (!(flags & CUTSCENE_STOP_MUSIC))
            music_update();
        audio_update();
        input_update();
        vblanks++;
        if ((flags & CUTSCENE_SKIPPABLE) && input_pressed(INPUT_A | INPUT_START))
            break;
        int due = (int)(((uint64_t)vblanks * (uint64_t)fps * 4389u) >> 18);
        /* Every frame builds on the last, so none can be skipped; if
         * decoding falls behind it just catches up. */
        while (shown < due && shown < frames - 1)
            show_frame(file, ++shown, tiles);
    }

    /* Let the last frame stay up for its own duration. */
    if (shown == frames - 1)
    {
        int end = (int)(((uint64_t)frames * 262144u) / ((uint64_t)fps * 4389u));
        while ((int)vblanks < end)
        {
            VBlankIntrWait();
            wav_vblank();
            if (!(flags & CUTSCENE_STOP_MUSIC))
                music_update();
            audio_update();
            input_update();
            vblanks++;
            if ((flags & CUTSCENE_SKIPPABLE) && input_pressed(INPUT_A | INPUT_START))
                break;
        }
    }

    if (c->sound >= 0)
        wav_stop(WAV_CHANNEL_A);

    /* Put the scene back: its tiles, map and palettes, the dialogue
     * layer, then the original display set-up. */
    REG_DISPCNT = 0x0080;
    REG_BG0CNT = bgcnt[0];
    REG_BG1CNT = bgcnt[1];
    REG_BG2CNT = bgcnt[2];
    REG_BG3CNT = bgcnt[3];
    if (scene_current())
        scene_load(scene_current());
    ui_restore_vram();
    REG_DISPCNT = dispcnt;
    input_block_presses(10);
}
