"""
Shimmer Engine project compiler.

    python compiler/build_project.py examples/demo

Reads a Shimmer Engine project folder:

    <project>/
        project.json            { "name": ..., "start_scene": "town",
                                   "items": ["Old Key", ...],       <- optional
                                   "flags": ["met_town_npc"],       <- optional
                                   "variables": ["score"] }         <- optional
        scenes/<name>.json      one file per scene
        assets/backgrounds/     background PNGs
        assets/sprites/         NPC sprite PNGs (96x16, same format as player.png)

and writes GBA-ready C data into engine/data/:

    scenes_data.c / scenes_data.h

NPC sprites are embedded in scenes_data.c.  The special sprite name "player"
reuses the player_graphics / player_palette symbols already compiled by
tools/png_to_gba_sprite.py.

Optional per-sprite-sheet animation/collision metadata, in project.json's
"spriteSheets" list (matched by name to "sprite" in an NPC, or "player"):
    "spriteSheets": [
        {
            "name": "npc1",             <- matches assets/sprites/npc1.png,
                                            or "player" for the built-in sheet
            "states": [                 <- optional; a sprite with none keeps
                                            the legacy fixed convention below
                {
                    "name": "wave",     <- unique within this sheet; targeted
                                            by "actor_set_state" events
                    "frames": [4, 5, 4, 6],  <- frame indices into this
                                                sheet's compiled 8-frame set
                                                (0,1=down 2,3=up 4,5=right
                                                6,7=left - see "Sheet layout"
                                                below), shown in this order
                    "speed": 6,         <- optional, VBlanks per frame
                                            (default 8, ENTITY_ANIM_SPEED)
                    "slot": "movingRight"  <- optional (see "animationType"
                                                below)
                }
            ],
            "collisionBox": {           <- optional; default is the full
                                            16x16 sprite rect
                "x": 4, "y": 8,         <- offset within the sprite's canvas
                "width": 8, "height": 8
            },
            "animationType": "multi_movement",  <- optional (see
                                                     editor/shared/
                                                     projectTypes.ts's
                                                     SpriteAnimationType) -
                                                     decides which "slot"s
                                                     feed the runtime
                                                     direction map (below)
            "flipLeft": true,           <- optional, default true. Any state
                                            whose "slot" above is
                                            idleLeft/movingLeft/jumpingLeft
                                            has its frames/speed/flips
                                            REPLACED with a mirror of its
                                            "*Right" sibling state (matched
                                            by "slot") - set false to author
                                            such a state's frames yourself
            "canvasWidth": 16,           <- optional, default 16. On a sheet
            "canvasHeight": 16               WITHOUT composed frames: metadata
                                              only, must be one of the 12 legal
                                              GBA OBJ sizes (GBA_SPRITE_SIZES).
                                              On a composed sheet: any 1..240 x
                                              1..160 (see anchoring below)
            "canvasOriginX": 0,          <- optional (composed sheets), shifts
            "canvasOriginY": 0              the anchored canvas, px
            "spriteMode": "8x16",        <- optional (composed sheets), "8x16"
                                             (default) or "8x8" - size of ONE
                                             placed tile. An 8x16 tile is one
                                             tall hardware OBJ covering sheet
                                             rows sheetY and sheetY+1
            "frames": [                  <- optional; authored tile-composed
                                             ("metasprite") frames - see
                                             editor/shared/projectTypes.ts's
                                             SpriteFrameJSON/PlacedTileJSON.
                                             Referenced by a state's
                                             "frameRefs" (below), NOT by its
                                             "frames" (the legacy numbered
                                             set)
                {
                    "id": "walk_right_1",
                    "tiles": [
                        { "x": 0, "y": 0, "sheetX": 4, "sheetY": 0 },
                        { "x": 9, "y": -3, "sheetX": 5, "sheetY": 0,
                          "flipX": true, "palette": 3, "priority": true }
                    ]
                }
            ]
        }
    ]
A state's "frameRefs" (parallel/alternative to "frames" above): ordered
ids into its sheet's "frames" - when non-empty, this state is shown/
compiled from these tile-composed frames instead of the legacy numbered
set. A sheet where ANY state references a composed frame compiles its
WHOLE animation set (every state, composed or legacy-numbered) through the
engine's multi-tile ("metasprite") path (see engine/source/sprite.c's
sprite_init_multi/ASpriteMultiFrame); a legacy numbered frame on such a
sheet becomes two tall 8x16 OBJs at entity offset (0,0)/(8,0). A sheet
where no state references a composed frame compiles exactly as before
this feature existed (the backward-compatibility boundary). Composed-frame
rules:
  - Only frames some state references are compiled; unreferenced frames
    are skipped entirely (no validation, no ROM space).
  - Tile x/y are pixel positions (any integer) relative to the canvas's
    top-left; a tile may hang partly outside the canvas, one lying
    entirely outside it is dropped with a warning.
  - Anchoring: the canvas's bottom-centre sits on the bottom-centre of
    the entity's 16x16 footprint cell, then shifts by canvasOrigin:
        dx = x + (16 - canvasWidth) // 2 + canvasOriginX
        dy = y + (16 - canvasHeight)     + canvasOriginY
    The result must fit the engine's int8 offsets (-128..127).
  - A frame with no tiles is valid and shows nothing.
  - flipLeft: a "*Left" slot state derived from its "*Right" sibling shows
    the sibling's composed frames mirrored tile by tile (x' = canvasWidth
    - x - 8, flipX toggled, before anchoring).
  - Later-listed tiles draw on top (as in GB Studio's editor).
The "player" sheet may use composed frames too: its atlas is
engine/data/player.png (checked against engine/data/player_graphics.c, so
the colours match player_palette in OBJ bank 0).

Every sheet with slot-tagged states also gets a runtime direction map
(anim_map - see build_anim_map() and engine/include/entity.h): walking/
facing picks the state for that direction per the sheet's animationType,
the way GB Studio's actors animate.

A sprite sheet with no "spriteSheets" entry (or an entry with neither
"states" nor "collisionBox") compiles exactly as it always has: the legacy
fixed 4-direction/8-frame convention (engine/include/entity.h's
entity_animate()) and a collision box equal to the full sprite rect.

A "player" entry applies to BOTH any NPC that reuses the player sprite
sheet (via npc_sprites[], like any other sprite name) AND the actual
player Entity created in engine/source/main.c - the latter is compiled
into a separate player_sprite_def global (see PlayerSpriteDef in
scene.h), since the player's frame/palette data itself still comes from
the statically pre-baked engine/data/player_graphics.h (generated by
tools/png_to_gba_sprite.py, not by this script) rather than from
project.json/assets/sprites. A project with no "player" spriteSheets
entry gets a player_sprite_def with state_count 0 and the default
(0,0,16,16) box, and main.c's player Entity is completely unaffected -
same legacy convention as always.

"items", "flags" and "variables" in project.json are project-wide named lists
(like GB Studio's own inventory/switches/variables): "items" back an
inventory bit each (SaveData.inventory), "flags" back a plain boolean bit
each (SaveData.flags), "variables" back a signed 16-bit number each
(SaveData.variables) - for counters, scores, timers, anything a boolean flag
can't hold. All three are referenced BY NAME from event scripts below -
none of them is tied to any specific NPC, door, or other fixed feature.

Everything an NPC or door actually DOES - show text, give an item, set or
check a flag or variable, move/show/hide an actor, play a sound, switch
scenes, or any sequence/branch of those - is a generic event SCRIPT (see
engine/include/script.h), not a fixed field. This is the same idea as GB
Studio's own visual scripting: a small set of composable event types,
authored per-object, rather than checkboxes like "locked door" or "one-time
item" baked into the engine.

Scene JSON NPC format:
    "npcs": [
        {
            "sprite": "npc1",          <- assets/sprites/npc1.png (or "player")
            "x": 10,                   <- tile column
            "y": 8,                    <- tile row
            "direction": "down",       <- down / up / right / left
            "movement": "wander",      <- optional: static (default) or
                                           wander (random walk, tile-
                                           collision aware only). Like GB
                                           Studio's own actor movement type,
                                           this is a plain built-in property,
                                           not something scripted.
            "name": "shopkeeper",      <- optional, unique within this scene.
                                           Lets other events in this scene
                                           (this NPC's own script, another
                                           NPC's, a door's, or the scene's
                                           on_init) target this actor via
                                           "actor_*" events (see below).
                                           Unnamed NPCs can still be targeted
                                           by their 0-based index in "npcs".
            "dialogue": "Hi there!",   <- optional shorthand: talking to the
                                           NPC just shows this text. Compiles
                                           to an "on_interact" script with a
                                           single "text" event.
            "on_interact": [ ... ]     <- optional, full event script (see
                                           below) run when the player talks
                                           to this NPC. Overrides "dialogue"
                                           if both are given. Omit both for
                                           a purely decorative/wander-only NPC.
                                           Inside its own on_interact, this
                                           NPC can also target itself with
                                           "actor": "self".
        }
    ]

A scene can also run an event script automatically, once, every time it
loads (boot into it or transition into it) - not tied to any NPC or door:
    "on_init": [
        { "type": "if_flag", "flag": "seen_intro", "else": [ ... ] }
    ]

A scene can also define independent background timers - each one runs its
own event script "frames" frames after something starts it with a
"start_timer" event, in the background, whatever else (dialogue, another
script, normal movement) is happening at the time:
    "timers": [
        { "name": "storm",         <- optional, unique within this scene.
                                       Lets "start_timer" events target it
                                       by name instead of its 0-based index
                                       in "timers".
          "frames": 600,           <- how long after start_timer before this
                                       timer's script runs (60 = 1 second).
          "script": [ ... ]        <- event script, same format as
                                       on_interact/on_init/door events.
        }
    ]
A scene may define at most 8 timers (MAX_TIMERS). A timer that's already
counting down and gets started again just restarts its countdown - it
doesn't queue up a second firing. If a timer reaches 0 while a script is
already running or dialogue is on screen, that firing is skipped entirely
(not delayed/queued) - a timer is for incidental background behavior
(ambient sound, a wandering effect, a scripted event some time later),
not anything that must fire at an exact frame.

A door is really just a trigger zone with an "on_enter" script. Use either
the simple warp shorthand:
    "doors": [
        { "x": 5, "y": 0, "width": 2, "height": 1,
          "target_scene": "town", "target_x": 10, "target_y": 12 }
    ]
which compiles to a "play_sound door" + "switch_scene" script, or a full
custom script (for a locked door, a one-way trap door, anything) via
"events" instead of "target_scene"/"target_x"/"target_y":
    "doors": [
        { "x": 5, "y": 0, "width": 2, "height": 1,
          "events": [
              { "type": "if_item", "item": "Old Key",
                "then": [
                    { "type": "play_sound", "sound": "door" },
                    { "type": "switch_scene", "scene": "house_inside",
                      "x": 5, "y": 8 }
                ],
                "else": [
                    { "type": "text", "text": "It's locked." }
                ]
              }
          ]
        }
    ]
A door must have exactly one of "target_scene" or "events".

Event script types (used in "on_interact" and door "events" lists):
    { "type": "text", "text": "..." }
        Show a dialogue box. "\n" in the text starts a new page. Pauses the
        script until the player dismisses it.
    { "type": "set_flag", "flag": "<name>" }
    { "type": "clear_flag", "flag": "<name>" }
        Set/clear a named flag from project.json's "flags" list.
    { "type": "if_flag", "flag": "<name>", "then": [...], "else": [...] }
        Branch on whether a flag is set. "else" is optional.
    { "type": "give_item", "item": "<name>" }
        Grant a named item from project.json's "items" list.
    { "type": "if_item", "item": "<name>", "then": [...], "else": [...] }
        Branch on whether the player holds an item. "else" is optional.
    { "type": "play_sound", "sound": "blip" | "door" | "save" | "item" }
        Play one of the engine's small fixed set of sound effects.
    { "type": "play_music", "track": "<engine/music asset name>", "loop": true }
        Start (or restart) a music track from a script, not just a scene's
        own "music" property (see below) - e.g. from an on_init, so it
        loops in the background until changed/stopped. Already-playing the
        same track is a no-op. "loop" defaults to true; false plays once.
    { "type": "stop_music" }
        Silence whatever music is currently playing.
    { "type": "wait", "frames": 30 }
        Pause the script for a number of frames (60 = 1 second).
    { "type": "switch_scene", "scene": "<name>", "x": 5, "y": 8 }
        Fade out, load another scene, and place the player at tile (x, y)
        there. Ends the script.
    { "type": "set_var", "var": "<name>", "value": 0 }
        Set a named variable from project.json's "variables" list to a
        literal 16-bit value.
    { "type": "add_var", "var": "<name>", "delta": 1 }
        Add to a named variable. "delta" may be negative (there's no
        separate "subtract").
    { "type": "if_var", "var": "<name>", "op": ">=", "value": 10,
      "then": [...], "else": [...] }
        Branch by comparing a variable to a literal value. "op" is one of
        "==", "!=", "<", "<=", ">", ">=". "else" is optional.
    { "type": "actor_show", "actor": "<name, index, or \"self\">" }
    { "type": "actor_hide", "actor": ... }
        Show/hide an NPC actor in the current scene. A hidden actor also
        stops blocking movement and stops being talked to until shown
        again. "self" (only inside an NPC's own on_interact) targets that
        NPC itself.
    { "type": "actor_set_position", "actor": ..., "x": 5, "y": 8 }
        Teleport an actor to a tile position.
    { "type": "actor_set_direction", "actor": ..., "direction": "down" }
        Turn an actor to face a direction, without moving it.
    { "type": "actor_move_to", "actor": ..., "x": 5, "y": 8 }
        Walk an actor to a tile position over several frames, at the same
        speed the player moves. Pauses the script until it arrives. Ignores
        collision entirely (same as actor_set_position) - this is
        author-directed movement, not the player's collision-checked
        movement.
    { "type": "actor_set_state", "actor": ..., "state": "<name, or index>" }
        Switch an actor to one of its sprite's authored animation states
        (see "spriteSheets" above). The actor's sprite must define at least
        one state - this is a compile error on a sprite using the legacy
        fixed convention.
    { "type": "actor_set_animate", "actor": ..., "enabled": true }
        Turn per-frame animation stepping on ("enabled": true, the default)
        or off for an actor using authored states - off holds whatever
        frame is currently shown.
    { "type": "actor_set_frame", "actor": ..., "frame": 3 }
        Show a specific frame directly, by index into the actor's sprite
        sheet - bypasses the current state's frame list (and also stops
        animation stepping, like actor_set_animate false, until re-enabled).
    { "type": "actor_set_collision_box", "actor": ...,
      "x": 0, "y": 4, "width": 16, "height": 12 }
        Override an actor's collision box: offset ("x"/"y", default 0/0)
        and size ("width"/"height", required) in pixels within its sprite's
        canvas - same shape as a sprite sheet's "collisionBox" above, but
        settable at runtime (e.g. shrinking a character's box when it lies
        down).
    { "type": "wait_button", "buttons": "a" }
    { "type": "wait_button", "buttons": ["a", "b"] }
        Pause the script until one of the given buttons is freshly pressed
        (not just held). One name or a list of names: "a", "b", "select",
        "start", "up", "down", "left", "right", "l", "r".
    { "type": "choice", "prompt": "Take the shortcut?",
      "options": ["Yes", "No"], "then": [...], "else": [...] }
        Show a two-option prompt in the dialogue box (Up/Down to move the
        cursor, A to pick). "then" runs if the first option ("Yes" here) was
        picked, "else" if the second was. "else" is optional, same as
        if_flag/if_item/if_var. Exactly two "options" are required - this is
        a yes/no-style choice, not a general menu.
    { "type": "menu",
      "options": [
          { "label": "Attack", "then": [...] },
          { "label": "Defend", "then": [...] },
          { "label": "Run",    "then": [...] }
      ] }
        A general 2-4 option menu (unlike "choice", each option runs its own
        "then" rather than picking between just "then"/"else", and there's
        no prompt row of its own - put a "text" event before it for one).
        Up/Down wrap around the option list, A picks.

"set_var"/"add_var"/"if_var"'s "value"/"delta" may also be another
variable instead of a literal number:
    { "type": "set_var", "var": "score", "value": {"var": "bonus"} }
    { "type": "if_var", "var": "score", "op": ">=", "value": {"var": "par"},
      "then": [...] }
    { "type": "random_var", "var": "<name>", "min": 1, "max": 6 }
        Set a variable to a random integer in [min, max] inclusive.
    { "type": "start_timer", "timer": "<name, or index>" }
        Arm one of this scene's "timers" (see below) - it fires its own
        event script "frames" frames from now, in the background.
    { "type": "camera_lock_actor", "actor": ... }
        Keep the camera centered on an actor (by default it's the player)
        every frame, instead of just the player - useful for cutscenes
        following an NPC around. Stays locked across dialogue/scripts/
        normal movement until camera_release.
    { "type": "camera_lock_point", "x": 10, "y": 8 }
        Keep the camera centered on a fixed tile position instead of any
        actor, until camera_release.
    { "type": "camera_move_to", "x": 10, "y": 8 }
        Pan the camera to a tile position over several frames (same speed
        as actor_move_to). Pauses the script until it arrives. Leaves the
        camera locked there afterward (as if camera_lock_point had been
        used) - follow with camera_release to hand control back to the
        player.
    { "type": "camera_release" }
        Release any camera lock (actor, point, or left over from a
        camera_move_to) and resume following the player normally.

GB Studio parity events (compile_parity_event()). Positions are in tiles
unless "units": "pixels" is given; "then"/"else" work as in if_flag:
    { "type": "if_expression", "expression": "$score$ >= 10 && held(a)",
      "then": [...], "else": [...] }
    { "type": "set_var_expression", "var": "<name>", "expression": "..." }
    { "type": "loop_while", "expression": "...", "body": [...] }
    { "type": "loop_for", "var": "i", "from": 0, "comparison": "<", "to": 10,
      "stepOp": "add", "step": 1, "body": [...] }
        Expressions: see compiler/expr.py (C operators, $name$ or bare
        variable names, min/max/abs/rnd/isqrt, actor_x/actor_y/actor_dir,
        held/pressed, flag/item, saved/peek, scene, time). "from"/"to"/
        "step" may be {"var": ...} like set_var's "value".
    { "type": "set_var_true" | "set_var_false", "var": ... }
    { "type": "var_inc" | "var_dec", "var": ... }
    { "type": "if_var_true" | "if_var_false", "var": ..., "then", "else" }
    { "type": "var_set_flags" | "var_add_flags" | "var_clear_flags",
      "var": ..., "bits": [0, 3] }            bits 0-15 of the variable
    { "type": "if_var_flags", "var": ..., "bits": [...], "then", "else" }
        True when every listed bit is set.
    { "type": "vars_reset" }   { "type": "seed_rng" }   { "type": "idle" }
    { "type": "rate_limit", "var": "<name>", "frames": 30, "body": [...] }
        Skips "body" if it ran less than "frames" frames ago ("var" keeps
        the time it last ran).
    { "type": "label", "label": "top" }   { "type": "goto", "label": "top" }
        Jump within the same script (not into or out of a sub-script).
    { "type": "switch", "var": ..., "cases": [{ "value": 1, "then": [...] }],
      "else": [...] }
    { "type": "if_color_supported" | "if_device_gba", "then": [...] }
    { "type": "if_device_sgb", "else": [...] }
        Resolved at compile time: a GBA supports color, is a GBA, isn't an SGB.
    { "type": "actor_invoke", "actor": ... }
        Runs that NPC's on_interact here (inlined; "self" inside it means
        that NPC).
    { "type": "thread_start", "var": "<optional handle var>", "script": [...] }
    { "type": "thread_stop", "var": "<handle var>" }
    { "type": "timer_script_set", "timer": 1-4, "frames": 60, "script": [...] }
    { "type": "timer_restart" | "timer_disable", "timer": 1-4 }
    { "type": "input_script_set", "buttons": ["a"], "override": false,
      "script": [...] }
    { "type": "input_script_remove", "buttons": ["a"] }
    { "type": "music_routine", "routine": 0-15, "script": [...] }
        "script"s run as separate background scripts (see script.h).
    { "type": "actor_set_position_vars" | "actor_move_to_vars", "actor": ...,
      "varX": ..., "varY": ..., "units": "tiles" }
    { "type": "actor_set_position_relative" | "actor_move_relative",
      "actor": ..., "x": 1, "y": 0, "units": "tiles" }
    { "type": "actor_set_frame_var", "actor": ..., "var": ... }
    { "type": "actor_set_move_speed", "actor": ..., "speed": 1-8 }  px/frame
    { "type": "actor_set_anim_speed", "actor": ..., "speed": 0-255 }
        Frames per animation frame; 0 = the sprite's own speed.
    { "type": "actor_set_collisions", "actor": ..., "enabled": true }
    { "type": "actor_push", "actor": ..., "continue": false }
    { "type": "if_actor_at_position", "actor": ..., "x": 5, "y": 8, ... }
    { "type": "if_actor_direction", "actor": ..., "direction": "up", ... }
    { "type": "if_actor_distance", "actor": ..., "other": ..., "op": "<=",
      "distance": 3, ... }                     whole tiles, Euclidean
    { "type": "if_actor_relative", "actor": ..., "other": ...,
      "relation": "up" | "down" | "left" | "right", ... }
    { "type": "if_input", "buttons": ["a", "b"], ... }        held right now
    { "type": "if_current_scene", "scene": "<name>", ... }
    { "type": "scene_push" | "scene_pop" | "scene_pop_all" | "scene_reset" }
    { "type": "data_save" | "data_load" | "data_clear", "slot": 0-2 }
    { "type": "if_data_saved", "slot": 0-2, ... }
    { "type": "data_peek", "slot": 0-2, "source": "<var in the save>",
      "var": "<var to store it in>" }
    { "type": "sprites_show" }   { "type": "sprites_hide" }
    { "type": "palette_set", "target": "background" | "sprite", "bank": 0-15,
      "index": 0-15, "colors": ["#rrggbb", ...] }
    { "type": "replace_tile", "x": 5, "y": 3, "sourceX": 0, "sourceY": 0 }
        Copies the map entry at the source tile onto (x, y).
    { "type": "sound_tone", "frequency": 440, "frames": 30 }
    { "type": "sound_beep", "pitch": 1-8, "frames": 30 }
    { "type": "sound_crash", "frames": 30 }
    { "type": "mute_channel", "channel": 1-4, "muted": true }

Any "text" event's "text", a "choice" event's "prompt"/"options", or a
"menu" event's option "label"s may embed a variable's current value with
"{varname}" (e.g. "text": "You have {score} points!") - substituted with
the variable's decimal value (with a leading "-" if negative) at the
moment the text is actually shown on screen, not when the script runs the
event, so it stays live across pages/frames.

A scene can also switch music on entering it:
    "music": "template"        <- optional, matches an engine/music/ file
                                   (without extension): a .uge song
                                   (hUGETracker / GB Studio, played on the
                                   GBA's Game Boy sound channels) resolves to
                                   its UGE_* id in uge_songs.h, a .mod/.xm/
                                   .s3m/.it module to the MOD_* constant
                                   mmutil generates for it. Leave unset to
                                   keep whatever's already playing.

This is the "compiler" box from the architecture:
    editor (later) -> project files -> THIS -> engine data -> .gba
"""

from pathlib import Path
import argparse
import json
import re
import sys

from PIL import Image

from uge import UgeError, build_uge_songs, track_const as uge_track_const
from expr import ExprError, compile_expression, to_rpn as expr_to_rpn
import expr as X

# Shared music folder (engine/music/) - .uge songs are compiled from here
# into engine/data/uge_songs.c; module files go through the Makefile's
# mmutil rule instead.
ENGINE_MUSIC_DIR = Path(__file__).resolve().parent.parent / "engine" / "music"
MODULE_MUSIC_EXTS = (".mod", ".xm", ".s3m", ".it")


