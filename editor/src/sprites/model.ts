/*
 * Sprite sheet helpers - the editor side of compiler/sprites.py. Layout and
 * animation rules follow GB Studio (gb-studio-source/src/shared/lib/sprites/
 * helpers.ts, MIT).
 */

import type {
  ProjectJSON,
  SpriteAnimationJSON,
  SpriteAnimationType,
  SpriteFrameJSON,
  SpriteMode,
  SpriteSheetJSON,
  SpriteStateJSON,
  SpriteTileJSON,
} from "../../shared/projectTypes";

export const MAX_CANVAS = 256;
/** engine's ASPRITE_MAX_OBJS - hardware sprites one frame may use. */
export const MAX_OBJS = 32;
/** OAM entries on the GBA, for all actors on screen together. */
export const OAM_TOTAL = 128;
/** OBJ VRAM tiles (1D mapping), for all actors in a scene together. */
export const VRAM_TOTAL = 1024;
export const DEFAULT_ANIM_SPEED = 8;
export const MAX_COLORS = 15;

export const ANIMATION_TYPE_GROUPS: { label: string; types: { type: SpriteAnimationType; label: string }[] }[] = [
  {
    label: "Fixed direction",
    types: [
      { type: "fixed", label: "Fixed Direction" },
      { type: "fixed_movement", label: "Fixed Direction + Movement" },
    ],
  },
  {
    label: "Horizontal directions",
    types: [
      { type: "horizontal", label: "Horizontal Directions" },
      { type: "horizontal_movement", label: "Horizontal Directions + Movement" },
    ],
  },
  {
    label: "Four directions",
    types: [
      { type: "multi", label: "Four Directions" },
      { type: "multi_movement", label: "Four Directions + Movement" },
    ],
  },
  { label: "Platformer", types: [{ type: "platform_player", label: "Platformer Player" }] },
  { label: "Point and click", types: [{ type: "cursor", label: "Cursor" }] },
];

export function spriteModeHeight(mode: SpriteMode | undefined): number {
  return mode === "8x8" ? 8 : 16;
}

