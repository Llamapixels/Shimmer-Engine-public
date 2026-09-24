/**
 * project.json / scenes/<name>.json types, mirroring
 * compiler/build_project.py's build() exactly - same field names, same
 * optionality. Anything the editor reads or writes goes through these
 * types so a project saved here is always exactly what the existing
 * Python compiler already knows how to build - the editor doesn't
 * introduce a second format.
 */

import type { Direction, EventScript } from "./eventTypes.js";

/** A single named numeric constant (e.g. MAX_HP = 100). Not read by the
 * compiler yet - purely an editor-side authoring convenience for now,
 * kept separate from Variables (which are runtime save-game slots).
 * Additive/optional field: projects without it are unaffected. */
export interface ConstantJSON {
  name: string;
  value: number;
}

/** A named, reusable event list (GB Studio's "Custom Scripts"), editable
 * in its own tab of the existing ScriptEditor. Callable from any other
 * script with a "call_script" event (see eventTypes.ts's CallScriptEvent);
 * the compiler inline-expands the call in place at compile time, so no
 * VM call/return mechanism is needed. Additive/optional field: projects
 * without it are unaffected. */
export interface CustomScriptJSON {
  id: string;
  name: string;
  script: EventScript;
}

/** A named BG palette bank: up to COLORS_PER_BANK (15) hex colors,
 * lightest to darkest. Purely an authoring/grouping aid in the editor -
 * see SceneJSON.palette_map for how a scene's tiles opt into one.
 * Additive/optional field: projects without it are unaffected. */
export interface PaletteJSON {
  id: string;
  name: string;
  colors: string[];
}

/**
 * Real GB Studio (src/shared/lib/resources/types.ts) authors a sprite
 * sheet's states as `{ id, name, animationType, flipLeft, animations }`,
 * where `animationType` fixes which set of named directional animations
 * a sheet has (src/shared/lib/sprites/helpers.ts):
 *   fixed / fixed_movement         - idle (+ moving)
 *   horizontal / horizontal_movement - idleRight, idleLeft (+ movingRight/Left)
 *   multi / multi_movement         - idle{Right,Left,Up,Down} (+ moving{...})
 *   platform_player                - idle{Right,Left}, jumping{Right,Left},
 *                                     moving{Right,Left}, climbing
 *   cursor                         - idle, hover
 * Shimmer Engine keeps the previous round's flatter, user-named
 * `states` list (rather than nesting a per-direction `animations` array
 * inside one state object per GB Studio's shape) - each state instead
 * carries an optional `slot`, which is the single named slot (above)
 * it fills. SpriteSheetJSON's `animationType` says which slot set is in
 * play; the editor uses `slot` to know which states are that type's
 * defaults (so it can add/remove states on a type change without
 * touching anything the slot set doesn't mention) and, together with
 * `flipLeft`, to know which states are derived mirrors of a sibling
 * "Right" state rather than independently authored (see `flipLeft`
 * below). A state with no `slot` is a plain custom state (including
 * every state authored before this feature existed) and is never
 * touched by animationType/flipLeft bookkeeping. */
export type SpriteAnimationType =
  | "fixed"
  | "fixed_movement"
  | "multi"
  | "multi_movement"
  | "horizontal"
  | "horizontal_movement"
  | "platform_player"
  | "cursor";

/** The named animation slots each SpriteAnimationType defines, in the
 * order the editor should create/display them. A "*Left" slot is the
 * one a sheet's `flipLeft` (default true) can derive from its "*Right"
 * sibling instead of being independently authored - see SpriteStateJSON. */
