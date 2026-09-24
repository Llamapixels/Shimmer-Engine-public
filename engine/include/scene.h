#ifndef ADVANCE_SCENE_H
#define ADVANCE_SCENE_H

#include <stdint.h>

#include "script.h"
#include "entity.h"

/*
 * A trigger zone (what a "door" is, underneath): position/size in
 * 8x8 tiles. Stepping into it runs on_enter, a generic script (see
 * script.h) - typically just a single SCRIPT_SWITCH_SCENE event
 * (what "target_scene"/"target_x"/"target_y" shorthand in scene JSON
 * compiles to), but it can be anything: an item check gating the
 * transition, a message, a sound, several of those in sequence, etc.
 * There's no special "locked door" concept in the engine - that's
 * just a script with an SCRIPT_IF_ITEM in it.
 */
typedef struct
{
    uint8_t x;                   /* tile column */
    uint8_t y;                   /* tile row */
    uint8_t width;                /* tiles wide */
    uint8_t height;                /* tiles tall */
    const ScriptEvent *on_enter;    /* never 0 - see compiler/build_project.py */
} DoorDef;

/*
 * Every sprite sheet the project uses, compiled by
 * compiler/build_project.py into sprite_defs[] in scenes_data.c (see
 * SpriteDef in entity.h). player_sprite_index picks the player's.
 */
extern const SpriteDef sprite_defs[];
extern const uint8_t player_sprite_index;

/*
 * One NPC placed in a scene. x/y are in pixels (already multiplied
 * by 8 by the compiler). Everything the NPC actually DOES when
 * talked to - show text, give an item, set a flag, gate on a flag or
 * item, play a sound, anything - lives in its own on_interact script
 * (see script.h), not in fixed fields here. 0 means the NPC can't be
 * interacted with at all (purely decorative, or wander-only).
 */
typedef struct
{
    int16_t x;
    int16_t y;
    uint8_t direction;      /* Direction: 0=down 1=up 2=right 3=left */
    uint8_t sprite_index;   /* index into sprite_defs[] */
    uint8_t palette_bank;   /* OBJ palette bank the compiler gave this
                              * sprite in this scene (0 = the player's) */
    uint8_t movement;       /* 0 = static (default), 1 = wanders nearby
                              * tiles at random - see "movement" in
                              * scene JSON. This (like GB Studio's own
                              * actor movement type) is a plain built-in
                              * property, not something scripted - tile-
                              * collision aware only, doesn't yet avoid
                              * the player or other NPCs. */
    const ScriptEvent *on_interact;   /* 0 = not interactable */
} NpcDef;

/*
 * A background timer definition - see engine/include/timer.h and
 * SCRIPT_START_TIMER in script.h. Not tied to any NPC or door; a
 * script anywhere in the scene arms one by index (or by its optional
 * "id" name, resolved to an index at compile time - see
 * compiler/build_project.py's "timers"/"start_timer").
 */
typedef struct
{
    int16_t frames;            /* how long after start_timer fires */
    const ScriptEvent *script;  /* never 0 */
} TimerDef;

/*
 * A compiled scene, as produced by compiler/build_project.py.
 * All arrays live in ROM.
 */
typedef struct
{
    const char *name;

    uint16_t width;             /* in 8x8 tiles */
    uint16_t height;

    const uint8_t *tiles;       /* 4bpp tile graphics, 32 bytes each */
    uint16_t tile_count;

    const uint16_t *palettes;   /* 16 colors per bank */
    uint8_t palette_count;

    const uint16_t *map;        /* width*height GBA screen entries */
    const uint8_t *collision;   /* width*height COLLISION_* values */

    int16_t player_x;           /* spawn, in pixels */
    int16_t player_y;
    uint8_t player_start_direction;
                                 /* Direction (0-3, see entity.h) the
                                  * player faces when the game boots
                                  * fresh into this scene (a resumed
                                  * save uses its own saved direction
                                  * instead - see main.c). Only
                                  * meaningful for whichever scene is
                                  * actually the project's start
                                  * scene, but every scene carries the
                                  * field (defaults to 0/down) so
                                  * there's nothing special-cased at
                                  * compile time about which one that
                                  * is. */

    int16_t music_track;        /* -1 = leave whatever's already playing
                                  * alone, else a UGE_* id to
                                  * switch to on entering this scene -
                                  * see "music" in scene JSON */

    const DoorDef *doors;       /* array of trigger zones */
    uint8_t door_count;

    const NpcDef *npcs;         /* array of NPC placements */
    uint8_t npc_count;

    const ScriptEvent *on_init; /* 0 = none. Auto-runs once, every time
                                  * this scene loads (boot into it, or
                                  * transition into it) - after the
                                  * fade-in finishes and before the
                                  * player regains control. See
                                  * "on_init" in scene JSON. */

    const TimerDef *timers;     /* array of background timer definitions -
                                  * see TimerDef above */
    uint8_t timer_count;
} SceneDef;

/* Load background, palettes, collision and camera bounds. */
void scene_load(const SceneDef *scene);

const SceneDef *scene_current(void);

/*
 * Check whether a pixel-space bounding box overlaps any trigger zone.
 * Returns the DoorDef pointer, or 0 if none was hit.
 */
const DoorDef *scene_check_doors(int px, int py, int pw, int ph);

#endif