let idCounter = 0;
export function newId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${idCounter.toString(36)}`;
}

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------

const DIR_NAMES = ["Idle Right", "Idle Left", "Idle Up", "Idle Down", "Moving Right", "Moving Left", "Moving Up", "Moving Down"];

/** The animations (by index into state.animations) a state of this type
 * shows in the editor, in GB Studio's order, with their names. */
export function visibleAnimations(type: SpriteAnimationType, flipLeft: boolean): { index: number; name: string }[] {
  const pick = (idx: number[], names: Record<number, string> = {}) =>
    idx.map((index) => ({ index, name: names[index] ?? DIR_NAMES[index] }));
  switch (type) {
    case "fixed":
      return pick([0], { 0: "Idle" });
    case "fixed_movement":
      return pick([0, 4], { 0: "Idle", 4: "Moving" });
    case "multi":
      return pick(flipLeft ? [0, 2, 3] : [0, 1, 2, 3]);
    case "horizontal":
      return pick(flipLeft ? [0] : [0, 1]);
    case "horizontal_movement":
      return pick(flipLeft ? [0, 4] : [0, 1, 4, 5]);
    case "platform_player": {
      const names = { 2: "Jump Right", 3: "Jump Left", 6: "Climbing" };
      return pick(flipLeft ? [0, 4, 2, 6] : [0, 1, 4, 5, 2, 3, 6], names);
    }
    case "cursor":
      return pick([0, 1], { 0: "Idle", 1: "Hover" });
    default:
      return pick(flipLeft ? [0, 2, 3, 4, 6, 7] : [0, 1, 2, 3, 4, 5, 6, 7]);
  }
}

export function animationName(type: SpriteAnimationType, flipLeft: boolean, index: number): string {
  return visibleAnimations(type, flipLeft).find((a) => a.index === index)?.name ?? DIR_NAMES[index] ?? `Animation ${index + 1}`;
}

/** For each of the 8 animation slots (GB order): which animation is
 * shown and whether mirrored. Port of GB Studio's animationMapBySpriteType;
 * compiler/sprites.py's animation_map() is the same. */
export function animationMap(type: SpriteAnimationType, flipLeft: boolean): { index: number; flip: boolean }[] {
  const out: { index: number; flip: boolean }[] = [];
  for (let i = 0; i < 8; i++) {
    const moving = i >= 4;
    let r: [number, boolean];
    if (type === "fixed") r = [0, false];
    else if (type === "fixed_movement") r = [moving ? 4 : 0, false];
    else if (type === "multi") r = flipLeft && (i === 1 || i === 5) ? [0, true] : [i % 4, false];
    else if (type === "horizontal") r = flipLeft ? [0, i % 2 !== 0] : [i % 2, false];
    else if (type === "horizontal_movement") {
      const base = moving ? 4 : 0;
      r = flipLeft ? [base, i % 2 !== 0] : [(i % 2) + base, false];
    } else if (type === "platform_player") r = flipLeft && (i === 1 || i === 3 || i === 5) ? [i - 1, true] : [i, false];
    else if (type === "cursor") r = i === 0 ? [1, false] : [0, false];
    else if (flipLeft && (i === 1 || i === 5)) r = [i - 1, true];
    else r = [i, false];
    out.push({ index: r[0], flip: r[1] });
  }
  return out;
}

export type Facing = "down" | "up" | "right" | "left";
const FACING_SLOT: Record<Facing, number> = { right: 0, left: 1, up: 2, down: 3 };

/** What an actor facing `facing` shows: the animation and whether it's
 * mirrored - the same choice the engine makes. */
export function animationFor(
  state: SpriteStateJSON,
  facing: Facing,
  moving: boolean,
): { anim: SpriteAnimationJSON | undefined; flip: boolean; index: number } {
  const m = animationMap(state.animationType, state.flipLeft)[FACING_SLOT[facing] + (moving ? 4 : 0)];
  return { anim: state.animations[m.index], flip: m.flip, index: m.index };
}

// ---------------------------------------------------------------------------
// Creating sheets
// ---------------------------------------------------------------------------

export function tile(
  x: number,
  y: number,
  sliceX: number,
  sliceY: number,
  width: number,
  height: number,
  extra: Partial<SpriteTileJSON> = {},
): SpriteTileJSON {
  return { id: newId(), x, y, sliceX, sliceY, width, height, ...extra };
}

export function frame(tiles: SpriteTileJSON[] = []): SpriteFrameJSON {
  return { id: newId(), tiles };
}

export function emptyAnimations(): SpriteAnimationJSON[] {
  return Array.from({ length: 8 }, () => ({ id: newId(), frames: [frame()] }));
}

export function newState(name: string, type: SpriteAnimationType = "multi_movement"): SpriteStateJSON {
  return { id: newId(), name, animationType: type, flipLeft: true, animations: emptyAnimations() };
}

/** A new sheet for an image with no entry: GB Studio's automatic layout
 * (its detectClassic), generalized from 16x16 to square frames as tall as
 * the image - 3 frames: down/up/right; 6 frames: the same with a second
 * walking frame each; anything else: the whole image as one frame. Keep in
 * step with compiler/sprites.py's default_sheet(). */
export function defaultSheet(name: string, width: number, height: number): SpriteSheetJSON {
  const size = height;
  const count = size && width % size === 0 ? width / size : 0;
  const state = newState("");
  const cell = (i: number) => frame([tile(0, 0, i * size, 0, size, size)]);
  let cw = size;
  let ch = size;
  const set = (i: number, frames: SpriteFrameJSON[]) => (state.animations[i] = { id: newId(), frames });
  if (count === 3) {
    state.animationType = "multi";
    set(0, [cell(2)]);
    set(2, [cell(1)]);
    set(3, [cell(0)]);
  } else if (count === 6) {
    state.animationType = "multi_movement";
    set(0, [cell(4)]);
    set(2, [cell(2)]);
    set(3, [cell(0)]);
    set(4, [cell(5), cell(4)]);
    set(6, [cell(3), cell(2)]);
    set(7, [cell(1), cell(0)]);
  } else {
    state.animationType = "fixed";
    cw = Math.min(width, MAX_CANVAS);
    ch = Math.min(height, MAX_CANVAS);
    set(0, [frame([tile(0, 0, 0, 0, cw, ch)])]);
  }
  return {
    version: 2,
    name,
    canvasWidth: Math.max(1, cw),
    canvasHeight: Math.max(1, ch),
    canvasOriginX: 0,
    canvasOriginY: 0,
    bounds: { x: 0, y: 0, width: 16, height: 16 },
    animSpeed: DEFAULT_ANIM_SPEED,
    spriteMode: "8x16",
    states: [state],
  };
}

export type SliceLayout = "classic" | "rows_dlru" | "rows_durl" | "into_animation";

export const SLICE_LAYOUTS: { value: SliceLayout; label: string; hint: string }[] = [
  {
    value: "classic",
    label: "GB Studio classic",
    hint: "One row: down, (down walk), up, (up walk), right, (right walk). Left mirrors right.",
  },
  { value: "rows_dlru", label: "Rows: down, left, right, up", hint: "One row per direction, walk cycle left to right (RPG Maker style)." },
  { value: "rows_durl", label: "Rows: down, up, right, left", hint: "One row per direction, walk cycle left to right." },
  {
    value: "into_animation",
    label: "All into this animation",
    hint: "Every non-empty cell, in reading order, as frames of the selected animation.",
  },
];

/** Cells of a `fw` x `fh` grid over the image, in reading order, skipping
 * empty ones only when asked. */
export function gridCells(imgW: number, imgH: number, fw: number, fh: number): { x: number; y: number; row: number; col: number }[] {
  const out: { x: number; y: number; row: number; col: number }[] = [];
  if (fw <= 0 || fh <= 0) return out;
  for (let row = 0; row * fh + fh <= imgH; row++) {
    for (let col = 0; col * fw + fw <= imgW; col++) out.push({ x: col * fw, y: row * fh, row, col });
  }
  return out;
}

/** "Slice sheet": rebuild a state's animations from a grid of `fw` x `fh`
 * frames. Returns the new state (and a canvas size to use), or an error. */
export function sliceIntoState(
  state: SpriteStateJSON,
  animIndex: number,
  imgW: number,
  imgH: number,
  fw: number,
  fh: number,
  layout: SliceLayout,
  isEmpty: (x: number, y: number, w: number, h: number) => boolean,
): { state: SpriteStateJSON } | { error: string } {
  const cells = gridCells(imgW, imgH, fw, fh);
  if (cells.length === 0) return { error: `A ${fw}x${fh} frame doesn't fit in the ${imgW}x${imgH} image.` };
  const cellFrame = (c: { x: number; y: number }) => frame([tile(0, 0, c.x, c.y, fw, fh)]);
  const animations = state.animations.map((a) => ({ ...a }));
  const set = (i: number, frames: SpriteFrameJSON[]) =>
    (animations[i] = { id: animations[i]?.id ?? newId(), frames, speed: animations[i]?.speed });

  if (layout === "into_animation") {
    const used = cells.filter((c) => !isEmpty(c.x, c.y, fw, fh));
    if (used.length === 0) return { error: "Every cell of that grid is empty." };
    set(animIndex, used.map(cellFrame));
    return { state: { ...state, animations } };
  }

  if (layout === "classic") {
    const row = cells.filter((c) => c.row === 0);
    if (row.length !== 3 && row.length !== 6)
      return { error: `The classic layout needs 3 or 6 frames in the first row; a ${fw}px grid gives ${row.length}.` };
    if (row.length === 3) {
      set(0, [cellFrame(row[2])]);
      set(2, [cellFrame(row[1])]);
      set(3, [cellFrame(row[0])]);
      set(4, [cellFrame(row[2])]);
      set(6, [cellFrame(row[1])]);
      set(7, [cellFrame(row[0])]);
      return { state: { ...state, animations, animationType: "multi", flipLeft: true } };
    }
    set(0, [cellFrame(row[4])]);
    set(2, [cellFrame(row[2])]);
    set(3, [cellFrame(row[0])]);
    set(4, [cellFrame(row[5]), cellFrame(row[4])]);
    set(6, [cellFrame(row[3]), cellFrame(row[2])]);
    set(7, [cellFrame(row[1]), cellFrame(row[0])]);
    return { state: { ...state, animations, animationType: "multi_movement", flipLeft: true } };
  }

  // One row per direction; GB animation index for each row.
  const rowOrder = layout === "rows_dlru" ? [3, 1, 0, 2] : [3, 2, 0, 1];
  const rows = Math.max(...cells.map((c) => c.row)) + 1;
  if (rows < 4) return { error: `That layout needs 4 rows of frames; a ${fh}px grid gives ${rows}.` };
  for (let r = 0; r < 4; r++) {
    const rowCells = cells.filter((c) => c.row === r && !isEmpty(c.x, c.y, fw, fh));
    if (rowCells.length === 0) return { error: `Row ${r + 1} has no frames.` };
    const idleCell = rowCells.length === 3 ? rowCells[1] : rowCells[0];
    // A 3-frame RPG Maker walk (step, stand, step) plays as a ping-pong.
    const walk = rowCells.length === 3 ? [rowCells[0], rowCells[1], rowCells[2], rowCells[1]] : rowCells;
    set(rowOrder[r], [cellFrame(idleCell)]);
    set(rowOrder[r] + 4, walk.map(cellFrame));
  }
  return { state: { ...state, animations, animationType: "multi_movement", flipLeft: false } };
}

