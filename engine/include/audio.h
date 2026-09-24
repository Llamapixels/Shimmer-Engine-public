#ifndef ADVANCE_AUDIO_H
#define ADVANCE_AUDIO_H

/*
 * Sound effects on the GBA's Game Boy-style PSG channels (UI blips,
 * tones, beeps and noise). Music is music.h's job.
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
