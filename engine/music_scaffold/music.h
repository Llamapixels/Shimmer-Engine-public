#ifndef ADVANCE_MUSIC_H
#define ADVANCE_MUSIC_H

/*
 * Module/sample music via Maxmod. Not wired into the build yet -
 * see engine/music/README.md for how to turn this on once you have
 * actual tracker files. Until then, engine/source/audio.c's square-
 * wave blips are all the game has, and that's fine.
 */

/* Call once at startup, after audio_init(). */
void music_init(void);

/* Call once every frame (right after VBlankIntrWait()). */
void music_update(void);

/* Start a track by its soundbank.h MOD_* id. loop = 1 to repeat. */
void music_play(int track_id, int loop);

void music_stop(void);

#endif
