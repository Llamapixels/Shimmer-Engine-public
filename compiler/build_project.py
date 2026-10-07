"""
Shimmer Engine project compiler.

    python compiler/build_project.py path/to/project

Reads a Shimmer Engine project folder:

    <project>/
        project.json            { "name": ..., "start_scene": "town",
                                   "items": ["Old Key", ...],       <- optional
                                   "flags": ["met_town_npc"],       <- optional
                                   "variables": ["score"] }         <- optional
        scenes/<name>.json      one file per scene
        assets/backgrounds/     background PNGs
        assets/sprites/         sprite PNGs (any size, up to 15 colors)

and writes GBA-ready C data into engine/data/:

    scenes_data.c / scenes_data.h

Sprites (the player's and every NPC's) are compiled into scenes_data.c as
sprite_defs[] - see compiler/sprites.py for the "spriteSheets" format (GB
Studio's: a canvas, animation states, 8 animations per state, frames built
from tiles cut out of the PNG) and how frames become GBA hardware OBJs.
project.json "playerSprite" names the player's sprite (default "player";
with no assets/sprites/player.png that is engine/data/player.png).

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

Scene JSON collision, "collision": one string per tile row, one character
per tile: "." walkable, "#" solid, "~" water (blocks walking), "!" damage,
"H" ladder (walkable; climbed in Platformer scenes),
and one-way tiles "^" "v" "<" ">" whose top/bottom/left/right edge is solid
(they can't be entered across that edge, only from the other sides).

Scene JSON "tile_overrides" (the editor's Tiles tool): {"x,y": [sx, sy]}
draws the background's own 8x8 tile (sx, sy) into cell (x, y) at build
time; the PNG itself is left alone. "notes" (editor sticky notes) are
ignored by the build.

Scene JSON NPC format:
    "npcs": [
        {
            "sprite": "npc1",          <- assets/sprites/npc1.png (default:
                                           the player's sprite)
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
            "pinned": true,            <- optional: x/y are a screen tile
                                           position; drawn fixed on screen
                                           (HUD), no collisions, no talking
            "move_speed": 2,           <- optional px/frame, 1-8 (wandering
                                           and scripted moves; default 1)
            "anim_speed": 8,           <- optional frames per animation
                                           frame (0 = the sprite's own)
            "above_player": true,      <- optional: drawn in front of the
                                           player instead of behind it
            "push_player": true,       <- optional: walking into the player
                                           shoves it along (else it just
                                           overlaps, and the player can walk
                                           out)
            "collision_group": 1,      <- optional 1-3: touching the player
                                           runs "on_hit", or else the
                                           scene's "on_player_hit" for it
            "on_init": [ ... ],        <- optional, runs as this NPC when
                                           the scene starts, before the
                                           scene's own on_init
            "on_update": [ ... ],      <- optional, loops in a background
                                           thread (at most once a frame)
            "on_hit": [ ... ],         <- optional, see collision_group
            "platform": true,          <- optional, Platformer scenes: the
                                           player stands on it and rides it
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

More scene settings (GB Studio's scene inspector):
    "player_sprite": "hero",       <- the player's sprite in this scene
                                       (default: project.json playerSprite)
    "parallax": [                  <- 1-3 horizontal screen bands, top to
        {"rows": 4, "speed": "fixed"},   bottom, each scrolling at camera x
        {"rows": 4, "speed": 2},          >> speed (0 = normal, 1-8, or
        {"speed": 0}                      "fixed"); the last band runs to
    ],                                    the bottom of the screen
    "on_player_hit": {"1": [...], "2": [...], "3": [...]}
                                   <- runs when the player touches an NPC
                                       of that collision group
    "player": {"on_init": [...], "on_update": [...], "anim_speed": 8,
               "collisions": false}
                                   <- the player's own actor settings, like
                                       an NPC's ("self" = the player); see
                                       player_init_events()
    "type": "platform"             <- scene type (GB Studio's): topdown
                                       (default), platform, adventure, shmup,
                                       pointnclick or logo - how the player
                                       moves; see compiler/modes.py
    "engine": {"pl_grav": 0.3}     <- this scene's own engine settings, over
                                       project.json "engine" (the full list
                                       is compiler/engine_settings.json)
    "layers": [                    <- up to 2 GBA background layers (BG2/BG3),
        {"image": "../assets/backgrounds/sky.png",   full images scrolling
         "speed_x": 0.25, "speed_y": 0,              at speed x the camera
         "auto_x": 0.5, "auto_y": 0,                 (0-4; 1 = with the map)
         "front": false}                             plus px/frame drift
    ]                                                (-8..8). front: false =
                                                     behind the map, true =
                                                     over it (under actors),
                                                     "actors" = over both.
        Layers line up with the map (as the editor shows them) with the
        camera at the player's start; parallax moves them from there.
        Layer images are up to 512x256 or 256x512 and repeat. With a layer
        behind, only transparent pixels of the scene's background show it.
        The scene and its layers share the 1024 tiles and 15 palettes.
A door may also have "on_leave": [...], run when the player steps back out.

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
    Any event can carry "__disabled": true to be skipped entirely (the
    editor's "Disable event", as in GB Studio), and an event with an
    "else" branch can carry "__disableElse": true to skip just that branch.
    { "type": "text", "text": "..." }
        Show a dialogue box. "\n" in the text starts a new page. Pauses the
        script until the player dismisses it.
        "focus": "none" | "dim" | "blur" | "dim_blur" dims and/or blurs
        everything but the box while it's open (choice and menu too).
        Optional box options: "position": "bottom" | "top" | "middle",
        "rows": 1-4 (text lines, default 2), "frame": false (text only,
        no box).
        Text codes (as in GB Studio): "!F:fontname!" switches font,
        "!C:#ff4040!" colours the text ("!C!" resets) and
        "!S5!" sets the text speed (frames per character, 0 = instant)
        from that point on. Text too long for the box continues on the
        next page.
    { "type": "play_sound", "sound": "<wav name>", "channel": "auto" | "a" | "b",
      "loop": false, "volume": "full" | "half" }
        A WAV from assets/sounds (compiler/wav.py) on one of the GBA's two
        Direct Sound channels ("auto" picks a free one). The built-in
        blip/door/save/item still work as before.
    { "type": "stop_sound", "channel": "auto" | "a" | "b" }
        Stop WAV playback on a channel ("auto" = both).
    { "type": "set_engine_setting", "setting": "pl_extra_jumps", "value": 1 }
        Change an engine setting (compiler/engine_settings.json) for the
        rest of the scene.
    { "type": "launch_projectile", "sprite": "bullet", "actor": "player",
      "direction": "facing" | "up" | "down" | "left" | "right" | "angle",
      "angle": 45, "speed": 3, "lifetime": 0, "hits": "actors",
      "group": 1, "pierce": false, "through_walls": false, "front": false,
      "offset_x": 0, "offset_y": 0 }
        Fire a sprite in a straight line (angle: degrees, 0 = right, 90 =
        up; lifetime 0 = until it leaves the screen). hits: "actors" (any
        with a collision group), "group1".."group3", or "player" (runs the
        scene's on_player_hit for "group") - or a list of them. front: drawn
        in front of the player and actors.
        More options: "path": "straight" | "wave" | "arc_high" | "arc_low" |
        "boomerang" ("wave_size" px, "wave_length" frames; "gravity" and
        "lift" in px per frame; "return_after" frames); "bounces": 0-254
        or "forever" (off walls; "bounce_actors": true for actors too);
        "on_land": "vanish" | "stick" | "linger" ("linger_frames", and
        "land_state" to switch animation state); "follow": true keeps it
        at its offset from the thrower (melee, with speed 0);
        "mirror_offset": true flips offset_x when fired to the left.
    { "type": "projectile_recall" | "projectile_remove", "sprite": "<name>" | "all" }
        Send projectiles back to their thrower (stuck ones too), or remove them.
    { "type": "text_set_font", "font": "<name>" }
    { "type": "text_set_frame", "frame": "<name>" }
    { "type": "text_set_speed", "speed": 0-30 }
        Font / dialogue frame / text speed for all text from now on. Fonts
        are assets/fonts/*.png, frames assets/frames/*.png; "default" is the
        built-in one (see compiler/ui.py).
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
    { "type": "play_music", "track": "<assets/music song name>", "loop": true }
        Start (or restart) a music track from a script, not just a scene's
        own "music" property (see below) - e.g. from an on_init, so it
        loops in the background until changed/stopped. Already-playing the
        same track is a no-op. "loop" defaults to true; false plays once.
    { "type": "stop_music" }
        Silence whatever music is currently playing.
    { "type": "wait", "frames": 30 }
        Pause the script for a number of frames (60 = 1 second).
    { "type": "switch_scene", "scene": "<name>", "x": 5, "y": 8,
      "transition": "fade_black" | "fade_white" | "none" | "flash" | "mosaic"
                    | "box" | "bars" | "wipe",
      "transition_frames": 8 }
        Fade out, load another scene, and place the player at tile (x, y)
        there. Ends the script. "transition" (default fade_black) and
        "transition_frames" (1-255, default 8) set how it fades out and in.
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
        Switch an actor to one of its sprite's animation states (by name,
        "Default"/"" for the first, or index).
    { "type": "actor_set_animate", "actor": ..., "enabled": true }
        Turn animation on ("enabled": true, the default) or off - off holds
        whatever frame is currently shown.
    { "type": "actor_set_frame", "actor": ..., "frame": 3 }
        Show a frame (0-based) of the actor's current animation and stop
        animating, until animation is turned back on or the actor turns or
        starts/stops moving.
    { "type": "actor_set_collision_box", "actor": ...,
      "x": 0, "y": 4, "width": 16, "height": 12 }
        Override an actor's collision box: offset ("x"/"y", default 0/0)
        and size ("width"/"height", required) in pixels, relative to the
        actor's 16x16 footprint - like a sprite's "bounds", but settable at
        runtime (e.g. shrinking a character's box when it lies
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
    { "type": "camera_move_to", "x": 10, "y": 8, "speed": 1 }
        Pan the camera to a tile position (the screen's centre) at "speed"
        px per frame (1-16, default 1). Pauses the script until it arrives. Leaves the
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
    { "type": "actor_line_of_sight", "actor": ..., "range": 4, "walls": true,
      "script": [...] }
        Runs "script" (as that actor) whenever the player steps into the
        tiles in front of it, up to "range" tiles, following its position
        and facing; "walls": solid tiles block the view. Again only after
        the player has left the view. Until the scene changes, or
    { "type": "actor_line_of_sight_remove", "actor": ... }
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
    { "type": "actor_transform", "actor": ..., "angle": 0-359,
      "scale_x": 25-200, "scale_y": 25-200 }   degrees clockwise, percent
    { "type": "actor_rotate_by", "actor": ..., "degrees": -359-359 }
    { "type": "text_draw", "slot": 0-7, "x": 0-29, "y": 0-19, "text": "...",
      "frame": false, "frames": 0 }
        Text on screen, outside the dialogue box (item names, HUDs). It
        stays until cleared, or for "frames" frames. Slots let several
        show at once; drawing into a slot replaces it. Up to 4 lines.
    { "type": "text_clear", "slot": 0-7 | "all" | "area", "x", "y",
      "width", "height" }   ("area": clears every text it overlaps)
    { "type": "player_set_sprite", "sprite": "<name>", "keep": true }
        Give the player another sprite (and its collision box). "keep"
        (default true) also uses it in later scenes that don't set their
        own player sprite.
    { "type": "actor_scale_by", "actor": ..., "x": -175-175, "y": -175-175 }
        Percentage points added to the scale (it stays within 25-200).
        These three take {"var": "<name>"} in place of any number.
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
    "music": "town"            <- optional, a .uge song (hUGETracker /
                                   GB Studio) in the project's assets/music/
                                   folder, without the extension. Played on
                                   the GBA's Game Boy sound channels. Leave
                                   unset to keep whatever's already playing.

This is the "compiler" box from the architecture:
    editor (later) -> project files -> THIS -> engine data -> .gba
"""

