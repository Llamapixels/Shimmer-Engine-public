#ifndef ADVANCE_AUDIO_H
#define ADVANCE_AUDIO_H

/*
 * Minimal sound: the GBA's built-in square-wave channel (PSG
 * channel 1), for short UI blips. No music/sample playback yet -
 * that needs a bigger system (Maxmod + tracker files), left for
 * later.
 */

/* Turns on the sound hardware. Call once at startup. */
void audio_init(void);

/* A short blip, used for opening/advancing dialogue. */
void audio_play_blip(void);

/* A slightly lower blip, used for door transitions. */
void audio_play_door(void);

/* A two-note chime, used when a save completes. */
void audio_play_save(void);

/* A bright, ringing tone - distinct from the blips above - used
 * when an NPC hands you an item. */
void audio_play_item(void);

/* GB Studio "Play Sound Effect" presets - see audio.c. */
void audio_play_tone(int hz, int frames);     /* square wave, channel 1 */
void audio_play_beep(int pitch, int frames);  /* pitch 1-8, channel 4 */
void audio_play_crash(int frames);            /* noise burst, channel 4 */

/* Call once per frame - ends timed tone/beep/crash effects. */
void audio_update(void);

#endif
