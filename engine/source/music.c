#include <stdint.h>

#include "music.h"          /* also pulls in uge_songs.h (UGE_* ids) */
#include "huge.h"
#include "script.h"

/* GB NR50/NR51 (master volume / channel panning), which .uge songs
 * drive directly - see huge.c. */
#define REG_NR50 (*(volatile uint8_t *)0x04000080)
#define REG_NR51 (*(volatile uint8_t *)0x04000081)

void music_init(void)
{
    /* Nothing to set up: audio_init() already turned the PSG on, and
     * huge_init() sets up the channels when a song starts. */
}

/* See music_current_track()'s doc comment in music.h. */
static int current_track = -1;

/* Whether a song is playing, and whether it loops. */
static int uge_playing;
static int uge_loop;

/* Per PSG channel: frames left before a sound effect gives the channel
 * back to the song (see music_sfx_claim_channel), and channels muted by
 * the "Mute Channel" script event. A channel is muted in the driver
 * while either applies. */
static int sfx_frames[4];
static uint8_t user_mute_mask;

/* Fades: volume 0-7 in 1/256 steps, its target, the step per frame, and
 * whether to stop once silent; fade_next = "fade in" for the next play. */
static int vol_q8 = 7 << 8, vol_to = 7 << 8, vol_step, stop_when_silent, fade_next;

/* "Set Music Routine" scripts, run when a song plays effect 6xx. */
static const ScriptEvent *routine_scripts[16];

static int is_uge_track(int track_id)
{
    return track_id >= 0 && track_id < UGE_SONG_COUNT;
}

static int channel_muted(int ch)
{
    return sfx_frames[ch] > 0 || ((user_mute_mask >> ch) & 1);
}

static void apply_mutes(void)
{
    for (int ch = 0; ch < 4; ch++)
        huge_mute_channel((uint8_t)ch, (uint8_t)channel_muted(ch));
}

static void stop_uge(void)
{
    if (!uge_playing)
        return;
    uge_playing = 0;
    huge_silence();
}

static void on_routine(uint8_t routine)
{
    if (routine_scripts[routine])
        script_thread_start(routine_scripts[routine]);
}

void music_update(void)
{
    for (int ch = 0; ch < 4; ch++)
    {
        if (sfx_frames[ch] > 0 && --sfx_frames[ch] == 0 && uge_playing && !channel_muted(ch))
            huge_mute_channel((uint8_t)ch, 0);
    }

    if (uge_playing) {
        /* GB Studio ticks hUGEDriver once per Game Boy vblank; the
         * GBA's vblank runs at the same ~59.7 Hz, so tempo matches. */
        huge_dosound();
        if (!uge_loop && huge_song_wrapped())
            music_stop();
    }

    /* A fade: the master volume (NR50) moves toward its target. */
    int fading = vol_q8 != vol_to;
    if (fading)
    {
        vol_q8 += vol_step;
        if ((vol_step > 0 && vol_q8 > vol_to) || (vol_step < 0 && vol_q8 < vol_to))
            vol_q8 = vol_to;
        if (vol_q8 == 0 && stop_when_silent)
        {
            stop_when_silent = 0;
            music_stop();
            vol_q8 = vol_to = 7 << 8;
            return;
        }
    }
    if (uge_playing && (fading || vol_q8 != 7 << 8))
    {
        int v = vol_q8 >> 8;
        REG_NR50 = (uint8_t)((v << 4) | v);
    }
}

void music_fade(int to, int frames, int stop_after)
{
    if (to < 0) to = 0;
    if (to > 7) to = 7;
    vol_to = to << 8;
    stop_when_silent = stop_after && to == 0;
    if (frames < 1)
        frames = 1;
    vol_step = (vol_to - vol_q8) / frames;
    if (vol_step == 0)
        vol_step = vol_to > vol_q8 ? 1 : -1;
}

void music_fade_in_next(int frames)
{
    fade_next = frames;
}

int music_fading_out(void)
{
    return stop_when_silent;
}

void music_play(int track_id, int loop)
{
    stop_uge();
    current_track = -1;
    if (!is_uge_track(track_id))
        return;

    /* Everything on, all four channels to both speakers - the song's
     * own 5xx/8xx effects can change these as it plays. */
    REG_NR50 = 0x77;
    REG_NR51 = 0xFF;
    stop_when_silent = 0;
    if (fade_next > 0)
    {
        vol_q8 = 0;
        REG_NR50 = 0;
        music_fade(7, fade_next, 0);
        fade_next = 0;
    }
    else
        vol_q8 = vol_to = 7 << 8;

    huge_set_routine_callback(on_routine);
    huge_init(uge_songs[track_id]);
    apply_mutes();      /* huge_init() clears the driver's mutes */
    uge_playing = 1;
    uge_loop = loop;
    current_track = track_id;
}

void music_stop(void)
{
    stop_uge();
    current_track = -1;
}

int music_current_track(void)
{
    return current_track;
}

void music_sfx_claim_channel(int ch, int frames)
{
    if (ch < 0 || ch > 3)
        return;
    if (uge_playing && !channel_muted(ch))
        huge_mute_channel((uint8_t)ch, 1);
    if (frames > sfx_frames[ch])
        sfx_frames[ch] = frames;
}

void music_sfx_claim_channel1(int frames)
{
    music_sfx_claim_channel(0, frames);
}

void music_set_channel_muted(int ch, int muted)
{
    if (ch < 0 || ch > 3)
        return;
    if (muted)
        user_mute_mask |= (uint8_t)(1 << ch);
    else
        user_mute_mask &= (uint8_t)~(1 << ch);
    if (uge_playing)
        huge_mute_channel((uint8_t)ch, (uint8_t)channel_muted(ch));
}

void music_set_routine(int routine, const ScriptEvent *script)
{
    if (routine >= 0 && routine < 16)
        routine_scripts[routine] = script;
}
