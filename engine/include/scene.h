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
 * An NPC's sprite sheet, shared across any scene that references it.
 * Compiled by compiler/build_project.py into npc_sprites[] in scenes_data.c.
 */
typedef struct
{
    const uint8_t  *frames;       /* 4bpp tile data, 128 bytes per frame */
    uint16_t        frame_count;  /* total frames (8: down/up/right/left × 2) */
    uint8_t         palette_bank; /* OBJ palette bank (0 = player, 1-15 = NPC) */
    const uint16_t *palette;      /* 16 GBA colors */

    /*
     * Authored animation states (optional - see EntityAnimState in
     * entity.h), compiled from this sprite's project.json
     * "spriteSheets" entry. 0/0 (the default for a sprite with no
     * authored states) means scene_entities_load() leaves the NPC on
     * the legacy fixed 4-direction/8-frame convention, driven by
     * entity_animate() exactly as before this field existed.
     */
    const EntityAnimState *states;
    uint8_t                state_count;

    /*
     * Authored collision box: offset + size within the sprite's 16x16
     * canvas, compiled from the same "spriteSheets" entry. Defaults to
     * (0, 0, 16, 16) - the full sprite rect, i.e. today's behavior -
     * for a sprite with no authored box.
     */
    int8_t  col_ox;
    int8_t  col_oy;
    uint8_t col_w;
    uint8_t col_h;

    /*
     * Authored canvas size in pixels (project.json "canvasWidth"/
     * "canvasHeight"), default 16x16. For a legacy (non-composed) sheet
     * this is metadata only and must be one of the 12 legal GBA OBJ sizes
     * - frames are still 16x16 and the entity is created 16x16. For a
     * composed sheet (multi_frames below) it is any 1..240 x 1..160 and
     * has already been applied by the compiler: each sub-tile's dx/dy is
     * anchored so the canvas's bottom-centre sits on the entity's 16x16
     * footprint cell's bottom-centre (+ canvasOriginX/Y).
     */
    uint8_t width;
    uint8_t height;

    /*
     * Authored tile-composed ("metasprite") frames (optional - see
     * ASpriteMultiFrame in entity.h/sprite.h), compiled from this
     * sprite's project.json "spriteSheets" entry (its "frames" list and
     * any state's "frameRefs" - see shared/projectTypes.ts). 0/0 (the
     * default) means this sprite has no authored tile placements at
     * all - scene_entities_load() calls entity_set_frames() exactly as
     * before this field existed, using `frames`/`frame_count` above.
     * When set, `states` above are ALREADY indices into
     * `multi_frames`/`multi_frame_count` (not the legacy numbered set) -
     * see build_project.py's spriteSheets pass - and
     * scene_entities_load() calls entity_set_multi_frames() instead,
     * with `multi_max_sub_tiles` (the largest tile_count - OBJs/OAM
     * entries - across multi_frames) and `multi_max_vram_tiles` (the
     * largest vram_tiles - an 8x16 tall OBJ uses 2) as the OAM and VRAM
     * reservations. When multi_frames is set, `width`/`height` above are
     * the authored canvas size (any 1..240 x 1..160), already folded
     * into each sub-tile's dx/dy by the compiler - the entity itself is
     * still created as a 16x16 footprint cell.
     */
    const ASpriteMultiFrame *multi_frames;
    uint16_t                 multi_frame_count;
    uint8_t                  multi_max_sub_tiles;
    uint16_t                 multi_max_vram_tiles;

    /*
     * Direction map (Animation Type) - see ANIM_MAP_KEEP/Entity.anim_map
     * in entity.h. 8 state indices, indexed moving*4 + Direction, compiled
     * from this sheet's slot-tagged states; 0 for a sheet with none (no
     * change in runtime behaviour).
     */
    const uint8_t           *anim_map;
} NpcSpriteDef;

/*
 * The player's own authored animation states + collision box, compiled
 * from project.json's "spriteSheets" entry named "player" (same schema
 * as an NPC sprite's entry above). Unlike NpcSpriteDef this carries no
 * legacy frame/palette data - the player uses player_graphics.h's
 * player_graphics/PLAYER_FRAME_COUNT/player_palette (generated
 * separately by tools/png_to_gba_sprite.py), unless the sheet has
 * composed frames (multi_frames below).
 *
 * A project with no "player" spriteSheets entry (or one with neither
 * "states" nor "collisionBox") gets state_count == 0 and the default
 * (0, 0, 16, 16) box here - main.c leaves the player Entity on the
 * legacy fixed 4-direction/8-frame convention (entity_animate()),
 * unchanged from before this feature existed. Always defined by
 * compiler/build_project.py (as player_sprite_def in scenes_data.c),
 * even for a project with no "spriteSheets" at all.
 */
typedef struct
{
    const EntityAnimState *states;
    uint8_t                state_count;

    int8_t  col_ox;
    int8_t  col_oy;
    uint8_t col_w;
    uint8_t col_h;

    /* Authored canvas/hardware size - see NpcSpriteDef's width/height
     * doc comment above. */
    uint8_t width;
    uint8_t height;

    /* Tile-composed frames + direction map - same meaning as the
     * NpcSpriteDef fields of the same names. multi_frame_count > 0 makes
     * main.c use entity_set_multi_frames() for the player (frames sliced
     * from engine/data/player.png, drawn with player_palette in OBJ bank
     * 0) instead of player_graphics; 0 = the legacy path, unchanged. */
    const ASpriteMultiFrame *multi_frames;
    uint16_t                 multi_frame_count;
    uint8_t                  multi_max_sub_tiles;
    uint16_t                 multi_max_vram_tiles;
    const uint8_t           *anim_map;
} PlayerSpriteDef;

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
    uint8_t sprite_index;   /* index into npc_sprites[] */
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
                                  * alone, else a MOD_* / UGE_* id to
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