from pathlib import Path
import argparse
import json
import re
import sys

from PIL import Image

from sprites import (SheetImage, SpriteError, check_sheet, compile_sprite, default_sheet,
                     emit_sprite)
from cutscenes import CutsceneError, build_cutscenes, cutscene_files
from ui import UiError, build_ui, color_index, encode_char, ui_to_c
import modes as M
from uge import UgeError, build_uge_songs, track_const as uge_track_const
from wav import WavError, build_sounds, sound_files
from expr import ExprError, compile_expression, to_rpn as expr_to_rpn
import expr as X

# Each project's .uge songs live in <project>/assets/music/ and are
# compiled into engine/data/uge_songs.c.
PROJECT_MUSIC_DIR = Path("assets") / "music"
PROJECT_SOUNDS_DIR = Path("assets") / "sounds"
PROJECT_CUTSCENES_DIR = Path("assets") / "cutscenes"   # video cutscenes (compiler/cutscenes.py)   # WAV sound effects (compiler/wav.py)
WAV_CHANNELS = {"auto": 0, "a": 1, "b": 2}


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
    "^": 4,   # one-way: top edge solid (can't enter from above)
    "v": 5,   # one-way: bottom edge solid
    "<": 6,   # one-way: left edge solid
    ">": 7,   # one-way: right edge solid
    "H": 8,   # ladder (walkable; Platformer scenes climb it)
}
COLLISION_NAMES = {0: "walkable", 1: "solid", 2: "water", 3: "damage",
                   4: "top", 5: "bottom", 6: "left", 7: "right", 8: "ladder"}

# Direction name -> engine constant
DIRECTION_MAP = {
    "down":  0,
    "up":    1,
    "right": 2,
    "left":  3,
}

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
MAX_NPCS = 16          # actors per scene - keep in sync with NPC_MAX in
                        # engine/source/main.c (more were silently dropped)

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

# "switch_scene" events' "transition" -> TransitionColor.
SCENE_TRANSITIONS = {"fade_black": 0, "fade_white": 1, "none": 2, "flash": 3, "mosaic": 4,
                     "box": 5, "bars": 6, "wipe": 7}

# Matches a "{varname}" reference inside text/prompt/option/label
# strings - see interpolate_vars().
VAR_REF_RE = re.compile(r"\{([^{}]+)\}")
# Text codes (GB Studio's): "!F:fontname!" switches font, "!S5!" / "!S:5!"
# sets the text speed (frames per character, 0 = instant). Ours:
# "!C:#ff4040!" colours the text from there on, "!C!" goes back to the
# font's own colour.
TEXT_CODE_RE = re.compile(r"\{([^{}]+)\}|!F:([^!]+)!|!S:?(\d+)!|!C(?::([^!]*))?!")

# Display Text "position" -> engine/include/ui.h UI_BOX_*.
TEXT_POSITIONS = {"bottom": 0, "top": 1, "middle": 2, "custom": 3}
# Text/choice/menu "focus": dim and/or blur everything but the box.
TEXT_FOCUS = {"none": 0, "dim": 1, "blur": 2, "dim_blur": 3}

# Move Actor To / Set Actor Position options -> engine/include/script.h
# MOVE_F_* flags.
MOVE_TYPES = {"horizontal": 0, "vertical": 1, "diagonal": 2}
MOVE_TARGETS = {"position": 0, "variables": 1, "actor": 2}

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

# "input_script_set" triggers -> the engine's INPUT_TRIG_* (script.c).
INPUT_TRIGGERS = {"press": 0, "hold": 1, "long": 2, "release": 3, "tap": 4, "combo": 5}

# int16_t range - set_var/add_var/if_var literal values must fit.
INT16_MIN, INT16_MAX = -32768, 32767

# Preview tint per collision type (RGBA overlay).
PREVIEW_COLORS = {
    1: (255, 0, 0, 110),
    2: (0, 80, 255, 110),
    3: (255, 160, 0, 110),
    4: (255, 220, 0, 110),
    5: (255, 220, 0, 110),
    6: (255, 220, 0, 110),
    7: (255, 220, 0, 110),
    8: (160, 90, 20, 110),
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

def load_background(path, tile_overrides=None, scene_name=""):
    image = Image.open(path).convert("RGBA")
    w, h = image.size
    if tile_overrides:
        image = apply_tile_overrides(image, tile_overrides, scene_name or path.name)

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


def apply_tile_overrides(image, overrides, where):
    """The scene's "tile_overrides" (painted with the editor's Tiles tool):
    {"x,y": [src_x, src_y]} puts the background's own 8x8 tile at
    (src_x, src_y) into cell (x, y). Sources come from the unedited image."""
    if not isinstance(overrides, dict):
        raise BuildError(f"{where}: \"tile_overrides\" must be an object.")
    src = image
    out = image.copy()
    tw, th = image.width // TILE, image.height // TILE
    for key, value in overrides.items():
        try:
            x, y = (int(v) for v in key.split(","))
            sx, sy = int(value[0]), int(value[1])
        except (ValueError, TypeError, IndexError):
            raise BuildError(f"{where}: bad tile_overrides entry '{key}'.") from None
        if not (0 <= x < tw and 0 <= y < th and 0 <= sx < tw and 0 <= sy < th):
            continue   # outside the image (e.g. after the background changed)
        out.paste(src.crop((sx * TILE, sy * TILE, sx * TILE + TILE, sy * TILE + TILE)), (x * TILE, y * TILE))
    return out


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


# Stand-in "colour" for see-through pixels when only real transparency
# counts (scenes with background layers - see convert_background()).
SEE_THROUGH = (-1, -1, -1)


def convert_background(path, name, palette_map=None, tile_overrides=None, see_through_only=False, image=None):
    """`see_through_only`: only transparent pixels become palette index 0
    (see-through to the layers behind); otherwise the most common colour
    is the backdrop, free in every palette bank."""
    if image is None:
        image = load_background(path, tile_overrides, name)
    w_tiles = image.width // TILE
    h_tiles = image.height // TILE

    # Transparent pixels count as the backdrop.
    data = image.tobytes()
    raw = [tuple(data[i:i + 4]) for i in range(0, len(data), 4)]
    solid = [p for p in raw if p[3] != 0]
    if see_through_only:
        backdrop = SEE_THROUGH
    else:
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
        entries = [gba_color(backdrop if backdrop != SEE_THROUGH else (0, 0, 0))] + [gba_color(c) for c in bank]
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
        "banks": banks,
        "backdrop": backdrop,
    }


# Background layers (GBA BG2/BG3) - see "layers" in the docstring.
LAYER_SIZES = {(32, 32): 0, (64, 32): 1, (32, 64): 2}   # tiles -> BGxCNT size
MAX_LAYERS = 2
LAYER_SPEED_MAX = 4.0


def _fixed8(value, field, where, lo, hi):
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not lo <= value <= hi:
        raise BuildError(f"{where}: \"{field}\" must be a number from {lo} to {hi}.")
    return int(round(value * 256))


def scenes_root(scene_file):
    """The project's scenes/ folder, which a scene's asset paths
    ("../assets/...") are relative to wherever in it the scene file is."""
    for parent in scene_file.parents:
        if parent.name == "scenes":
            return parent
    return scene_file.parent


