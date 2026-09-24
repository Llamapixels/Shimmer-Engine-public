#ifndef ADVANCE_MUSIC_H
#define ADVANCE_MUSIC_H

/*
 * Music: .uge songs (hUGETracker / GB Studio) from the project's
 * assets/music/ folder, played by huge.c - a port of GB Studio's
 * hUGEDriver - on the GBA's four Game Boy-style PSG channels. Track
 * ids are the UGE_* constants (0..UGE_SONG_COUNT-1) in the generated
 * uge_songs.h (compiler/build_project.py writes it).
 */
#include "uge_songs.h"

/* Call once at startup, after audio_init(). */
void music_init(void);

/* Call once every frame (right after VBlankIntrWait()). */
void music_update(void);

/* Start a track by its UGE_* id. loop = 1 to repeat. */
void music_play(int track_id, int loop);

void music_stop(void);

/* The id last passed to music_play(), or -1 if nothing is
 * currently playing (either music_stop() was called, a play-once
 * track finished, or nothing has played yet). Single source of truth
 * for "is this track already playing" - main.c's scene-switch music
 * logic and script.c's SCRIPT_PLAY_MUSIC both go through
 * music_play()/music_stop(), so whichever one started the current
 * track, this always reflects it. */
int music_current_track(void);

/* Sound effects on PSG channel 1 (audio.c) call this first: while a
 * .uge song is playing it takes channel 1 away from the song for
 * `frames` frames, the same way GB Studio mutes a hUGEDriver channel
 * while a sound effect uses it. */
void music_sfx_claim_channel1(int frames);

/* Same for any PSG channel: 0-1 square, 2 wave, 3 noise. */
void music_sfx_claim_channel(int ch, int frames);

/* "Mute Channel" script event: keep a .uge song off a PSG channel
 * (0-3) until unmuted. Persists across tracks. */
void music_set_channel_muted(int ch, int muted);

/* "Set Music Routine" script event: run `script` (in the background,
 * see script_thread_start()) whenever the playing .uge song hits
 * effect 6xx with x = routine (0-15). 0 clears it. */
struct ScriptEvent;
void music_set_routine(int routine, const struct ScriptEvent *script);

#endif
