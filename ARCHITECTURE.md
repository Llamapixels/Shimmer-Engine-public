# Architecture

Shimmer Engine has three parts:

| Part | Folder | Language | Job |
|---|---|---|---|
| Editor | `editor/` | TypeScript, React, Electron | Edits projects (JSON + PNG/UGE/WAV files) |
| Compiler | `compiler/` | Python | Turns a project into C data for the engine |
| Engine | `engine/` | C (devkitARM, libgba) | The GBA runtime the data is linked into |

A build runs the compiler, compiles the engine plus the generated data with
`arm-none-eabi-gcc`, links, `objcopy`s to a ROM and fixes the header with `gbafix`.

## Projects

A project is a folder: `project.json`, `scenes/*.json` and `assets/` (backgrounds,
sprites, fonts, frames, ui, music, sounds, cutscenes). Types for both JSON files are in
`editor/shared/projectTypes.ts` and `editor/shared/eventTypes.ts`; the compiler's module
docstring in `compiler/build_project.py` documents the same format.

## Compiler

- `build_rom.py` - the whole build without make: compile with up-to-date checks, link,
  objcopy, gbafix. Writes to `<project>/build/rom/` so projects can live anywhere.
  Usage: `python3 compiler/build_rom.py <project> [--engine DIR] [--devkitpro DIR] [--out FILE]`.
- `build_project.py` - scenes, collision, actors, triggers and event scripts to
  `scenes_data.c`. Every event type compiles to `ScriptEvent` instructions
  (`engine/include/script.h`); expressions (`expr.py`) compile to RPN arrays.
- `sprites.py` - sprite sheets: draws each frame, covers it with as few hardware OBJs as
  possible (8x8 up to 64x64), dedupes tiles, mirrors "flip left" frames with OBJ flips and
  assigns OBJ palette banks per scene.
- `ui.py` - dialogue fonts, frames and cursor (GB Studio formats) to `ui_data.c`.
- `uge.py` - `.uge` songs to `uge_songs.c`; output matches GB Studio's exporter.
- `wav.py` - WAVs to signed 8-bit mono at 16384 Hz.
- `cutscenes.py` - video cutscenes; the files go into the ROM with `.incbin`.
- `modes.py` + `engine_settings.json` - game mode settings. The same JSON drives the
  editor's settings screens, so a new setting only needs adding there.

Generated files land in `engine/data/` during development builds; restore them with
`git checkout engine/data` before committing.

## Engine

- `main.c` - the game loop and scene state machine (play, fade out, load, fade in), actors,
  the scene stack and "real pause" snapshots.
- `script.c` - the script machine: one main script plus 8 background threads, an
  expression evaluator, timers, button scripts and line-of-sight watchers. A script runs
  until it blocks (text, wait, a move), then resumes next frame.
- `modes.c` - the six game modes (top down, platformer, adventure, shoot 'em up, point and
  click, logo).
- `background.c` - BG0 maps up to 64x64 tiles load directly; bigger maps stream rows and
  columns as the camera moves. BG2/BG3 hold up to two parallax layers.
- `entity.c`, `sprite.c` - actors and their sprites. Each actor reserves OAM and VRAM for
  its largest frame and streams frames in.
- `ui.c`, `dialogue.c` - text is drawn pixel by pixel into a RAM canvas of tiles on BG1,
  word-wrapped and paged.
- `huge.c` - a C port of hUGEDriver on the PSG channels. `wav.c` plays WAVs on Direct
  Sound A/B with DMA 1/2 and timer 0.
- `cutscene.c` - plays `.cut` videos: LZ77 frames unpacked by the BIOS, changed tiles
  copied to VRAM, timed from the hardware clock.
- `save.c` - three 1 KB save slots in battery-backed SRAM.

### Video memory

| Area | Use |
|---|---|
| BG char block 0-1 | Scene tiles (up to 1024) |
| BG screen blocks 28-31 | Scene map (BG0) |
| BG screen blocks 24-27 | Parallax layer maps (BG2, BG3) |
| BG char block 2, screen block 23 | Dialogue box and text (BG1) |
| BG palette banks 0-14 / 15 | Scene / dialogue |
| OBJ VRAM 0x06010000 | Sprite tiles, streamed per frame |
| OBJ palette banks | Per scene; the player is bank 0 |

## Editor

- `editor/electron/` - main process: file access (`projectIO.ts`), builds
  (`buildRunner.ts`), menus and settings (`main.ts`). The renderer only talks to it through
  the typed IPC in `editor/shared/ipc.ts`.
- `editor/src/state/projectStore.ts` - the open project, undo/redo and autosave.
- `editor/src/script/` - the event block editor. `eventCatalog.ts` defines every event's
  fields; `ScriptFields.tsx` renders them.
- `editor/src/components/` - Game World (`SceneCanvas.tsx`), inspectors, sprites, music.
- `editor/src/art/` - the Art Editor. Layers are saved next to a PNG as `<name>.art.json`.
- `editor/src/cutscenes/` - video import (decoded in the app), the encoder (in a worker)
  and the preview player.
- `editor/src/music/` - `.uge` I/O, a TypeScript port of the driver and a PSG synth.

## Installers

`.github/workflows/installer.yml` builds Windows (NSIS), Linux (AppImage + deb) and Mac
(dmg) on every push to `dev`. Each bundles a frozen build tool, the engine and a trimmed
devkitARM (`editor/scripts/stage_toolchain.py`). Linux uses Arm's GCC with devkitPro's GBA
files (`tools/linux-toolchain/`) because devkitPro's Linux GCC needs glibc 2.36.

## Not done yet

Platformer slopes, emotes, changing an actor's sprite at runtime, overlays.
