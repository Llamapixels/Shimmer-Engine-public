# Adding music

The engine links Maxmod already (`-lmm` in `engine/Makefile`), but
music is off by default so it can't break a build that has no music
files yet. To turn it on:

1. **Get some tracker files.** Maxmod plays `.mod`, `.xm`, `.s3m` and
   `.it` module files (not `.mp3`/`.ogg`/`.wav`) - the same format
   old trackers like OpenMPT or MilkyTracker save. Put them in this
   folder (`engine/music/`).

2. **Turn on the music build.** In `engine/Makefile`, change:

       MUSIC		:=

   to:

       MUSIC		:= music

   This makes `make` run `mmutil` over every file in this folder and
   generate `soundbank.bin` + `soundbank.h` (a `MOD_<FILENAME>`
   constant per track) during the build.

3. **Move the scaffold into the build.** Copy the two files from
   `engine/music_scaffold/` into the real source tree so the
   Makefile picks them up:

       cp engine/music_scaffold/music.h engine/include/
       cp engine/music_scaffold/music.c engine/source/

4. **Call it from `main.c`:**

   - `#include "music.h"` near the other includes.
   - `music_init();` right after `audio_init();` at startup.
   - `music_update();` right after `VBlankIntrWait();` at the top of
     the main loop, every frame.
   - `music_play(MOD_YOURFILENAME, 1);` wherever you want a track to
     start (e.g. after `scene_load()`, to play a different song per
     scene) - the exact constant name is whatever `mmutil` prints
     when it builds `soundbank.h`.

`./build.sh` after that will compile it all in. If `mmutil` isn't
found, make sure devkitPro's `tools/bin` is on your PATH (the same
place `grit` lives, if you've used that before).