// ---------------------------------------------------------------------------
// Upgrading project.json from the editor's previous sprite format
// ---------------------------------------------------------------------------

interface V1Tile {
  x?: number;
  y?: number;
  sheetX?: number;
  sheetY?: number;
  flipX?: boolean;
  flipY?: boolean;
  priority?: boolean;
}
interface V1Sheet {
  name: string;
  states?: { name: string; frames?: number[]; flips?: boolean[]; frameRefs?: string[]; speed?: number; slot?: string }[];
  collisionBox?: { x: number; y: number; width: number; height: number };
  animationType?: SpriteAnimationType;
  flipLeft?: boolean;
  canvasWidth?: number;
  canvasHeight?: number;
  canvasOriginX?: number;
  canvasOriginY?: number;
  spriteMode?: SpriteMode;
  frames?: { id: string; tiles?: V1Tile[] }[];
}

const V1_SLOT_INDEX: Record<string, number> = {
  idle: 0,
  idleRight: 0,
  idleLeft: 1,
  idleUp: 2,
  idleDown: 3,
  moving: 4,
  movingRight: 4,
  movingLeft: 5,
  movingUp: 6,
  movingDown: 7,
  jumpingRight: 2,
  jumpingLeft: 3,
  climbing: 6,
  hover: 1,
};

