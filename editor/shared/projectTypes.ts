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

/*
 * Sprites, laid out like GB Studio's (gb-studio-source/src/shared/lib/
 * resources/types.ts): a sprite is a PNG in assets/sprites/ plus an entry
 * in project.json "spriteSheets" (matched by name). compiler/sprites.py
 * turns it into GBA hardware sprites; see its docstring for the details.
 */

export type SpriteAnimationType =
  | "fixed"
  | "fixed_movement"
  | "multi"
  | "multi_movement"
  | "horizontal"
  | "horizontal_movement"
  | "platform_player"
  | "cursor";

export type SpriteMode = "8x8" | "8x16";

/** A rectangle cut out of the sprite's PNG and placed on a frame's canvas.
 * Unlike GB Studio's 8x8/8x16 tiles it can be any size (width/height
 * default to 8 x the sprite mode's height); the compiler packs the drawn
 * frame into GBA OBJs of up to 64x64 either way. */
export interface SpriteTileJSON {
  id: string;
  /** Position on the canvas, px (top-left = 0,0). */
  x: number;
  y: number;
  /** Top-left of the cut-out in the PNG, px. */
  sliceX: number;
  sliceY: number;
  width?: number;
  height?: number;
  flipX?: boolean;
  flipY?: boolean;
  /** Draw behind the scene's background layer. */
  priority?: boolean;
}

/** One frame ("metasprite"): tiles drawn in order, later ones on top. */
export interface SpriteFrameJSON {
  id: string;
  tiles: SpriteTileJSON[];
}

export interface SpriteAnimationJSON {
  id: string;
  frames: SpriteFrameJSON[];
  /** VBlanks per frame; omitted = the sheet's animSpeed. */
  speed?: number;
}

/** An animation state: always 8 animations, in GB Studio's order (idle
 * right/left/up/down, moving right/left/up/down); which of them the
 * animation type actually uses is up to animationMap(). */
export interface SpriteStateJSON {
  id: string;
  /** "" = the default state (shown as "Default"). */
  name: string;
  animationType: SpriteAnimationType;
  /** Show the right-facing animations mirrored for left. */
  flipLeft: boolean;
  animations: SpriteAnimationJSON[];
}

export interface SpriteBoundsJSON {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SpriteSheetJSON {
  version: 2;
  /** assets/sprites/<name>.png */
  name: string;
  /** Frame canvas size, px (up to 256x256). Its bottom-centre sits on the
   * bottom-centre of the actor's 16x16 footprint, shifted by the origin. */
  canvasWidth: number;
  canvasHeight: number;
  canvasOriginX: number;
  canvasOriginY: number;
  /** Collision box, relative to the actor's 16x16 footprint. */
  bounds: SpriteBoundsJSON;
  /** Default VBlanks per animation frame. */
  animSpeed: number;
  /** Default tile size when placing tiles from the palette. */
  spriteMode: SpriteMode;
  states: SpriteStateJSON[];
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
  /** The player's sprite (assets/sprites/<name>.png); default "player". */
  playerSprite?: string;
  /** Dialogue look - see UiSettingsJSON. */
  ui?: UiSettingsJSON;
}

/** project.json "ui" (compiler/ui.py). Fonts are assets/fonts/<name>.png,
 * frames assets/frames/<name>.png; "default" is the built-in one. */
export interface UiSettingsJSON {
  /** Font dialogue starts with; default: the first font, else "default". */
  font?: string;
  /** Box frame dialogue starts with; same default rule. */
  frame?: string;
  /** Frames per character, 0 (instant) to 30; default 1. */
  textSpeed?: number;
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
  /** Runs when the player steps back out (GB Studio's trigger "On Leave"). */
  on_leave?: EventScript;
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
  /** x/y are a screen position: drawn fixed on screen (HUD-style), no
   * collisions, can't be talked to. */
  pinned?: boolean;
  /** Pixels per frame for wandering and scripted moves, 1-8 (default 1). */
  move_speed?: number;
  /** Frames per animation frame, 0 = the sprite's own speed. */
  anim_speed?: number;
  /** 0 = none. 1-3: touching the player runs on_hit, or else the
   * scene's on_player_hit for this group. */
  collision_group?: number;
  /** Run as this actor when the scene starts, before the scene's on_init. */
  on_init?: EventScript;
  /** Loops in the background (at most once per frame) while the scene is up. */
  on_update?: EventScript;
  on_hit?: EventScript;
}

/** One parallax band; the last one runs to the bottom of the screen and
 * ignores `rows`. speed: 0 = normal, 1-8 = 1/2 .. 1/256, "fixed". */
export interface ParallaxLayerJSON {
  rows?: number;
  speed: number | "fixed";
}

/** Only top-down exists in the engine so far; the others are listed in the
 * editor for later. */
export type SceneType = "topdown" | "platformer" | "adventure" | "shmup" | "pointnclick";

export interface TimerJSON {
  name?: string;
  frames: number;
  script?: EventScript;
}

export interface NoteJSON {
  /** Tile position. */
  x: number;
  y: number;
  text: string;
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
  type?: SceneType;
  /** The player's sprite in this scene; default: the project's. */
  player_sprite?: string;
  /** Horizontal bands scrolling at different speeds, top to bottom (1-3). */
  parallax?: ParallaxLayerJSON[];
  on_init?: EventScript;
  /** GB Studio's "On Player Hit", per actor collision group. */
  on_player_hit?: { "1"?: EventScript; "2"?: EventScript; "3"?: EventScript };
  doors?: DoorJSON[];
  npcs?: NpcJSON[];
  timers?: TimerJSON[];
  /** Editor-only sticky notes (GB Studio's notes); the build ignores them. */
  notes?: NoteJSON[];
  /** Tiles tool: {"x,y": [sx, sy]} shows the background's own tile
   * (sx, sy) in cell (x, y). Applied at build time; the PNG is untouched. */
  tile_overrides?: Record<string, [number, number]>;
  /** Row strings of "." (walkable) "#" (solid) "~" (water) "!" (damage),
   * and one-way tiles "^" "v" "<" ">" (that edge is solid).
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