def convert_layer(scene_file, layer, i, scene_name):
    """One entry of a scene's "layers": its image, padded with transparency
    up to a hardware background size (256 or 512 px each way, at most
    512x256 or 256x512; the layer repeats beyond that), converted like a
    background. Returns (bg dict, layer settings)."""
    where = f"{scene_name}: layer {i + 1}"
    if not isinstance(layer, dict) or not layer.get("image"):
        raise BuildError(f"{where}: needs an \"image\".")
    path = (scenes_root(scene_file) / layer["image"]).resolve()
    if not path.exists():
        raise BuildError(f"{where}: image not found: {path}")
    image = Image.open(path).convert("RGBA")
    w = 256 if image.width <= 256 else 512 if image.width <= 512 else 0
    h = 256 if image.height <= 256 else 512 if image.height <= 512 else 0
    if not w or not h or (w, h) == (512, 512):
        raise BuildError(
            f"{where}: {path.name} is {image.width}x{image.height}; layers can be up to "
            "512x256 or 256x512 pixels (they repeat to fill the screen). Use 256 or 512 "
            "pixels wide for a seamless repeat.")
    padded = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    padded.paste(image, (0, 0))
    bg = convert_background(path, f"{where} ({path.name})", see_through_only=True, image=padded)
    front = layer.get("front", False)
    if front not in (False, True, "actors"):
        raise BuildError(f"{where}: \"front\" must be false (behind the map), true (over the map) "
                         "or \"actors\" (over the map and actors).")
    settings = {
        "size": LAYER_SIZES[(w // TILE, h // TILE)],
        "front": 2 if front == "actors" else 1 if front else 0,
        "speed_x": _fixed8(layer.get("speed_x", 0.5), "speed_x", where, 0, LAYER_SPEED_MAX),
        "speed_y": _fixed8(layer.get("speed_y", 0.5), "speed_y", where, 0, LAYER_SPEED_MAX),
        "auto_x": _fixed8(layer.get("auto_x", 0), "auto_x", where, -8, 8),
        "auto_y": _fixed8(layer.get("auto_y", 0), "auto_y", where, -8, 8),
    }
    return bg, settings


def merge_layer(main, layer_bg, where):
    """Add a layer's tiles and palette banks to the scene's own (all BG
    layers share one tile set and the 15 BG palette banks). Returns the
    layer's map with tile and bank numbers moved past the scene's."""
    tile_off = main["tile_count"] - 1          # the layer's blank tile 0 is dropped
    bank_off = main["palette_count"]
    if tile_off + layer_bg["tile_count"] > MAX_TILES:
        raise BuildError(
            f"{where}: the scene and its layers need {tile_off + layer_bg['tile_count']} unique "
            f"tiles between them; the most is {MAX_TILES}.")
    if bank_off + layer_bg["palette_count"] > MAX_BANKS:
        raise BuildError(
            f"{where}: the scene and its layers need {bank_off + layer_bg['palette_count']} "
            f"palettes between them; the most is {MAX_BANKS} (each 8x8 tile uses one "
            "palette of up to 15 colours).")
    main["tiles"] = main["tiles"] + layer_bg["tiles"][32:]
    main["tile_count"] += layer_bg["tile_count"] - 1
    main["palette"] = main["palette"] + layer_bg["palette"]
    main["palette_count"] += layer_bg["palette_count"]
    out = []
    for e in layer_bg["map"]:
        t = e & 0x3FF
        if t == 0:
            out.append(0)
        else:
            out.append((t + tile_off) | (e & 0x0C00) | (((e >> 12) + bank_off) << 12))
    return out


# ---------------------------------------------------------------------------
# Collision
# ---------------------------------------------------------------------------

def blank_collision(w, h):
    return ["." * w for _ in range(h)]


def fit_collision(rows, w, h, scene_name):
    """The collision grid cropped or padded (walkable) to the background's
    size - it keeps its old size when a scene's background is swapped for
    one of another size."""
    if not isinstance(rows, list) or not all(isinstance(r, str) for r in rows):
        raise BuildError(f"{scene_name}: \"collision\" must be a list of row strings.")
    if len(rows) == h and all(len(r) == w for r in rows):
        return rows
    old_w = max((len(r) for r in rows), default=0)
    print(f"  {scene_name}: collision was {old_w}x{len(rows)} tiles but the background is "
          f"{w}x{h}; built with the extra cut off / the gap walkable. Open the scene in the "
          "editor to repaint it.")
    return [(rows[y] if y < len(rows) else "")[:w].ljust(w, ".") for y in range(h)]


MAX_TILE_ANIM_TILES = 64


def compile_tile_animations(anims, bg, scene_file, scene_name):
    """Scene "tile_animations": [{"x", "y" (tile on the map), "width",
    "height" (tiles, default 1), "image" (frames side by side, relative to
    the scene file), "speed" (frames each is shown, default 8)}] ->
    [(scene tile index, frame count, speed, 4bpp bytes frame by frame)],
    one per animated 8x8 tile. Frames use the tile's own palette."""
    if not anims:
        return []
    if not isinstance(anims, list):
        raise BuildError(f"{scene_name}: \"tile_animations\" must be a list.")
    out = {}
    w, h = bg["width"], bg["height"]
    for n, a in enumerate(anims):
        where = f"{scene_name}: animated tiles {n + 1}"
        if not isinstance(a, dict) or not a.get("image"):
            raise BuildError(f"{where}: pick an image of frames.")
        x = resolve_small_int(a.get("x", 0), "x", where, 0, w - 1)
        y = resolve_small_int(a.get("y", 0), "y", where, 0, h - 1)
        tw = resolve_small_int(a.get("width", 1), "width", where, 1, 8)
        th = resolve_small_int(a.get("height", 1), "height", where, 1, 8)
        speed = resolve_small_int(a.get("speed", 8), "speed", where, 1, 255)
        if x + tw > w or y + th > h:
            raise BuildError(f"{where}: the area goes past the edge of the map.")
        path = scene_file.parent / a["image"]
        if not path.exists():
            raise BuildError(f"{where}: image not found: {a['image']}")
        img = Image.open(path).convert("RGBA")
        fw, fh = tw * TILE, th * TILE
        if img.height != fh or img.width < fw * 2 or img.width % fw:
            raise BuildError(f"{where}: the image must be {fh} px tall with at least 2 frames of {fw} px "
                             f"side by side (it's {img.width}x{img.height}).")
        frames = img.width // fw
        px = img.load()
        for j in range(th):
            for i in range(tw):
                entry = bg["map"][(y + j) * w + (x + i)]
                tile, hf, vf, bank_i = entry & 0x3FF, (entry >> 10) & 1, (entry >> 11) & 1, entry >> 12
                if tile == 0:
                    raise BuildError(f"{where}: tile ({x + i}, {y + j}) is the plain backdrop colour, which "
                                     "can't animate (it fills every empty spot). Pick tiles with some detail.")
                bank = bg["banks"][bank_i]
                data = []
                for f in range(frames):
                    idx = []
                    for yy in range(8):
                        for xx in range(8):
                            sx = 7 - xx if hf else xx
                            sy = 7 - yy if vf else yy
                            r, g, b, al = px[f * fw + i * 8 + sx, j * 8 + sy]
                            c = (r, g, b)
                            if al == 0 or c == bg["backdrop"]:
                                idx.append(0)
                            elif c in bank:
                                idx.append(1 + bank.index(c))
                            else:
                                raise BuildError(
                                    f"{where}: frame {f + 1} uses #{r:02x}{g:02x}{b:02x}, which isn't in the "
                                    f"palette of the map tile at ({x + i}, {y + j}). Animation frames can only "
                                    "use that tile's colours.")
                    for k in range(0, 64, 2):
                        data.append(idx[k] | (idx[k + 1] << 4))
                out[tile] = (tile, frames, speed, data)
    if len(out) > MAX_TILE_ANIM_TILES:
        raise BuildError(f"{scene_name}: {len(out)} animated tiles; the most is {MAX_TILE_ANIM_TILES}.")
    return list(out.values())


def parse_front(rows, w, h, scene_name):
    """Scene "front_tiles": rows of "#" (drawn in front of actors) and "." ->
    a flat list of booleans, w*h (short or missing rows count as ".")."""
    if not isinstance(rows, list) or not all(isinstance(r, str) for r in rows):
        raise BuildError(f"{scene_name}: \"front_tiles\" must be a list of strings.")
    return [(rows[y][x] == "#") if y < len(rows) and x < len(rows[y]) else False
            for y in range(h) for x in range(w)]


def parse_collision(rows, w, h, scene_name):
    rows = fit_collision(rows, w, h, scene_name)

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
    """Resolve an "actor_set_state" event's "state" field (a state name or
    an index) to its index in the target actor's sprite's "states" list.
    The first state's name is "" (shown as "Default"); "default" also
    finds it."""
    sprite_name = ctx.get("npc_sprite_of", {}).get(actor_idx)
    names = ctx.get("sprite_state_names", {}).get(sprite_name, {})
    count = len(names)

    if isinstance(ref, bool):
        raise BuildError(f"{where}: \"state\" must be a state name or index.")

    if isinstance(ref, int):
        if ref < 0 or ref >= count:
            raise BuildError(
                f"{where}: state index {ref} is out of range (sprite "
                f"'{sprite_name}' has {count} state(s)).")
        return ref

    if isinstance(ref, str):
        if ref in names:
            return names[ref]
        if ref.lower() == "default" and "" in names:
            return names[""]
        known = ", ".join(sorted(n or "Default" for n in names))
        raise BuildError(
            f"{where}: unknown state '{ref}' on sprite '{sprite_name}'. "
            f"Its states: {known}")

    raise BuildError(f"{where}: \"state\" must be a state name or index.")


# Sentinel actor index meaning "the player", not an NPC - must match
# PLAYER_ACTOR_INDEX in engine/include/actor.h exactly. Distinct from
# any real NPC index (always >= 0) and from -1 (used elsewhere as a
# "not locked"/"not moving" sentinel), so it can't collide with those.
PLAYER_ACTOR_INDEX = -2


# "hits" names -> projectile.h's PROJ_P_TARGET bits (bit 0 player, bit g group g).
PROJECTILE_TARGETS = {"player": 1, "group1": 2, "group2": 4, "group3": 8, "actors": 14}
PROJECTILE_DIRECTIONS = {"right": (1, 0), "left": (-1, 0), "up": (0, -1), "down": (0, 1)}
# "path" -> (PROJ_PATH_*, default gravity, default lift) in px per frame.
PROJECTILE_PATHS = {"straight": (0, 0, 0), "wave": (1, 0, 0), "arc_high": (2, 0.2, 4),
                    "arc_low": (2, 0.1, 1.5), "boomerang": (3, 0, 0)}
PROJECTILE_LAND = {"vanish": 0, "stick": 1, "linger": 2}


def compile_projectile(ev, ctx, where):
    """A "launch_projectile" event -> the int16 PROJ_P_* array
    (engine/include/projectile.h); returns its C identifier."""
    import math
    sprite = _require(ev, "sprite", where)
    if sprite not in ctx["sprite_index"]:
        raise BuildError(f"{where}: unknown sprite '{sprite}'.")
    bank = ctx["scene_banks"].get(sprite)
    if bank is None:
        raise BuildError(f"{where}: sprite '{sprite}' has no palette in this scene.")
    source = resolve_actor(ev.get("actor", "player"), ctx, where)
    speed = ev.get("speed", 2)
    if not isinstance(speed, (int, float)) or isinstance(speed, bool) or not 0 <= speed <= 8:
        raise BuildError(f"{where}: \"speed\" must be a number of pixels per frame, 0 to 8.")
    speed_fx = int(round(speed * 256))
    direction = ev.get("direction", "facing")
    facing, vx, vy = 0, 0, 0
    if direction == "facing":
        facing = 1
    elif direction == "angle":
        angle = ev.get("angle", 0)
        if not isinstance(angle, (int, float)) or isinstance(angle, bool):
            raise BuildError(f"{where}: \"angle\" must be a number of degrees (0 = right, 90 = up).")
        vx = int(round(math.cos(math.radians(angle)) * speed_fx))
        vy = int(round(-math.sin(math.radians(angle)) * speed_fx))
    elif direction in PROJECTILE_DIRECTIONS:
        dx, dy = PROJECTILE_DIRECTIONS[direction]
        vx, vy = dx * speed_fx, dy * speed_fx
    else:
        raise BuildError(f"{where}: \"direction\" must be facing, up, down, left, right or angle.")
    life = resolve_small_int(ev.get("lifetime", 0), "lifetime", where, 0, 32767)
    hits = ev.get("hits", "actors")
    hit_list = hits if isinstance(hits, list) else [hits]
    target = 0
    for h in hit_list:
        if h not in PROJECTILE_TARGETS:
            raise BuildError(f"{where}: \"hits\" must be one or a list of: {', '.join(PROJECTILE_TARGETS)}.")
        target |= PROJECTILE_TARGETS[h]
    group = resolve_small_int(ev.get("group", 1), "group", where, 1, 3)
    flags = ((1 if ev.get("pierce") else 0) | (2 if ev.get("through_walls") else 0) | (4 if ev.get("front") else 0)
             | (8 if ev.get("follow") else 0) | (16 if ev.get("bounce_actors") else 0)
             | (32 if ev.get("mirror_offset") else 0))
    off_x = resolve_small_int(ev.get("offset_x", 0), "offset_x", where, -128, 128)
    off_y = resolve_small_int(ev.get("offset_y", 0), "offset_y", where, -128, 128)

    def px_number(key, default, lo, hi):
        v = ev.get(key, default)
        if not isinstance(v, (int, float)) or isinstance(v, bool) or not lo <= v <= hi:
            raise BuildError(f"{where}: \"{key}\" must be a number from {lo} to {hi}.")
        return int(round(v * 256))

    path = str(ev.get("path", "straight"))
    if path not in PROJECTILE_PATHS:
        raise BuildError(f"{where}: \"path\" must be one of: {', '.join(PROJECTILE_PATHS)}.")
    path_id, arc_gravity, arc_lift = PROJECTILE_PATHS[path]
    gravity = px_number("gravity", arc_gravity, 0, 2)
    lift = px_number("lift", arc_lift, 0, 8)
    amp = resolve_small_int(ev.get("wave_size", 8), "wave_size", where, 0, 64) if path == "wave" else 0
    period = resolve_small_int(ev.get("wave_length", 30), "wave_length", where, 2, 600) if path == "wave" else 0
    ret = resolve_small_int(ev.get("return_after", 30), "return_after", where, 1, 600) if path == "boomerang" else 0
    bounces = ev.get("bounces", 0)
    bounces = 255 if bounces in ("forever", 255) else resolve_small_int(bounces, "bounces", where, 0, 254)
    on_land = str(ev.get("on_land", "vanish"))
    if on_land not in PROJECTILE_LAND:
        raise BuildError(f"{where}: \"on_land\" must be one of: {', '.join(PROJECTILE_LAND)}.")
    linger = resolve_small_int(ev.get("linger_frames", 60), "linger_frames", where, 1, 32767) if on_land == "linger" else 0
    land_state = 0
    if ev.get("land_state"):
        names = {str(n).strip().lower(): i for n, i in ctx["sprite_state_names"].get(sprite, {}).items()}
        key = str(ev["land_state"]).strip().lower()
        if key == "default":
            key = ""
        if key not in names:
            raise BuildError(f"{where}: sprite '{sprite}' has no state '{ev['land_state']}'.")
        land_state = names[key] + 1
    data = [ctx["sprite_index"][sprite], bank, source, facing, vx, vy, speed_fx, life, group,
            target, flags, off_x, off_y,
            path_id, amp, period, gravity, lift, ret, bounces, PROJECTILE_LAND[on_land], linger, land_state]
    ident = _aux_ident(ctx, "projectile")
    ctx["_aux"].append(("expr", ident, data))
    return ident


def projectile_sprites(obj):
    """Sprite names of every "launch_projectile" event anywhere in obj."""
    found = []
    if isinstance(obj, dict):
        if obj.get("type") == "launch_projectile" and isinstance(obj.get("sprite"), str):
            found.append(obj["sprite"])
        for v in obj.values():
            found += projectile_sprites(v)
    elif isinstance(obj, list):
        for v in obj:
            found += projectile_sprites(v)
    return found


def _events_of_type(obj, etype):
    """Every event dict of type `etype` anywhere in obj."""
    found = []
    if isinstance(obj, dict):
        if obj.get("type") == etype:
            found.append(obj)
        for v in obj.values():
            found += _events_of_type(v, etype)
    elif isinstance(obj, list):
        for v in obj:
            found += _events_of_type(v, etype)
    return found


def player_sprite_events(obj):
    """Sprite names of every "player_set_sprite" event anywhere in obj."""
    found = []
    if isinstance(obj, dict):
        if obj.get("type") == "player_set_sprite" and isinstance(obj.get("sprite"), str):
            found.append(obj["sprite"])
        for v in obj.values():
            found += player_sprite_events(v)
    elif isinstance(obj, list):
        for v in obj:
            found += player_sprite_events(v)
    return found


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
    """Compile dialogue text for the engine (engine/include/ui.h):
    "{varname}" -> 0x02 + the variable's index (0x05 for 128+; shown as
    its value), "!F:font!" -> 0x03 + font index, "!S5!" -> 0x04 + speed
    (each argument byte stored +1, see ui.h), and every
    other character to the byte the fonts use for it (Latin-1, or a font's
    .json "mapping"; anything else shows as "?"). c_string_literal()
    escapes the non-printable bytes afterwards."""
    ui = ctx.get("ui")
    out = []
    pos = 0

    def plain(s):
        out.append("".join(encode_char(ch, ui) for ch in s) if ui else s)

    for m in TEXT_CODE_RE.finditer(text):
        plain(text[pos:m.start()])
        pos = m.end()
        # Argument bytes are stored +1 so none of them is ever a 0 (which
        # would end the C string).
        if m.group(1) is not None:
            idx = resolve_var(m.group(1), ctx, where)
            out.append(("\x02" if idx < 128 else "\x05") + chr((idx & 0x7F) + 1))
        elif m.group(2) is not None:
            out.append("\x03" + chr(resolve_ui_name(m.group(2), "font", ctx, where) + 1))
        elif m.group(0).startswith("!C"):
            out.append("\x06" + chr(resolve_text_color(m.group(4), ctx, where) + 1))
        else:
            speed = int(m.group(3))
            if speed > 30:
                raise BuildError(f"{where}: text speed !S{speed}! is too slow - use 0 to 30 frames per character.")
            out.append("\x04" + chr(speed + 1))
    plain(text[pos:])
    return "".join(out)


def resolve_text_color(value, ctx, where):
    """A "!C:...!" code's colour -> its dialogue palette index (0 = the
    font's own colour, for "!C!" / "!C:default!")."""
    value = (value or "").strip()
    if value == "" or value.lower() == "default":
        return 0
    if not re.fullmatch(r"#[0-9a-fA-F]{6}", value):
        raise BuildError(f"{where}: text colour !C:{value}! should be a hex colour like !C:#ff4040! (or !C! to reset).")
    ui = ctx.get("ui")
    rgb = tuple(int(value[i:i + 2], 16) for i in (1, 3, 5))
    idx = color_index(ui, rgb) if ui else None
    if idx is None:
        raise BuildError(f"{where}: text colour {value} isn't in the dialogue palette.")
    return idx


def text_focus(ev, where):
    """A text/choice/menu event's "focus" -> DIALOGUE_FOCUS_* bits."""
    focus = str(ev.get("focus", "none")).lower()
    if focus not in TEXT_FOCUS:
        raise BuildError(f"{where}: \"focus\" must be one of: {', '.join(TEXT_FOCUS)}.")
    return TEXT_FOCUS[focus]


def text_options(ev, where):
    """Display Text's box options -> SCRIPT_TEXT's `a` and `b` (see
    engine/include/dialogue.h DIALOGUE_OPT_* / DIALOGUE_PLACE_*)."""
    pos = str(ev.get("position", "bottom")).lower()
    if pos not in TEXT_POSITIONS:
        raise BuildError(f"{where}: \"position\" must be bottom, top, middle or custom.")
    rows = ev.get("rows", 2)
    if isinstance(rows, bool) or not isinstance(rows, int) or not 1 <= rows <= 4:
        raise BuildError(f"{where}: \"rows\" must be 1 to 4.")
    framed = ev.get("frame", True) is not False
    a = (TEXT_POSITIONS[pos] | ((0 if rows == 2 else rows) << 2) | (0 if framed else 0x20)
         | (text_focus(ev, where) << 6))
    b = 0
    if pos == "custom":
        bx = resolve_small_int(ev.get("box_x", 0), "box_x", where, 0, 29)
        by = resolve_small_int(ev.get("box_y", 0), "box_y", where, 0, 19)
        bw = resolve_small_int(ev.get("box_width", 30), "box_width", where, 1, 30)
        height = rows + (2 if framed else 0)
        if bx + bw > 30:
            raise BuildError(f"{where}: the box goes off the right of the screen (X {bx} + width {bw} > 30 tiles).")
        if by + height > 20:
            raise BuildError(f"{where}: the box goes off the bottom of the screen (Y {by} + {height} tiles tall > 20).")
        if framed and bw < 3:
            raise BuildError(f"{where}: a framed box needs a width of at least 3 tiles.")
        b = bx | (by << 5) | (bw << 10)
    return a, b


def actor_move_ex(ev, idx, ctx, where):
    """Move Actor To / Set Actor Position with any GB Studio-style option
    -> (b, c, d) for SCRIPT_ACTOR_MOVE_EX / SET_POSITION_EX."""
    target = str(ev.get("target", "position")).lower()
    if target not in MOVE_TARGETS:
        raise BuildError(f"{where}: \"target\" must be position, variables or actor.")
    pixels = str(ev.get("units", "tiles")).lower() == "pixels"
    move_type = str(ev.get("move_type", "horizontal")).lower()
    if move_type not in MOVE_TYPES:
        raise BuildError(f"{where}: \"move_type\" must be horizontal, vertical or diagonal.")
    flags = (1 if pixels else 0) | (2 if ev.get("relative") else 0) | (4 if ev.get("collisions") else 0)
    flags |= MOVE_TYPES[move_type] << 3
    flags |= MOVE_TARGETS[target] << 5
    if target == "variables":
        b = resolve_var(_require(ev, "x_var", where), ctx, where)
        c = resolve_var(_require(ev, "y_var", where), ctx, where)
    elif target == "actor":
        b = resolve_actor(_require(ev, "target_actor", where), ctx, where)
        c = 0
    else:
        lo, hi = (-32768, 32767) if pixels or ev.get("relative") else (0, 4095)
        b = resolve_small_int(ev.get("x", 0), "x", where, lo, hi)
        c = resolve_small_int(ev.get("y", 0), "y", where, lo, hi)
    return b, c, flags


# Fields that switch Move Actor To / Set Actor Position to the full version.
MOVE_EX_KEYS = ("target", "relative", "units", "collisions", "move_type")


def resolve_ui_name(name, kind, ctx, where):
    """A font or frame name -> its index in ui_data.c."""
    ui = ctx.get("ui")
    names = ui[f"{kind}_names"] if ui else []
    name = str(name).strip()
    if name not in names:
        known = ", ".join(names) or "(none)"
        raise BuildError(f"{where}: unknown {kind} '{name}'. {kind.capitalize()}s in this project: {known}")
    return names.index(name)


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
            opts, place = text_options(ev, ev_where)
            out.append(_instr("SCRIPT_TEXT", a=opts, b=place, text=c_string_literal(text)))

        elif etype == "text_set_font":
            idx = resolve_ui_name(_require(ev, "font", ev_where), "font", ctx, ev_where)
            out.append(_instr("SCRIPT_TEXT_SET_FONT", a=idx))

        elif etype == "text_set_frame":
            idx = resolve_ui_name(_require(ev, "frame", ev_where), "frame", ctx, ev_where)
            out.append(_instr("SCRIPT_TEXT_SET_FRAME", a=idx))

        elif etype == "text_set_speed":
            speed = resolve_small_int(_require(ev, "speed", ev_where), "speed", ev_where, 0, 30)
            out.append(_instr("SCRIPT_TEXT_SET_SPEED", a=speed))

        elif etype == "set_engine_setting":
            key = _require(ev, "setting", ev_where)
            try:
                idx = M.setting_index(key, ev_where)
                value = M.setting_value(key, _require(ev, "value", ev_where), ev_where)
            except M.ModeError as e:
                raise BuildError(str(e)) from None
            out.append(_instr("SCRIPT_SET_ENGINE_SETTING", a=idx, b=value))

        elif etype == "launch_projectile":
            out.append(_instr("SCRIPT_LAUNCH_PROJECTILE", ptr=compile_projectile(ev, ctx, ev_where)))

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
            raw = str(_require(ev, "sound", ev_where)).strip()
            if raw in ctx["wav_names"]:
                channel = str(ev.get("channel", "auto")).lower()
                if channel not in WAV_CHANNELS:
                    raise BuildError(f"{ev_where}: \"channel\" must be auto, a or b.")
                flags = (1 if ev.get("loop") else 0) | (2 if ev.get("volume") == "half" else 0)
                out.append(_instr("SCRIPT_PLAY_WAV", a=ctx["wav_names"].index(raw), b=WAV_CHANNELS[channel], c=flags))
                continue
            sound = raw.lower()
            const = SOUND_NAME_TO_CONST.get(sound)
            if const is None:
                known = ", ".join(sorted(SOUND_NAME_TO_CONST) + ctx["wav_names"])
                raise BuildError(f"{ev_where}: unknown sound '{sound}'. Use one of: {known}")
            out.append(_instr("SCRIPT_PLAY_SOUND", a=const))

        elif etype == "stop_sound":
            channel = str(ev.get("channel", "auto")).lower()
            if channel not in WAV_CHANNELS:
                raise BuildError(f"{ev_where}: \"channel\" must be auto (both), a or b.")
            out.append(_instr("SCRIPT_STOP_WAV", a=WAV_CHANNELS[channel]))

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
            trans = str(ev.get("transition", "fade_black"))
            if trans not in SCENE_TRANSITIONS:
                raise BuildError(f"{ev_where}: \"transition\" must be one of: {', '.join(SCENE_TRANSITIONS)}.")
            speed = resolve_small_int(ev.get("transition_frames", 8), "transition_frames", ev_where, 1, 255)
            if trans != "fade_black" or speed != 8:
                out.append(_instr("SCRIPT_SCENE_TRANSITION", a=SCENE_TRANSITIONS[trans], b=speed))
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

        elif etype in ("actor_set_position", "actor_move_to") and any(k in ev for k in MOVE_EX_KEYS):
            idx = resolve_actor(_require(ev, "actor", ev_where), ctx, ev_where)
            b, c, d = actor_move_ex(ev, idx, ctx, ev_where)
            op = "SCRIPT_ACTOR_MOVE_EX" if etype == "actor_move_to" else "SCRIPT_ACTOR_SET_POSITION_EX"
            out.append(_instr(op, a=idx, b=b, c=c, d=d))

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
                out, "SCRIPT_CHOICE", {"text": c_string_literal(packed), "a": text_focus(ev, ev_where)}, "b",
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
            out.append(_instr("SCRIPT_MENU", a=len(options), c=text_focus(ev, ev_where),
                              text=c_string_literal(packed)))
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
            speed = resolve_small_int(ev.get("speed", 1), "speed", ev_where, 1, 16)
            out.append(_instr("SCRIPT_CAMERA_MOVE_TO", a=speed, b=x, c=y))

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
            out.append(_instr("SCRIPT_PLAY_MUSIC", a=music_track_const(track, ctx, ev_where), b=loop))

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
    "play_cutscene", "if_expression", "set_var_expression", "loop_while", "loop_for",
    "set_var_true", "set_var_false", "var_inc", "var_dec", "if_var_true",
    "if_var_false", "var_set_flags", "var_add_flags", "var_clear_flags",
    "if_var_flags", "vars_reset", "seed_rng", "rate_limit", "label", "goto",
    "switch",
    "actor_invoke", "thread_start", "thread_stop", "timer_script_set",
    "actor_line_of_sight", "actor_line_of_sight_remove",
    "timer_restart", "timer_disable", "input_script_set",
    "input_script_remove", "music_routine", "actor_set_position_vars",
    "actor_move_to_vars", "actor_set_position_relative",
    "actor_move_relative", "actor_set_frame_var", "actor_set_move_speed",
    "actor_set_anim_speed", "actor_set_collisions", "actor_push",
    "actor_transform", "actor_rotate_by", "actor_scale_by", "player_set_sprite",
    "text_draw", "text_clear", "projectile_recall", "projectile_remove",
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
        override = 1 if ev.get("override", False) else 0
        # Like GB Studio the script runs alongside play; "freeze_player"
        # stops the player (and everything waiting on the main script) instead.
        freeze = 1 if ev.get("freeze_player", False) else 0
        trigger = str(ev.get("trigger", "press"))
        if trigger not in INPUT_TRIGGERS:
            raise BuildError(f"{where}: \"trigger\" must be one of: {', '.join(INPUT_TRIGGERS)}.")
        d, text = 0, "0"
        if trigger != "press":
            frames = resolve_small_int(ev.get("frames", 15), "frames", where, 1, 4095)
            d = INPUT_TRIGGERS[trigger] | (frames << 3)
        if trigger == "combo":
            steps = ev.get("combo", [])
            if isinstance(steps, str):
                steps = steps.replace(",", " ").split()
            if not isinstance(steps, list) or not 2 <= len(steps) <= 16:
                raise BuildError(f"{where}: a combo needs 2 to 16 buttons in order, e.g. \"down right a\".")
            bits = []
            for s in steps:
                name = str(s).strip().lower()
                if name not in BUTTON_NAME_TO_CONST:
                    raise BuildError(f"{where}: unknown button '{s}' in the combo. "
                                     f"Use: {', '.join(BUTTON_NAME_TO_CONST)}.")
                bits.append(list(BUTTON_NAME_TO_CONST).index(name))
            mask = BUTTON_NAME_TO_CONST[str(steps[-1]).strip().lower()]
            text = c_string_literal("".join(chr(b + 1) for b in bits))
        else:
            mask = _button_mask(ev.get("buttons"), where)
        ptr = compile_subscript(ev.get("script", []), ctx, where)
        out.append(_instr("SCRIPT_INPUT_SCRIPT_SET", a=mask, b=override, c=freeze, d=d, text=text, ptr=ptr))

    elif etype == "actor_line_of_sight":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        if idx == PLAYER_ACTOR_INDEX:
            raise BuildError(f"{where}: Line Of Sight is for an actor watching the player, not the player.")
        rng = resolve_small_int(ev.get("range", 4), "range", where, 1, 30)
        walls = 1 if ev.get("walls", True) else 0
        # "self" inside the script = the watching actor.
        saved_self = ctx.get("self_actor_index")
        ctx["self_actor_index"] = idx
        try:
            ptr = compile_subscript(ev.get("script", []), ctx, where)
        finally:
            ctx["self_actor_index"] = saved_self
        out.append(_instr("SCRIPT_LINE_OF_SIGHT", a=idx, b=rng, c=walls, ptr=ptr))

    elif etype == "actor_line_of_sight_remove":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        out.append(_instr("SCRIPT_LINE_OF_SIGHT", a=idx))

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

    elif etype == "actor_transform":
        # A variable is passed as -(index + 1) (literals are never negative).
        def arg(key, default, lo, hi):
            v = ev.get(key, default)
            if isinstance(v, dict):
                return -(resolve_var(_require(v, "var", where), ctx, where) + 1)
            return resolve_small_int(v, key, where, lo, hi)
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        out.append(_instr("SCRIPT_ACTOR_TRANSFORM", a=idx, b=arg("angle", 0, 0, 359),
                          c=arg("scale_x", 100, 25, 200), d=arg("scale_y", 100, 25, 200)))

    elif etype == "actor_rotate_by":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        deg = _require(ev, "degrees", where)
        if isinstance(deg, dict):
            out.append(_instr("SCRIPT_ACTOR_ROTATE_BY", a=idx,
                              b=resolve_var(_require(deg, "var", where), ctx, where), c=1))
        else:
            out.append(_instr("SCRIPT_ACTOR_ROTATE_BY", a=idx,
                              b=resolve_small_int(deg, "degrees", where, -359, 359)))

    elif etype in ("projectile_recall", "projectile_remove"):
        sname = ev.get("sprite", "all")
        if sname in (None, "", "all"):
            idx = -1
        elif sname in ctx["sprite_index"]:
            idx = ctx["sprite_index"][sname]
        else:
            raise BuildError(f"{where}: unknown sprite '{sname}'.")
        out.append(_instr("SCRIPT_PROJECTILES", a=0 if etype == "projectile_recall" else 1, b=idx))

    elif etype == "text_draw":
        slot = resolve_small_int(ev.get("slot", 0), "slot", where, 0, 7)
        x = resolve_small_int(ev.get("x", 0), "x", where, 0, 29)
        y = resolve_small_int(ev.get("y", 0), "y", where, 0, 19)
        frames = resolve_small_int(ev.get("frames", 0), "frames", where, 0, 32767)
        text = interpolate_vars(_require(ev, "text", where), ctx, where)
        out.append(_instr("SCRIPT_TEXT_DRAW", a=slot | ((1 if ev.get("frame") else 0) << 3),
                          b=x | (y << 5), c=frames, text=c_string_literal(text)))

    elif etype == "text_clear":
        what = ev.get("slot", "all")
        if what == "all":
            out.append(_instr("SCRIPT_TEXT_CLEAR", a=8))
        elif what == "area":
            x = resolve_small_int(ev.get("x", 0), "x", where, 0, 29)
            y = resolve_small_int(ev.get("y", 0), "y", where, 0, 19)
            w = resolve_small_int(ev.get("width", 30), "width", where, 1, 30)
            h = resolve_small_int(ev.get("height", 20), "height", where, 1, 20)
            out.append(_instr("SCRIPT_TEXT_CLEAR", a=9, b=x | (y << 5), c=w | (h << 5)))
        else:
            if isinstance(what, str) and what.isdigit():
                what = int(what)
            out.append(_instr("SCRIPT_TEXT_CLEAR", a=resolve_small_int(what, "slot", where, 0, 7)))

    elif etype == "player_set_sprite":
        sname = _require(ev, "sprite", where)
        if sname not in ctx["sprite_index"]:
            raise BuildError(f"{where}: unknown sprite '{sname}'.")
        out.append(_instr("SCRIPT_PLAYER_SET_SPRITE", a=ctx["sprite_index"][sname],
                          b=1 if ev.get("keep", True) else 0))

    elif etype == "actor_scale_by":
        idx = resolve_actor(_require(ev, "actor", where), ctx, where)
        flags = 0
        vals = []
        for bit, key in ((1, "x"), (2, "y")):
            v = ev.get(key, 0)
            if isinstance(v, dict):
                flags |= bit
                vals.append(resolve_var(_require(v, "var", where), ctx, where))
            else:
                vals.append(resolve_small_int(v, key, where, -175, 175))
        out.append(_instr("SCRIPT_ACTOR_SCALE_BY", a=idx, b=vals[0], c=vals[1], d=flags))

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

    elif etype == "play_cutscene":
        name = str(_require(ev, "cutscene", where))
        if name not in ctx["cutscene_names"]:
            known = ", ".join(ctx["cutscene_names"]) or "(none - make one in the Cutscenes tab)"
            raise BuildError(f"{where}: unknown cutscene '{name}'. Cutscenes: {known}")
        flags = (1 if ev.get("skippable", True) else 0) | (2 if ev.get("stop_music", True) else 0)
        out.append(_instr("SCRIPT_PLAY_CUTSCENE", a=ctx["cutscene_names"].index(name), b=flags))

    elif etype in ("scene_push", "scene_pop", "scene_pop_all", "scene_reset"):
        op_name = {"scene_push": "SCRIPT_SCENE_PUSH", "scene_pop": "SCRIPT_SCENE_POP",
                   "scene_pop_all": "SCRIPT_SCENE_POP", "scene_reset": "SCRIPT_SCENE_RESET"}[etype]
        if etype == "scene_push":
            a = 1 if ev.get("remember_all", False) else 0
        else:
            a = 1 if etype == "scene_pop_all" else 0
        out.append(_instr(op_name, a=a))

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


def player_init_events(player, where):
    """The scene's "player" settings as events run (as the player) at the
    start of its on_init: animation speed, tile collisions off, its own
    on_init, then its on_update started as a looping background thread.
        "player": { "anim_speed": 0-255, "collisions": false,
                    "on_init": [...], "on_update": [...] }"""
    if not player:
        return []
    if not isinstance(player, dict):
        raise BuildError(f"{where} must be an object.")
    events = []
    if player.get("anim_speed"):
        events.append({"type": "actor_set_anim_speed", "actor": "self", "speed": player["anim_speed"]})
    if player.get("collisions") is False:
        events.append({"type": "actor_set_collisions", "actor": "self", "enabled": False})
    events += _script_list(player.get("on_init") or [], f"{where} \"on_init\"")
    if player.get("on_update"):
        body = _script_list(player["on_update"], f"{where} \"on_update\"") + [{"type": "wait", "frames": 1}]
        events.append({"type": "thread_start", "script": [{"type": "loop", "body": body}]})
    return events


def compile_script_parts(parts, ctx, where):
    """Like compile_script(), for several event lists run one after the
    other as one script, each with its own "self" actor and label scope:
    a scene's on_init prefixed with its NPCs' own "on_init"s. `parts` is
    [(events, self_index or None, where)]."""
    out = CompiledScript()
    outer_aux, outer_labels, outer_self = ctx.get("_aux"), ctx.get("_labels"), ctx.get("self_actor_index")
    ctx["_aux"] = out.aux
    try:
        for events, self_index, part_where in parts:
            ctx["_labels"] = {"defined": {}, "gotos": []}
            ctx["self_actor_index"] = self_index
            compile_events(events, out, ctx, part_where)
            labels = ctx["_labels"]
            for goto_index, name, goto_where in labels["gotos"]:
                if name not in labels["defined"]:
                    known = ", ".join(sorted(labels["defined"])) or "(none in this script)"
                    raise BuildError(f"{goto_where}: no label '{name}' in this script. Known labels: {known}.")
                out[goto_index]["a"] = labels["defined"][name]
        out.append(_instr("SCRIPT_END"))
    finally:
        ctx["_aux"], ctx["_labels"], ctx["self_actor_index"] = outer_aux, outer_labels, outer_self
    return out


def _script_list(value, where):
    if not isinstance(value, list):
        raise BuildError(f"{where} must be a list of events.")
    return value


PARALLAX_SPEEDS = {"fixed": 128}


def parse_parallax(value, where):
    """Scene "parallax": up to 3 bands [{"rows": 4, "speed": 1}, ...], top
    to bottom; the last one runs to the bottom of the screen. speed: 0 =
    normal, 1-8 = 1/2 .. 1/256 of the camera's speed, "fixed" = still."""
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 3:
        raise BuildError(f"{where}: \"parallax\" must be a list of 1-3 layers.")
    layers = []
    total = 0
    for i, layer in enumerate(value):
        if not isinstance(layer, dict):
            raise BuildError(f"{where}: parallax layer {i + 1} must be an object.")
        speed = layer.get("speed", 0)
        speed = PARALLAX_SPEEDS.get(speed, speed)
        if not isinstance(speed, int) or isinstance(speed, bool) or not (0 <= speed <= 8 or speed == 128):
            raise BuildError(f"{where}: parallax layer {i + 1} speed must be 0-8 or \"fixed\".")
        rows = layer.get("rows", 1)
        if i < len(value) - 1:
            if not isinstance(rows, int) or isinstance(rows, bool) or rows < 1:
                raise BuildError(f"{where}: parallax layer {i + 1} needs \"rows\" (1 or more).")
            total += rows
            if total >= 20:
                raise BuildError(f"{where}: parallax layers above the last must add up to less than 20 rows (the screen's height).")
        else:
            rows = 0
        layers.append((rows, speed))
    return layers


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
# Sprites (the conversion itself lives in compiler/sprites.py)
# ---------------------------------------------------------------------------

DEFAULT_PLAYER_PNG = Path(__file__).resolve().parent.parent / "engine" / "data" / "player.png"
# Built-in dialogue font/frame/cursor (compiler/ui.py).
DEFAULT_UI_DIR = Path(__file__).resolve().parent.parent / "engine" / "data" / "ui"


def compile_project_sprites(project, project_dir, names):
    """Compile each sprite in `names` (assets/sprites/<name>.png plus its
    project.json "spriteSheets" entry, if any). Returns {name:
    CompiledSprite}."""
    sheets = project.get("spriteSheets", [])
    if not isinstance(sheets, list):
        raise BuildError("project.json \"spriteSheets\" must be a list.")
    by_name = {}
    for i, sheet in enumerate(sheets):
        if not isinstance(sheet, dict) or not isinstance(sheet.get("name"), str):
            raise BuildError(f"project.json spriteSheets[{i}] must be an object with a \"name\".")
        if sheet["name"] in by_name:
            raise BuildError(f"project.json spriteSheets has two entries named '{sheet['name']}'.")
        by_name[sheet["name"]] = (i, sheet)

    sprites_dir = project_dir / "assets" / "sprites"
    compiled = {}
    for name in names:
        png = sprites_dir / f"{name}.png"
        if not png.exists() and name == "player":
            png = DEFAULT_PLAYER_PNG
        if not png.exists():
            raise BuildError(
                f"sprite '{name}': {sprites_dir / (name + '.png')} not found. Add the PNG "
                "in the editor's Sprites section, or pick another sprite.")
        try:
            image = SheetImage(png, name)
            if name in by_name:
                i, sheet = by_name[name]
                sheet = check_sheet(sheet, f"project.json spriteSheets[{i}] ('{name}')")
            else:
                sheet = default_sheet(name, image.width, image.height)
            cs = compile_sprite(sheet, image, f"sprite '{name}'")
        except SpriteError as e:
            raise BuildError(str(e)) from None
        print(f"  sprite: {name} - {len(cs.frames)} frame(s), {len(cs.state_maps)} state(s), "
              f"up to {cs.max_objs} OBJ(s) / {cs.max_vram} VRAM tile(s) per frame")
        compiled[name] = cs
    return compiled


def assign_palette_banks(sprites, player_sprite, compiled, scene_name, player_only=False):
    """OBJ palette bank for each sprite a scene's NPCs use. Bank 0 is the
    player's; sprites with identical palettes share a bank (with
    player_only, none share the player's). Returns {sprite name: bank}."""
    bank_of_palette = {("player only",) if player_only else tuple(compiled[player_sprite].palette): 0}
    banks = {}
    for name in sprites:
        key = tuple(compiled[name].palette)
        if key not in bank_of_palette:
            if len(bank_of_palette) >= 16:
                raise BuildError(
                    f"{scene_name}: its actors' sprites need more than 16 different palettes "
                    "(the GBA has 16 OBJ palette banks, one of them the player's). Use fewer "
                    "different sprites in this scene, or give some the same colors.")
            bank_of_palette[key] = len(bank_of_palette)
        banks[name] = bank_of_palette[key]
    return banks


# ---------------------------------------------------------------------------
# Preview
# ---------------------------------------------------------------------------

def file_stem(name):
    """A scene name as a plain file name: "Forest/Cave 1" -> "Forest-Cave 1"
    (folder slashes, and anything else Windows won't take, become "-")."""
    stem = re.sub(r'[\/:*?"<>|]+', "-", str(name)).strip(" .-")
    return stem or "scene"


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
    project dict) contains a play_music event anywhere, including
    nested branches. Used to decide whether scenes_data.c needs
    #include "music.h"."""
    if isinstance(node, dict):
        if node.get("type") == "play_music":
            return True
        return any(_uses_play_music(v) for v in node.values())
    if isinstance(node, list):
        return any(_uses_play_music(v) for v in node)
    return False


def music_track_const(name, ctx, where):
    """A music name (e.g. "town" or "town.uge", as a scene's "music"
    property or a play_music event's "track" gives it) to its UGE_*
    track id in uge_songs.h, checked against the project's
    assets/music/*.uge files."""
    stem = name[:-4] if name.lower().endswith(".uge") else name
    known = ctx["music_names"]
    if stem not in known:
        listed = ", ".join(sorted(known)) or "(none - add .uge files to assets/music/)"
        raise BuildError(f"{where}: unknown music '{name}'. Songs in this project: {listed}")
    return uge_track_const(stem)


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

def write_if_changed(path, text):
    """Write a generated file only when its text changed, so an unchanged
    file keeps its timestamp and isn't recompiled."""
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")


def strip_disabled(node):
    """A copy of `node` (any JSON value) with every disabled event removed
    from every list it's in, and every disabled Else branch emptied. The
    editor marks these like GB Studio's "Disable Event" / "Disable Else":
    { ..., "__disabled": true } and { ..., "__disableElse": true }. Done
    once at load so nothing later (compiling, asset scans, checks) ever
    sees a disabled event."""
    if isinstance(node, list):
        return [strip_disabled(v) for v in node
                if not (isinstance(v, dict) and "type" in v and v.get("__disabled"))]
    if isinstance(node, dict):
        out = {k: strip_disabled(v) for k, v in node.items()}
        if "type" in out and out.get("__disableElse") and "else" in out:
            out["else"] = []
        return out
    return node


def build(project_dir, out_dir):
    project_file = project_dir / "project.json"
    if not project_file.exists():
        raise BuildError(f"No project.json in {project_dir}")

    project = strip_disabled(json.loads(project_file.read_text(encoding="utf-8")))

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

    # Scenes can sit in subfolders (a "/" in a scene's name, like GB Studio).
    scene_files = sorted((project_dir / "scenes").rglob("*.json"))
    if not scene_files:
        raise BuildError(f"No scenes in {project_dir / 'scenes'}")

    # First pass: build name -> index mapping so doors/events can reference
    # target scenes by name.
    scene_names = []
    scene_data_list = []
    for scene_file in scene_files:
        scene = strip_disabled(json.loads(scene_file.read_text(encoding="utf-8")))
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
        "sprite_state_names": {},   # filled in below, once the sprites are compiled
        "sprite_index": {},         # sprite name -> sprite_defs[] index (same)
        "scene_banks": {},          # sprite name -> OBJ palette bank, per scene
        "timer_name_to_index": {},
        "scene_timer_count": 0,
        "custom_scripts": custom_scripts,
        "music_names": {p.stem for p in (project_dir / PROJECT_MUSIC_DIR).glob("*.uge")},
        "wav_names": [p.stem for p in sound_files(project_dir / PROJECT_SOUNDS_DIR)],
        "cutscene_names": [n for n, _, _ in cutscene_files(project_dir / PROJECT_CUTSCENES_DIR)],
    }
    M.set_sound_names(ctx["wav_names"])
    M.set_script_ids(list(custom_scripts))

    # Dialogue fonts, frames and cursor (compiler/ui.py) - needed before any
    # text is compiled, for "!F:font!" codes and character mapping.
    referenced = json.dumps(project) + "".join(json.dumps(s) for _, s in scene_data_list)
    try:
        ctx["ui"] = build_ui(project, project_dir, DEFAULT_UI_DIR, referenced)
    except UiError as e:
        raise BuildError(str(e)) from None
    for f in ctx["ui"]["fonts"]:
        print(f"  font: {f['name']} ({'fixed' if f['fixed'] else 'variable'} width, {len(f['widths'])} characters)")

    # -----------------------------------------------------------------------
    # Sprites: the player's plus every NPC's (see compiler/sprites.py).
    # -----------------------------------------------------------------------
    player_sprite = project.get("playerSprite") or "player"
    sprite_names = [player_sprite]
    custom_projectiles = projectile_sprites(project.get("customScripts") or [])
    # "Set Player Sprite" targets: compiled too, and while a project uses
    # the event, OBJ palette bank 0 is the player's alone (the player's
    # colors can change at any time).
    player_swaps = player_sprite_events(project.get("customScripts") or [])
    for _, scene in scene_data_list:
        player_swaps += player_sprite_events(scene)
    for _, scene in scene_data_list:
        for sname in ([scene.get("player_sprite")] + [npc.get("sprite") or player_sprite for npc in scene.get("npcs", [])]
                      + projectile_sprites(scene) + custom_projectiles + player_swaps):
            if sname and sname not in sprite_names:
                sprite_names.append(sname)
    if len(sprite_names) > 255:
        raise BuildError(f"{len(sprite_names)} different sprites are used; the most is 255.")
    compiled_sprites = compile_project_sprites(project, project_dir, sprite_names)
    ctx["sprite_index"] = {n: i for i, n in enumerate(sprite_names)}
    ctx["sprite_state_names"] = {n: cs.state_names for n, cs in compiled_sprites.items()}

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
        '#include "mode_settings.h"',   # MS_COUNT
    ]

    if (any(scene.get("music") for _, scene in scene_data_list)
            or _uses_play_music(project)
            or any(_uses_play_music(scene) for _, scene in scene_data_list)):
        # music.h pulls in uge_songs.h (UGE_* ids, written by build()
        # below). _uses_play_music(project) catches project.json's top-level
        # customScripts[]; each scene's own dict (on_init/doors/npcs/
        # timers) is checked separately since scene JSON lives in its
        # own file, not nested inside project.json.
        c_parts.append('#include "music.h"')

    c_parts.append("")

    h_defs = []
    scene_idents = []

    # Sprites: sprite_defs[] (SpriteDef, engine/include/entity.h), in
    # sprite_names order; player_sprite_index picks the player's.
    sprite_inits = []
    for sname in sprite_names:
        code, init = emit_sprite(compiled_sprites[sname], f"spr_{c_ident(sname)}", sname)
        c_parts.append(code)
        c_parts.append("")
        sprite_inits.append(f"    /* [{len(sprite_inits)}] {sname} */ {init},")
    c_parts.append(f"const SpriteDef sprite_defs[{len(sprite_names)}] =")
    c_parts.append("{")
    c_parts.extend(sprite_inits)
    c_parts.append("};")
    c_parts.append(f"const uint8_t player_sprite_index = {sprite_names.index(player_sprite)};")
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
    settings_idents = {}   # engine settings arrays, shared by scenes with the same ones
    for scene_file, scene in scene_data_list:
        name = scene.get("name", scene_file.stem)
        ident = c_ident(name)

        bg_path = (scenes_root(scene_file) / scene["background"]).resolve()
        if not bg_path.exists():
            raise BuildError(f"{name}: background not found: {bg_path}")

        layers = scene.get("layers") or []
        if not isinstance(layers, list) or len(layers) > MAX_LAYERS:
            raise BuildError(f"{name}: \"layers\" must be a list of up to {MAX_LAYERS} background layers.")
        # With a layer behind it, only the background's transparent pixels
        # are see-through (normally its most common colour is the backdrop).
        behind = any(isinstance(l, dict) and not l.get("front") for l in layers)
        bg = convert_background(bg_path, name, scene.get("palette_map"), scene.get("tile_overrides"),
                                see_through_only=behind)
        w, h = bg["width"], bg["height"]
        layer_data = []
        for li, layer in enumerate(layers):
            layer_bg, settings = convert_layer(scene_file, layer, li, name)
            settings["map"] = merge_layer(bg, layer_bg, f"{name}: layer {li + 1}")
            layer_data.append(settings)

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
        music_const = music_track_const(music_name, ctx, f"{name}: \"music\"") if music_name else None

        doors = scene.get("doors", [])
        validate_doors(doors, name, w, h, name_to_index)

        npcs = scene.get("npcs", [])

        timers = scene.get("timers", [])
        if len(timers) > MAX_TIMERS:
            raise BuildError(
                f"{name}: {len(timers)} timers listed, but the engine's "
                f"MAX_TIMERS is {MAX_TIMERS} per scene.")

        write_preview(bg, grid, spawn,
                      project_dir / "build" / f"{file_stem(name)}_preview.png",
                      doors, npcs)

        # Named actors, for this scene's "actor_*" events (see
        # resolve_actor()) - scene-scoped, rebuilt fresh per scene.
        scene_player_sprite = scene.get("player_sprite") or player_sprite
        npc_name_to_index = {}
        npc_sprite_of = {PLAYER_ACTOR_INDEX: scene_player_sprite}
        for j, npc in enumerate(npcs):
            npc_sprite_of[j] = npc.get("sprite") or player_sprite
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
        scene_banks = assign_palette_banks(
            [npc.get("sprite") or player_sprite for npc in npcs] + projectile_sprites(scene) + custom_projectiles,
            scene_player_sprite, compiled_sprites, name, player_only=bool(player_swaps))
        ctx["scene_banks"] = scene_banks

        # Scene type and its engine settings (compiler/modes.py).
        try:
            scene_mode = M.scene_mode(scene, name)
            # "state" settings name states of this scene's player sprite.
            M.set_state_names({n.strip().lower(): i for n, i in
                               compiled_sprites[scene_player_sprite].state_names.items() if n})
            settings = M.resolve(project.get("engine"), scene.get("engine"), f"{name}: \"engine\"")
        except M.ModeError as e:
            raise BuildError(str(e)) from None
        settings_key = tuple(settings)
        if settings_key not in settings_idents:
            settings_idents[settings_key] = f"mode_settings_{len(settings_idents)}"
            c_parts.append(f"static const int16_t {settings_idents[settings_key]}[MS_COUNT] = {{ "
                           + ", ".join(map(str, settings)) + " };")
        # For "actor_invoke": each NPC's on_interact events (or its
        # "dialogue" shorthand), inlined wherever it's invoked.
        ctx["npc_events"] = {
            j: (npc["on_interact"] if "on_interact" in npc
                else [{"type": "text", "text": npc["dialogue"]}] if npc.get("dialogue")
                else None)
            for j, npc in enumerate(npcs)
        }
        if len(npcs) > MAX_NPCS:
            raise BuildError(
                f"{name}: {len(npcs)} actors, but a scene can have at most {MAX_NPCS}. "
                "Split it into two scenes, or reuse actors (move/show/hide them with events).")
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
        for li, layer in enumerate(layer_data):
            c_parts.append(c_array("uint16_t", f"{ident}_layer{li}_map", layer["map"], "0x{:04X}", 16))
            c_parts.append("")
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

        # Animated tiles ("tile_animations").
        anims = compile_tile_animations(scene.get("tile_animations"), bg, scene_file, name)
        if anims:
            for k, (tile, frames, speed, data) in enumerate(anims):
                c_parts.append(c_array("uint8_t", f"{ident}_anim{k}", data, "0x{:02X}", 16))
            c_parts.append(f"static const TileAnim {ident}_tile_anims[{len(anims)}] =")
            c_parts.append("{")
            for k, (tile, frames, speed, data) in enumerate(anims):
                c_parts.append(f"    {{ {tile}, {frames}, {speed}, {ident}_anim{k} }},")
            c_parts.append("};")
            c_parts.append("")

        # Tiles in front of actors ("front_tiles": rows, "#" = in front).
        front_ref = "0"
        if scene.get("front_tiles") is not None:
            front = parse_front(scene["front_tiles"], w, h, name)
            if any(front):
                if layer_data:
                    raise BuildError(f"{name}: tiles in front of actors can't be used together with "
                                     "background layers (both need the GBA's BG2). Remove the layers or the front tiles.")
                if scene.get("parallax"):
                    raise BuildError(f"{name}: tiles in front of actors can't be used together with "
                                     "parallax strips. Remove one of them.")
                front_ref = f"{ident}_front_map"
                c_parts.append(c_array("uint16_t", front_ref,
                                       [e if f else 0 for e, f in zip(bg["map"], front)],
                                       "0x{:04X}", w if w <= 16 else 16))
                c_parts.append("")

        # Scene on_init: auto-runs once, every time this scene loads.
        # NPCs' own "on_init"s run first (as themselves), then the scene's.
        init_parts = [(_script_list(npc["on_init"], f"{name}: NPC {j} \"on_init\""), j, f"{name}: NPC {j} on_init")
                      for j, npc in enumerate(npcs) if npc.get("on_init")]
        player_events = player_init_events(scene.get("player"), f"{name}: \"player\"")
        if player_events:
            init_parts.insert(0, (player_events, PLAYER_ACTOR_INDEX, f"{name}: player"))
        on_init_events = scene.get("on_init")
        if on_init_events is not None:
            init_parts.append((on_init_events, None, f"{name}: on_init"))
        if init_parts:
            on_init_ident = f"{ident}_on_init_script"
            instructions = compile_script_parts(init_parts, ctx, f"{name}: on_init")
            emit_script(c_parts, on_init_ident, instructions)
            on_init_ref = on_init_ident
        else:
            on_init_ref = "0"

        # Custom scripts named by "script" engine settings (On dash, On
        # knockback...), as this scene's ability_scripts[] (index = the
        # setting's value - 1), run as the player.
        ability_ids = set()
        for i, sdef in enumerate(M.SETTINGS):
            if sdef["unit"] == "script" and settings[i]:
                ability_ids.add(M.SCRIPT_IDS[settings[i] - 1])
        for ev in _events_of_type(scene, "set_engine_setting"):
            sdef = M.SETTING_BY_KEY.get(ev.get("setting"))
            if sdef and sdef["unit"] == "script" and ev.get("value") in custom_scripts:
                ability_ids.add(ev["value"])
        ability_ref = "0"
        if ability_ids:
            refs = []
            for k, sid in enumerate(M.SCRIPT_IDS):
                if sid not in ability_ids:
                    refs.append("0")
                    continue
                sident = f"{ident}_ability{k}_script"
                ctx["self_actor_index"] = PLAYER_ACTOR_INDEX
                instructions = compile_script(_script_list(custom_scripts[sid], f"{name}: script '{sid}'"),
                                              ctx, f"{name}: custom script '{sid}'")
                ctx["self_actor_index"] = None
                emit_script(c_parts, sident, instructions)
                refs.append(sident)
            ability_ref = f"{ident}_ability_scripts"
            c_parts.append(f"static const ScriptEvent *const {ability_ref}[{len(refs)}] = {{ {', '.join(refs)} }};")
            c_parts.append("")

        # "On Player Hit" per collision group.
        player_hit = scene.get("on_player_hit") or {}
        if not isinstance(player_hit, dict):
            raise BuildError(f"{name}: \"on_player_hit\" must be an object: {{\"1\": [...], \"2\": [...], \"3\": [...]}}.")
        player_hit_refs = []
        for g in ("1", "2", "3"):
            events = player_hit.get(g)
            if events:
                hit_ident = f"{ident}_player_hit{g}_script"
                emit_script(c_parts, hit_ident, compile_script(
                    _script_list(events, f"{name}: on_player_hit {g}"), ctx, f"{name}: on_player_hit {g}"))
                player_hit_refs.append(hit_ident)
            else:
                player_hit_refs.append("0")

        parallax = parse_parallax(scene.get("parallax"), name)

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

                leave_ref = "0"
                if door.get("on_leave"):
                    leave_ref = f"{ident}_door{di}_leave_script"
                    emit_script(c_parts, leave_ref, compile_script(
                        _script_list(door["on_leave"], f"{where} \"on_leave\""), ctx, f"{where} on_leave"))

                door_values.append(
                    f"    {{ {door['x']}, {door['y']}, "
                    f"{door.get('width', 1)}, {door.get('height', 1)}, "
                    f"{script_ident}, {leave_ref} }},")

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
                sname = npc.get("sprite") or player_sprite
                sprite_idx = sprite_names.index(sname)
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

                pinned = 1 if npc.get("pinned") else 0
                move_speed = resolve_small_int(npc.get("move_speed", 1), "move_speed", where, 1, 8)
                anim_speed = resolve_small_int(npc.get("anim_speed", 0), "anim_speed", where, 0, 255)
                group = resolve_small_int(npc.get("collision_group", 0), "collision_group", where, 0, 3)

                hit_ref = "0"
                if npc.get("on_hit"):
                    hit_ref = f"{ident}_npc{j}_hit_script"
                    ctx["self_actor_index"] = j
                    instructions = compile_script(_script_list(npc["on_hit"], f"{where} \"on_hit\""), ctx, f"{where} on_hit")
                    ctx["self_actor_index"] = None
                    emit_script(c_parts, hit_ref, instructions)

                # "On Update": loops for as long as the scene is up, one
                # pass per frame at most.
                update_ref = "0"
                if npc.get("on_update"):
                    update_ref = f"{ident}_npc{j}_update_script"
                    loop = ([{"type": "label", "label": "__on_update"}]
                            + _script_list(npc["on_update"], f"{where} \"on_update\"")
                            + [{"type": "wait", "frames": 1}, {"type": "goto", "label": "__on_update"}])
                    ctx["self_actor_index"] = j
                    instructions = compile_script(loop, ctx, f"{where} on_update")
                    ctx["self_actor_index"] = None
                    emit_script(c_parts, update_ref, instructions)

                npc_values.append(
                    f"    {{ {nx}, {ny}, {dir_val}, {sprite_idx}, "
                    f"{scene_banks[sname]}, {movement_val}, {script_ref}, "
                    f"{pinned}, {move_speed}, {anim_speed}, {group}, {hit_ref}, {update_ref}, "
                    f"{1 if npc.get('platform') else 0}, {1 if npc.get('above_player') else 0}, "
                    f"{1 if npc.get('push_player') else 0} }},")

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
        c_parts.append(f"    .player_sprite = {sprite_names.index(scene_player_sprite) if scene.get('player_sprite') else '0xFF'},")
        c_parts.append(f"    .player_hit    = {{ {', '.join(player_hit_refs)} }},")
        c_parts.append("    .parallax      = { " + ", ".join(f"{{ {r}, {sp} }}" for r, sp in (parallax or [(0, 0)])) + " },")
        c_parts.append(f"    .parallax_count = {len(parallax)},")
        if layer_data:
            c_parts.append("    .layers        = {")
            # The camera at the player's start: where the layers line up
            # with the map, as the editor draws them (engine/background.c).
            anchor_x = max(0, min(spawn[0] + 8 - 120, w * TILE - 240))
            anchor_y = max(0, min(spawn[1] + 8 - 80, h * TILE - 160))
            for li, l in enumerate(layer_data):
                c_parts.append(f"        {{ {ident}_layer{li}_map, {l['size']}, {l['front']}, "
                               f"{l['speed_x']}, {l['speed_y']}, {l['auto_x']}, {l['auto_y']}, "
                               f"{anchor_x}, {anchor_y} }},")
            c_parts.append("    },")
        c_parts.append(f"    .layer_count   = {len(layer_data)},")
        c_parts.append(f"    .mode          = {scene_mode},")
        c_parts.append(f"    .settings      = {settings_idents[settings_key]},")
        if ability_ref != "0":
            c_parts.append(f"    .ability_scripts = {ability_ref},")
        if front_ref != "0":
            c_parts.append(f"    .front_map     = {front_ref},")
        if anims:
            c_parts.append(f"    .tile_anims    = {ident}_tile_anims,")
            c_parts.append(f"    .tile_anim_count = {len(anims)},")
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
        f"#define SPRITE_COUNT      {len(sprite_names)}",
        f"#define ITEM_COUNT        {len(item_names)}",
        "",
        *h_defs,
        "",
        "extern const SceneDef *const scenes[SCENE_COUNT];",
        "extern const SpriteDef       sprite_defs[SPRITE_COUNT];",
        "extern const uint8_t         player_sprite_index;",
        "extern const char *const      item_names[];",
        "",
        "#endif",
        "",
    ]

    out_dir.mkdir(parents=True, exist_ok=True)
    try:
        uge_names = build_uge_songs(project_dir / PROJECT_MUSIC_DIR, out_dir)
    except UgeError as e:
        raise BuildError(str(e)) from None
    if uge_names:
        print(f"Wrote {out_dir / 'uge_songs.c'} ({len(uge_names)} .uge song(s))")
    try:
        cut_names, cut_sounds = build_cutscenes(
            project_dir / PROJECT_CUTSCENES_DIR, out_dir, len(ctx["wav_names"]))
        wav_names = build_sounds(project_dir / PROJECT_SOUNDS_DIR, out_dir, cut_sounds)
    except (WavError, CutsceneError) as e:
        raise BuildError(str(e)) from None
    if cut_names:
        print(f"  cutscenes: {', '.join(cut_names)}")
    if wav_names:
        print(f"  sounds: {', '.join(wav_names)}")
    write_if_changed(out_dir / "ui_data.c", ui_to_c(ctx["ui"]))
    write_if_changed(out_dir / "mode_settings.h", M.header())
    write_if_changed(out_dir / "scenes_data.c", "\n".join(c_parts))
    write_if_changed(out_dir / "scenes_data.h", "\n".join(header))
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