TILE = 8

# A background up to 64x64 tiles (512x512 px) loads straight into VRAM.
# Bigger than that, the engine streams a scrolling 64x64 window of it
# in from ROM instead (see engine/source/background.c), so this cap is
# really a ROM/build-time budget, not a hardware wall. Raise it if you
# need bigger maps and don't mind bigger .gba files / slower builds.
MAX_MAP_TILES = 256         # up to 2048x2048 px
HW_MAP_TILES = 64           # the VRAM-direct threshold - matches the engine
MAX_TILES = 1024            # unique tile GRAPHICS - this cap is unchanged;
                             # streaming only helps with map SIZE, so reuse
                             # tiles across a big map like you already do
MAX_BANKS = 15              # 16 BG palettes, minus 1 reserved for the dialogue font
COLORS_PER_BANK = 15        # index 0 is shared backdrop/transparent

# Collision characters used in scene JSON.
COLLISION_CHARS = {
    ".": 0,   # walkable
    "#": 1,   # solid
    "~": 2,   # water
    "!": 3,   # damage
}
COLLISION_NAMES = {0: "walkable", 1: "solid", 2: "water", 3: "damage"}

# Direction name -> engine constant
DIRECTION_MAP = {
    "down":  0,
    "up":    1,
    "right": 2,
    "left":  3,
}

ENTITY_STATE_MAX_FRAMES = 16   # keep in sync with entity.h's ENTITY_STATE_MAX_FRAMES

# Known project.json "animationType" values (editor/shared/projectTypes.ts's
# SpriteAnimationType / SPRITE_ANIMATION_SLOTS) - validated here for an
# early, clear error on a typo. flipLeft derivation is driven off each
# state's own "slot"; the animationType additionally picks which slots feed
# the runtime direction map (see build_anim_map()).
SPRITE_ANIMATION_TYPES = {
    "fixed", "fixed_movement", "multi", "multi_movement",
    "horizontal", "horizontal_movement", "platform_player", "cursor",
}

# "*Left" slot -> its "*Right" sibling slot (editor/shared/projectTypes.ts's
# SPRITE_LEFT_SLOT_TO_RIGHT). A state whose "slot" is a key here, on a sheet
# whose "flipLeft" isn't explicitly false, is derived from the sibling
# state whose "slot" is the mapped value - see the spriteSheets pass below.
SPRITE_LEFT_SLOT_TO_RIGHT = {
    "idleLeft": "idleRight",
    "movingLeft": "movingRight",
    "jumpingLeft": "jumpingRight",
}

# Legal GBA hardware OBJ sizes (engine/source/sprite.c's size_table) that a
# sheet's "canvasWidth"/"canvasHeight" must be one of - see the spriteSheets
# pass below and SpriteSheetJSON.canvasWidth's doc comment.
GBA_SPRITE_SIZES = {
    (8, 8), (16, 16), (32, 32), (64, 64),
    (16, 8), (32, 8), (32, 16), (64, 32),
    (8, 16), (8, 32), (16, 32), (32, 64),
}

# engine/include/sprite.h's ASPRITE_MAX_SUBTILES - the most placed tiles
# one authored composed ("metasprite") frame may use (also how many OAM
# slots get reserved, once, for a sheet that uses this feature at all -
# see sprite.c's sprite_init_multi doc comment).
ASPRITE_MAX_SUBTILES = 16

# GBA OBJ palette banks (sprite.c's ADV_OBJ_PALETTE, 16 banks x 16
# colors). A placed tile's "palette" (shared/projectTypes.ts's
# PlacedTileJSON.palette - the GBA-only simplification of GB Studio's
# dual OBP0/OBP1 + color-palette fields, see that type's doc comment)
# must be one of these; unlike MAX_BANKS/COLORS_PER_BANK above (BG
# palettes), no bank is reserved here - all 16 are addressable, it's up
# to the project not to collide two different sprites' bank choices
# (same constraint the existing "npc_palette_bank" assignment lives
# with already).
OBJ_PALETTE_BANK_MAX = 16

# Composed-sheet canvas limits (SpriteSheetJSON "ROUND 3 CONTRACT" in
# editor/shared/projectTypes.ts): a composed frame is built from many OBJs,
# so the canvas is any size up to the GBA screen, not one legal OBJ shape.
COMPOSED_CANVAS_MAX_W = 240
COMPOSED_CANVAS_MAX_H = 160

# SpriteSheetJSON.spriteMode values -> placed-tile height in pixels. "8x16"
# (the default, as in GB Studio) is ONE tall hardware OBJ per placed tile,
# using two consecutive 8x8 VRAM tiles (1D OBJ mapping: sheet row sheetY on
# top, sheetY+1 below).
SPRITE_MODE_TILE_H = {"8x8": 8, "8x16": 16}
DEFAULT_SPRITE_MODE = "8x16"

# Which "slot" names each animationType defines (editor/shared/
# projectTypes.ts's SPRITE_ANIMATION_SLOTS) - used to build a sheet's
# runtime direction->state map (anim_map, see build_anim_map()).
SPRITE_ANIMATION_SLOTS = {
    "fixed": {"idle"},
    "fixed_movement": {"idle", "moving"},
    "horizontal": {"idleRight", "idleLeft"},
    "horizontal_movement": {"idleRight", "idleLeft", "movingRight", "movingLeft"},
    "multi": {"idleRight", "idleLeft", "idleUp", "idleDown"},
    "multi_movement": {"idleRight", "idleLeft", "idleUp", "idleDown",
                       "movingRight", "movingLeft", "movingUp", "movingDown"},
    "platform_player": {"idleRight", "idleLeft", "jumpingRight", "jumpingLeft",
                        "movingRight", "movingLeft", "climbing"},
    "cursor": {"idle", "hover"},
}

# engine/include/entity.h's Direction order - anim_map is indexed
# moving * 4 + direction.
ANIM_MAP_DIRS = ("Down", "Up", "Right", "Left")
ANIM_MAP_KEEP = 0xFF   # "keep whatever state is current" (entity.h ANIM_MAP_KEEP)


def build_anim_map(anim_type, slot_to_index):
    """Build the 8-entry runtime direction map for one sprite sheet
    (engine/include/entity.h's Entity.anim_map, indexed moving*4 + Direction,
    value = state index or ANIM_MAP_KEEP), from its slot-tagged states.
    Returns None when the sheet has no usable slot-tagged state (-> no map,
    the engine keeps its legacy behaviour).

    Only the slots `anim_type` defines (SPRITE_ANIMATION_SLOTS) are
    considered - a state left over from a previous animationType is not
    picked up; with no animationType at all, every slot is considered.
      idle[d]   = state for "idle<D>", else "idle" (fixed/cursor), else KEEP
      moving[d] = state for "moving<D>", else "moving" (fixed_movement),
                  else idle[d]
    So multi(_movement) maps all 4 directions; horizontal(_movement) and
    platform_player map Right/Left only (Up/Down = KEEP); fixed(_movement)
    and cursor map every direction to idle (and moving). jumping*/
    climbing/hover slots are NOT mapped (no jump/climb/hover state in the
    engine's movement code yet) - reachable via actor_set_state only."""
    allowed = SPRITE_ANIMATION_SLOTS.get(anim_type) if anim_type else None
    slots = {k: v for k, v in slot_to_index.items()
             if allowed is None or k in allowed}
    if not slots:
        return None
    idle = [slots.get("idle" + d, slots.get("idle", ANIM_MAP_KEEP)) for d in ANIM_MAP_DIRS]
    moving = [slots.get("moving" + d, slots.get("moving", idle[i]))
              for i, d in enumerate(ANIM_MAP_DIRS)]
    anim_map = idle + moving
    if all(v == ANIM_MAP_KEEP for v in anim_map):
        return None
    return anim_map


MAX_EVENT_FLAGS = 32   # one bit per named flag, in SaveData.flags
MAX_ITEMS = 32         # one bit per named item, in SaveData.inventory
MAX_VARIABLES = 256    # one int16_t per named variable, in SaveData.variables.
                        # No bitfield ceiling like flags/items - capped by
                        # dialogue "{name}" interpolation's one-byte variable
                        # index (dialogue.c's expand_marker()) instead.
                        # Keep in sync with MAX_VARIABLES in
                        # engine/include/state.h.
MAX_TIMERS = 8         # background timers per scene - keep in sync with
                        # MAX_TIMERS in engine/source/main.c
MAX_MENU_OPTIONS = 4   # keep in sync with MENU_MAX_OPTIONS in dialogue.c

# Event "play_sound" names -> engine/include/script.h SoundEffect constants.
SOUND_NAME_TO_CONST = {
    "blip": "SOUND_BLIP",
    "door": "SOUND_DOOR",
    "save": "SOUND_SAVE",
    "item": "SOUND_ITEM",
}

# Event "if_var" "op" -> engine/include/script.h ScriptOp constant. One op
# per comparison operator (folded into the opcode - see script.h).
VAR_OP_TO_SCRIPT = {
    "==": "SCRIPT_IF_VAR_EQ",
    "!=": "SCRIPT_IF_VAR_NE",
    "<":  "SCRIPT_IF_VAR_LT",
    "<=": "SCRIPT_IF_VAR_LE",
    ">":  "SCRIPT_IF_VAR_GT",
    ">=": "SCRIPT_IF_VAR_GE",
}

# Same, for when "value" is {"var": "<name>"} instead of a literal -
# picked automatically, see _var_or_literal()/compile_events()'s "if_var".
VAR_VAR_OP_TO_SCRIPT = {
    "==": "SCRIPT_IF_VAR_VAR_EQ",
    "!=": "SCRIPT_IF_VAR_VAR_NE",
    "<":  "SCRIPT_IF_VAR_VAR_LT",
    "<=": "SCRIPT_IF_VAR_VAR_LE",
    ">":  "SCRIPT_IF_VAR_VAR_GT",
    ">=": "SCRIPT_IF_VAR_VAR_GE",
}

# "math" event's "op" -> (literal-operand opcode, variable-operand
# opcode) - same paired-table shape as VAR_OP_TO_SCRIPT/
# VAR_VAR_OP_TO_SCRIPT above. "add" reuses add_var's own opcodes rather
# than getting new ones, since it's the exact same operation.
MATH_OP_TO_SCRIPT = {
    "add": ("SCRIPT_ADD_VAR", "SCRIPT_ADD_VAR_VAR"),
    "sub": ("SCRIPT_SUB_VAR", "SCRIPT_SUB_VAR_VAR"),
    "mul": ("SCRIPT_MUL_VAR", "SCRIPT_MUL_VAR_VAR"),
    "div": ("SCRIPT_DIV_VAR", "SCRIPT_DIV_VAR_VAR"),
    "mod": ("SCRIPT_MOD_VAR", "SCRIPT_MOD_VAR_VAR"),
}

# "array_var_math" event's "op" -> (literal-operand opcode,
# variable-operand opcode), same paired-table shape as MATH_OP_TO_SCRIPT
# above - "get" isn't here since it's a single opcode with no literal/
# variable operand split (see compile_events()'s "array_var_math" case).
ARRAY_OP_TO_SCRIPT = {
    "set": ("SCRIPT_ARRAY_SET", "SCRIPT_ARRAY_SET_VAR"),
    "add": ("SCRIPT_ARRAY_ADD", "SCRIPT_ARRAY_ADD_VAR"),
    "sub": ("SCRIPT_ARRAY_SUB", "SCRIPT_ARRAY_SUB_VAR"),
    "mul": ("SCRIPT_ARRAY_MUL", "SCRIPT_ARRAY_MUL_VAR"),
    "div": ("SCRIPT_ARRAY_DIV", "SCRIPT_ARRAY_DIV_VAR"),
    "mod": ("SCRIPT_ARRAY_MOD", "SCRIPT_ARRAY_MOD_VAR"),
}

# "fade_out"/"fade_in" events' "color" -> TransitionColor (see
# engine/include/transition.h).
FADE_COLOR_TO_SCRIPT = {"black": 0, "white": 1}

# Matches a "{varname}" reference inside text/prompt/option/label
# strings - see interpolate_vars().
VAR_REF_RE = re.compile(r"\{([^{}]+)\}")

# Event "wait_button" button names -> engine/include/input.h INPUT_* bits.
BUTTON_NAME_TO_CONST = {
    "a":      "INPUT_A",
    "b":      "INPUT_B",
    "select": "INPUT_SELECT",
    "start":  "INPUT_START",
    "right":  "INPUT_RIGHT",
    "left":   "INPUT_LEFT",
    "up":     "INPUT_UP",
    "down":   "INPUT_DOWN",
    "r":      "INPUT_R",
    "l":      "INPUT_L",
}

# int16_t range - set_var/add_var/if_var literal values must fit.
INT16_MIN, INT16_MAX = -32768, 32767

# Preview tint per collision type (RGBA overlay).
PREVIEW_COLORS = {
    1: (255, 0, 0, 110),
    2: (0, 80, 255, 110),
    3: (255, 160, 0, 110),
}


class BuildError(Exception):
    pass


# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------

def gba5(v):
    return (v * 31 + 127) // 255


def gba_color(rgb):
    r, g, b = rgb
    return gba5(r) | (gba5(g) << 5) | (gba5(b) << 10)


# ---------------------------------------------------------------------------
# Background conversion
# ---------------------------------------------------------------------------

def load_background(path):
    image = Image.open(path).convert("RGBA")
    w, h = image.size

    if w % TILE or h % TILE:
        raise BuildError(
            f"{path.name}: size {w}x{h} must be a multiple of 8.")

    if w // TILE > MAX_MAP_TILES or h // TILE > MAX_MAP_TILES:
        raise BuildError(
            f"{path.name}: {w}x{h} is larger than the "
            f"{MAX_MAP_TILES * TILE}x{MAX_MAP_TILES * TILE} build cap "
            "(MAX_MAP_TILES in build_project.py). Raise it if you need "
            "a bigger map.")

    return image


def most_common_color(pixels):
    counts = {}
    for p in pixels:
        counts[p] = counts.get(p, 0) + 1
    return max(counts, key=counts.get)


def flips(tile):
    """All 4 orientations of a tile: (pixels, hflip, vflip)."""
    rows = [tile[y * 8:(y + 1) * 8] for y in range(8)]

    def pack(rs):
        return tuple(p for r in rs for p in r)

    return [
        (pack(rows), 0, 0),
        (pack([r[::-1] for r in rows]), 1, 0),
        (pack(rows[::-1]), 0, 1),
        (pack([r[::-1] for r in rows[::-1]]), 1, 1),
    ]


def assign_banks(unique_tiles, backdrop, name, tile_positions, palette_map=None):
    """
    Pack tiles into up to MAX_BANKS palette banks of COLORS_PER_BANK colors
    each (plus the shared backdrop in slot 0). Returns (banks, tile_bank).

    `palette_map`, when given, is the editor's per-tile palette-id grid
    (rows of id-or-None, indexed [ty][tx] - see SceneJSON.palette_map in
    shared/projectTypes.ts and Navigator.tsx's palette-paint tool). Every
    tile whose position has a non-null id there is *forced* into a bank
    shared with every other tile carrying that same id, in first-seen
    order - the artist's explicit grouping is respected exactly rather
    than treated as a hint. Tiles with no forced id (every tile, for a
    project that doesn't use palette-painting) fall back to the original
    greedy best-fit packing, using only the banks left over after the
    forced ones - so a background with no palette map compiles identically
    to before this feature existed.
    """
    color_sets = []
    for i, tile in enumerate(unique_tiles):
        colors = set(tile) - {backdrop}
        if len(colors) > COLORS_PER_BANK:
            tx, ty = tile_positions[i]
            raise BuildError(
                f"{name}: tile at ({tx},{ty}) (pixels {tx*8},{ty*8}) "
                f"uses {len(colors) + 1} colors. Max is 16 per 8x8 tile.")
        color_sets.append(colors)

    banks = []                      # list of sets
    tile_bank = [0] * len(unique_tiles)

    # ---- Forced groups from the editor's palette map, if any. ----
    forced_of = {}                  # tile index -> palette id
    if palette_map:
        for i, (tx, ty) in enumerate(tile_positions):
            if ty < len(palette_map):
                row = palette_map[ty]
                if tx < len(row) and row[tx]:
                    forced_of[i] = row[tx]

    forced_ids = []                 # first-seen order
    for i in range(len(unique_tiles)):
        pid = forced_of.get(i)
        if pid is not None and pid not in forced_ids:
            forced_ids.append(pid)

    n_forced_banks = 0
    for pid in forced_ids:
        idxs = [i for i, p in forced_of.items() if p == pid]
        union = set()
        for i in idxs:
            union |= color_sets[i]
        if len(union) > COLORS_PER_BANK:
            raise BuildError(
                f"{name}: palette '{pid}' is painted over tiles that together "
                f"use {len(union)} colors; a palette bank holds at most "
                f"{COLORS_PER_BANK}. Split it across two palettes.")
        banks.append(union)
        for i in idxs:
            tile_bank[i] = len(banks) - 1
        n_forced_banks += 1

    if n_forced_banks > MAX_BANKS:
        raise BuildError(
            f"{name}: {n_forced_banks} palettes are used, more than the "
            f"{MAX_BANKS} palette banks available (1 of 16 is reserved for "
            "the dialogue font). Merge or remove some palettes.")

    # ---- Everything else: original greedy best-fit, restricted to the
    # banks left over after the forced ones (never grown into a forced
    # bank, so an explicit palette assignment is never silently altered).
    unforced = [i for i in range(len(unique_tiles)) if i not in forced_of]
    order = sorted(unforced, key=lambda i: -len(color_sets[i]))

    for i in order:
        colors = color_sets[i]
        best = None
        best_growth = None

        for b in range(n_forced_banks, len(banks)):
            bank = banks[b]
            union = bank | colors
            if len(union) <= COLORS_PER_BANK:
                growth = len(union) - len(bank)
                if best is None or growth < best_growth:
                    best, best_growth = b, growth

        if best is None:
            if len(banks) >= MAX_BANKS:
                raise BuildError(
                    f"{name}: needs more than {MAX_BANKS} palettes of "
                    f"{COLORS_PER_BANK} colors. Use fewer colors, share "
                    "colors between areas, or group more of the art with "
                    "the palette-paint tool.")
            banks.append(set())
            best = len(banks) - 1

        banks[best] |= colors
        tile_bank[i] = best

    # Stable color order inside each bank.
    bank_lists = [sorted(b) for b in banks] or [[]]
    return bank_lists, tile_bank


def convert_background(path, name, palette_map=None):
    image = load_background(path)
    w_tiles = image.width // TILE
    h_tiles = image.height // TILE

    # Transparent pixels count as the backdrop.
    data = image.tobytes()
    raw = [tuple(data[i:i + 4]) for i in range(0, len(data), 4)]
    solid = [p for p in raw if p[3] != 0]
    backdrop = most_common_color(
        [p[:3] for p in solid]) if solid else (0, 0, 0)

    def px(x, y):
        r, g, b, a = raw[y * image.width + x]
        return backdrop if a == 0 else (r, g, b)

    # Tile 0 is always a blank backdrop tile (used for padding).
    blank = tuple([backdrop] * 64)
    unique = [blank]
    unique_pos = [(0, 0)]
    lookup = {blank: (0, 0, 0)}     # pixels -> (index, hflip, vflip)

    cells = []                      # (tile_index, hflip, vflip) row-major

    for ty in range(h_tiles):
        for tx in range(w_tiles):
            tile = tuple(
                px(tx * 8 + x, ty * 8 + y)
                for y in range(8) for x in range(8))

            if tile in lookup:
                cells.append(lookup[tile])
                continue

            index = len(unique)
            unique.append(tile)
            unique_pos.append((tx, ty))

            # Register every flipped version so later copies reuse it.
            for pixels, hf, vf in flips(tile):
                if pixels not in lookup:
                    lookup[pixels] = (index, hf, vf)

            cells.append((index, 0, 0))

    if len(unique) > MAX_TILES:
        raise BuildError(
            f"{name}: {len(unique)} unique tiles, max is {MAX_TILES}. "
            "Reuse more 8x8 tiles in the art.")

    banks, tile_bank = assign_banks(unique, backdrop, name, unique_pos, palette_map)

    # Palette data: 16 colors per bank, slot 0 = backdrop.
    palette = []
    for bank in banks:
        entries = [gba_color(backdrop)] + [gba_color(c) for c in bank]
        entries += [0] * (16 - len(entries))
        palette.extend(entries)

    # 4bpp tile data.
    tile_bytes = []
    for i, tile in enumerate(unique):
        bank = banks[tile_bank[i]]
        idx = [0 if c == backdrop else 1 + bank.index(c) for c in tile]
        for j in range(0, 64, 2):
            tile_bytes.append(idx[j] | (idx[j + 1] << 4))

    # GBA screen entries: tile | hflip<<10 | vflip<<11 | bank<<12.
    screen = [
        t | (hf << 10) | (vf << 11) | (tile_bank[t] << 12)
        for t, hf, vf in cells
    ]

    return {
        "image": image,
        "width": w_tiles,
        "height": h_tiles,
        "tiles": tile_bytes,
        "tile_count": len(unique),
        "palette": palette,
        "palette_count": len(banks),
        "map": screen,
        "colors": 1 + len(set().union(*[set(b) for b in banks])),
    }


# ---------------------------------------------------------------------------
# Collision
# ---------------------------------------------------------------------------

def blank_collision(w, h):
    return ["." * w for _ in range(h)]


def parse_collision(rows, w, h, scene_name):
    if len(rows) != h or any(len(r) != w for r in rows):
        raise BuildError(
            f"{scene_name}: collision must be {h} rows of {w} characters "
            f"(got {len(rows)} rows).")

    grid = []
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch not in COLLISION_CHARS:
                raise BuildError(
                    f"{scene_name}: unknown collision '{ch}' at ({x},{y}). "
                    f"Use one of: {' '.join(COLLISION_CHARS)}")
            grid.append(COLLISION_CHARS[ch])
    return grid


def validate_doors(doors, scene_name, w, h, name_to_index):
    """
    Catch doors that can never fire, or that don't say what they do,
    before they reach the ROM.

    The player is 16x16 and triggers a door with its center point, so a
    door only one tile tall can be unreachable: the player's top half
    would have to sit in the wall above it.
    """
    for i, door in enumerate(doors):
        for key in ("x", "y"):
            if key not in door:
                raise BuildError(
                    f"{scene_name}: door {i} is missing \"{key}\".")

        dx, dy = int(door["x"]), int(door["y"])
        dw = int(door.get("width", 1))
        dh = int(door.get("height", 1))

        if dx < 0 or dy < 0 or dx + dw > w or dy + dh > h:
            raise BuildError(
                f"{scene_name}: door {i} at ({dx},{dy}) size {dw}x{dh} "
                f"falls outside the {w}x{h} tile map.")

        has_shorthand = "target_scene" in door
        has_events = "events" in door

        if has_shorthand and has_events:
            raise BuildError(
                f"{scene_name}: door {i} has both \"target_scene\" and "
                "\"events\" - use the target_scene/target_x/target_y "
                "shorthand for a simple warp, or a custom \"events\" "
                "script for anything else (a locked door, a message, "
                "etc), not both.")

        if not has_shorthand and not has_events:
            raise BuildError(
                f"{scene_name}: door {i} needs either \"target_scene\" "
                "(simple warp) or \"events\" (custom on_enter script).")

        if has_shorthand:
            target = door["target_scene"]
            if target not in name_to_index:
                known = ", ".join(sorted(name_to_index))
                raise BuildError(
                    f"{scene_name}: door {i} targets unknown scene "
                    f"'{target}'. Known scenes: {known}")

        if dh < 2:
            print(f"  WARNING: {scene_name} door {i} at ({dx},{dy}) is only "
                  "1 tile tall. The 16px player triggers doors with its "
                  "center, so this may be unreachable - use height 2.")