export function isCurrentSheet(sheet: unknown): sheet is SpriteSheetJSON {
  return !!sheet && typeof sheet === "object" && (sheet as { version?: unknown }).version === 2;
}

/** Convert a sheet saved by the old sprite editor (numbered 16x16 frames
 * of a fixed 96x16 layout, or 8px tiles by cell) to the current format. */
export function migrateSheet(old: V1Sheet): SpriteSheetJSON {
  const cw = old.canvasWidth ?? 16;
  const ch = old.canvasHeight ?? 16;
  const ox = old.canvasOriginX ?? 0;
  const oy = old.canvasOriginY ?? 0;
  const tileH = spriteModeHeight(old.spriteMode);
  const composed = new Map((old.frames ?? []).map((f) => [f.id, f]));
  // Old numbered frames: 0,1 down  2,3 up  4,5 right  6,7 left (mirrored right).
  const legacyFrame = (n: number, flip: boolean): SpriteFrameJSON => {
    const col = n >= 6 ? n - 2 : n;
    const mirror = n >= 6 !== flip;
    return frame([tile(0, 0, col * 16, 0, 16, 16, mirror ? { flipX: true } : {})]);
  };
  const composedFrame = (id: string): SpriteFrameJSON =>
    frame(
      (composed.get(id)?.tiles ?? []).map((t) =>
        tile(t.x ?? 0, t.y ?? 0, (t.sheetX ?? 0) * 8, (t.sheetY ?? 0) * 8, 8, tileH, {
          ...(t.flipX ? { flipX: true } : {}),
          ...(t.flipY ? { flipY: true } : {}),
          ...(t.priority ? { priority: true } : {}),
        }),
      ),
    );
  const framesOf = (st: NonNullable<V1Sheet["states"]>[number]): SpriteAnimationJSON => ({
    id: newId(),
    frames: st.frameRefs?.length ? st.frameRefs.map(composedFrame) : (st.frames ?? []).map((n, i) => legacyFrame(n, !!st.flips?.[i])),
    ...(st.speed && st.speed !== DEFAULT_ANIM_SPEED ? { speed: st.speed } : {}),
  });

  const states: SpriteStateJSON[] = [];
  const main = newState("", old.animationType ?? "multi_movement");
  main.flipLeft = old.flipLeft !== false;
  // Start from the old fixed layout (what the engine showed for anything
  // not authored), then put the authored slots on top.
  const set = (i: number, nums: number[]) => (main.animations[i] = { id: newId(), frames: nums.map((n) => legacyFrame(n, false)) });
  set(0, [4]);
  set(1, [6]);
  set(2, [2]);
  set(3, [0]);
  set(4, [4, 5]);
  set(5, [6, 7]);
  set(6, [2, 3]);
  set(7, [0, 1]);
  const slotted = (old.states ?? []).filter((s) => s.slot && s.slot in V1_SLOT_INDEX);
  if (!slotted.length) main.animationType = "multi_movement";
  for (const st of slotted) main.animations[V1_SLOT_INDEX[st.slot!]] = framesOf(st);
  states.push(main);
  const names = new Set([""]);
  for (const st of old.states ?? []) {
    if (st.slot && st.slot in V1_SLOT_INDEX) continue;
    let name = st.name || "state";
    while (names.has(name)) name += "_";
    names.add(name);
    const s = newState(name, "fixed");
    s.animations[0] = framesOf(st);
    states.push(s);
  }

  // The old collision box was relative to the canvas; bounds are relative
  // to the 16x16 footprint the canvas is anchored on.
  const box = old.collisionBox ?? { x: 0, y: 0, width: cw, height: ch };
  const ax = Math.floor((16 - cw) / 2) + ox;
  const ay = 16 - ch + oy;
  return {
    version: 2,
    name: old.name,
    canvasWidth: cw,
    canvasHeight: ch,
    canvasOriginX: ox,
    canvasOriginY: oy,
    bounds: { x: box.x + ax, y: box.y + ay, width: box.width, height: box.height },
    animSpeed: DEFAULT_ANIM_SPEED,
    spriteMode: old.spriteMode ?? "8x16",
    states,
  };
}