export const SPRITE_ANIMATION_SLOTS: Record<SpriteAnimationType, { slot: string; label: string }[]> = {
  fixed: [{ slot: "idle", label: "Idle" }],
  fixed_movement: [
    { slot: "idle", label: "Idle" },
    { slot: "moving", label: "Walk" },
  ],
  horizontal: [
    { slot: "idleRight", label: "Idle Right" },
    { slot: "idleLeft", label: "Idle Left" },
  ],
  horizontal_movement: [
    { slot: "idleRight", label: "Idle Right" },
    { slot: "idleLeft", label: "Idle Left" },
    { slot: "movingRight", label: "Walk Right" },
    { slot: "movingLeft", label: "Walk Left" },
  ],
  multi: [
    { slot: "idleRight", label: "Idle Right" },
    { slot: "idleLeft", label: "Idle Left" },
    { slot: "idleUp", label: "Idle Up" },
    { slot: "idleDown", label: "Idle Down" },
  ],
  multi_movement: [
    { slot: "idleRight", label: "Idle Right" },
    { slot: "idleLeft", label: "Idle Left" },
    { slot: "idleUp", label: "Idle Up" },
    { slot: "idleDown", label: "Idle Down" },
    { slot: "movingRight", label: "Walk Right" },
    { slot: "movingLeft", label: "Walk Left" },
    { slot: "movingUp", label: "Walk Up" },
    { slot: "movingDown", label: "Walk Down" },
  ],
  platform_player: [
    { slot: "idleRight", label: "Idle Right" },
    { slot: "idleLeft", label: "Idle Left" },
    { slot: "jumpingRight", label: "Jump Right" },
    { slot: "jumpingLeft", label: "Jump Left" },
    { slot: "movingRight", label: "Walk Right" },
    { slot: "movingLeft", label: "Walk Left" },
    { slot: "climbing", label: "Climb" },
  ],
  cursor: [
    { slot: "idle", label: "Idle" },
    { slot: "hover", label: "Hover" },
  ],
};

/** Slots derivable from a "Right" sibling when `flipLeft` is on (default),
 * mapped to that sibling's slot name. See SpriteStateJSON's `slot`. */
export const SPRITE_LEFT_SLOT_TO_RIGHT: Record<string, string> = {
  idleLeft: "idleRight",
  movingLeft: "movingRight",
  jumpingLeft: "jumpingRight",
};

/** GBA hardware OBJ sizes an authored sprite's `canvasWidth`/`canvasHeight`
 * is constrained to - see engine/source/sprite.c's `size_table` (12
 * entries, the only shapes the GBA/this engine can render as one OBJ). */
export const GBA_SPRITE_SIZES: { width: number; height: number }[] = [
  { width: 8, height: 8 },
  { width: 16, height: 16 },
  { width: 32, height: 32 },
  { width: 64, height: 64 },
  { width: 16, height: 8 },
  { width: 32, height: 8 },
  { width: 32, height: 16 },
  { width: 64, height: 32 },
  { width: 8, height: 16 },
  { width: 8, height: 32 },
  { width: 16, height: 32 },
  { width: 32, height: 64 },
];

/** One authored animation state on a sprite sheet (see SpriteSheetJSON):
 * an ordered list of frame indices into the sheet's compiled 8-frame set
 * (0,1=down 2,3=up 4,5=right 6,7=left, same numbering entity.h's
 * EntityAnimState/sprite_set_frame() use) and a per-state speed in
 * VBlanks per frame. Targeted by name from an "actor_set_state" event
 * (see eventTypes.ts's ActorSetStateEvent). */
export interface SpriteStateJSON {
  name: string;
  frames: number[];
  /** VBlanks per frame. Compiler default (if omitted) is 8, matching the
   * engine's ENTITY_ANIM_SPEED. */
  speed?: number;
  /** Optional, parallel to `frames`: `flips[i]` true means that
   * occurrence of `frames[i]` is shown horizontally mirrored. The
   * compiler bakes a mirrored copy of that frame's pixel data into the
   * sprite sheet at compile time (no engine-side runtime flip involved -
   * see build_project.py's emit_sprite_states) - NOT supported for the
   * "player" sheet, which has no source PNG for the compiler to mirror
   * (its frame data is the pre-baked engine/data/player_graphics.h).
   * Omitted, or all-false: compiles identically to before this field
   * existed. */
  flips?: boolean[];
  /** Which SpriteAnimationType slot (see SPRITE_ANIMATION_SLOTS) this
   * state fills, e.g. "movingRight". Optional/additive: a state with no
   * `slot` (every state authored before this field existed) is a plain
   * custom state, completely untouched by animationType-driven default
   * generation or flipLeft derivation. When `slot` ends in "Left" and
   * the sheet's `flipLeft` is not explicitly false, this state's
   * `frames`/`flips`/`speed` above are ignored - the compiler (and the
   * editor's own preview) derive them from the sibling state whose
   * `slot` is the "Right" counterpart (SPRITE_LEFT_SLOT_TO_RIGHT),
   * mirrored via the same per-frame `flips` bake this field already
   * supports. Left as its own authored data (used verbatim) once
   * `flipLeft` is set to false. */
  slot?: string;
  /** Optional, and mutually exclusive with `frames` above at the
   * data-authoring level (both fields stay present for backward compat,
   * but when `frameRefs` is a non-empty list this state is shown/
   * compiled from these tile-composed frames instead of the legacy
   * numbered-frame set): ordered ids into the sheet's `frames`
   * (SpriteFrameJSON.id), shown in this order at `speed`. Omitted, or
   * an empty list (every state authored before this feature existed):
   * this state keeps using `frames`/`flips` exactly as before - no
   * behavior change. */
  frameRefs?: string[];
}