# ---------------------------------------------------------------------------
# Event scripts (see engine/include/script.h)
# ---------------------------------------------------------------------------
#
# compile_script() turns a JSON "events" list into a flat list of
# instruction dicts (one per ScriptEvent), fully resolved: flag/item
# names become bit indices, scene names become scene indices, and
# if_flag/if_item "then"/"else" blocks become instruction-index jumps.
# emit_script() then writes that list out as a static ScriptEvent[] array.

def _instr(op, a=0, b=0, c=0, text="0", d=0, ptr="0"):
    return {"op": op, "a": a, "b": b, "c": c, "d": d, "ptr": ptr, "str": text}


def _require(ev, key, where):
    if key not in ev:
        raise BuildError(f"{where}: missing \"{key}\".")
    return ev[key]


def resolve_flag(name, ctx, where):
    if name not in ctx["flag_names"]:
        known = ", ".join(ctx["flag_names"]) or "(none yet)"
        raise BuildError(
            f"{where}: unknown flag '{name}'. Add it to project.json's "
            f"\"flags\" list first. Known flags: {known}")
    return ctx["flag_names"].index(name)


def resolve_item(name, ctx, where):
    if name not in ctx["item_names"]:
        known = ", ".join(ctx["item_names"]) or "(none yet)"
        raise BuildError(
            f"{where}: unknown item '{name}'. Add it to project.json's "
            f"\"items\" list first. Known items: {known}")
    return ctx["item_names"].index(name)


def resolve_var(name, ctx, where):
    if name not in ctx["variable_names"]:
        known = ", ".join(ctx["variable_names"]) or "(none yet)"
        raise BuildError(
            f"{where}: unknown variable '{name}'. Add it to project.json's "
            f"\"variables\" list first. Known variables: {known}")
    return ctx["variable_names"].index(name)


def resolve_int16(value, field, where):
    if not isinstance(value, int) or isinstance(value, bool):
        raise BuildError(f"{where}: \"{field}\" must be an integer.")
    if value < INT16_MIN or value > INT16_MAX:
        raise BuildError(
            f"{where}: \"{field}\" ({value}) must fit in a 16-bit signed "
            f"integer ({INT16_MIN}..{INT16_MAX}).")
    return value


def resolve_small_int(value, field, where, lo, hi):
    if not isinstance(value, int) or isinstance(value, bool):
        raise BuildError(f"{where}: \"{field}\" must be an integer.")
    if value < lo or value > hi:
        raise BuildError(
            f"{where}: \"{field}\" ({value}) must be between {lo} and {hi}.")
    return value


def resolve_state(actor_idx, ref, ctx, where):
    """Resolve an "actor_set_state" event's "state" field (a name or an
    index) to its 0-based index within the target actor's sprite's
    authored states list (project.json "spriteSheets"[].states) - same
    shape as resolve_actor()/resolve_timer() above."""
    sprite_of = ctx.get("npc_sprite_of", {})
    sprite_name = sprite_of.get(actor_idx)
    names = ctx.get("sprite_state_names", {}).get(sprite_name, {})
    count = len(names)

    if not names:
        raise BuildError(
            f"{where}: actor's sprite '{sprite_name}' has no authored "
            "animation states. Add a \"states\" list to it under "
            "project.json's \"spriteSheets\" first.")

    if isinstance(ref, bool):
        raise BuildError(f"{where}: \"state\" must be a state name or index.")

    if isinstance(ref, int):
        if ref < 0 or ref >= count:
            raise BuildError(
                f"{where}: state index {ref} is out of range (sprite "
                f"'{sprite_name}' has {count} state(s)).")
        return ref

    if isinstance(ref, str):
        if ref not in names:
            known = ", ".join(sorted(names))
            raise BuildError(
                f"{where}: unknown state '{ref}' on sprite '{sprite_name}'. "
                f"Known states: {known}")
        return names[ref]

    raise BuildError(f"{where}: \"state\" must be a state name or index.")


# Sentinel actor index meaning "the player", not an NPC - must match
# PLAYER_ACTOR_INDEX in engine/include/actor.h exactly. Distinct from
# any real NPC index (always >= 0) and from -1 (used elsewhere as a
# "not locked"/"not moving" sentinel), so it can't collide with those.
PLAYER_ACTOR_INDEX = -2


def resolve_actor(ref, ctx, where):
    """Resolve an "actor" event field (a name, an index, "self", or
    "player") to the NPC's 0-based index within its scene's npcs[]
    list, or PLAYER_ACTOR_INDEX for "player" (see actor.h)."""
    if ref == "self":
        if ctx.get("self_actor_index") is None:
            raise BuildError(
                f"{where}: \"self\" only works inside an NPC's own "
                "on_interact script.")
        return ctx["self_actor_index"]

    if ref == "player":
        return PLAYER_ACTOR_INDEX

    npc_count = ctx.get("scene_npc_count", 0)

    if isinstance(ref, bool):
        raise BuildError(f"{where}: \"actor\" must be \"self\", \"player\", "
                          "a named actor, or an NPC index.")

    if isinstance(ref, int):
        if ref < 0 or ref >= npc_count:
            raise BuildError(
                f"{where}: actor index {ref} is out of range (this scene "
                f"has {npc_count} NPC(s)).")
        return ref

    if isinstance(ref, str):
        names = ctx.get("npc_name_to_index", {})
        if ref not in names:
            known = ", ".join(sorted(names)) or "(none named in this scene)"
            raise BuildError(
                f"{where}: unknown actor '{ref}'. Known named actors here: {known}")
        return names[ref]

    raise BuildError(f"{where}: \"actor\" must be \"self\", \"player\", a "
                      "named actor, or an NPC index.")


def resolve_timer(ref, ctx, where):
    """Resolve a "start_timer" event's "timer" field (a name or an
    index) to the timer's 0-based index within this scene's "timers"
    list - same shape as resolve_actor() above, minus the "self" case
    (a timer isn't tied to any one actor)."""
    timer_count = ctx.get("scene_timer_count", 0)

    if isinstance(ref, bool):
        raise BuildError(f"{where}: \"timer\" must be a name or an index.")

    if isinstance(ref, int):
        if ref < 0 or ref >= timer_count:
            raise BuildError(
                f"{where}: timer index {ref} is out of range (this scene "
                f"has {timer_count} timer(s)).")
        return ref

    if isinstance(ref, str):
        names = ctx.get("timer_name_to_index", {})
        if ref not in names:
            known = ", ".join(sorted(names)) or "(none named in this scene)"
            raise BuildError(
                f"{where}: unknown timer '{ref}'. Known named timers here: {known}")
        return names[ref]

    raise BuildError(f"{where}: \"timer\" must be a name or an index.")


def _var_or_literal(ev, field, ctx, where):
    """Resolve set_var/add_var/if_var's "value"/"delta" field, which may
    be a literal int16 or {"var": "<name>"} referencing another
    variable (compiled to a *_VAR_VAR_* / COPY_VAR / ADD_VAR_VAR op
    instead of the literal-value one - see compile_events()). Returns
    (is_var, resolved) - resolved is either the literal value or the
    other variable's index."""
    value = _require(ev, field, where)
    if isinstance(value, dict):
        if "var" not in value:
            raise BuildError(
                f"{where}: \"{field}\" object must have a \"var\" key "
                "(e.g. {{\"var\": \"other_score\"}}).")
        return True, resolve_var(value["var"], ctx, where)
    return False, resolve_int16(value, field, where)


def interpolate_vars(text, ctx, where):
    """Replace every "{varname}" in `text` with a 2-byte runtime marker
    (0x02 followed by the variable's index byte) that dialogue.c
    substitutes with that variable's current decimal value when it's
    actually shown - see script.h's ScriptEvent doc comment and
    dialogue.c's expand_word()/expand_range_text(). c_string_literal()
    (called afterwards, same as for any other text) already escapes
    these two non-printable bytes safely, including the "would be
    misread as a longer hex escape" case - nothing extra needed here."""
    def repl(match):
        idx = resolve_var(match.group(1), ctx, where)
        return "\x02" + chr(idx)

    return VAR_REF_RE.sub(repl, text)


def _button_mask(buttons, where):
    """A button name or list of names -> a C INPUT_* mask expression."""
    if isinstance(buttons, str):
        buttons = [buttons]
    if not isinstance(buttons, list) or not buttons:
        raise BuildError(
            f"{where}: \"buttons\" must be a button name, or a "
            "list of button names.")
    consts = []
    for b in buttons:
        name = str(b).strip().lower()
        const = BUTTON_NAME_TO_CONST.get(name)
        if const is None:
            known = ", ".join(sorted(BUTTON_NAME_TO_CONST))
            raise BuildError(
                f"{where}: unknown button '{b}'. Use one of: {known}")
        consts.append(const)
    return consts[0] if len(consts) == 1 else "(" + " | ".join(consts) + ")"


def _compile_branch(out, if_op, fields, jump_field, ev, ctx, where):
    """Shared if_flag/if_item/if_var logic: emit the IF (with `fields` as
    its fixed operands), compile "then" right after it, and - if "else"
    is present - a GOTO past it plus "else", patching both jump targets
    (the IF's `jump_field` operand, and the GOTO's target) to real
    instruction indices once the surrounding blocks' lengths are known."""
    if_index = len(out)
    out.append(_instr(if_op, **fields))

    compile_events(ev.get("then", []), out, ctx, where)

    if ev.get("else"):
        goto_index = len(out)
        out.append(_instr("SCRIPT_GOTO"))
        out[if_index][jump_field] = len(out)   # IF false -> start of else
        compile_events(ev["else"], out, ctx, where)
        out[goto_index]["a"] = len(out)        # end of then -> past else
    else:
        out[if_index][jump_field] = len(out)   # IF false -> straight past


def _compile_menu_chain(out, options, i, ctx, where):
    """Compile options[i:] (a "menu" event's option list) as a chain of
    SCRIPT_IF_MENU_EQ comparisons, one per option except the last -
    the last needs no comparison, it's just whatever's left once every
    other option has been ruled out (like a switch's default arm).
    Each option's own SCRIPT_GOTO, once patched, skips every option
    after it - same jump-patching idea as _compile_branch(), just
    chained instead of a single true/false split."""
    if i == len(options) - 1:
        compile_events(options[i].get("then", []), out, ctx, where)
        return

    if_index = len(out)
    out.append(_instr("SCRIPT_IF_MENU_EQ", a=i))

    compile_events(options[i].get("then", []), out, ctx, where)

    goto_index = len(out)
    out.append(_instr("SCRIPT_GOTO"))
    out[if_index]["b"] = len(out)   # not this option -> try the next one

    _compile_menu_chain(out, options, i + 1, ctx, where)

    out[goto_index]["a"] = len(out)   # end of this option's "then" -> past the rest