/** project.json with every sprite sheet in the current format, or the
 * same object when nothing needed upgrading. */
export function migrateProjectSprites(project: ProjectJSON): ProjectJSON {
  const sheets = project.spriteSheets as unknown[] | undefined;
  if (!sheets || sheets.every(isCurrentSheet)) return project;
  return { ...project, spriteSheets: sheets.map((s) => (isCurrentSheet(s) ? s : migrateSheet(s as V1Sheet))) };
}

// ---------------------------------------------------------------------------
// Frame geometry
// ---------------------------------------------------------------------------

export function tileSize(t: SpriteTileJSON, mode: SpriteMode): { w: number; h: number } {
  return { w: t.width ?? 8, h: t.height ?? spriteModeHeight(mode) };
}

/** Top-left of the canvas relative to the actor's 16x16 footprint. */
export function canvasAnchor(sheet: SpriteSheetJSON): { x: number; y: number } {
  return { x: Math.floor((16 - sheet.canvasWidth) / 2) + sheet.canvasOriginX, y: 16 - sheet.canvasHeight + sheet.canvasOriginY };
}

/** Mirror a frame's tiles across the canvas (what "flip left" shows). */
export function mirrorTiles(tiles: SpriteTileJSON[], canvasWidth: number, mode: SpriteMode): SpriteTileJSON[] {
  return tiles.map((t) => {
    const { w } = tileSize(t, mode);
    return { ...t, x: canvasWidth - t.x - w, flipX: !t.flipX };
  });
}

/** A deep copy with fresh ids (for pasting / duplicating). */
export function cloneFrame(f: SpriteFrameJSON): SpriteFrameJSON {
  return { id: newId(), tiles: f.tiles.map((t) => ({ ...t, id: newId() })) };
}

export function stateLabel(state: SpriteStateJSON): string {
  return state.name || "Default";
}

/** Which project sprite the player uses. */
export function playerSpriteName(project: ProjectJSON): string {
  return project.playerSprite || "player";
}