/**
 * One tile placed into a composed ("metasprite") frame - see
 * SpriteFrameJSON. Models real GB Studio's `MetaspriteTile` (x/y,
 * sliceX/sliceY, flipX/flipY, priority), minus its dual monochrome-
 * palette (OBP0/OBP1) + color-palette fields: GB Studio needs both
 * because its ROMs run on plain DMG (2 sprite palettes, 4 colors) AND
 * GBC (8 richer palettes) at once, with a monochrome fallback mode.
 * Shimmer Engine targets GBA only - no monochrome fallback, no
 * dual-hardware split - so a placed tile just gets ONE palette-bank
 * selector (`palette`, 0-15, GBA OBJ palette RAM), a deliberate GBA
 * simplification rather than an oversight.
 */
export interface PlacedTileJSON {
  /** Stable id for editor selection (GB Studio's MetaspriteTile.id).
   * Optional/additive - the compiler ignores it; the editor assigns one
   * to any tile missing it. */
  id?: string;
  /** Position of this tile's top-left corner relative to the frame
   * canvas's top-left, in PIXELS - any integer (pixel-precise, like GB
   * Studio; every GBA OBJ has its own per-pixel x/y). A tile may hang
   * partly outside the canvas; one lying entirely outside it is dropped
   * (GB Studio's removeMetaspriteTilesOutsideCanvas rule). */
  x: number;
  y: number;
  /** Which source tile this shows, as a tile-grid column/row within the
   * imported sheet PNG (col = pixelX/8, row = pixelY/8) - NOT a pixel
   * offset. In the sheet's "8x16" spriteMode a tile is 8 wide and 16
   * tall: it covers sheet rows sheetY and sheetY+1 (see
   * SpriteSheetJSON.spriteMode). */
  sheetX: number;
  sheetY: number;
  /** Horizontal/vertical mirror flags for this tile only. */
  flipX?: boolean;
  flipY?: boolean;
  /** GBA OBJ palette bank, 0-15. Omitted = inherit the sheet's normal
   * palette bank (see build_project.py's npc_palette_bank). */
  palette?: number;
  /** "Display behind background layer" - true draws this tile at OBJ
   * priority behind the scene's BG0 layer instead of the normal
   * in-front position (see engine/source/sprite.c's
   * ADV_ATTR2_PRIORITY_*). */
  priority?: boolean;
}

/** One authored, tile-composed animation frame (real GB Studio's
 * `Metasprite`): an id (referenced by a state's `frameRefs`, see
 * SpriteStateJSON) plus the list of tiles placed to make it up. A frame
 * with an empty/missing `tiles` list, or exactly one tile positioned at
 * (0,0) covering the sheet's whole canvas with no flip/priority/custom
 * palette, compiles through the engine's original single-OAM-entry
 * "legacy" path - see build_project.py's emit_sprite_states and
 * engine/source/sprite.c's sprite_init_multi doc comment. */
export interface SpriteFrameJSON {
  id: string;
  tiles: PlacedTileJSON[];
}

/** A collision box: offset + size in pixels within a 16x16 sprite canvas.
 * Also reused inline by "actor_set_collision_box" events (as x/y/width/
 * height fields directly on the event, not nested like this). */