def compile_events(events, out, ctx, where):
    """Compile a JSON events list, appending ScriptEvent instruction dicts
    to `out` (a plain list shared across the whole script, including
    nested then/else blocks, so jump indices land on real positions)."""
    if not isinstance(events, list):
        raise BuildError(f"{where}: \"events\"/\"on_interact\" must be a list.")

    for i, ev in enumerate(events):
        if not isinstance(ev, dict) or "type" not in ev:
            raise BuildError(f"{where}: event {i} must be an object with a \"type\".")
        etype = ev["type"]
        ev_where = f"{where} event {i} ({etype})"

        if etype == "text":
            text = _require(ev, "text", ev_where)
            text = interpolate_vars(text, ctx, ev_where)
            out.append(_instr("SCRIPT_TEXT", text=c_string_literal(text)))

        elif etype == "set_flag":
            idx = resolve_flag(_require(ev, "flag", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_SET_FLAG", a=idx))

        elif etype == "clear_flag":
            idx = resolve_flag(_require(ev, "flag", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_CLEAR_FLAG", a=idx))

        elif etype == "if_flag":
            idx = resolve_flag(_require(ev, "flag", ev_where), ctx, ev_where)
            _compile_branch(out, "SCRIPT_IF_FLAG", {"a": idx}, "b", ev, ctx, ev_where)

        elif etype == "give_item":
            idx = resolve_item(_require(ev, "item", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_GIVE_ITEM", a=idx))

        elif etype == "if_item":
            idx = resolve_item(_require(ev, "item", ev_where), ctx, ev_where)
            _compile_branch(out, "SCRIPT_IF_ITEM", {"a": idx}, "b", ev, ctx, ev_where)

        elif etype == "play_sound":
            sound = str(_require(ev, "sound", ev_where)).strip().lower()
            const = SOUND_NAME_TO_CONST.get(sound)
            if const is None:
                known = ", ".join(sorted(SOUND_NAME_TO_CONST))
                raise BuildError(f"{ev_where}: unknown sound '{sound}'. Use one of: {known}")
            out.append(_instr("SCRIPT_PLAY_SOUND", a=const))

        elif etype == "wait":
            frames = ev.get("frames")
            if not isinstance(frames, int) or isinstance(frames, bool) or frames < 0:
                raise BuildError(f"{ev_where}: \"frames\" must be a non-negative integer.")
            out.append(_instr("SCRIPT_WAIT", a=frames))

        elif etype == "switch_scene":
            scene_name = _require(ev, "scene", ev_where)
            if scene_name not in ctx["name_to_index"]:
                known = ", ".join(sorted(ctx["name_to_index"]))
                raise BuildError(
                    f"{ev_where}: unknown scene '{scene_name}'. Known scenes: {known}")
            tx = int(ev.get("x", 0)) * TILE
            ty = int(ev.get("y", 0)) * TILE
            out.append(_instr("SCRIPT_SWITCH_SCENE",
                              a=ctx["name_to_index"][scene_name], b=tx, c=ty, d=-1))

        elif etype == "set_var":
            idx = resolve_var(_require(ev, "var", ev_where), ctx, ev_where)
            is_var, val = _var_or_literal(ev, "value", ctx, ev_where)
            if is_var:
                out.append(_instr("SCRIPT_COPY_VAR", a=idx, b=val))
            else:
                out.append(_instr("SCRIPT_SET_VAR", a=idx, b=val))

        elif etype == "add_var":
            idx = resolve_var(_require(ev, "var", ev_where), ctx, ev_where)
            is_var, val = _var_or_literal(ev, "delta", ctx, ev_where)
            if is_var:
                out.append(_instr("SCRIPT_ADD_VAR_VAR", a=idx, b=val))
            else:
                out.append(_instr("SCRIPT_ADD_VAR", a=idx, b=val))

        elif etype == "if_var":
            idx = resolve_var(_require(ev, "var", ev_where), ctx, ev_where)
            op = _require(ev, "op", ev_where)
            is_var, val = _var_or_literal(ev, "value", ctx, ev_where)
            if_op = (VAR_VAR_OP_TO_SCRIPT if is_var else VAR_OP_TO_SCRIPT).get(op)
            if if_op is None:
                known = ", ".join(VAR_OP_TO_SCRIPT)
                raise BuildError(f"{ev_where}: unknown \"op\" '{op}'. Use one of: {known}")
            _compile_branch(out, if_op, {"a": idx, "b": val}, "c", ev, ctx, ev_where)

        elif etype == "random_var":
            idx = resolve_var(_require(ev, "var", ev_where), ctx, ev_where)
            vmin = resolve_int16(_require(ev, "min", ev_where), "min", ev_where)
            vmax = resolve_int16(_require(ev, "max", ev_where), "max", ev_where)
            if vmax < vmin:
                raise BuildError(
                    f"{ev_where}: \"max\" ({vmax}) must be >= \"min\" ({vmin}).")
            out.append(_instr("SCRIPT_RANDOM_VAR", a=idx, b=vmin, c=vmax))

        elif etype == "actor_show":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_ACTOR_SHOW", a=idx))

        elif etype == "actor_hide":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_ACTOR_HIDE", a=idx))

        elif etype == "actor_set_position":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            x = int(ev.get("x", 0)) * TILE
            y = int(ev.get("y", 0)) * TILE
            out.append(_instr("SCRIPT_ACTOR_SET_POSITION", a=idx, b=x, c=y))

        elif etype == "actor_set_direction":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            dir_name = str(_require(ev, "direction", ev_where)).lower()
            if dir_name not in DIRECTION_MAP:
                raise BuildError(
                    f"{ev_where}: unknown direction '{dir_name}'. "
                    "Use: down, up, right, left.")
            out.append(_instr("SCRIPT_ACTOR_SET_DIRECTION", a=idx, b=DIRECTION_MAP[dir_name]))

        elif etype == "actor_set_state":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            state_idx = resolve_state(idx, _require(ev, "state", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_ACTOR_SET_STATE", a=idx, b=state_idx))

        elif etype == "actor_set_animate":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            enabled = 1 if ev.get("enabled", True) else 0
            out.append(_instr("SCRIPT_ACTOR_SET_ANIMATE", a=idx, b=enabled))

        elif etype == "actor_set_frame":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            frame = resolve_small_int(_require(ev, "frame", ev_where), "frame", ev_where, 0, 255)
            out.append(_instr("SCRIPT_ACTOR_SET_FRAME", a=idx, b=frame))

        elif etype == "actor_set_collision_box":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            ox = resolve_small_int(ev.get("x", 0), "x", ev_where, -128, 127)
            oy = resolve_small_int(ev.get("y", 0), "y", ev_where, -128, 127)
            w = resolve_small_int(_require(ev, "width", ev_where), "width", ev_where, 0, 255)
            h = resolve_small_int(_require(ev, "height", ev_where), "height", ev_where, 0, 255)
            # Pack two bytes per operand (ScriptEvent only has a/b/c) - see
            # script.h's SCRIPT_ACTOR_SET_COLLISION_BOX doc comment and
            # script.c's matching unpack.
            b_expr = f"(({ox} & 0xFF) | (({oy} & 0xFF) << 8))"
            c_expr = f"(({w} & 0xFF) | (({h} & 0xFF) << 8))"
            out.append(_instr("SCRIPT_ACTOR_SET_COLLISION_BOX", a=idx, b=b_expr, c=c_expr))

        elif etype == "actor_move_to":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            x = int(ev.get("x", 0)) * TILE
            y = int(ev.get("y", 0)) * TILE
            out.append(_instr("SCRIPT_ACTOR_MOVE_TO", a=idx, b=x, c=y))

        elif etype == "wait_button":
            mask_expr = _button_mask(ev.get("buttons"), ev_where)
            out.append(_instr("SCRIPT_WAIT_BUTTON", a=mask_expr))

        elif etype == "choice":
            prompt = _require(ev, "prompt", ev_where)
            options = ev.get("options")
            if not isinstance(options, list) or len(options) != 2:
                raise BuildError(
                    f"{ev_where}: \"options\" must be a list of exactly 2 "
                    "strings - choice is yes/no-style, not a general menu.")
            for opt in options:
                if not isinstance(opt, str):
                    raise BuildError(f"{ev_where}: \"options\" entries must be strings.")
            prompt = interpolate_vars(prompt, ctx, ev_where)
            options = [interpolate_vars(o, ctx, ev_where) for o in options]
            packed = f"{prompt}\x01{options[0]}\x01{options[1]}"
            _compile_branch(
                out, "SCRIPT_CHOICE", {"text": c_string_literal(packed)}, "b",
                ev, ctx, ev_where)

        elif etype == "menu":
            options = ev.get("options")
            if not isinstance(options, list) or not (2 <= len(options) <= MAX_MENU_OPTIONS):
                raise BuildError(
                    f"{ev_where}: \"options\" must be a list of 2 to "
                    f"{MAX_MENU_OPTIONS} entries.")
            for opt in options:
                if not isinstance(opt, dict) or "label" not in opt:
                    raise BuildError(
                        f"{ev_where}: each menu option must be an object "
                        "with a \"label\" (and optionally \"then\").")
                if not isinstance(opt["label"], str):
                    raise BuildError(f"{ev_where}: menu option \"label\" must be a string.")

            labels = [interpolate_vars(opt["label"], ctx, ev_where) for opt in options]
            packed = "\x01".join(labels)
            out.append(_instr("SCRIPT_MENU", a=len(options), text=c_string_literal(packed)))
            _compile_menu_chain(out, options, 0, ctx, ev_where)

        elif etype == "start_timer":
            idx = resolve_timer(_require(ev, "timer", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_START_TIMER", a=idx))

        elif etype == "camera_lock_actor":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_CAMERA_LOCK_ACTOR", a=idx))

        elif etype == "camera_lock_point":
            x = int(_require(ev, "x", ev_where)) * TILE
            y = int(_require(ev, "y", ev_where)) * TILE
            out.append(_instr("SCRIPT_CAMERA_LOCK_POINT", b=x, c=y))

        elif etype == "camera_move_to":
            x = int(_require(ev, "x", ev_where)) * TILE
            y = int(_require(ev, "y", ev_where)) * TILE
            out.append(_instr("SCRIPT_CAMERA_MOVE_TO", b=x, c=y))

        elif etype == "camera_release":
            out.append(_instr("SCRIPT_CAMERA_RELEASE"))

        elif etype == "call_script":
            script_id = _require(ev, "script", ev_where)
            custom_scripts = ctx.get("custom_scripts", {})
            if script_id not in custom_scripts:
                known = ", ".join(sorted(custom_scripts)) or "(none defined)"
                raise BuildError(
                    f"{ev_where}: unknown custom script '{script_id}'. "
                    f"Known custom scripts: {known}")

            call_stack = ctx.setdefault("_call_stack", [])
            if script_id in call_stack:
                chain = " -> ".join(call_stack + [script_id])
                raise BuildError(
                    f"{ev_where}: custom script call cycle: {chain}. "
                    "A custom script can't call itself, directly or "
                    "through another custom script.")
            call_stack.append(script_id)
            try:
                # Inline-expand: splice a compiled copy of the target
                # script's events in place, like a macro/include - no new
                # VM opcode or call stack needed in the C engine.
                compile_events(
                    custom_scripts[script_id], out, ctx,
                    f"{ev_where} -> custom script '{script_id}'")
            finally:
                call_stack.pop()

        elif etype == "comment":
            pass   # editor-only note, no runtime effect

        elif etype == "group":
            # Pure organizational wrapper - inline-splice its children
            # straight into the surrounding script, like call_script's
            # macro-expansion, but with no cycle risk (children can't
            # reference the group itself).
            compile_events(ev.get("children", []), out, ctx, ev_where)

        elif etype == "loop":
            body_start = len(out)
            compile_events(ev.get("body", []), out, ctx, ev_where)
            out.append(_instr("SCRIPT_GOTO", a=body_start))

        elif etype == "stop_script":
            # A real SCRIPT_END anywhere in the flat instruction array
            # halts the script the instant the interpreter reaches it -
            # see script.c's script_update() loop condition - so this
            # needs no new opcode, jump, or special engine handling.
            out.append(_instr("SCRIPT_END"))

        elif etype == "math":
            idx = resolve_var(_require(ev, "var", ev_where), ctx, ev_where)
            op = _require(ev, "op", ev_where)
            is_var, val = _var_or_literal(ev, "value", ctx, ev_where)
            ops = MATH_OP_TO_SCRIPT.get(op)
            if ops is None:
                known = ", ".join(MATH_OP_TO_SCRIPT)
                raise BuildError(f"{ev_where}: unknown \"op\" '{op}'. Use one of: {known}")
            literal_op, var_op = ops
            out.append(_instr(var_op if is_var else literal_op, a=idx, b=val))

        elif etype == "actor_get_position":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            vx = resolve_var(_require(ev, "varX", ev_where), ctx, ev_where)
            vy = resolve_var(_require(ev, "varY", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_ACTOR_GET_POSITION", a=idx, b=vx, c=vy))

        elif etype == "actor_get_direction":
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            v = resolve_var(_require(ev, "var", ev_where), ctx, ev_where)
            out.append(_instr("SCRIPT_ACTOR_GET_DIRECTION", a=idx, b=v))

        elif etype == "camera_shake":
            frames = resolve_small_int(_require(ev, "frames", ev_where), "frames", ev_where, 0, 32767)
            magnitude = resolve_small_int(ev.get("magnitude", 2), "magnitude", ev_where, 0, 127)
            out.append(_instr("SCRIPT_CAMERA_SHAKE", a=frames, b=magnitude))

        elif etype == "array_var_math":
            base_idx = resolve_var(_require(ev, "array", ev_where), ctx, ev_where)
            index_idx = resolve_var(_require(ev, "index", ev_where), ctx, ev_where)
            op = _require(ev, "op", ev_where)
            if op == "get":
                out_idx = resolve_var(_require(ev, "output", ev_where), ctx, ev_where)
                out.append(_instr("SCRIPT_ARRAY_GET_VAR", a=base_idx, b=index_idx, c=out_idx))
            else:
                ops = ARRAY_OP_TO_SCRIPT.get(op)
                if ops is None:
                    known = ", ".join(["get", *ARRAY_OP_TO_SCRIPT])
                    raise BuildError(f"{ev_where}: unknown \"op\" '{op}'. Use one of: {known}")
                literal_op, var_op = ops
                is_var, val = _var_or_literal(ev, "value", ctx, ev_where)
                out.append(_instr(var_op if is_var else literal_op, a=base_idx, b=index_idx, c=val))

        elif etype in ("fade_out", "fade_in"):
            color = str(ev.get("color", "black")).lower()
            if color not in FADE_COLOR_TO_SCRIPT:
                raise BuildError(f"{ev_where}: unknown \"color\" '{color}'. Use \"black\" or \"white\".")
            frames = resolve_small_int(_require(ev, "frames", ev_where), "frames", ev_where, 1, 32767)
            wait = 1 if ev.get("wait", True) else 0
            op_name = "SCRIPT_FADE_OUT" if etype == "fade_out" else "SCRIPT_FADE_IN"
            out.append(_instr(op_name, a=FADE_COLOR_TO_SCRIPT[color], b=frames, c=wait))

        elif etype == "play_music":
            track = _require(ev, "track", ev_where)
            if not isinstance(track, str) or not track.strip():
                raise BuildError(f"{ev_where}: \"track\" must be a non-empty music asset name.")
            loop = 1 if ev.get("loop", True) else 0
            out.append(_instr("SCRIPT_PLAY_MUSIC", a=music_track_const(track), b=loop))

        elif etype == "stop_music":
            out.append(_instr("SCRIPT_STOP_MUSIC"))

        elif compile_parity_event(etype, ev, out, ctx, ev_where):
            pass

        else:
            raise BuildError(
                f"{ev_where}: unknown event type '{etype}'. Use one of: "
                "text, set_flag, clear_flag, if_flag, give_item, if_item, "
                "play_sound, wait, switch_scene, set_var, add_var, if_var, "
                "random_var, actor_show, actor_hide, actor_set_position, "
                "actor_set_direction, actor_set_state, actor_set_animate, "
                "actor_set_frame, actor_set_collision_box, actor_move_to, "
                "wait_button, choice, menu, "
                "start_timer, camera_lock_actor, camera_lock_point, "
                "camera_move_to, camera_release, call_script, "
                "comment, group, loop, stop_script, math, "
                "actor_get_position, actor_get_direction, camera_shake, "
                "array_var_math, fade_out, fade_in, play_music, stop_music, "
                f"{', '.join(PARITY_EVENT_TYPES)}.")

    return out


# ---------------------------------------------------------------------------
# GB Studio parity events - the ones that emit the ops added after
# SCRIPT_STOP_MUSIC in script.h (expressions, threads, timer/input/music-
# routine scripts, save slots, the scene stack, ...), plus events that
# lower onto older ops (labels, switch, compile-time device checks).
# ---------------------------------------------------------------------------

POSITION_UNITS = {"tiles": TILE, "pixels": 1}

COMPARE_TO_EXPR = {
    "==": "EXPR_EQ", "!=": "EXPR_NE", "<": "EXPR_LT",
    "<=": "EXPR_LE", ">": "EXPR_GT", ">=": "EXPR_GE",
}

TIMER_SCRIPT_SLOTS = 4          # script.c's TIMER_SLOTS
MUSIC_ROUTINES = 16
SAVE_SLOT_COUNT = 3             # save.h's SAVE_SLOT_COUNT
PALETTE_TARGETS = {"background": 0, "sprite": 1}
HEX_COLOR_RE = re.compile(r"^#?([0-9a-fA-F]{6})$")


def _units_scale(ev, where):
    units = str(ev.get("units", "tiles")).lower()
    if units not in POSITION_UNITS:
        raise BuildError(f"{where}: unknown \"units\" '{units}'. Use \"tiles\" or \"pixels\".")
    return POSITION_UNITS[units]


def _value_node(ev, field, ctx, where, default=None):
    """A VarOrLiteral field as an expression node."""
    if field not in ev and default is not None:
        return X.const(default)
    is_var, val = _var_or_literal(ev, field, ctx, where)
    return X.var(val) if is_var else X.const(val)


def _bits_mask(ev, field, where):
    """"bits": [0..15] -> the int16 value with those bits set."""
    bits = _require(ev, field, where)
    if isinstance(bits, int) and not isinstance(bits, bool):
        bits = [bits]
    if not isinstance(bits, list):
        raise BuildError(f"{where}: \"{field}\" must be a list of bit numbers 0-15.")
    mask = 0
    for b in bits:
        mask |= 1 << resolve_small_int(b, field, where, 0, 15)
    return mask - 0x10000 if mask & 0x8000 else mask


def _slot(ev, where, field="slot"):
    return resolve_small_int(ev.get(field, 0), field, where, 0, SAVE_SLOT_COUNT - 1)


def _timer_slot(ev, where):
    # 1-based in JSON, like GB Studio's Timer 1-4.
    return resolve_small_int(ev.get("timer", 1), "timer", where, 1, TIMER_SCRIPT_SLOTS) - 1


def _expr_branch(out, node, ev, ctx, where):
    """if/else on an expression (string or AST node)."""
    ptr = emit_expr(ctx, node, where)
    _compile_branch(out, "SCRIPT_IF_EXPR", {"ptr": ptr}, "b", ev, ctx, where)


def _loop_on_expr(out, node, body, ctx, where, step=None):
    """while (node) { body; step }"""
    top = len(out)
    ptr = emit_expr(ctx, node, where)
    if_index = len(out)
    out.append(_instr("SCRIPT_IF_EXPR", ptr=ptr))
    compile_events(body or [], out, ctx, where)
    if step:
        out.append(step)
    out.append(_instr("SCRIPT_GOTO", a=top))
    out[if_index]["b"] = len(out)


# Every event type compile_parity_event() handles (for error messages).
PARITY_EVENT_TYPES = [
    "if_expression", "set_var_expression", "loop_while", "loop_for",
    "set_var_true", "set_var_false", "var_inc", "var_dec", "if_var_true",
    "if_var_false", "var_set_flags", "var_add_flags", "var_clear_flags",
    "if_var_flags", "vars_reset", "seed_rng", "rate_limit", "label", "goto",
    "switch", "if_color_supported", "if_device_gba", "if_device_sgb",
    "actor_invoke", "thread_start", "thread_stop", "timer_script_set",
    "timer_restart", "timer_disable", "input_script_set",
    "input_script_remove", "music_routine", "actor_set_position_vars",
    "actor_move_to_vars", "actor_set_position_relative",
    "actor_move_relative", "actor_set_frame_var", "actor_set_move_speed",
    "actor_set_anim_speed", "actor_set_collisions", "actor_push",
    "if_actor_at_position", "if_actor_direction", "if_actor_distance",
    "if_actor_relative", "if_input", "if_current_scene", "scene_push",
    "scene_pop", "scene_pop_all", "scene_reset", "data_save", "data_load",
    "data_clear", "if_data_saved", "data_peek", "sprites_show",
    "sprites_hide", "palette_set", "replace_tile", "sound_tone", "sound_beep",
    "sound_crash", "mute_channel", "idle",
]


def compile_parity_event(etype, ev, out, ctx, where):
    """Compile one of the GB Studio parity events. Returns False if
    `etype` isn't one of them."""

    # ---- Expressions ----
    if etype == "if_expression":
        _expr_branch(out, _require(ev, "expression", where), ev, ctx, where)

    elif etype == "set_var_expression":
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        ptr = emit_expr(ctx, _require(ev, "expression", where), where)
        out.append(_instr("SCRIPT_SET_VAR_EXPR", a=idx, ptr=ptr))

    elif etype == "loop_while":
        _loop_on_expr(out, _require(ev, "expression", where), ev.get("body"), ctx, where)

    elif etype == "loop_for":
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        is_var, start = _var_or_literal(ev, "from", ctx, where)
        out.append(_instr("SCRIPT_COPY_VAR" if is_var else "SCRIPT_SET_VAR", a=idx, b=start))
        cmp = COMPARE_TO_EXPR.get(ev.get("comparison", "<="))
        if cmp is None:
            raise BuildError(f"{where}: unknown \"comparison\" '{ev.get('comparison')}'. "
                             f"Use one of: {', '.join(COMPARE_TO_EXPR)}")
        ops = MATH_OP_TO_SCRIPT.get(ev.get("stepOp", "add"))
        if ops is None:
            raise BuildError(f"{where}: unknown \"stepOp\" '{ev.get('stepOp')}'. "
                             f"Use one of: {', '.join(MATH_OP_TO_SCRIPT)}")
        if "step" in ev:
            step_is_var, step = _var_or_literal(ev, "step", ctx, where)
        else:
            step_is_var, step = False, 1
        step_ins = _instr(ops[1] if step_is_var else ops[0], a=idx, b=step)
        node = X.op(cmp, X.var(idx), _value_node(ev, "to", ctx, where))
        _loop_on_expr(out, node, ev.get("body"), ctx, where, step=step_ins)

    # ---- Variables ----
    elif etype in ("set_var_true", "set_var_false"):
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        out.append(_instr("SCRIPT_SET_VAR", a=idx, b=1 if etype == "set_var_true" else 0))

    elif etype in ("var_inc", "var_dec"):
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        out.append(_instr("SCRIPT_ADD_VAR", a=idx, b=1 if etype == "var_inc" else -1))

    elif etype in ("if_var_true", "if_var_false"):
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        if_op = "SCRIPT_IF_VAR_NE" if etype == "if_var_true" else "SCRIPT_IF_VAR_EQ"
        _compile_branch(out, if_op, {"a": idx, "b": 0}, "c", ev, ctx, where)

    elif etype == "var_set_flags":
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        out.append(_instr("SCRIPT_SET_VAR", a=idx, b=_bits_mask(ev, "bits", where)))

    elif etype in ("var_add_flags", "var_clear_flags"):
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        mask = _bits_mask(ev, "bits", where)
        if etype == "var_add_flags":
            node = X.op("EXPR_BOR", X.var(idx), X.const(mask))
        else:
            node = X.op("EXPR_BAND", X.var(idx), X.const(~mask))
        out.append(_instr("SCRIPT_SET_VAR_EXPR", a=idx, ptr=emit_expr(ctx, node, where)))

    elif etype == "if_var_flags":
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        mask = _bits_mask(ev, "bits", where)
        node = X.op("EXPR_EQ", X.op("EXPR_BAND", X.var(idx), X.const(mask)), X.const(mask))
        _expr_branch(out, node, ev, ctx, where)

    elif etype == "vars_reset":
        out.append(_instr("SCRIPT_VARS_RESET"))

    elif etype == "seed_rng":
        out.append(_instr("SCRIPT_SEED_RNG"))

    # ---- Control flow ----
    elif etype == "rate_limit":
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        frames = resolve_small_int(ev.get("frames", 30), "frames", where, 1, INT16_MAX)
        rl_index = len(out)
        out.append(_instr("SCRIPT_RATE_LIMIT", a=idx, b=frames))
        compile_events(ev.get("body", []), out, ctx, where)
        out[rl_index]["c"] = len(out)

    elif etype == "label":
        name = _require(ev, "label", where)
        if not isinstance(name, str) or not name.strip():
            raise BuildError(f"{where}: \"label\" must be a non-empty name.")
        defined = ctx["_labels"]["defined"]
        if name in defined:
            raise BuildError(f"{where}: label '{name}' is defined twice in this script.")
        defined[name] = len(out)

    elif etype == "goto":
        name = _require(ev, "label", where)
        ctx["_labels"]["gotos"].append((len(out), name, where))
        out.append(_instr("SCRIPT_GOTO"))

    elif etype == "switch":
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        cases = ev.get("cases", [])
        if not isinstance(cases, list):
            raise BuildError(f"{where}: \"cases\" must be a list.")
        end_gotos = []
        seen = set()
        for ci, case in enumerate(cases):
            case_where = f"{where} case {ci}"
            if not isinstance(case, dict):
                raise BuildError(f"{case_where}: must be an object with a \"value\".")
            value = resolve_int16(_require(case, "value", case_where), "value", case_where)
            if value in seen:
                raise BuildError(f"{case_where}: value {value} already has a case.")
            seen.add(value)
            if_index = len(out)
            out.append(_instr("SCRIPT_IF_VAR_EQ", a=idx, b=value))
            compile_events(case.get("then", []), out, ctx, case_where)
            end_gotos.append(len(out))
            out.append(_instr("SCRIPT_GOTO"))
            out[if_index]["c"] = len(out)
        compile_events(ev.get("else", []), out, ctx, f"{where} else")
        for g in end_gotos:
            out[g]["a"] = len(out)

    elif etype in ("if_color_supported", "if_device_gba"):
        # Always true on a GBA - resolved at compile time.
        compile_events(ev.get("then", []), out, ctx, where)

    elif etype == "if_device_sgb":
        compile_events(ev.get("else", []), out, ctx, where)

    # ---- Scripts / threads ----
    elif etype == "actor_invoke":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        if idx < 0:
            raise BuildError(f"{where}: \"actor\" must be an NPC - the player has no "
                             "on_interact script to invoke.")
        events = ctx.get("npc_events", {}).get(idx)
        if events:
            stack = ctx.setdefault("_invoke_stack", [])
            if idx in stack:
                raise BuildError(f"{where}: NPC {idx}'s on_interact invokes itself "
                                 "(directly or through another actor_invoke).")
            stack.append(idx)
            saved_self = ctx.get("self_actor_index")
            ctx["self_actor_index"] = idx
            try:
                compile_events(events, out, ctx, f"{where} -> NPC {idx} on_interact")
            finally:
                ctx["self_actor_index"] = saved_self
                stack.pop()

    elif etype == "thread_start":
        handle_var = ev.get("var")
        a = resolve_var(handle_var, ctx, where) if handle_var else -1
        ptr = compile_subscript(ev.get("script", []), ctx, where)
        out.append(_instr("SCRIPT_THREAD_START", a=a, ptr=ptr))

    elif etype == "thread_stop":
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        out.append(_instr("SCRIPT_THREAD_STOP", a=idx))

    elif etype == "timer_script_set":
        slot = _timer_slot(ev, where)
        frames = resolve_small_int(_require(ev, "frames", where), "frames", where, 1, INT16_MAX)
        ptr = compile_subscript(ev.get("script", []), ctx, where)
        out.append(_instr("SCRIPT_TIMER_SET", a=slot, b=frames, ptr=ptr))

    elif etype == "timer_restart":
        out.append(_instr("SCRIPT_TIMER_RESTART", a=_timer_slot(ev, where)))

    elif etype == "timer_disable":
        out.append(_instr("SCRIPT_TIMER_DISABLE", a=_timer_slot(ev, where)))

    elif etype == "input_script_set":
        mask = _button_mask(ev.get("buttons"), where)
        override = 1 if ev.get("override", False) else 0
        ptr = compile_subscript(ev.get("script", []), ctx, where)
        out.append(_instr("SCRIPT_INPUT_SCRIPT_SET", a=mask, b=override, ptr=ptr))

    elif etype == "input_script_remove":
        out.append(_instr("SCRIPT_INPUT_SCRIPT_REMOVE", a=_button_mask(ev.get("buttons"), where)))

    elif etype == "music_routine":
        routine = resolve_small_int(ev.get("routine", 0), "routine", where, 0, MUSIC_ROUTINES - 1)
        ptr = compile_subscript(ev.get("script", []), ctx, where)
        out.append(_instr("SCRIPT_MUSIC_ROUTINE", a=routine, ptr=ptr))

    # ---- Actors ----
    elif etype in ("actor_set_position_vars", "actor_move_to_vars"):
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        vx = resolve_var(_require(ev, "varX", where), ctx, where)
        vy = resolve_var(_require(ev, "varY", where), ctx, where)
        pixels = 1 if _units_scale(ev, where) == 1 else 0
        op_name = ("SCRIPT_ACTOR_SET_POSITION_VARS" if etype == "actor_set_position_vars"
                   else "SCRIPT_ACTOR_MOVE_TO_VARS")
        out.append(_instr(op_name, a=idx, b=vx, c=vy, d=pixels))

    elif etype in ("actor_set_position_relative", "actor_move_relative"):
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        scale = _units_scale(ev, where)
        dx = resolve_int16(ev.get("x", 0) * scale, "x", where)
        dy = resolve_int16(ev.get("y", 0) * scale, "y", where)
        op_name = ("SCRIPT_ACTOR_SET_POSITION_REL" if etype == "actor_set_position_relative"
                   else "SCRIPT_ACTOR_MOVE_REL")
        out.append(_instr(op_name, a=idx, b=dx, c=dy))

    elif etype == "actor_set_frame_var":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        v = resolve_var(_require(ev, "var", where), ctx, where)
        out.append(_instr("SCRIPT_ACTOR_SET_FRAME_VAR", a=idx, b=v))

    elif etype == "actor_set_move_speed":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        speed = resolve_small_int(_require(ev, "speed", where), "speed", where, 1, 8)
        out.append(_instr("SCRIPT_ACTOR_SET_MOVE_SPEED", a=idx, b=speed))

    elif etype == "actor_set_anim_speed":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        speed = resolve_small_int(_require(ev, "speed", where), "speed", where, 0, 255)
        out.append(_instr("SCRIPT_ACTOR_SET_ANIM_SPEED", a=idx, b=speed))

    elif etype == "actor_set_collisions":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        out.append(_instr("SCRIPT_ACTOR_SET_COLLISIONS", a=idx, b=1 if ev.get("enabled", True) else 0))

    elif etype == "actor_push":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        out.append(_instr("SCRIPT_ACTOR_PUSH", a=idx, b=1 if ev.get("continue", False) else 0))

    elif etype == "if_actor_at_position":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        scale = _units_scale(ev, where)
        x = resolve_int16(_require(ev, "x", where) * scale, "x", where)
        y = resolve_int16(_require(ev, "y", where) * scale, "y", where)
        node = X.op("EXPR_AND",
                    X.op("EXPR_EQ", X.op("EXPR_ACTOR_X", X.const(idx)), X.const(x)),
                    X.op("EXPR_EQ", X.op("EXPR_ACTOR_Y", X.const(idx)), X.const(y)))
        _expr_branch(out, node, ev, ctx, where)

    elif etype == "if_actor_direction":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        dir_name = str(_require(ev, "direction", where)).lower()
        if dir_name not in DIRECTION_MAP:
            raise BuildError(f"{where}: unknown direction '{dir_name}'. Use: down, up, right, left.")
        node = X.op("EXPR_EQ", X.op("EXPR_ACTOR_DIR", X.const(idx)), X.const(DIRECTION_MAP[dir_name]))
        _expr_branch(out, node, ev, ctx, where)

    elif etype == "if_actor_distance":
        # Like GB Studio: both positions in whole tiles, then compare the
        # squared Euclidean distance against distance squared.
        a = resolve_actor(_require(ev, "actor", where), ctx, where)
        b = resolve_actor(_require(ev, "other", where), ctx, where)
        cmp = COMPARE_TO_EXPR.get(ev.get("op", "<="))
        if cmp is None:
            raise BuildError(f"{where}: unknown \"op\" '{ev.get('op')}'. "
                             f"Use one of: {', '.join(COMPARE_TO_EXPR)}")

        def tiles(tok, actor):
            return X.op("EXPR_SHR", X.op(tok, X.const(actor)), X.const(3))

        dx = X.op("EXPR_SUB", tiles("EXPR_ACTOR_X", a), tiles("EXPR_ACTOR_X", b))
        dy = X.op("EXPR_SUB", tiles("EXPR_ACTOR_Y", a), tiles("EXPR_ACTOR_Y", b))
        dist = _value_node(ev, "distance", ctx, where)
        node = X.op(cmp,
                    X.op("EXPR_ADD", X.op("EXPR_MUL", dx, dx), X.op("EXPR_MUL", dy, dy)),
                    X.op("EXPR_MUL", dist, dist))
        _expr_branch(out, node, ev, ctx, where)

    elif etype == "if_actor_relative":
        a = resolve_actor(_require(ev, "actor", where), ctx, where)
        b = resolve_actor(_require(ev, "other", where), ctx, where)
        relation = str(ev.get("relation", "up")).lower()
        table = {
            "up": ("EXPR_ACTOR_Y", "EXPR_LT"), "down": ("EXPR_ACTOR_Y", "EXPR_GT"),
            "left": ("EXPR_ACTOR_X", "EXPR_LT"), "right": ("EXPR_ACTOR_X", "EXPR_GT"),
        }
        if relation not in table:
            raise BuildError(f"{where}: unknown \"relation\" '{relation}'. Use: up, down, left, right.")
        axis, cmp = table[relation]
        node = X.op(cmp, X.op(axis, X.const(a)), X.op(axis, X.const(b)))
        _expr_branch(out, node, ev, ctx, where)

    # ---- Input / scene / data ----
    elif etype == "if_input":
        mask = _button_mask(ev.get("buttons"), where)
        _expr_branch(out, X.op("EXPR_HELD", X.const(mask)), ev, ctx, where)

    elif etype == "if_current_scene":
        scene_name = _require(ev, "scene", where)
        if scene_name not in ctx["name_to_index"]:
            known = ", ".join(sorted(ctx["name_to_index"]))
            raise BuildError(f"{where}: unknown scene '{scene_name}'. Known scenes: {known}")
        node = X.op("EXPR_EQ", X.op("EXPR_SCENE"), X.const(ctx["name_to_index"][scene_name]))
        _expr_branch(out, node, ev, ctx, where)

    elif etype in ("scene_push", "scene_pop", "scene_pop_all", "scene_reset"):
        op_name = {"scene_push": "SCRIPT_SCENE_PUSH", "scene_pop": "SCRIPT_SCENE_POP",
                   "scene_pop_all": "SCRIPT_SCENE_POP", "scene_reset": "SCRIPT_SCENE_RESET"}[etype]
        out.append(_instr(op_name, a=1 if etype == "scene_pop_all" else 0))

    elif etype in ("data_save", "data_load", "data_clear"):
        op_name = {"data_save": "SCRIPT_DATA_SAVE", "data_load": "SCRIPT_DATA_LOAD",
                   "data_clear": "SCRIPT_DATA_CLEAR"}[etype]
        out.append(_instr(op_name, a=_slot(ev, where)))

    elif etype == "if_data_saved":
        _expr_branch(out, X.op("EXPR_SAVED", X.const(_slot(ev, where))), ev, ctx, where)

    elif etype == "data_peek":
        slot = _slot(ev, where)
        source = resolve_var(_require(ev, "source", where), ctx, where)
        idx = resolve_var(_require(ev, "var", where), ctx, where)
        node = X.op("EXPR_PEEK", X.const(slot), X.const(source))
        out.append(_instr("SCRIPT_SET_VAR_EXPR", a=idx, ptr=emit_expr(ctx, node, where)))

    # ---- Screen ----
    elif etype == "sprites_show":
        out.append(_instr("SCRIPT_SPRITES_SHOW"))

    elif etype == "sprites_hide":
        out.append(_instr("SCRIPT_SPRITES_HIDE"))

    elif etype == "palette_set":
        target = str(ev.get("target", "background")).lower()
        if target not in PALETTE_TARGETS:
            raise BuildError(f"{where}: unknown \"target\" '{target}'. Use \"background\" or \"sprite\".")
        bank = resolve_small_int(ev.get("bank", 0), "bank", where, 0, 15)
        index = resolve_small_int(ev.get("index", 0), "index", where, 0, 15)
        colors = ev.get("colors", [ev["color"]] if "color" in ev else None)
        if isinstance(colors, str):
            colors = [colors]
        if not isinstance(colors, list) or not colors or index + len(colors) > 16:
            raise BuildError(f"{where}: \"colors\" must be a list of 1-{16 - index} "
                             "\"#rrggbb\" colors (a bank holds 16).")
        for i, col in enumerate(colors):
            m = HEX_COLOR_RE.match(str(col))
            if not m:
                raise BuildError(f"{where}: color '{col}' isn't a \"#rrggbb\" hex color.")
            h = m.group(1)
            value = gba_color((int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)))
            a = (PALETTE_TARGETS[target] << 8) | (bank << 4) | (index + i)
            out.append(_instr("SCRIPT_PALETTE_SET", a=a, b=f"0x{value:04X}"))

    elif etype == "replace_tile":
        x = resolve_small_int(_require(ev, "x", where), "x", where, 0, 255)
        y = resolve_small_int(_require(ev, "y", where), "y", where, 0, 255)
        sx = resolve_small_int(_require(ev, "sourceX", where), "sourceX", where, 0, 255)
        sy = resolve_small_int(_require(ev, "sourceY", where), "sourceY", where, 0, 255)
        out.append(_instr("SCRIPT_REPLACE_TILE", a=x, b=y, c=sx, d=sy))

    # ---- Sound ----
    elif etype == "sound_tone":
        hz = resolve_small_int(ev.get("frequency", 440), "frequency", where, 64, 20000)
        frames = resolve_small_int(ev.get("frames", 30), "frames", where, 1, INT16_MAX)
        out.append(_instr("SCRIPT_SOUND_TONE", a=hz, b=frames))

    elif etype == "sound_beep":
        pitch = resolve_small_int(ev.get("pitch", 4), "pitch", where, 1, 8)
        frames = resolve_small_int(ev.get("frames", 30), "frames", where, 1, INT16_MAX)
        out.append(_instr("SCRIPT_SOUND_BEEP", a=pitch, b=frames))

    elif etype == "sound_crash":
        frames = resolve_small_int(ev.get("frames", 30), "frames", where, 1, INT16_MAX)
        out.append(_instr("SCRIPT_SOUND_CRASH", b=frames))

    elif etype == "mute_channel":
        ch = resolve_small_int(_require(ev, "channel", where), "channel", where, 1, 4)
        out.append(_instr("SCRIPT_MUTE_CHANNEL", a=ch - 1, b=1 if ev.get("muted", True) else 0))

    # ---- Timing ----
    elif etype == "idle":
        out.append(_instr("SCRIPT_WAIT", a=0))   # yields until next frame

    else:
        return False
    return True


class CompiledScript(list):
    """compile_script()'s result: the instruction list, plus `aux` - the
    expression arrays and sub-scripts (thread/timer/input/music-routine
    bodies) its instructions point at through "ptr", in dependency
    order. emit_script() writes those out first, since C needs them
    declared before the array that references them."""

    def __init__(self):
        super().__init__()
        self.aux = []


def compile_script(events, ctx, where):
    """Compile a top-level events list into a complete, SCRIPT_END-terminated
    instruction list, ready for emit_script().

    Also used for sub-scripts: every script (and so every array of
    instruction indices) gets its own label scope for "label"/"goto"."""
    out = CompiledScript()
    outer_aux = ctx.get("_aux")
    outer_labels = ctx.get("_labels")
    ctx["_aux"] = out.aux
    ctx["_labels"] = {"defined": {}, "gotos": []}
    try:
        compile_events(events, out, ctx, where)
        out.append(_instr("SCRIPT_END"))
        labels = ctx["_labels"]
        for goto_index, name, goto_where in labels["gotos"]:
            if name not in labels["defined"]:
                known = ", ".join(sorted(labels["defined"])) or "(none in this script)"
                raise BuildError(
                    f"{goto_where}: no label '{name}' in this script. Known labels: "
                    f"{known}. (A goto can't jump into or out of a thread, timer, "
                    "input or music-routine script.)")
            out[goto_index]["a"] = labels["defined"][name]
    finally:
        ctx["_aux"] = outer_aux
        ctx["_labels"] = outer_labels
    return out


def _aux_ident(ctx, kind):
    n = ctx.get("_aux_counter", 0)
    ctx["_aux_counter"] = n + 1
    return f"{kind}_{n}"


def compile_subscript(events, ctx, where):
    """Compile `events` as a separate ScriptEvent array (a thread, timer,
    input or music-routine body) and return its C identifier, for an
    instruction's "ptr". It's queued on the enclosing script's aux list,
    after any aux of its own."""
    if events is None:
        events = []
    if not isinstance(events, list):
        raise BuildError(f"{where}: \"script\" must be a list of events.")
    sub = compile_script(events, ctx, f"{where} script")
    ident = _aux_ident(ctx, "subscript")
    ctx["_aux"].extend(sub.aux)
    ctx["_aux"].append(("script", ident, list(sub)))
    return ident


class _ExprResolver:
    """Name lookups for expr.py, reporting errors against `where`."""

    def __init__(self, ctx, where):
        self.ctx = ctx
        self.where = where

    def var(self, name):
        return resolve_var(name, self.ctx, self.where)

    def actor(self, ref):
        return resolve_actor(ref, self.ctx, self.where)

    def flag(self, name):
        return resolve_flag(name, self.ctx, self.where)

    def item(self, name):
        return resolve_item(name, self.ctx, self.where)

    def button(self, name):
        return _button_mask([name], self.where)


def emit_expr(ctx, node, where):
    """Queue an expression (an expression string, or an expr.py AST node
    built by a lowered event) as an int16_t RPN array and return its C
    identifier, for an instruction's "ptr"."""
    try:
        if isinstance(node, str):
            rpn = compile_expression(node, _ExprResolver(ctx, where))
        else:
            rpn = expr_to_rpn(node)
    except ExprError as e:
        raise BuildError(f"{where}: expression error: {e}")
    ident = _aux_ident(ctx, "expr")
    ctx["_aux"].append(("expr", ident, rpn))
    return ident


def emit_script(c_parts, ident, instructions):
    for kind, aux_ident, data in getattr(instructions, "aux", []):
        if kind == "expr":
            c_parts.append(f"static const int16_t {aux_ident}[{len(data)}] =")
            c_parts.append("{")
            c_parts.append("    " + ", ".join(str(t) for t in data))
            c_parts.append("};")
            c_parts.append("")
        else:
            _emit_script_array(c_parts, aux_ident, data)
    _emit_script_array(c_parts, ident, instructions)


def _emit_script_array(c_parts, ident, instructions):
    c_parts.append(f"static const ScriptEvent {ident}[{len(instructions)}] =")
    c_parts.append("{")
    for ins in instructions:
        a = ins["a"] if isinstance(ins["a"], str) else str(ins["a"])
        b = ins["b"] if isinstance(ins["b"], str) else str(ins["b"])
        c = ins["c"] if isinstance(ins["c"], str) else str(ins["c"])
        d = ins.get("d", 0)
        c_parts.append(f"    {{ {ins['op']}, {a}, {b}, {c}, {d}, {ins.get('ptr', '0')}, {ins['str']} }},")
    c_parts.append("};")
    c_parts.append("")


# ---------------------------------------------------------------------------
# NPC sprite conversion
# ---------------------------------------------------------------------------

SPRITE_FRAME_W = 16
SPRITE_FRAME_H = 16
SPRITE_FRAMES  = 8   # 2 per direction × 4 directions

def _sprite_palette(image):
    """Build a 16-entry GBA palette from a sprite sheet. Slot 0 = transparent."""
    colors = []
    for r, g, b, a in image.getdata():
        if a == 0:
            continue
        rgb = (r, g, b)
        if rgb not in colors:
            colors.append(rgb)
    if len(colors) > 15:
        raise BuildError(
            f"Sprite has {len(colors)} visible colors; maximum is 15.")
    palette = [0]   # slot 0 = transparent
    for rgb in colors:
        palette.append(gba_color(rgb))
    while len(palette) < 16:
        palette.append(0)
    return palette, colors


def _sprite_pixel_index(pixel, vis_colors):
    r, g, b, a = pixel
    if a == 0:
        return 0
    return 1 + vis_colors.index((r, g, b))


def _sprite_8x8(tile_img, vis_colors):
    pixels = []
    for y in range(8):
        for x in range(8):
            pixels.append(_sprite_pixel_index(tile_img.getpixel((x, y)), vis_colors))
    result = []
    for i in range(0, 64, 2):
        result.append(pixels[i] | (pixels[i + 1] << 4))
    return result


def _sprite_frame(frame_img, vis_colors):
    """Convert one 16x16 frame to GBA 4bpp, 1D-mapped (2×2 of 8×8 tiles)."""
    data = []
    for ty in range(2):
        for tx in range(2):
            tile = frame_img.crop((tx*8, ty*8, tx*8+8, ty*8+8))
            data.extend(_sprite_8x8(tile, vis_colors))
    return data


def _sprite_atlas_tile(image, vis_colors, col, row, flip_x=False, flip_y=False):
    """32 bytes of raw 4bpp pixel data for the 8x8 tile at tile-grid
    (col, row) in the full imported sheet `image` (NOT a flip-baked
    legacy frame - the source PlacedTileJSON references straight into
    this atlas by tile-grid coordinates - see shared/projectTypes.ts's
    PlacedTileJSON). Used for composed ("metasprite") frames: unlike the
    legacy whole-frame flip bake (emit_sprite_states' remap_frames),
    flip_x/flip_y here are ONLY used for validation-time preview/consistency -
    the engine applies per-tile flip as an OAM bit at runtime (see
    sprite.c's ASpriteSubTile), so the byte data returned is always the
    tile's raw, unflipped pixels."""
    tile = image.crop((col * 8, row * 8, col * 8 + 8, row * 8 + 8))
    return _sprite_8x8(tile, vis_colors)


def convert_npc_sprite(path, name):
    """
    Load a sprite sheet PNG as an 8x8-tile atlas, for composed
    ("metasprite") frames (project.json spriteSheets[].frames - see
    shared/projectTypes.ts's SpriteFrameJSON/PlacedTileJSON): each placed
    tile addresses this atlas by tile-grid (sheetX, sheetY), so the
    sheet's overall size doesn't matter beyond being tile-aligned - a
    256x256 sheet holding every animation for several differently-sized
    sprites is exactly as valid as an 8x8 sheet holding one tile. Only
    the individually AUTHORED sprite size (canvasWidth/canvasHeight) is
    hardware-constrained, not this source PNG.
    ('sprite size' vs 'sheet size': the sheet is just where tiles are
    imported from - see SpriteSheetJSON's doc comment in
    shared/projectTypes.ts.)

    The legacy fixed-layout convention (a sprite sheet with no
    spriteSheets entry, or a state that shows plain numbered "frames"
    instead of composed frameRefs) is a DIFFERENT, narrower format - a
    hardcoded 96x16 six-frame walk sheet - and is only decoded lazily, by
    _load_legacy_frames() below, the first time something actually needs
    it. Most sprites authored entirely with composed frames never call
    that function at all, so their sheet PNG is never size-restricted.

    Returns { "palette": [16 uint16], "vis_colors": [...], "image":
    PIL.Image, "atlas_cols"/"atlas_rows": int, "path": Path, "name": str }.
    "frames"/"tile_data" (the legacy 96x16 six-frame layout) are added
    lazily by _load_legacy_frames(), not present until then.
    """
    image = Image.open(path).convert("RGBA")
    if image.width % 8 != 0 or image.height % 8 != 0:
        raise BuildError(
            f"NPC sprite '{name}' ({path.name}): {image.width}x{image.height} px - "
            "sprite sheets must be a multiple of 8 pixels in both directions "
            "(GBA tiles are 8x8), so every tile in the sheet lines up on an "
            "8-pixel grid.")

    palette, vis_colors = _sprite_palette(image)

    return {
        "palette": palette,
        "vis_colors": vis_colors,
        # Kept for composed ("metasprite") frames: the full imported
        # sheet, sliced as an 8x8-tile atlas by _sprite_atlas_tile(),
        # plus its size in tiles. Any sheet size works here.
        "image": image,
        "atlas_cols": image.width // 8,
        "atlas_rows": image.height // 8,
        # Kept so _load_legacy_frames() can report a useful error and
        # re-derive vis_colors-consistent pixel data lazily.
        "path": path,
        "name": name,
    }


def _load_legacy_frames(data):
    """Lazily decode this sheet's LEGACY fixed layout (see
    convert_npc_sprite's doc comment): a hardcoded 96x16 six-frame walk
    sheet (col 0,1 = down, col 2,3 = up, col 4,5 = right; left frames are
    generated by horizontally flipping the right frames). Populates and
    returns `data["frames"]`/`data["tile_data"]` (memoized - a no-op if
    already loaded). Only called where the legacy convention is actually
    needed (no spriteSheets entry, or a state using plain numbered
    "frames" instead of composed frameRefs - see sprite_needs_legacy in
    the caller) - a sheet authored entirely with composed frames never
    reaches this function, so its PNG is never held to this fixed size.
    """
    if "tile_data" in data:
        return data

    image, name, path = data["image"], data["name"], data["path"]
    if image.size != (96, 16):
        raise BuildError(
            f"NPC sprite '{name}' ({path.name}): this sprite has a state using "
            "plain numbered animation frames (the classic fixed layout), which "
            f"needs a 96x16 six-frame sheet - but this sheet is {image.width}x"
            f"{image.height}. Either make the sheet 96x16, or author every one "
            "of this sprite's states with tile-composed frames instead (which "
            "accepts any sheet size).")

    vis_colors = data["vis_colors"]
    frames = []
    for i in range(6):
        frame = image.crop((i * SPRITE_FRAME_W, 0,
                            (i + 1) * SPRITE_FRAME_W, SPRITE_FRAME_H))
        frames.append(frame)

    # Generate left frames by mirroring right frames (indices 4, 5).
    frames.append(frames[5].transpose(Image.Transpose.FLIP_LEFT_RIGHT))  # left-1
    frames.append(frames[4].transpose(Image.Transpose.FLIP_LEFT_RIGHT))  # left-2

    tile_data = []
    for frame in frames:
        tile_data.extend(_sprite_frame(frame, vis_colors))

    # Kept for baking per-frame horizontal flips (authored "flips" in a
    # spriteSheets state - see emit_sprite_states below): the 8 source
    # PIL frames (same order as tile_data), re-sliced on a mirrored copy.
    data["frames"] = frames
    data["tile_data"] = tile_data
    return data


def _parse_c_int_array(text, name):
    """Integer initializer of `name[...] = { ... };` in generated C, or None."""
    m = re.search(re.escape(name) + r"\s*\[[^\]]*\]\s*=\s*\{([^}]*)\}", text)
    if not m:
        return None
    return [int(v, 0) for v in re.findall(r"0[xX][0-9A-Fa-f]+|\d+", m.group(1))]


def generate_player_graphics(pdata, player_c):
    """Writes engine/data/player_graphics.c/.h straight from
    engine/data/player.png (via convert_npc_sprite()/_load_legacy_frames(),
    the exact same pixel/palette conversion NPC sprite sheets use for
    their own legacy frames), so editing player.png (e.g. from the
    editor's Sprites view - see editor/electron/projectIO.ts's
    replacePlayerSprite()) and rebuilding is enough on its own: nothing
    needs to be pre-baked or manually re-run first.

    This REPLACES the old validate-and-raise check_player_graphics(),
    which only compared player.png against an already-baked
    player_graphics.c (produced by hand via `python
    tools/png_to_gba_sprite.py engine/data/player.png
    engine/data/player_graphics.c`) and refused to build on a mismatch.
    That manual step is gone now - this always regenerates fresh output
    matching whatever engine/data/player.png currently contains, in the
    identical format/layout tools/png_to_gba_sprite.py used to produce by
    hand (same array names/sizes), so no other code needs to change.

    Only rewrites either file when its content actually changed, so an
    unmodified player.png doesn't touch player_graphics.c's mtime (and
    doesn't force a devkitARM rebuild of it) on every single build."""
    tile_data = list(pdata["tile_data"][:SPRITE_FRAMES * 128])
    palette = list(pdata["palette"])   # already a full 16-entry GBA palette
    frame_offsets = [i * 128 for i in range(8)]

    c_lines = [
        "/*",
        " * Generated by compiler/build_project.py from engine/data/player.png",
        " * (do not edit by hand - change player.png and rebuild instead)",
        " */",
        "",
        "#include <stdint.h>",
        "",
        "#define PLAYER_FRAME_COUNT 8",
        "#define PLAYER_FRAME_SIZE 128",
        "",
        "const uint8_t player_graphics[] =",
        "{",
    ]
    for i in range(0, len(tile_data), 16):
        chunk = tile_data[i:i + 16]
        c_lines.append("    " + ", ".join(f"0x{v:02X}" for v in chunk) + ",")
    c_lines += [
        "};",
        "",
        "const uint16_t player_palette[16] =",
        "{",
        "    " + ", ".join(f"0x{v:04X}" for v in palette) + ",",
        "};",
        "",
        "const uint32_t player_frame_offsets[8] =",
        "{",
        "    " + ", ".join(str(v) for v in frame_offsets) + ",",
        "};",
        "",
    ]
    c_text = "\n".join(c_lines)

    header_path = player_c.with_suffix(".h")
    guard = header_path.stem.upper() + "_H"
    h_text = "\n".join([
        "/*",
        " * Generated by compiler/build_project.py from engine/data/player.png",
        " * (do not edit by hand - change player.png and rebuild instead)",
        " */",
        "",
        f"#ifndef {guard}",
        f"#define {guard}",
        "",
        "#include <stdint.h>",
        "",
        "#define PLAYER_FRAME_COUNT 8",
        "#define PLAYER_FRAME_SIZE 128",
        "",
        "extern const uint8_t player_graphics[];",
        "extern const uint16_t player_palette[16];",
        "extern const uint32_t player_frame_offsets[8];",
        "",
        "#endif",
        "",
    ])

    if not player_c.exists() or player_c.read_text(encoding="utf-8") != c_text:
        player_c.write_text(c_text, encoding="utf-8")
    if not header_path.exists() or header_path.read_text(encoding="utf-8") != h_text:
        header_path.write_text(h_text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def write_preview(bg, grid, spawn, path, doors=(), npcs=()):
    base = bg["image"].convert("RGBA")
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))

    for y in range(bg["height"]):
        for x in range(bg["width"]):
            c = PREVIEW_COLORS.get(grid[y * bg["width"] + x])
            if c:
                overlay.paste(c, (x * 8, y * 8, x * 8 + 8, y * 8 + 8))

    # Doors in magenta.
    for door in doors:
        dx = int(door["x"]) * TILE
        dy = int(door["y"]) * TILE
        dw = int(door.get("width", 1)) * TILE
        dh = int(door.get("height", 1)) * TILE
        overlay.paste((255, 0, 255, 130), (dx, dy, dx + dw, dy + dh))

    # Player spawn in green.
    sx, sy = spawn
    overlay.paste((0, 200, 0, 170), (sx, sy, sx + 16, sy + 16))

    # NPCs in cyan.
    for npc in npcs:
        nx = int(npc["x"]) * TILE
        ny = int(npc["y"]) * TILE
        overlay.paste((0, 220, 220, 150), (nx, ny, nx + 16, ny + 16))

    out = Image.alpha_composite(base, overlay)
    out = out.resize((out.width * 2, out.height * 2), Image.NEAREST)
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path)


# ---------------------------------------------------------------------------
# C output helpers
# ---------------------------------------------------------------------------

def c_array(ctype, name, values, fmt, per_line, align=True):
    attr = " __attribute__((aligned(4)))" if align else ""
    lines = [f"static const {ctype} {name}[{len(values)}]{attr} =", "{"]
    for i in range(0, len(values), per_line):
        chunk = values[i:i + per_line]
        lines.append("    " + ", ".join(fmt.format(v) for v in chunk) + ",")
    lines.append("};")
    return "\n".join(lines)


def _uses_play_music(node):
    """True if `node` (any nested JSON value - typically the whole
    project dict) contains a play_music event anywhere: a scene's
    on_init, a door's events, an NPC's on_interact, a timer's script,
    a custom script, or nested inside any of those (then/else/body/
    children/menu options branches). Used to decide whether
    scenes_data.c needs #include "soundbank.h" - a scene's own
    "music" property already gets its own, narrower check (see
    build_scenes_c()); this covers music started only from a script."""
    if isinstance(node, dict):
        if node.get("type") == "play_music":
            return True
        return any(_uses_play_music(v) for v in node.values())
    if isinstance(node, list):
        return any(_uses_play_music(v) for v in node)
    return False


def music_track_const(name):
    """A music asset name/filename (e.g. "template", "template.mod" or
    "town.uge", matching MusicSelect's picker / a scene's "music"
    property / a play_music event's "track") to its C track id: UGE_*
    (uge_songs.h, see compiler/uge.py) for an engine/music/*.uge song,
    else the soundbank.h MOD_* identifier mmutil generates. A bare
    name that matches both a .uge and a module file picks the module,
    so projects from before .uge support keep the track they had.
    Module names aren't validated here - an unknown/misspelled one
    surfaces as an "undeclared identifier" from the devkitARM build."""
    path = Path(name)
    ext = path.suffix.lower()
    stem = path.stem if ext in (".uge",) + MODULE_MUSIC_EXTS else name
    is_uge = ext == ".uge" or (
        ext not in MODULE_MUSIC_EXTS
        and (ENGINE_MUSIC_DIR / f"{stem}.uge").is_file()
        and not any((ENGINE_MUSIC_DIR / f"{stem}{e}").is_file() for e in MODULE_MUSIC_EXTS))
    if is_uge:
        return uge_track_const(stem)
    return "MOD_" + "".join(ch.upper() if ch.isalnum() else "_" for ch in stem)


def c_ident(name):
    ident = "".join(ch if ch.isalnum() else "_" for ch in name.lower())
    if not ident or ident[0].isdigit():
        ident = "s_" + ident
    return ident


def c_string_literal(text):
    """Escape a Python string for embedding as a C string literal.
    '\n' in the JSON source becomes a real newline byte - dialogue.c
    reads that as a page break.

    Any other non-printable byte (currently just '\x01', the separator
    a "choice" event packs its prompt/options with - see the "choice"
    case in compile_events()) is written as a \\xHH escape. C's \\x
    escape is "greedy": it swallows EVERY hex digit that follows, not
    just two, so "\\x01" immediately in front of a literal '0'-'9' or
    'a'-'f' would be misparsed as one long escape instead of "\\x01"
    followed by that character. When that would happen, this closes
    the string literal right after the escape and reopens a fresh one
    - two adjacent string-literal tokens are automatically concatenated
    by C, so "\\x01" "1abc" is still exactly one string at runtime.
    """
    HEX_DIGITS = "0123456789abcdefABCDEF"
    out = []
    for i, ch in enumerate(text):
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\t":
            out.append("\\t")
        elif 32 <= ord(ch) < 127:
            out.append(ch)
        else:
            out.append("\\x{:02x}".format(ord(ch) & 0xFF))
            next_ch = text[i + 1] if i + 1 < len(text) else ""
            if next_ch in HEX_DIGITS:
                out.append('" "')   # split - see docstring above
    return '"' + "".join(out) + '"'


# ---------------------------------------------------------------------------
# Project
# ---------------------------------------------------------------------------

def build(project_dir, out_dir):
    project_file = project_dir / "project.json"
    if not project_file.exists():
        raise BuildError(f"No project.json in {project_dir}")

    project = json.loads(project_file.read_text(encoding="utf-8"))

    # engine/data/player.png -> engine/data/player_graphics.c/.h - moved
    # below, after the spriteSheets pass, so it's known whether "player"
    # needs the legacy fixed 96x16 layout (same rule as any NPC sprite -
    # see sprite_needs_legacy) before deciding whether to enforce that
    # size. See the "Player sprite:" block further down for the actual
    # generation call.

    # Project-wide named item list: { "items": ["Old Key", ...] }.
    # Index in this list = the item's bit in SaveData.inventory. Referenced
    # by name from "give_item"/"if_item" events (see module docstring).
    item_names = project.get("items", [])
    if len(item_names) > MAX_ITEMS:
        raise BuildError(
            f"{len(item_names)} items listed in project.json, but "
            f"SaveData.inventory only has {MAX_ITEMS} bits.")
    if len(set(item_names)) != len(item_names):
        raise BuildError("project.json \"items\" has duplicate names.")

    # Project-wide named flag list: { "flags": ["met_town_npc", ...] }.
    # Index in this list = the flag's bit in SaveData.flags. Referenced by
    # name from "set_flag"/"clear_flag"/"if_flag" events.
    flag_names = project.get("flags", [])
    if len(flag_names) > MAX_EVENT_FLAGS:
        raise BuildError(
            f"{len(flag_names)} flags listed in project.json, but "
            f"SaveData.flags only has {MAX_EVENT_FLAGS} bits.")
    if len(set(flag_names)) != len(flag_names):
        raise BuildError("project.json \"flags\" has duplicate names.")

    # Project-wide named variable list: { "variables": ["score", ...] }.
    # Index in this list = the variable's slot in SaveData.variables.
    # Referenced by name from "set_var"/"add_var"/"if_var" events.
    variable_names = project.get("variables", [])
    if len(variable_names) > MAX_VARIABLES:
        raise BuildError(
            f"{len(variable_names)} variables listed in project.json, but "
            f"SaveData.variables only has {MAX_VARIABLES} slots.")
    if len(set(variable_names)) != len(variable_names):
        raise BuildError("project.json \"variables\" has duplicate names.")

    # Custom, reusable scripts (project.json "customScripts": [{ "id",
    # "name", "script" }, ...]), inline-expanded wherever a "call_script"
    # event references their id - see compile_events().
    custom_script_list = project.get("customScripts", [])
    custom_scripts = {}
    for i, cs in enumerate(custom_script_list):
        if not isinstance(cs, dict) or "id" not in cs or "script" not in cs:
            raise BuildError(
                f"project.json customScripts[{i}] must be an object with "
                "an \"id\" and a \"script\" list.")
        if cs["id"] in custom_scripts:
            raise BuildError(
                f"project.json customScripts has duplicate id '{cs['id']}'.")
        custom_scripts[cs["id"]] = cs["script"]

    scene_files = sorted((project_dir / "scenes").glob("*.json"))
    if not scene_files:
        raise BuildError(f"No scenes in {project_dir / 'scenes'}")

    # First pass: build name -> index mapping so doors/events can reference
    # target scenes by name.
    scene_names = []
    scene_data_list = []
    for scene_file in scene_files:
        scene = json.loads(scene_file.read_text(encoding="utf-8"))
        name = scene.get("name", scene_file.stem)
        scene_names.append(name)
        scene_data_list.append((scene_file, scene))

    name_to_index = {n: i for i, n in enumerate(scene_names)}

    # Shared name-resolution context for compile_events()/compile_script().
    # "npc_name_to_index"/"scene_npc_count"/"self_actor_index" and
    # "timer_name_to_index"/"scene_timer_count" are scene- (and, for
    # self_actor_index, script-) scoped, reset while each scene's
    # doors/npcs/timers/on_init are compiled below.
    ctx = {
        "item_names": item_names,
        "flag_names": flag_names,
        "variable_names": variable_names,
        "name_to_index": name_to_index,
        "npc_name_to_index": {},
        "npc_sprite_of": {},
        "scene_npc_count": 0,
        "self_actor_index": None,
        "sprite_state_names": {},   # filled in below, once npc_sprite_names is known
        "timer_name_to_index": {},
        "scene_timer_count": 0,
        "custom_scripts": custom_scripts,
    }

    # -----------------------------------------------------------------------
    # NPC sprite pass: collect unique sprite names, convert PNGs,
    # assign OBJ palette banks (0 = player, 1+ = NPC).
    # The special name "player" reuses player_graphics / player_palette.
    # -----------------------------------------------------------------------
    npc_sprite_names  = []   # ordered list of unique sprite names
    npc_sprite_data   = {}   # name -> { tile_data, palette } or None if "player"

    for _, scene in scene_data_list:
        for npc in scene.get("npcs", []):
            sname = npc.get("sprite", "player")
            if sname not in npc_sprite_names:
                npc_sprite_names.append(sname)

    # Convert PNGs for non-player sprites.
    sprites_dir = project_dir / "assets" / "sprites"
    for sname in npc_sprite_names:
        if sname == "player":
            npc_sprite_data[sname] = None   # handled specially in C
            continue
        png = sprites_dir / f"{sname}.png"
        if not png.exists():
            raise BuildError(
                f"NPC sprite '{sname}': {png} not found. "
                "Place a sprite sheet PNG there (any size, as long as it's a "
                "multiple of 8px in both directions), or use sprite \"player\".")
        npc_sprite_data[sname] = convert_npc_sprite(png, sname)
        print(f"  NPC sprite: {sname} from {png.name}")

    # OBJ palette bank per sprite: player = 0, others start at 1.
    npc_palette_bank = {}
    next_bank = 1
    for sname in npc_sprite_names:
        if sname == "player":
            npc_palette_bank[sname] = 0
        else:
            npc_palette_bank[sname] = next_bank
            next_bank += 1

    if next_bank > 16:
        raise BuildError(
            "Too many unique NPC sprites: only 15 OBJ palette banks "
            "are available for NPCs (player uses bank 0).")

    # -----------------------------------------------------------------------
    # Sprite sheet metadata pass: project.json "spriteSheets" - optional,
    # additive per-sprite animation states + collision box (see module
    # docstring). A sprite sheet with no entry here (or an entry with
    # neither "states" nor "collisionBox") compiles exactly as before this
    # feature existed: the legacy fixed 4-direction/8-frame convention and
    # a collision box equal to the full 16x16 sprite rect.
    # -----------------------------------------------------------------------
    sprite_sheets = project.get("spriteSheets", [])
    if not isinstance(sprite_sheets, list):
        raise BuildError("project.json \"spriteSheets\" must be a list.")

    # name -> { state_name: index }, for resolve_state() / actor_set_state.
    sprite_state_names = {}
    # name -> [(frame_list, speed), ...], parallel to sprite_state_names.
    sprite_state_lists = {}
    # name -> (ox, oy, w, h), authored collision box.
    sprite_collision_box = {}
    # name -> (width, height), authored canvas/hardware size - see
    # SpriteSheetJSON.canvasWidth's doc comment. Defaults to (16, 16),
    # this sheet's actual current effective frame size, below.
    sprite_canvas_size = {}
    # name -> { frame_id: [placed-tile dict, ...] }, authored composed
    # ("metasprite") frames - see shared/projectTypes.ts's
    # SpriteFrameJSON/PlacedTileJSON and the composed-frame emission
    # pass further below (after the flip-baking pass).
    sprite_frame_tiles = {}
    # name -> [8 state indices / ANIM_MAP_KEEP], the runtime direction map
    # (see build_anim_map()) - only for sheets with slot-tagged states.
    sprite_anim_map = {}

    seen_sheet_names = set()
    for si, sheet in enumerate(sprite_sheets):
        if not isinstance(sheet, dict) or "name" not in sheet:
            raise BuildError(
                f"project.json spriteSheets[{si}] must be an object with a \"name\".")
        sname = sheet["name"]
        swhere = f"project.json spriteSheets[{si}] ('{sname}')"
        if sname in seen_sheet_names:
            raise BuildError(f"{swhere}: duplicate sprite sheet name.")
        seen_sheet_names.add(sname)

        anim_type = sheet.get("animationType")
        if anim_type is not None and anim_type not in SPRITE_ANIMATION_TYPES:
            raise BuildError(
                f"{swhere}: unknown \"animationType\" '{anim_type}'. Must be one of "
                f"{sorted(SPRITE_ANIMATION_TYPES)}.")

        # Default true - matches GB Studio's own default and
        # SpriteSheetJSON.flipLeft's doc comment. Only ever consulted for
        # states whose "slot" is a "*Left" one (see SPRITE_LEFT_SLOT_TO_RIGHT
        # below), so a sheet with no slot-tagged states (every sheet from
        # before this feature existed) is unaffected either way.
        flip_left = bool(sheet.get("flipLeft", True))

        states = sheet.get("states", [])
        if not isinstance(states, list):
            raise BuildError(f"{swhere}: \"states\" must be a list.")
        state_names = {}
        state_lists = []
        # slot -> index into state_lists, for the flipLeft derivation pass
        # right below this loop.
        slot_to_index = {}
        for sti, st in enumerate(states):
            stwhere = f"{swhere}: states[{sti}]"
            if not isinstance(st, dict) or "name" not in st:
                raise BuildError(f"{stwhere} must be an object with a \"name\".")
            st_name = st["name"]
            if st_name in state_names:
                raise BuildError(f"{stwhere}: duplicate state name '{st_name}'.")
            # Tile-composed ("metasprite") frames - see shared/
            # projectTypes.ts's SpriteStateJSON.frameRefs. Parsed before
            # "frames"'s own non-empty check below, since a state whose
            # frameRefs is non-empty is shown/compiled from THOSE (its
            # own "frames" is then optional - typically omitted).
            frame_refs = st.get("frameRefs", [])
            if not isinstance(frame_refs, list):
                raise BuildError(f"{stwhere} ('{st_name}'): \"frameRefs\" must be a list.")
            # (frame_id, mirrored) pairs - `mirrored` is only ever set by
            # the flipLeft derivation below (a "*Left" state's frames are
            # its "*Right" sibling's, mirrored tile by tile).
            frame_refs = [(str(r), False) for r in frame_refs]

            frames = st.get("frames", [])
            if frames is None:
                frames = []
            if not isinstance(frames, list):
                raise BuildError(f"{stwhere} ('{st_name}'): \"frames\" must be a list.")
            if len(frames) > ENTITY_STATE_MAX_FRAMES:
                raise BuildError(
                    f"{stwhere} ('{st_name}'): {len(frames)} frames, but the "
                    f"engine's ENTITY_STATE_MAX_FRAMES is {ENTITY_STATE_MAX_FRAMES}.")
            frame_vals = [resolve_small_int(f, "frames[]", stwhere, 0, 255) for f in frames]
            speed = resolve_small_int(st.get("speed", 8), "speed", stwhere, 0, 255)

            flips = st.get("flips", [])
            if not isinstance(flips, list):
                raise BuildError(f"{stwhere} ('{st_name}'): \"flips\" must be a list.")
            if flips and len(flips) != len(frame_vals):
                raise BuildError(
                    f"{stwhere} ('{st_name}'): \"flips\" ({len(flips)}) must be the "
                    f"same length as \"frames\" ({len(frame_vals)}).")
            flip_vals = [bool(f) for f in flips] if flips else [False] * len(frame_vals)

            slot = st.get("slot")
            is_derived_left = (
                isinstance(slot, str) and slot in SPRITE_LEFT_SLOT_TO_RIGHT and flip_left
            )

            # Per-frame "flips" bakes a mirrored copy of the frame's pixel
            # data (see below) - there's no source PNG to do that against
            # for "player" (pre-baked engine/data/player_graphics.h), so
            # it's rejected UNLESS this is a flipLeft-derived state (in
            # which case the derivation below uses an index-remap instead
            # of "flips" for "player", and never sets flip_vals itself).
            if sname == "player" and any(flip_vals) and not is_derived_left and not frame_refs:
                raise BuildError(
                    f"{stwhere} ('{st_name}'): per-frame \"flips\" isn't supported on "
                    "the \"player\" sprite sheet - the compiler bakes a mirrored copy "
                    "of the frame's pixel data at compile time, but the player sheet "
                    "has no source PNG here (it's the pre-baked "
                    "engine/data/player_graphics.h). Use a real NPC sprite sheet "
                    "instead if you need a flipped frame.")

            # frame_refs already parsed above (before the "frames"
            # non-empty check) - ordered ids into this sheet's "frames",
            # validated once the sheet's composed frame defs themselves
            # are parsed, below. A non-empty frameRefs takes over this
            # state's shown frames entirely - "frames"/"flips" above are
            # simply ignored for it (kept parsed/validated regardless,
            # so switching a state back to legacy frames later needs no
            # re-authoring).

            state_names[st_name] = len(state_lists)
            if isinstance(slot, str):
                slot_to_index[slot] = len(state_lists)
            state_lists.append([frame_vals, speed, flip_vals, frame_refs])

        # ---------------------------------------------------------------
        # flipLeft derivation: a state whose "slot" is a "*Left" one (see
        # SPRITE_LEFT_SLOT_TO_RIGHT) has its own authored frames/speed/
        # flips above REPLACED with a mirror of its "*Right" sibling
        # state, when this sheet's "flipLeft" isn't explicitly false (see
        # SpriteStateJSON.slot's doc comment - the editor keeps such a
        # state's own frame list read-only/hidden for the same reason).
        # For a real NPC sheet this reuses the same per-frame "flips" bake
        # as a manually-authored flip - flip_vals is set to the logical
        # NOT of the Right sibling's own flips, so the SAME occurrence
        # (whatever frame index it happens to be) ends up mirrored,
        # regardless of animationType (works equally for e.g. a
        # platform_player's "jumpingLeft"/"jumpingRight", which reuse
        # whatever frame indices the author picked, not necessarily the
        # legacy walk-right columns).
        #
        # "player" has no source PNG to bake a mirrored copy against (see
        # the BuildError above), so it instead remaps each frame index
        # through the sheet's already-baked left/right pair (4<->7,
        # 5<->6 - the compiled 8-frame set's existing down/up/right/left
        # convention), which is exact for ordinary idle/moving right<->
        # left pairs but is only an identity fallback (no mirroring) for
        # any other frame index a "player" state might use - a known
        # narrower case than the general NPC path above, called out here
        # since there's no way to bake new player pixel data in this
        # pipeline (player_graphics.h is pre-baked by
        # tools/png_to_gba_sprite.py, not this script).
        # ---------------------------------------------------------------
        PLAYER_MIRROR_PAIR = {4: 7, 5: 6, 6: 4, 7: 5}
        for sti, st in enumerate(states):
            slot = st.get("slot")
            if not (isinstance(slot, str) and slot in SPRITE_LEFT_SLOT_TO_RIGHT and flip_left):
                continue
            right_slot = SPRITE_LEFT_SLOT_TO_RIGHT[slot]
            right_idx = slot_to_index.get(right_slot)
            if right_idx is None:
                continue   # no "*Right" sibling authored yet - leave this state's own data
            right_frames, right_speed, right_flips, right_refs = state_lists[right_idx]
            if sname == "player":
                derived_frames = [PLAYER_MIRROR_PAIR.get(f, f) for f in right_frames]
                derived_flips = [False] * len(right_frames)
            else:
                derived_frames = list(right_frames)
                derived_flips = [not fl for fl in right_flips]
            state_lists[sti][0] = derived_frames
            state_lists[sti][1] = right_speed
            state_lists[sti][2] = derived_flips
            # Composed ("metasprite") frameRefs: the "*Left" state shows
            # the SAME frames as its "*Right" sibling, each mirrored
            # across the canvas tile by tile (tx' = canvasWidth - tx - 8,
            # flipX toggled - applied in the composed-frame emission pass
            # below, before anchoring). Mirroring a mirrored ref is never
            # needed (Right slots are never derived).
            state_lists[sti][3] = [(fid, not m) for (fid, m) in right_refs]

        # A state with neither legacy "frames" nor "frameRefs" (a
        # half-authored state - e.g. a "*Left" slot state with no "*Right"
        # sibling yet) still compiles: to a 0-frame state, which the engine
        # treats as "select it, show nothing new" (entity.c's
        # entity_set_state/entity_step_state_animation both no-op on a
        # frame_count of 0).
        for sti, st in enumerate(state_lists):
            if not st[0] and not st[3]:
                print(f"  WARNING: {swhere}: state '{states[sti]['name']}' has no "
                      "frames - it compiles to an empty state (shows nothing new).")

        state_lists = [tuple(s) for s in state_lists]

        if state_names:
            sprite_state_names[sname] = state_names
            sprite_state_lists[sname] = state_lists

        box = sheet.get("collisionBox")
        if box is not None:
            if not isinstance(box, dict):
                raise BuildError(f"{swhere}: \"collisionBox\" must be an object.")
            ox = resolve_small_int(box.get("x", 0), "collisionBox.x", swhere, -128, 127)
            oy = resolve_small_int(box.get("y", 0), "collisionBox.y", swhere, -128, 127)
            w = resolve_small_int(_require(box, "width", swhere), "collisionBox.width", swhere, 0, 255)
            h = resolve_small_int(_require(box, "height", swhere), "collisionBox.height", swhere, 0, 255)
            sprite_collision_box[sname] = (ox, oy, w, h)

        # Runtime direction->state map (Entity.anim_map, see
        # build_anim_map()) from this sheet's slot-tagged states - None
        # (no map, legacy runtime behaviour) for a sheet with none.
        amap = build_anim_map(anim_type, slot_to_index)
        if amap is not None:
            sprite_anim_map[sname] = amap

        # Does this sheet use tile-composed ("metasprite") frames? Only if
        # some state (after flipLeft derivation) actually references one
        # via "frameRefs". A sheet whose "frames" list is never referenced
        # (stale/unused frames only) compiles exactly like a sheet with no
        # composed frames at all - those frames are ignored entirely (not
        # validated, no ROM space).
        is_composed = any(refs for (_f, _s, _fl, refs) in state_lists)

        # Canvas/hardware size - see SpriteSheetJSON.canvasWidth's doc
        # comment. Defaults to (16, 16) - this sprite's current implicit
        # size - when omitted, for backward compatibility.
        cw = sheet.get("canvasWidth")
        ch = sheet.get("canvasHeight")
        if is_composed:
            # ROUND 3 CONTRACT: free canvas size (a composed frame is many
            # OBJs, not one legal OBJ shape), anchored bottom-centre on the
            # entity's 16x16 footprint cell, shifted by canvasOriginX/Y.
            cw = resolve_small_int(16 if cw is None else cw, "canvasWidth", swhere,
                                   1, COMPOSED_CANVAS_MAX_W)
            ch = resolve_small_int(16 if ch is None else ch, "canvasHeight", swhere,
                                   1, COMPOSED_CANVAS_MAX_H)
            sprite_canvas_size[sname] = (cw, ch)
        elif cw is not None or ch is not None:
            # No composed frames: exactly the pre-existing rule/behaviour
            # (metadata only, must be a legal single-OBJ size).
            cw = resolve_small_int(_require(sheet, "canvasWidth", swhere) if cw is None else cw,
                                    "canvasWidth", swhere, 1, 255)
            ch = resolve_small_int(_require(sheet, "canvasHeight", swhere) if ch is None else ch,
                                    "canvasHeight", swhere, 1, 255)
            if (cw, ch) not in GBA_SPRITE_SIZES:
                raise BuildError(
                    f"{swhere}: canvasWidth/canvasHeight {cw}x{ch} isn't a legal GBA "
                    f"hardware sprite size. Must be one of {sorted(GBA_SPRITE_SIZES)}.")
            sprite_canvas_size[sname] = (cw, ch)

        if not is_composed:
            continue

        # -----------------------------------------------------------
        # Composed ("metasprite") frames: project.json spriteSheets[]
        # "frames" - a list of authored PlacedTileJSON groups (see
        # shared/projectTypes.ts's SpriteFrameJSON), each a set of
        # tiles placed within this sheet's canvas. Referenced by id
        # from a state's "frameRefs" (parsed in the states loop
        # above). Only REFERENCED frames are parsed/validated here;
        # turning them into actual engine data (which needs this
        # sheet's converted source PNG/atlas) happens in the
        # composed-frame emission pass below, after flip-baking.
        # -----------------------------------------------------------
        origin_x = resolve_small_int(sheet.get("canvasOriginX", 0) or 0, "canvasOriginX",
                                     swhere, -128, 127)
        origin_y = resolve_small_int(sheet.get("canvasOriginY", 0) or 0, "canvasOriginY",
                                     swhere, -128, 127)
        sprite_mode = sheet.get("spriteMode") or DEFAULT_SPRITE_MODE
        if sprite_mode not in SPRITE_MODE_TILE_H:
            raise BuildError(
                f"{swhere}: unknown \"spriteMode\" '{sprite_mode}'. Must be one of "
                f"{sorted(SPRITE_MODE_TILE_H)}.")
        tile_h = SPRITE_MODE_TILE_H[sprite_mode]

        frame_defs = sheet.get("frames", [])
        if frame_defs is None:
            frame_defs = []
        if not isinstance(frame_defs, list):
            raise BuildError(f"{swhere}: \"frames\" must be a list.")
        used_ids = []
        for (_f, _s, _fl, refs) in state_lists:
            for (fid, _m) in refs:
                if fid not in used_ids:
                    used_ids.append(fid)
        # id -> [(index in "frames", frame dict), ...]. Malformed or
        # duplicate entries only matter if something references them.
        by_id = {}
        for fi, fr in enumerate(frame_defs):
            if isinstance(fr, dict) and "id" in fr:
                by_id.setdefault(str(fr["id"]), []).append((fi, fr))

        missing_refs = [fid for fid in used_ids if fid not in by_id]
        if missing_refs:
            raise BuildError(
                f"{swhere}: frameRefs reference unknown frame id(s) "
                f"{sorted(missing_refs)} - not in this sheet's \"frames\".")

        skipped = [str(fr.get("id")) if isinstance(fr, dict) else f"#{fi}"
                   for fi, fr in enumerate(frame_defs)
                   if not (isinstance(fr, dict) and str(fr.get("id")) in used_ids)]
        if skipped:
            print(f"  {swhere}: skipping {len(skipped)} unreferenced frame(s): "
                  f"{', '.join(skipped)}")

        frame_tiles = {}
        for fid in used_ids:
            entries = by_id[fid]
            if len(entries) > 1:
                # Two (or more) authored frame entries share this id - the
                # editor is meant to keep frame ids unique (see
                # uniqueId()/takenFrameIds() in SpritesView.tsx) and, since
                # v7, self-heals this on the next edit to the sheet, but an
                # already-saved project.json can still have a leftover
                # duplicate from before that safety net existed. Rather
                # than hard-failing the build over it, use the first
                # entry (same one `Array.prototype.find` picks in the
                # editor's own frame lookups, so this matches what's shown
                # there) and warn, like the unreferenced-frame case below.
                print(f"  WARNING: {swhere}: frame id '{fid}' is used by frames"
                      f"{[fi for fi, _fr in entries]} - frame ids should be "
                      f"unique; using frames[{entries[0][0]}] and ignoring the rest.")
            fi, fr = entries[0]
            fwhere = f"{swhere}: frames[{fi}] ('{fid}')"
            tiles = fr.get("tiles", [])
            if tiles is None:
                tiles = []
            if not isinstance(tiles, list):
                raise BuildError(f"{fwhere}: \"tiles\" must be a list.")
            parsed_tiles = []
            for ti, t in enumerate(tiles):
                twhere = f"{fwhere}: tiles[{ti}]"
                if not isinstance(t, dict):
                    raise BuildError(f"{twhere} must be an object.")
                # Pixel-precise position (any integer), relative to the
                # canvas's top-left; may hang partly outside the canvas.
                tx = resolve_small_int(_require(t, "x", twhere), "x", twhere, -4096, 4096)
                ty = resolve_small_int(_require(t, "y", twhere), "y", twhere, -4096, 4096)
                if tx + 8 <= 0 or tx >= cw or ty + tile_h <= 0 or ty >= ch:
                    # GB Studio's removeMetaspriteTilesOutsideCanvas rule:
                    # a tile with no pixel on the canvas is dropped.
                    print(f"  WARNING: {twhere}: 8x{tile_h} tile at ({tx},{ty}) lies "
                          f"entirely outside the {cw}x{ch} canvas - dropped.")
                    continue
                sx = resolve_small_int(_require(t, "sheetX", twhere), "sheetX", twhere, 0, 255)
                sy = resolve_small_int(_require(t, "sheetY", twhere), "sheetY", twhere, 0, 255)
                flip_x = bool(t.get("flipX", False))
                flip_y = bool(t.get("flipY", False))
                palette_raw = t.get("palette")
                palette = (resolve_small_int(palette_raw, "palette", twhere, 0, OBJ_PALETTE_BANK_MAX - 1)
                           if palette_raw is not None else None)
                priority = bool(t.get("priority", False))
                parsed_tiles.append({
                    "x": tx, "y": ty, "sheetX": sx, "sheetY": sy,
                    "flipX": flip_x, "flipY": flip_y,
                    "palette": palette, "priority": priority,
                    "where": twhere,
                })
            if len(parsed_tiles) > ASPRITE_MAX_SUBTILES:
                raise BuildError(
                    f"{fwhere}: {len(parsed_tiles)} placed tiles, but "
                    f"the engine's ASPRITE_MAX_SUBTILES is {ASPRITE_MAX_SUBTILES}.")
            frame_tiles[fid] = parsed_tiles

        sprite_frame_tiles[sname] = {
            "frames": frame_tiles,
            "canvas": (cw, ch),
            "origin": (origin_x, origin_y),
            "mode": sprite_mode,
        }

    ctx["sprite_state_names"] = sprite_state_names

    # Does this NPC sprite need its sheet's LEGACY fixed 96x16 layout at
    # all (see convert_npc_sprite/_load_legacy_frames)? True if it has no
    # spriteSheets entry (the legacy convention is the implicit default
    # for such a sprite), or if any one of its authored states shows
    # plain numbered "frames" rather than composed frameRefs (a
    # non-empty frameRefs takes over a state's shown frames entirely -
    # see the states-parsing pass above - so only a refs-less state with
    # actual frame numbers counts). A sprite whose every state is
    # authored with composed frameRefs never needs this and so is never
    # held to the fixed 96x16 sheet size.
    sprite_needs_legacy = {}
    for sname in npc_sprite_names:
        if sname == "player":
            continue
        state_list = sprite_state_lists.get(sname)
        sprite_needs_legacy[sname] = (
            not state_list
            or any(frames for (frames, _speed, _flips, refs) in state_list if not refs)
        )

    # Player sprite: same rule as any NPC sprite above - does it need the
    # legacy fixed 96x16 layout, or has project.json authored a "player"
    # spriteSheets entry whose every state uses composed frameRefs (the
    # same way an NPC sprite like "cop" can be authored in the Sprites
    # view)? Computed here (not up in the NPC loop above, since "player"
    # is deliberately excluded there) because it decides how
    # engine/data/player.png is read just below.
    player_state_list = sprite_state_lists.get("player")
    player_needs_legacy = (
        not player_state_list
        or any(frames for (frames, _speed, _flips, refs) in player_state_list if not refs)
    )

    # engine/data/player.png -> engine/data/player_graphics.c/.h. Always
    # regenerated fresh (see generate_player_graphics's doc comment), but
    # the fixed 96x16 six-frame layout is only actually DECODED from it -
    # and thus only enforced - when player_needs_legacy (computed above)
    # is true, exactly mirroring how an NPC sprite's sheet is only held
    # to that size when it actually needs it (sprite_needs_legacy). When
    # the player is fully composed-frame authored instead, its sheet can
    # be any size (checked only for 8px alignment, by convert_npc_sprite
    # below) - main.c's player_sprite_def.multi_frame_count > 0 branch
    # takes over at runtime and never reads player_graphics[] at all, so
    # a zero-filled stub is written for those unreachable legacy arrays
    # (engine/source/main.c still references the symbols at compile
    # time, in its untaken else-branch, so they must exist either way).
    # engine/data is resolved the same way sheet_source()'s own
    # player.png lookup does (this script's own parent/parent), not from
    # `out_dir`, since player_graphics.c/.h are only ever real source
    # files there - out_dir is just where THIS build's generated
    # scene/project C is written, which can be redirected with --out,
    # but player_graphics.c/.h must not move with it (engine/source/
    # main.c always #includes the real one).
    engine_data_dir = Path(__file__).resolve().parent.parent / "engine" / "data"
    player_png = engine_data_dir / "player.png"
    if player_png.exists():
        _pdata = convert_npc_sprite(player_png, "player")
        if player_needs_legacy:
            _load_legacy_frames(_pdata)
        else:
            _pdata["tile_data"] = [0] * (SPRITE_FRAMES * 128)
            _pdata["palette"] = [0] * 16
        generate_player_graphics(_pdata, engine_data_dir / "player_graphics.c")

    # -----------------------------------------------------------------------
    # Per-frame flip baking: for any NPC sprite sheet with a state that
    # marks a frame occurrence as flipped (project.json "flips" - see
    # SpriteStateJSON in shared/projectTypes.ts), bake a horizontally-
    # mirrored copy of that frame's pixel data as a NEW frame appended to
    # the sheet, and remap that occurrence to point at it. No engine-side
    # runtime flip is involved: EntityAnimState.frames is already just
    # indices into a fixed pixel-data array (see entity.h), so an extra
    # baked frame is all a "flipped frame" needs to be. Not supported for
    # "player" (see the BuildError above) - it has no source PNG here.
    #
    # flip_frame_index[sname][original_frame] -> baked frame index, only
    # for sprites/frames actually requested flipped (dedup: flipping the
    # same frame twice reuses one baked copy).
    # -----------------------------------------------------------------------
    flip_frame_index = {}
    for sname, state_list in sprite_state_lists.items():
        if sname == "player":
            continue   # no source PNG to mirror - guarded above
        data = npc_sprite_data.get(sname)
        if data is None:
            continue   # sprite sheet authored in spriteSheets but unused by any NPC
        # Only states actually SHOWN via the legacy numbered "frames" list
        # count here - a state with a non-empty frameRefs ignores its own
        # "frames"/"flips" entirely (see the states-parsing pass above),
        # including a "*Left" state whose frames/flips got a derived
        # legacy mirror alongside its derived (already-mirrored) refs -
        # that derived legacy data is never what's actually rendered, so
        # skipping refs-driven states here is required, not just an
        # optimization: without it, a composed-only sprite's "*Left"
        # states (which inherit an all-True derived "flips" whenever
        # their "*Right" sibling has no explicit flips at all - see the
        # flipLeft derivation above) would wrongly pull in
        # _load_legacy_frames() below and re-impose the fixed 96x16 size
        # on a sheet that never needed it (see sprite_needs_legacy above,
        # which already uses this same "not refs" test).
        needed = sorted({f for (frames, _speed, flips, refs) in state_list if not refs
                          for f, fl in zip(frames, flips) if fl})
        if not needed:
            continue

        _load_legacy_frames(data)   # only sprites with a flipped legacy frame reach here
        src_frames = data["frames"]
        vis_colors = data["vis_colors"]
        remap = {}
        # Tracks how many frames this sheet has so far (starts at 8, the
        # fixed down/up/right/left set) - grows by one per distinct baked
        # flip below.
        next_index = SPRITE_FRAMES
        for f in needed:
            if f < 0 or f >= len(src_frames):
                raise BuildError(
                    f"project.json spriteSheets ('{sname}'): can't flip-bake frame "
                    f"{f} - only frames 0-{len(src_frames) - 1} exist on this sheet.")
            mirrored = src_frames[f].transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            data["tile_data"].extend(_sprite_frame(mirrored, vis_colors))
            remap[f] = next_index
            next_index += 1
        data["frame_count"] = next_index
        flip_frame_index[sname] = remap

    def remap_frames(sname, frames, flips):
        """Apply flip_frame_index to one state's frame list (identity if
        this sprite has no baked flips, or nothing in this state is
        flipped)."""
        remap = flip_frame_index.get(sname)
        if not remap:
            return frames
        return [remap[f] if fl else f for f, fl in zip(frames, flips)]

    # -----------------------------------------------------------------------
    # Tile-composed ("metasprite") frame emission: for any sprite sheet
    # that authored composed frames (project.json spriteSheets[].frames -
    # see shared/projectTypes.ts's SpriteFrameJSON/PlacedTileJSON), build
    # this sheet's ASpriteMultiFrame list and REPLACE every one of its
    # states' frame indices with indices into that list - a legacy
    # numbered-frame state on an otherwise-composed sheet is folded in
    # too (as a synthetic single/multi-tile composed frame, reusing its
    # already flip-baked pixel data sliced per 8x8 tile - see
    # entity.h/sprite.c's sprite_show_frame() doc comment for why: one
    # ASprite is either fully legacy-frame-streamed or fully multi-tile,
    # never mixed, since sprite_show_frame() dispatches per-sprite, not
    # per-frame).
    #
    # A sheet with NO composed frames authored at all never enters this
    # pass (sprite_frame_tiles has no entry for it) - its states' frame
    # indices are untouched, and multi_frame_defs[sname] stays absent,
    # so npc_sprites[]/player_sprite_def's multi_frames/multi_frame_count
    # compile to 0/0 exactly as before this feature existed. THIS is the
    # backward-compatibility boundary the critical byte-identical-output
    # regression check (see the module's build-verification notes)
    # covers: an untouched sheet is never touched by any code below.
    # -----------------------------------------------------------------------
    multi_frame_defs = {}   # sname -> [ (subtile dicts, tile_bytes, vram_tiles), ... ]
    multi_max_sub = {}      # sname -> max tile_count (OAM entries) across its frames
    multi_max_vram = {}     # sname -> max vram_tiles (8x8 VRAM tiles) across its frames

    # The built-in "player" sheet's atlas is engine/data/player.png (the
    # same PNG tools/png_to_gba_sprite.py bakes engine/data/
    # player_graphics.c from), resolved from this toolchain's own root -
    # the same root main() uses to find engine/. Loaded lazily, only when
    # the "player" sheet actually uses composed frames.
    player_source = {}

    def sheet_source(sname):
        if sname != "player":
            return npc_sprite_data.get(sname)
        if "data" not in player_source:
            engine_data = Path(__file__).resolve().parent.parent / "engine" / "data"
            png = engine_data / "player.png"
            if not png.exists():
                raise BuildError(
                    f"project.json spriteSheets ('player'): composed frames need the "
                    f"player's source sheet, but {png} was not found.")
            pdata = convert_npc_sprite(png, "player")
            player_source["data"] = pdata
        return player_source["data"]

    for sname, info in sprite_frame_tiles.items():
        data = sheet_source(sname)
        if data is None:
            continue   # sheet authored in spriteSheets but unused by any NPC

        frame_tiles = info["frames"]
        cw, ch = info["canvas"]
        origin_x, origin_y = info["origin"]
        tall_mode = info["mode"] == "8x16"
        # Anchoring (SpriteSheetJSON ROUND 3 CONTRACT): canvas bottom-centre
        # on the entity's 16x16 footprint cell's bottom-centre, then
        # shifted by canvasOriginX/Y. Python floor division on purpose
        # (matches the contract's floor() for odd/wider canvases).
        anchor_x = (16 - cw) // 2 + origin_x
        anchor_y = (16 - ch) + origin_y

        atlas_cols, atlas_rows = data["atlas_cols"], data["atlas_rows"]
        image, vis_colors = data["image"], data["vis_colors"]
        # Player sheet tiles default to the player's own OBJ bank 0
        # (main.c's PLAYER_PALETTE, loaded with player_palette) even when
        # no NPC uses the "player" sprite.
        default_bank = 0 if sname == "player" else npc_palette_bank.get(sname, 1)
        swhere = f"project.json spriteSheets ('{sname}')"

        frames_out = []          # ordered [(subtiles, tile_bytes, vram_tiles), ...]
        index_of = {}            # ("composed", id, mirrored) | ("legacy", frame_num) -> index

        def emit_composed(frame_id, mirrored):
            """One referenced composed frame -> one ASpriteMultiFrame.
            Each placed tile is one hardware OBJ: 8x8, or (spriteMode
            "8x16") one TALL 8x16 OBJ using two consecutive 8x8 VRAM tiles
            (sheet rows sheetY, sheetY+1 - GBA 1D OBJ mapping). tile_offset
            counts 8x8 VRAM tiles within this frame's tile_data; identical
            source tiles within a frame share VRAM. Sub-tiles are emitted in
            REVERSE authored order: GB Studio draws later-listed tiles on
            top, and on GBA the lower OAM index (= lower sub-tile index,
            see sprite.c) wins."""
            key = ("composed", frame_id, mirrored)
            if key in index_of:
                return index_of[key]
            subtiles = []
            tile_bytes = []
            vram = 0
            vram_of = {}
            for t in reversed(frame_tiles[frame_id]):
                sx, sy = t["sheetX"], t["sheetY"]
                rows = 2 if tall_mode else 1
                if sx >= atlas_cols or sy + rows > atlas_rows:
                    raise BuildError(
                        f"{t['where']}: sheetX/sheetY ({sx},{sy}) is outside this "
                        f"sheet's {atlas_cols}x{atlas_rows}-tile imported sheet"
                        + (f" (an 8x16 tile also needs row {sy + 1})." if tall_mode else "."))
                tx, ty, flip_h = t["x"], t["y"], t["flipX"]
                if mirrored:
                    # flipLeft: mirror across the canvas, flip the tile.
                    tx = cw - tx - 8
                    flip_h = not flip_h
                dx = tx + anchor_x
                dy = ty + anchor_y
                if not (-128 <= dx <= 127 and -128 <= dy <= 127):
                    raise BuildError(
                        f"{t['where']}{' (mirrored for flipLeft)' if mirrored else ''}: "
                        f"tile at canvas ({tx},{ty}) lands at entity offset ({dx},{dy}) "
                        f"(= canvas pos + anchor ({anchor_x},{anchor_y}) from the "
                        f"{cw}x{ch} canvas and canvasOrigin ({origin_x},{origin_y})) - "
                        "the engine stores offsets as int8, so both must be within "
                        "-128..127. Move the tile or adjust the canvas origin.")
                vkey = (sx, sy)
                if vkey not in vram_of:
                    vram_of[vkey] = vram
                    tile_bytes.extend(_sprite_atlas_tile(image, vis_colors, sx, sy))
                    if tall_mode:
                        tile_bytes.extend(_sprite_atlas_tile(image, vis_colors, sx, sy + 1))
                    vram += rows
                bank = t["palette"] if t["palette"] is not None else default_bank
                subtiles.append({
                    "dx": dx, "dy": dy, "tile_offset": vram_of[vkey],
                    "flip_h": flip_h, "flip_v": t["flipY"],
                    "palette": bank, "priority": t["priority"],
                    "tall": tall_mode,
                })
            index_of[key] = len(frames_out)
            frames_out.append((subtiles, tile_bytes, vram))
            return index_of[key]

        def legacy_to_multi(frame_num):
            """Fold a legacy numbered frame (post flip-remap) into a
            synthetic composed frame: TWO tall 8x16 OBJs (left column,
            right column) of this sheet's already-baked 16x16 frame, at
            entity offset (0,0)/(8,0) - i.e. exactly where the legacy
            single 16x16 OBJ draws it (legacy frames are NOT re-anchored
            by the canvas; they are 16x16 footprint-cell images). Always
            tall regardless of spriteMode (spriteMode only governs
            authored placed tiles) - half the OAM of four 8x8s. VRAM
            order: TL, BL (column 0), TR, BR (column 1). No flip/
            priority/custom palette (already baked into the pixels, or
            simply not authored)."""
            key = ("legacy", frame_num)
            if key in index_of:
                return index_of[key]
            fbytes = data["tile_data"]
            frame_bytes = SPRITE_FRAME_W * SPRITE_FRAME_H // 2   # 128, 4bpp
            start = frame_num * frame_bytes
            chunk = fbytes[start:start + frame_bytes]
            if len(chunk) != frame_bytes:
                raise BuildError(
                    f"{swhere}: legacy frame {frame_num} referenced alongside "
                    "composed frames, but this sheet only has "
                    f"{len(fbytes) // frame_bytes} legacy frames.")
            tl, tr, bl, br = (chunk[i * 32:(i + 1) * 32] for i in range(4))  # _sprite_frame() order
            subtiles = [
                {"dx": 0, "dy": 0, "tile_offset": 0, "flip_h": False, "flip_v": False,
                 "palette": default_bank, "priority": False, "tall": True},
                {"dx": 8, "dy": 0, "tile_offset": 2, "flip_h": False, "flip_v": False,
                 "palette": default_bank, "priority": False, "tall": True},
            ]
            index_of[key] = len(frames_out)
            frames_out.append((subtiles, tl + bl + tr + br, 4))
            return index_of[key]

        # Rewrite EVERY state on this sheet (composed or legacy) to
        # reference frames_out by index. Only frames some state actually
        # references are emitted, in first-reference order.
        state_list = sprite_state_lists.get(sname, [])
        new_state_list = []
        for frames, speed, flips, refs in state_list:
            if refs:
                new_frames = [emit_composed(fid, m) for (fid, m) in refs]
            else:
                remapped = remap_frames(sname, frames, flips)
                new_frames = [legacy_to_multi(f) for f in remapped]
            new_state_list.append((new_frames, speed, flips, refs))
        if new_state_list:
            sprite_state_lists[sname] = new_state_list

        if len(frames_out) > 255:
            raise BuildError(
                f"{swhere}: {len(frames_out)} distinct frames, but a state's frame "
                "list stores uint8 indices (max 255).")
        multi_frame_defs[sname] = frames_out
        multi_max_sub[sname] = max((len(st) for st, _tb, _v in frames_out), default=0)
        multi_max_vram[sname] = max((v for _st, _tb, v in frames_out), default=0)
        if multi_max_sub[sname] > ASPRITE_MAX_SUBTILES:
            raise BuildError(
                f"{swhere}: needs {multi_max_sub[sname]} placed tiles in one frame, "
                f"but the engine's ASPRITE_MAX_SUBTILES is {ASPRITE_MAX_SUBTILES}.")
        print(f"  {swhere}: {len(frames_out)} composed frame(s) emitted, up to "
              f"{multi_max_sub[sname]} OBJ(s) / {multi_max_vram[sname]} VRAM tile(s) per frame")

    # -----------------------------------------------------------------------
    # Build C output.
    # -----------------------------------------------------------------------
    c_parts = [
        "/*",
        " * Generated by compiler/build_project.py - do not edit.",
        f" * Project: {project.get('name', project_dir.name)}",
        " */",
        "",
        '#include "scene.h"',
        '#include "script.h"',
        '#include "scenes_data.h"',
        '#include "input.h"',   # INPUT_* constants, for "wait_button" events
    ]

    # If any NPC uses the "player" sprite, reference player_graphics.h.
    if "player" in npc_sprite_names:
        c_parts.append('#include "player_graphics.h"')

    if (any(scene.get("music") for _, scene in scene_data_list)
            or _uses_play_music(project)
            or any(_uses_play_music(scene) for _, scene in scene_data_list)):
        # music.h pulls in both track-id headers: soundbank.h (MOD_*,
        # generated by the Makefile's mmutil rule - not on disk when
        # this script runs, only by the time this file gets compiled)
        # and uge_songs.h (UGE_*, written by build() below).
        # _uses_play_music(project) catches project.json's top-level
        # customScripts[]; each scene's own dict (on_init/doors/npcs/
        # timers) is checked separately since scene JSON lives in its
        # own file, not nested inside project.json.
        c_parts.append('#include "music.h"')

    c_parts.append("")

    h_defs = []
    scene_idents = []

    # Emit per-sprite tile data and palette.
    for sname in npc_sprite_names:
        if sname == "player":
            continue   # references player_graphics.h directly
        ident = c_ident(sname)
        data = npc_sprite_data[sname]
        if sprite_needs_legacy.get(sname):
            _load_legacy_frames(data)
        elif "tile_data" not in data:
            # Composed-only sprite (see sprite_needs_legacy above): its
            # sheet was never held to the legacy 96x16 layout, so there's
            # no real legacy frame data to emit. npc_sprites[] still
            # references *_tiles/frame_count by name unconditionally (see
            # below), but sprite_show_frame() (sprite.c) only ever reads
            # them when this sprite has NO composed multi_frames, which
            # is never true here - so a single blank placeholder frame is
            # all that's needed to keep the generated C valid.
            data["tile_data"] = [0] * (SPRITE_FRAME_W * SPRITE_FRAME_H // 2)
            data["frame_count"] = 1
        c_parts.append(f"/* NPC sprite: {sname} */")
        c_parts.append(c_array("uint8_t",  f"npc_sprite_{ident}_tiles",
                               data["tile_data"], "0x{:02X}", 16))
        c_parts.append("")
        c_parts.append(c_array("uint16_t", f"npc_sprite_{ident}_palette",
                               data["palette"], "0x{:04X}", 8))
        c_parts.append("")

    def emit_sprite_states(sname):
        """Emit this sprite's authored EntityAnimState array (if any -
        see the spriteSheets pass above) and return the C expression +
        count to put in its npc_sprites[] entry, or ("0", 0) for a
        sprite with no authored states (the legacy-convention default)."""
        state_list = sprite_state_lists.get(sname)
        if not state_list:
            return "0", 0

        # Once a sheet has gone through the composed-frame pass above
        # (multi_frame_defs has an entry for it), state_list's "frames"
        # are ALREADY final indices into that sheet's multi_frames[] -
        # remap_frames() (legacy per-frame flip baking) must NOT run
        # again on them here.
        is_multi = sname in multi_frame_defs

        ident = c_ident(sname)
        frame_array_idents = []
        for si, (frames, _speed, flips, _refs) in enumerate(state_list):
            if not frames:
                frame_array_idents.append("0")   # empty state - no zero-length array
                continue
            fident = f"npc_sprite_{ident}_state{si}_frames"
            emitted = frames if is_multi else remap_frames(sname, frames, flips)
            c_parts.append(c_array("uint8_t", fident, emitted, "{}", 16))
            c_parts.append("")
            frame_array_idents.append(fident)

        states_ident = f"npc_sprite_{ident}_states"
        c_parts.append(f"static const EntityAnimState {states_ident}[{len(state_list)}] =")
        c_parts.append("{")
        for si, (frames, speed, _flips, _refs) in enumerate(state_list):
            c_parts.append(
                f"    {{ {frame_array_idents[si]}, {len(frames)}, {speed} }},")
        c_parts.append("};")
        c_parts.append("")
        return states_ident, len(state_list)

    sprite_states_expr = {}
    for sname in npc_sprite_names:
        sprite_states_expr[sname] = emit_sprite_states(sname)

    def emit_multi_frames(sname):
        """Emit this sprite's ASpriteMultiFrame array (if it uses composed
        frames - see the composed-frame emission pass above) and return
        (C expression, frame count, max OBJs per frame, max VRAM tiles
        per frame), or ("0", 0, 0, 0) for a sheet with none (every sheet
        from before this feature existed) - the multi_frame_count == 0
        case main.c reads as "use entity_set_frames() exactly as before".
        An empty frame (no placed tiles) compiles to { 0, 0, 0, 0 } -
        tile_count 0, NULL pointers, no zero-length arrays - and simply
        shows nothing."""
        frames_out = multi_frame_defs.get(sname)
        if not frames_out:
            return "0", 0, 0, 0

        ident = c_ident(sname)
        frame_inits = []
        for fi, (subtiles, tile_bytes, vram_tiles) in enumerate(frames_out):
            if not subtiles:
                frame_inits.append("    { 0, 0, 0, 0 },   /* empty frame */")
                continue
            sub_ident = f"npc_sprite_{ident}_multi{fi}_tiles"
            c_parts.append(f"static const ASpriteSubTile {sub_ident}[{len(subtiles)}] =")
            c_parts.append("{")
            c_parts.append("    /* dx, dy, tile_offset (8x8 VRAM tiles), flip_h, flip_v, "
                           "palette_bank, priority, tall */")
            for st in subtiles:
                # tile_offset: this sub-tile's first 8x8 VRAM tile within
                # its frame's tile_data - sprite_set_multi_frame() uploads
                # the frame's vram_tiles*32 bytes contiguously at
                # sub_tile_index, and write_multi_oam() addresses this OBJ
                # as sub_tile_index + tile_offset (see sprite.c).
                c_parts.append(
                    f"    {{ {st['dx']}, {st['dy']}, {st['tile_offset']}, "
                    f"{1 if st['flip_h'] else 0}, {1 if st['flip_v'] else 0}, "
                    f"{st['palette']}, {1 if st['priority'] else 0}, "
                    f"{1 if st['tall'] else 0} }},"
                )
            c_parts.append("};")
            c_parts.append("")
            data_ident = f"npc_sprite_{ident}_multi{fi}_data"
            c_parts.append(c_array("uint8_t", data_ident, tile_bytes, "0x{:02X}", 16))
            c_parts.append("")
            frame_inits.append(
                f"    {{ {sub_ident}, {len(subtiles)}, {data_ident}, {vram_tiles} }},")

        multi_ident = f"npc_sprite_{ident}_multi_frames"
        c_parts.append(f"static const ASpriteMultiFrame {multi_ident}[{len(frames_out)}] =")
        c_parts.append("{")
        c_parts.extend(frame_inits)
        c_parts.append("};")
        c_parts.append("")
        return (multi_ident, len(frames_out), multi_max_sub.get(sname, 0),
                multi_max_vram.get(sname, 0))

    def emit_anim_map(sname):
        """Emit this sprite's runtime direction->state map (see
        build_anim_map(); Entity.anim_map in entity.h) and return its C
        expression, or "0" (no map - legacy runtime behaviour)."""
        amap = sprite_anim_map.get(sname)
        if amap is None or not sprite_state_lists.get(sname):
            return "0"
        ident = f"npc_sprite_{c_ident(sname)}_anim_map"
        c_parts.append("/* idle: down, up, right, left; moving: down, up, right, left "
                       "(255 = keep current state) */")
        c_parts.append(c_array("uint8_t", ident, amap, "{}", 8))
        c_parts.append("")
        return ident

    # The "player" sheet's composed frames / map are also needed by the
    # player Entity itself (player_sprite_def below), even when no NPC uses
    # the "player" sprite.
    sprite_multi_expr = {}
    sprite_anim_map_expr = {}
    for sname in npc_sprite_names + ([] if "player" in npc_sprite_names else ["player"]):
        sprite_multi_expr[sname] = emit_multi_frames(sname)
        sprite_anim_map_expr[sname] = emit_anim_map(sname)

    # Emit the global npc_sprites[] array.
    npc_sprite_count = len(npc_sprite_names)
    if npc_sprite_count > 0:
        c_parts.append(f"const NpcSpriteDef npc_sprites[{npc_sprite_count}] =")
        c_parts.append("{")
        for sname in npc_sprite_names:
            bank = npc_palette_bank[sname]
            states_expr, state_count = sprite_states_expr[sname]
            ox, oy, w, h = sprite_collision_box.get(sname, (0, 0, 16, 16))
            cw, ch = sprite_canvas_size.get(sname, (16, 16))
            multi_expr, multi_count, multi_max, multi_vram = sprite_multi_expr[sname]
            anim_map_expr = sprite_anim_map_expr[sname]
            if sname == "player":
                c_parts.append(
                    f"    /* [0] player */ "
                    f"{{ player_graphics, PLAYER_FRAME_COUNT, {bank}, player_palette, "
                    f"{states_expr}, {state_count}, {ox}, {oy}, {w}, {h}, {cw}, {ch}, "
                    f"{multi_expr}, {multi_count}, {multi_max}, {multi_vram}, {anim_map_expr} }},")
            else:
                ident = c_ident(sname)
                count = npc_sprite_data[sname].get("frame_count", SPRITE_FRAMES)
                c_parts.append(
                    f"    /* [{npc_sprite_names.index(sname)}] {sname} */ "
                    f"{{ npc_sprite_{ident}_tiles, {count}, {bank}, "
                    f"npc_sprite_{ident}_palette, "
                    f"{states_expr}, {state_count}, {ox}, {oy}, {w}, {h}, {cw}, {ch}, "
                    f"{multi_expr}, {multi_count}, {multi_max}, {multi_vram}, {anim_map_expr} }},")
        c_parts.append("};")
        c_parts.append("")
    else:
        # No NPC sprites in project — emit a zero-length placeholder so
        # scenes_data.h's extern declaration still resolves.
        c_parts.append("const NpcSpriteDef npc_sprites[1] = { { 0, 0, 0, 0, 0, 0, 0, 0, 16, 16, 16, 16, 0, 0, 0, 0, 0 } };")
        c_parts.append("")

    # -----------------------------------------------------------------------
    # Player sprite metadata: the player Entity's own authored states +
    # collision box, from project.json's "spriteSheets" entry named
    # "player" (parsed above into sprite_state_lists/sprite_collision_box,
    # independent of whether any NPC also uses the "player" sprite - see
    # PlayerSpriteDef's doc comment in scene.h). Always emitted, even for
    # a project with no such entry (state_count 0, default box), so
    # main.c/scenes_data.h always have a stable player_sprite_def to read.
    # Uses its own "player_entity_*" identifier prefix so it never
    # collides with emit_sprite_states("player")'s "npc_sprite_player_*"
    # arrays above, in case an NPC ALSO uses the "player" sprite sheet.
    # -----------------------------------------------------------------------
    player_state_list = sprite_state_lists.get("player")
    if player_state_list:
        player_frame_idents = []
        for si, (frames, _speed, _flips, _refs) in enumerate(player_state_list):
            # No remap_frames() here - flip-baking is refused for "player"
            # states up front (see the BuildError in the spriteSheets
            # parsing pass above), so frames is always used as-is.
            if not frames:
                player_frame_idents.append("0")   # empty state - no zero-length array
                continue
            fident = f"player_entity_state{si}_frames"
            c_parts.append(c_array("uint8_t", fident, frames, "{}", 16))
            c_parts.append("")
            player_frame_idents.append(fident)

        c_parts.append(f"static const EntityAnimState player_entity_states[{len(player_state_list)}] =")
        c_parts.append("{")
        for si, (frames, speed, _flips, _refs) in enumerate(player_state_list):
            c_parts.append(
                f"    {{ {player_frame_idents[si]}, {len(frames)}, {speed} }},")
        c_parts.append("};")
        c_parts.append("")
        player_states_expr = "player_entity_states"
        player_state_count = len(player_state_list)
    else:
        player_states_expr = "0"
        player_state_count = 0

    p_ox, p_oy, p_w, p_h = sprite_collision_box.get("player", (0, 0, 16, 16))
    p_cw, p_ch = sprite_canvas_size.get("player", (16, 16))
    # Composed ("metasprite") frames + direction map for the player Entity
    # - the same arrays emit_multi_frames("player")/emit_anim_map("player")
    # emitted above (shared with any NPC using the "player" sprite).
    p_multi_expr, p_multi_count, p_multi_max, p_multi_vram = sprite_multi_expr["player"]
    p_anim_map_expr = sprite_anim_map_expr["player"] if player_state_list else "0"
    c_parts.append(
        f"const PlayerSpriteDef player_sprite_def = "
        f"{{ {player_states_expr}, {player_state_count}, {p_ox}, {p_oy}, {p_w}, {p_h}, "
        f"{p_cw}, {p_ch}, {p_multi_expr}, {p_multi_count}, {p_multi_max}, {p_multi_vram}, "
        f"{p_anim_map_expr} }};")
    c_parts.append("")

    # Emit the item_names[] table (index = inventory bit). Declared with
    # an explicit size >= 1 here; scenes_data.h's extern has no size, so
    # ITEM_COUNT (which may legitimately be 0) is the real count to loop
    # over, not this array's storage size.
    c_parts.append(f"const char *const item_names[{max(len(item_names), 1)}] =")
    c_parts.append("{")
    if item_names:
        for nm in item_names:
            c_parts.append(f"    {c_string_literal(nm)},")
    else:
        c_parts.append("    0,")
    c_parts.append("};")
    c_parts.append("")

    # -----------------------------------------------------------------------
    # Per-scene data.
    # -----------------------------------------------------------------------
    for scene_file, scene in scene_data_list:
        name = scene.get("name", scene_file.stem)
        ident = c_ident(name)

        bg_path = (scene_file.parent / scene["background"]).resolve()
        if not bg_path.exists():
            raise BuildError(f"{name}: background not found: {bg_path}")

        bg = convert_background(bg_path, name, scene.get("palette_map"))
        w, h = bg["width"], bg["height"]

        # New scene with no collision yet: write an all-walkable grid.
        if "collision" not in scene:
            scene["collision"] = blank_collision(w, h)
            scene_file.write_text(
                json.dumps(scene, indent=2) + "\n", encoding="utf-8")
            print(f"  {name}: added blank collision grid to {scene_file.name}")

        grid = parse_collision(scene["collision"], w, h, name)

        start = scene.get("player_start", {"x": 0, "y": 0})
        spawn = (int(start["x"]) * TILE, int(start["y"]) * TILE)

        # Only actually takes effect for whichever scene is the
        # project's start_scene (see main.c) - every scene still gets
        # the field (defaulting to "down"/0) so there's nothing
        # special-cased here about which scene that is.
        start_dir_name = str(scene.get("player_start_direction", "down")).lower()
        if start_dir_name not in DIRECTION_MAP:
            raise BuildError(
                f"{name}: unknown \"player_start_direction\" "
                f"'{start_dir_name}'. Use: down, up, right, left.")
        start_direction = DIRECTION_MAP[start_dir_name]

        music_name = scene.get("music")
        music_const = music_track_const(music_name) if music_name else None

        doors = scene.get("doors", [])
        validate_doors(doors, name, w, h, name_to_index)

        npcs = scene.get("npcs", [])

        timers = scene.get("timers", [])
        if len(timers) > MAX_TIMERS:
            raise BuildError(
                f"{name}: {len(timers)} timers listed, but the engine's "
                f"MAX_TIMERS is {MAX_TIMERS} per scene.")

        write_preview(bg, grid, spawn,
                      project_dir / "build" / f"{name}_preview.png",
                      doors, npcs)

        # Named actors, for this scene's "actor_*" events (see
        # resolve_actor()) - scene-scoped, rebuilt fresh per scene.
        npc_name_to_index = {}
        npc_sprite_of = {}
        for j, npc in enumerate(npcs):
            npc_sprite_of[j] = npc.get("sprite", "player")
            nm = npc.get("name")
            if nm is None:
                continue
            if nm == "self":
                raise BuildError(
                    f"{name}: NPC {j} can't be named \"self\" - that's "
                    "reserved for an NPC's own on_interact script to refer "
                    "to itself.")
            if nm in npc_name_to_index:
                raise BuildError(
                    f"{name}: NPC {j} reuses the name '{nm}' (already NPC "
                    f"{npc_name_to_index[nm]}). Actor names must be unique "
                    "within a scene.")
            npc_name_to_index[nm] = j

        ctx["npc_name_to_index"] = npc_name_to_index
        ctx["npc_sprite_of"] = npc_sprite_of
        # For "actor_invoke": each NPC's on_interact events (or its
        # "dialogue" shorthand), inlined wherever it's invoked.
        ctx["npc_events"] = {
            j: (npc["on_interact"] if "on_interact" in npc
                else [{"type": "text", "text": npc["dialogue"]}] if npc.get("dialogue")
                else None)
            for j, npc in enumerate(npcs)
        }
        ctx["scene_npc_count"] = len(npcs)
        ctx["self_actor_index"] = None

        # Named timers, for this scene's "start_timer" events (see
        # resolve_timer()) - scene-scoped, rebuilt fresh per scene,
        # same pattern as npc_name_to_index above.
        timer_name_to_index = {}
        for j, timer in enumerate(timers):
            nm = timer.get("name")
            if nm is None:
                continue
            if nm in timer_name_to_index:
                raise BuildError(
                    f"{name}: timer {j} reuses the name '{nm}' (already "
                    f"timer {timer_name_to_index[nm]}). Timer names must "
                    "be unique within a scene.")
            timer_name_to_index[nm] = j

        ctx["timer_name_to_index"] = timer_name_to_index
        ctx["scene_timer_count"] = len(timers)

        c_parts.append(f"/* ---- scene: {name} ---- */")
        c_parts.append(c_array("uint8_t", f"{ident}_tiles",
                               bg["tiles"], "0x{:02X}", 16))
        c_parts.append("")
        c_parts.append(c_array("uint16_t", f"{ident}_palette",
                               bg["palette"], "0x{:04X}", 8))
        c_parts.append("")
        c_parts.append(c_array("uint16_t", f"{ident}_map",
                               bg["map"], "0x{:04X}", w if w <= 16 else 16))
        c_parts.append("")
        c_parts.append(c_array("uint8_t", f"{ident}_collision",
                               grid, "{}", w if w <= 64 else 64))
        c_parts.append("")

        # Scene on_init: auto-runs once, every time this scene loads.
        on_init_events = scene.get("on_init")
        if on_init_events is not None:
            on_init_ident = f"{ident}_on_init_script"
            instructions = compile_script(on_init_events, ctx, f"{name}: on_init")
            emit_script(c_parts, on_init_ident, instructions)
            on_init_ref = on_init_ident
        else:
            on_init_ref = "0"

        # Doors / trigger zones.
        door_count = len(doors)
        if door_count > 0:
            door_values = []
            for di, door in enumerate(doors):
                where = f"{name}: door {di}"

                if "target_scene" in door:
                    events = [
                        {"type": "play_sound", "sound": "door"},
                        {"type": "switch_scene",
                         "scene": door["target_scene"],
                         "x": door.get("target_x", 0),
                         "y": door.get("target_y", 0)},
                    ]
                else:
                    events = door["events"]

                script_ident = f"{ident}_door{di}_script"
                instructions = compile_script(events, ctx, where)
                emit_script(c_parts, script_ident, instructions)

                door_values.append(
                    f"    {{ {door['x']}, {door['y']}, "
                    f"{door.get('width', 1)}, {door.get('height', 1)}, "
                    f"{script_ident} }},")

            c_parts.append(
                f"static const DoorDef {ident}_doors[{door_count}] =")
            c_parts.append("{")
            c_parts.extend(door_values)
            c_parts.append("};")
            c_parts.append("")

        # NPCs.
        npc_count = len(npcs)
        if npc_count > 0:
            npc_values = []
            for j, npc in enumerate(npcs):
                sname = npc.get("sprite", "player")
                if sname not in npc_sprite_names:
                    raise BuildError(
                        f"{name}: NPC {j} sprite '{sname}' not in sprite list.")
                sprite_idx = npc_sprite_names.index(sname)
                dir_name   = npc.get("direction", "down").lower()
                if dir_name not in DIRECTION_MAP:
                    raise BuildError(
                        f"{name}: NPC {j} has unknown direction '{dir_name}'. "
                        "Use: down, up, right, left.")
                dir_val = DIRECTION_MAP[dir_name]
                nx = int(npc["x"]) * TILE
                ny = int(npc["y"]) * TILE

                movement_name = npc.get("movement", "static").lower()
                if movement_name not in ("static", "wander"):
                    raise BuildError(
                        f"{name}: NPC {j} has unknown movement "
                        f"'{movement_name}'. Use: static, wander.")
                movement_val = 1 if movement_name == "wander" else 0

                where = f"{name}: NPC {j}"
                if "on_interact" in npc:
                    events = npc["on_interact"]
                elif npc.get("dialogue"):
                    events = [{"type": "text", "text": npc["dialogue"]}]
                else:
                    events = None

                if events is not None:
                    script_ident = f"{ident}_npc{j}_script"
                    ctx["self_actor_index"] = j   # "self" inside its own script
                    instructions = compile_script(events, ctx, f"{where} on_interact")
                    ctx["self_actor_index"] = None
                    emit_script(c_parts, script_ident, instructions)
                    script_ref = script_ident
                else:
                    script_ref = "0"

                npc_values.append(
                    f"    {{ {nx}, {ny}, {dir_val}, {sprite_idx}, "
                    f"{movement_val}, {script_ref} }},")

            c_parts.append(
                f"static const NpcDef {ident}_npcs[{npc_count}] =")
            c_parts.append("{")
            c_parts.extend(npc_values)
            c_parts.append("};")
            c_parts.append("")

        # Background timers. Each fires its own event script once, in
        # the background, "frames" frames after a "start_timer" event
        # starts it (see engine/include/timer.h) - independent of
        # whatever the main script (if any) is doing that frame.
        timer_count = len(timers)
        if timer_count > 0:
            timer_values = []
            for j, timer in enumerate(timers):
                where = f"{name}: timer {j}"
                frames = timer.get("frames")
                if not isinstance(frames, int) or isinstance(frames, bool) or frames <= 0:
                    raise BuildError(
                        f"{where}: \"frames\" must be a positive integer.")
                if frames > INT16_MAX:
                    raise BuildError(
                        f"{where}: \"frames\" ({frames}) must fit in a "
                        f"16-bit signed integer (max {INT16_MAX}).")

                events = timer.get("script", [])
                script_ident = f"{ident}_timer{j}_script"
                instructions = compile_script(events, ctx, where)
                emit_script(c_parts, script_ident, instructions)

                timer_values.append(f"    {{ {frames}, {script_ident} }},")

            c_parts.append(
                f"static const TimerDef {ident}_timers[{timer_count}] =")
            c_parts.append("{")
            c_parts.extend(timer_values)
            c_parts.append("};")
            c_parts.append("")

        c_parts.append(f"const SceneDef scene_{ident} =")
        c_parts.append("{")
        c_parts.append(f'    .name          = "{name}",')
        c_parts.append(f"    .width         = {w},")
        c_parts.append(f"    .height        = {h},")
        c_parts.append(f"    .tiles         = {ident}_tiles,")
        c_parts.append(f"    .tile_count    = {bg['tile_count']},")
        c_parts.append(f"    .palettes      = {ident}_palette,")
        c_parts.append(f"    .palette_count = {bg['palette_count']},")
        c_parts.append(f"    .map           = {ident}_map,")
        c_parts.append(f"    .collision     = {ident}_collision,")
        c_parts.append(f"    .player_x      = {spawn[0]},")
        c_parts.append(f"    .player_y      = {spawn[1]},")
        c_parts.append(f"    .player_start_direction = {start_direction},")
        c_parts.append(f"    .music_track   = {music_const if music_const else -1},")
        if door_count > 0:
            c_parts.append(f"    .doors         = {ident}_doors,")
            c_parts.append(f"    .door_count    = {door_count},")
        else:
            c_parts.append(f"    .doors         = 0,")
            c_parts.append(f"    .door_count    = 0,")
        if npc_count > 0:
            c_parts.append(f"    .npcs          = {ident}_npcs,")
            c_parts.append(f"    .npc_count     = {npc_count},")
        else:
            c_parts.append(f"    .npcs          = 0,")
            c_parts.append(f"    .npc_count     = 0,")
        if timer_count > 0:
            c_parts.append(f"    .timers        = {ident}_timers,")
            c_parts.append(f"    .timer_count   = {timer_count},")
        else:
            c_parts.append(f"    .timers        = 0,")
            c_parts.append(f"    .timer_count   = 0,")
        c_parts.append(f"    .on_init       = {on_init_ref},")
        c_parts.append("};")
        c_parts.append("")

        h_defs.append(f"extern const SceneDef scene_{ident};")
        scene_idents.append(ident)

        counts = {}
        for v in grid:
            counts[v] = counts.get(v, 0) + 1
        coll = ", ".join(f"{COLLISION_NAMES[k]} {v}"
                         for k, v in sorted(counts.items()))
        door_str = f", {door_count} door(s)" if door_count else ""
        npc_str  = f", {npc_count} NPC(s)"  if npc_count  else ""
        timer_str = f", {timer_count} timer(s)" if timer_count else ""
        print(f"  {name}: {w * 8}x{h * 8}, {bg['tile_count']} tiles, "
              f"{bg['colors']} colors in {bg['palette_count']} palette(s), "
              f"collision: {coll}{door_str}{npc_str}{timer_str}")

    start_scene = c_ident(project.get("start_scene", scene_idents[0]))
    if start_scene not in scene_idents:
        raise BuildError(
            f"start_scene '{project.get('start_scene')}' has no scene file.")

    c_parts.append("const SceneDef *const scenes[SCENE_COUNT] =")
    c_parts.append("{")
    for ident in scene_idents:
        c_parts.append(f"    &scene_{ident},")
    c_parts.append("};")
    c_parts.append("")

    # -----------------------------------------------------------------------
    # Header.
    # -----------------------------------------------------------------------
    header = [
        "/*",
        " * Generated by compiler/build_project.py - do not edit.",
        " */",
        "",
        "#ifndef SCENES_DATA_H",
        "#define SCENES_DATA_H",
        "",
        '#include "scene.h"',
        "",
        f"#define SCENE_COUNT       {len(scene_idents)}",
        f"#define SCENE_START       (&scene_{start_scene})",
        f"#define NPC_SPRITE_COUNT  {max(npc_sprite_count, 1)}",
        f"#define ITEM_COUNT        {len(item_names)}",
        "",
        *h_defs,
        "",
        "extern const SceneDef *const scenes[SCENE_COUNT];",
        "extern const NpcSpriteDef    npc_sprites[NPC_SPRITE_COUNT];",
        "extern const PlayerSpriteDef player_sprite_def;",
        "extern const char *const      item_names[];",
        "",
        "#endif",
        "",
    ]

    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        uge_names = build_uge_songs(ENGINE_MUSIC_DIR, out_dir)
    except UgeError as e:
        raise BuildError(str(e)) from None
    if uge_names:
        print(f"Wrote {out_dir / 'uge_songs.c'} ({len(uge_names)} .uge song(s))")
    (out_dir / "scenes_data.c").write_text("\n".join(c_parts), encoding="utf-8")
    (out_dir / "scenes_data.h").write_text("\n".join(header), encoding="utf-8")
    print(f"Wrote {out_dir / 'scenes_data.c'}")


def main():
    here = Path(__file__).resolve().parent

    parser = argparse.ArgumentParser(description="Build a Shimmer Engine project.")
    parser.add_argument("project", type=Path, help="project folder")
    parser.add_argument("--out", type=Path,
                        default=here.parent / "engine" / "data",
                        help="where to write generated C (default engine/data)")
    args = parser.parse_args()

    try:
        print(f"Building {args.project}")
        build(args.project.resolve(), args.out.resolve())
    except BuildError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