export interface CollisionBoxJSON {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

/** Optional per-sprite-sheet animation/collision metadata (project.json
 * "spriteSheets", matched by `name` to an NpcJSON's "sprite", or the
 * special name "player" for the built-in player sheet). Additive/
 * optional: a sprite sheet with no entry here (or one with neither
 * `states` nor `collisionBox`) compiles exactly as it always has - the
 * engine's legacy fixed 4-direction/8-frame convention and a collision
 * box equal to the full sprite rect. See compiler/build_project.py's
 * module docstring for the authoritative format. */
export interface SpriteSheetJSON {
  name: string;
  states?: SpriteStateJSON[];
  collisionBox?: CollisionBoxJSON;
  /** Which set of named animation slots this sheet's states are drawn
   * from (see SPRITE_ANIMATION_SLOTS) - purely an authoring aid for the
   * editor's default-state generation and flipLeft derivation; the
   * compiler doesn't need it (it drives everything off each state's own
   * `slot`). Optional/additive: omitted (every sheet from before this
   * field existed) means "no animationType has been picked yet" - the
   * editor treats such a sheet's states as plain custom states and does
   * not run default-generation or flipLeft derivation on it, even though
   * conceptually the closest GB Studio equivalent is "multi". */
  animationType?: SpriteAnimationType;
  /** When true (the default, matching GB Studio), every state whose
   * `slot` names a "*Left" animation (idleLeft/movingLeft/jumpingLeft)
   * is NOT independently authored - its frames are derived by mirroring
   * its "Right" sibling (see SpriteStateJSON.slot). Set false to author
   * Left states' frames independently instead. Optional/additive:
   * omitted behaves as true, but only has any effect on states that
   * actually carry a "*Left" `slot` - a sheet with no slot-tagged states
   * (every sheet from before this feature existed) is unaffected either
   * way. */
  flipLeft?: boolean;
  /** The in-game rendered size of this sprite, in pixels - independent
   * of the imported sheet image's own dimensions. Must be one of the 12
   * sizes a GBA hardware OBJ can actually be (GBA_SPRITE_SIZES). Optional/
   * additive: omitted defaults to this sprite's current effective frame
   * size (16x16 - see SPRITE_FRAME_W/H in build_project.py), so existing
   * sprites keep rendering at exactly the size they always have.
   * NOTE (scoped-down for this pass): choosing a size other than 16x16
   * only changes this compiled metadata (NpcSpriteDef/PlayerSpriteDef's
   * width/height in scene.h) - the engine doesn't yet resize the actual
   * hardware OBJ or fill the extra canvas with real pixel data (frames
   * are still always converted/baked at 16x16 from a single sheet
   * block). That needs the follow-up per-tile frame-composition pass
   * (choosing which sheet tiles fill which canvas cell); until then this
   * is forward-compatible metadata only, round-tripped through
   * project.json and the compiler. */
  canvasWidth?: number;
  canvasHeight?: number;
  /** ROUND 3 CONTRACT (supersedes the canvasWidth notes above for sheets
   * that use composed frames): canvasWidth/canvasHeight are free integers,
   * 1..240 x 1..160 (GBA screen), default 16x16 - no longer restricted to
   * GBA_SPRITE_SIZES, because a composed frame is built from many OBJs.
   *
   * Anchoring (engine + compiler + editor all agree on this): the actor's
   * position (Entity x/y) is the top-left of its 16x16 collision/footprint
   * cell. The canvas is placed so its bottom-centre sits on that cell's
   * bottom-centre (GB Studio's convention - bigger sprites grow upward and
   * sideways), then shifted by canvasOriginX/Y. So a placed tile at canvas
   * pixel (tx, ty) is drawn at entity-relative offset
   *   dx = tx + floor((16 - canvasWidth) / 2) + canvasOriginX
   *   dy = ty + (16 - canvasHeight)           + canvasOriginY
   * For the default 16x16 canvas and 0/0 origin that is exactly (tx, ty),
   * i.e. today's behaviour. */
  canvasOriginX?: number;
  canvasOriginY?: number;
  /** Size of one placed tile, GB Studio's per-sheet "Sprite Mode":
   * "8x16" (default when omitted, same as GB Studio's default) or "8x8".
   * On GBA an 8x16 tile is one "tall" hardware OBJ (shape tall, size 0)
   * using two consecutive VRAM tiles (1D mapping), so it costs half the
   * OAM entries of two 8x8 tiles. */
  spriteMode?: "8x8" | "8x16";
  /** Authored tile-composed ("metasprite") frames - see SpriteFrameJSON.
   * Referenced by a state's `frameRefs`, not by the legacy numbered
   * `frames` a state's own `frames` field points into. Optional/
   * additive: omitted, or a sheet whose states all use plain `frames`
   * (every sheet from before this feature existed), compiles through
   * the exact same legacy path as always - untouched by this field. */
  frames?: SpriteFrameJSON[];
}

export interface ProjectJSON {
  name: string;
  start_scene: string;
  items?: string[];
  flags?: string[];
  variables?: string[];
  /** See ConstantJSON. */
  constants?: ConstantJSON[];
  /** See CustomScriptJSON. */
  customScripts?: CustomScriptJSON[];
  /** See PaletteJSON. */
  palettes?: PaletteJSON[];
  /** See PrefabJSON. */
  prefabs?: PrefabJSON[];
  /** See SpriteSheetJSON. */
  spriteSheets?: SpriteSheetJSON[];
}

export interface DoorJSON {
  x: number;
  y: number;
  width?: number;
  height?: number;
  /** Simple-warp shorthand - mutually exclusive with "events". */
  target_scene?: string;
  target_x?: number;
  target_y?: number;
  /** Custom on_enter script - mutually exclusive with target_scene. */
  events?: EventScript;
}

export type NpcMovement = "static" | "wander";

export interface NpcJSON {
  sprite?: string;
  x: number;
  y: number;
  direction?: Direction;
  movement?: NpcMovement;
  name?: string;
  /** Shorthand: compiles to a single "text" on_interact event. */
  dialogue?: string;
  on_interact?: EventScript;
}

export interface TimerJSON {
  name?: string;
  frames: number;
  script?: EventScript;
}

export interface SceneJSON {
  name?: string;
  background: string;
  player_start?: { x: number; y: number };
  /** Which way the player faces on a fresh boot into this scene (a
   * resumed save keeps its own saved facing instead) - only actually
   * takes effect for whichever scene is the project's start_scene.
   * Defaults to "down". */
  player_start_direction?: Direction;
  music?: string;
  on_init?: EventScript;
  doors?: DoorJSON[];
  npcs?: NpcJSON[];
  timers?: TimerJSON[];
  /** Row strings of "." (walkable) "#" (solid) "~" (water) "!" (damage).
   * Omitted for a brand-new scene - the compiler fills in an all-walkable
   * grid and writes it back the first time it builds. */
  collision?: string[];
  /** Per-tile BG palette assignment: palette_map[y][x] is a PaletteJSON
   * id, or null/absent for "let the compiler auto-assign this tile".
   * Same width/height grid as `collision` (background width/height / 8).
   * Every tile carrying the same id is packed into one shared palette
   * bank at compile time; tiles with no id fall back to the compiler's
   * existing greedy auto-packing, so a scene with no palette_map (or an
   * all-null one) compiles exactly as it did before this field existed.
   * Additive/optional field. */
  palette_map?: (string | null)[][];
}

/** A reusable NPC/door starting point (GB Studio's "prefab"): dropping one
 * onto a scene copies `template`'s fields into a brand-new NPC/door at
 * the clicked tile - a one-time copy, not a live link, so editing the
 * prefab afterwards never touches NPCs/doors already placed from it
 * (matches GB Studio's own prefabs). Additive/optional field: projects
 * without it are unaffected, and the compiler never sees this field -
 * only the NPCs/doors it produces. */
export interface PrefabJSON {
  id: string;
  kind: "npc" | "door";
  name: string;
  template: Partial<NpcJSON> | Partial<DoorJSON>;
}

/** One scene as the editor holds it in memory / on disk: the parsed JSON
 * plus which scene file it came from (the file's basename without
 * .json, used as the scene's identity when "name" is absent, exactly
 * like build_project.py's `scene.get("name", scene_file.stem)`). */
export interface SceneRecord {
  /** Filename stem under <project>/scenes/, e.g. "town" for town.json. */
  fileId: string;
  data: SceneJSON;
}

export interface ProjectData {
  /** Absolute path to the project folder on disk (contains project.json,
   * scenes/, assets/). */
  rootPath: string;
  project: ProjectJSON;
  scenes: SceneRecord[];
}
