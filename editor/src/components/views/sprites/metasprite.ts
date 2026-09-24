/**
 * Pure helpers for the tile-composed ("metasprite") frame editor - a port
 * of GB Studio's MetaspriteEditor / SpriteTilePalette / spritesReducers
 * behaviour onto Shimmer Engine's data contract (shared/projectTypes.ts:
 * PlacedTileJSON x/y = pixel position of the tile's top-left relative to
 * the canvas top-left, y-down; sheetX/sheetY = tile-grid column/row in the
 * sheet PNG in 8px units).
 */
import type { PlacedTileJSON, SpriteFrameJSON, SpriteSheetJSON, SpriteStateJSON } from "../../../../shared/projectTypes";

export type SpriteMode = "8x8" | "8x16";

/** A placed tile that is guaranteed to carry an id (see normalizeTileIds). */
export type Tile = PlacedTileJSON & { id: string };

/** GB Studio's SpriteTileSelection: x/y are the top-left of the selection in
 * sheet PIXELS (always 8px-snapped here), width is in 8px tile columns and
 * height is in tile rows of the sheet's sprite mode height (8 or 16px). */
export interface PaletteSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const spriteModeOf = (sheet: SpriteSheetJSON | undefined | null): SpriteMode =>
  sheet?.spriteMode === "8x8" ? "8x8" : "8x16";

export const tileHeightFor = (mode: SpriteMode): number => (mode === "8x8" ? 8 : 16);

/** The topmost placed tile whose footprint contains canvas point (x, y),
 * or null. Used by the tile-composed editor's left-click tile eraser:
 * while a palette selection is armed, clicking an already-placed tile
 * deletes it instead of stamping a new tile on top of it. Iterates back
 * to front so an overlapping tile drawn later (on top) wins the hit
 * test, matching what's actually visible under the cursor. */
export function tileAt(tiles: Tile[], x: number, y: number, th: number): Tile | null {
  for (let i = tiles.length - 1; i >= 0; i--) {
    const t = tiles[i];
    if (x >= t.x && x < t.x + 8 && y >= t.y && y < t.y + th) return t;
  }
  return null;
}

let idCounter = 0;
/** A fresh unique tile / frame id. */
export function newId(prefix = "t"): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return `${prefix}_${c.randomUUID()}`;
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Tiles authored before ids existed get a deterministic id derived from
 * their index, so the SAME id is seen by the renderer (for selection) and by
 * the edit path (which persists it on first edit). Deterministic rather than
 * random on purpose: a random id generated at render time would change every
 * render and break selection-by-id. */
export function normalizeTileIds(tiles: PlacedTileJSON[] | undefined | null): Tile[] {
  const list = tiles ?? [];
  const used = new Set(list.map((t) => t.id).filter((id): id is string => !!id));
  return list.map((t, i) => {
    if (t.id) return t as Tile;
    let id = `legacy-${i}`;
    let n = 2;
    while (used.has(id)) id = `legacy-${i}-${n++}`;
    used.add(id);
    return { ...t, id };
  });
}

/** GB Studio's removeMetaspriteTilesOutsideCanvas: drop tiles that lie
 * ENTIRELY outside the canvas (a tile hanging partly over the edge stays). */
export function removeTilesOutsideCanvas<T extends PlacedTileJSON>(tiles: T[], cw: number, ch: number, th: number): T[] {
  return tiles.filter((t) => !(t.x + 8 <= 0 || t.x >= cw || t.y + th <= 0 || t.y >= ch));
}

/** Port of GB Studio's flipXMetaspriteTiles: toggles flipX on every selected
 * tile AND mirrors their positions within the selection's own bounding box,
 * so a multi-tile group flips as a unit. */
export function flipTilesX(tiles: Tile[], ids: string[]): Tile[] {
  const sel = tiles.filter((t) => ids.includes(t.id));
  if (!sel.length) return tiles;
  const left = Math.min(...sel.map((t) => t.x));
  const right = Math.max(...sel.map((t) => t.x)) + 8;
  const mirror = left + (right - left) / 2;
  return tiles.map((t) => {
    if (!ids.includes(t.id)) return t;
    const middle = t.x + 4;
    return { ...t, flipX: !t.flipX, x: Math.round(mirror + (mirror - middle) - 4) };
  });
}

/** Port of GB Studio's flipYMetaspriteTiles (same idea, vertical). */
export function flipTilesY(tiles: Tile[], ids: string[], th: number): Tile[] {
  const sel = tiles.filter((t) => ids.includes(t.id));
  if (!sel.length) return tiles;
  const top = Math.min(...sel.map((t) => t.y));
  const bottom = Math.max(...sel.map((t) => t.y)) + th;
  const mirror = top + (bottom - top) / 2;
  return tiles.map((t) => {
    if (!ids.includes(t.id)) return t;
    const middle = t.y + th / 2;
    return { ...t, flipY: !t.flipY, y: Math.round(mirror + (mirror - middle) - th / 2) };
  });
}

/** What a derived "*Left" state shows for one of its "*Right" sibling's
 * composed frames: every tile mirrored about the canvas (x' = cw - x - 8)
 * with flipX toggled - the same transform the compiler applies. */
export function mirrorTilesForLeft(tiles: Tile[], cw: number): Tile[] {
  return tiles.map((t) => ({ ...t, x: cw - t.x - 8, flipX: !t.flipX }));
}

/** The stamp GB Studio's onCreateTiles would add for `sel` with its
 * top-left at canvas pixel (ox, oy). */
export function stampTiles(sel: PaletteSelection, ox: number, oy: number, mode: SpriteMode): Tile[] {
  const th = tileHeightFor(mode);
  const out: Tile[] = [];
  for (let tx = 0; tx < sel.width; tx++) {
    for (let ty = 0; ty < sel.height; ty++) {
      out.push({
        id: newId("t"),
        x: ox + tx * 8,
        y: oy + ty * th,
        sheetX: sel.x / 8 + tx,
        sheetY: sel.y / 8 + ty * (th / 8),
      });
    }
  }
  return out;
}

/** The actor's 16x16 footprint/collision cell expressed in canvas pixels -
 * the inverse of the anchoring rule in SpriteSheetJSON's doc comment
 * (dx = tx + floor((16-cw)/2) + originX, dy = ty + (16-ch) + originY). */
export function footprintInCanvas(cw: number, ch: number, originX: number, originY: number): { x: number; y: number } {
  return { x: -(Math.floor((16 - cw) / 2) + originX), y: -(16 - ch + originY) };
}

/** A 16x16 frame taken from column-block `n` of a classic 96x16 sheet, as
 * placed tiles (two 8x16 tiles, or four 8x8 tiles). */
export function tilesForClassicFrame(n: number, mode: SpriteMode): Tile[] {
  if (mode === "8x16") {
    return [
      { id: newId("t"), x: 0, y: 0, sheetX: 2 * n, sheetY: 0 },
      { id: newId("t"), x: 8, y: 0, sheetX: 2 * n + 1, sheetY: 0 },
    ];
  }
  return [
    { id: newId("t"), x: 0, y: 0, sheetX: 2 * n, sheetY: 0 },
    { id: newId("t"), x: 8, y: 0, sheetX: 2 * n + 1, sheetY: 0 },
    { id: newId("t"), x: 0, y: 8, sheetX: 2 * n, sheetY: 1 },
    { id: newId("t"), x: 8, y: 8, sheetX: 2 * n + 1, sheetY: 1 },
  ];
}

/** `base`, or `base_2`, `base_3`... - the first not in `taken`. Adds it. */
export function uniqueId(base: string, taken: Set<string>): string {
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}_${n++}`;
  taken.add(id);
  return id;
}

/** Drop frames in `candidates` that no state references any more. */
export function gcFrames(frames: SpriteFrameJSON[], states: SpriteStateJSON[], candidates: Iterable<string>): SpriteFrameJSON[] {
  const referenced = new Set(states.flatMap((s) => s.frameRefs ?? []));
  const drop = new Set([...candidates].filter((id) => !referenced.has(id)));
  return drop.size ? frames.filter((f) => !drop.has(f.id)) : frames;
}

/** Which classic-sheet column blocks each generated state gets from
 * "Auto Detect Animations" on a 96x16 sheet (engine frame layout: cols 0,1
 * down; 2,3 up; 4,5 right; left = mirrored right via flipLeft). */
export const AUTO_DETECT_SLOTS: { slot: string; cols: number[] }[] = [
  { slot: "idleDown", cols: [0] },
  { slot: "movingDown", cols: [0, 1] },
  { slot: "idleUp", cols: [2] },
  { slot: "movingUp", cols: [2, 3] },
  { slot: "idleRight", cols: [4] },
  { slot: "movingRight", cols: [4, 5] },
];

/** Whether a keyboard event's target is a form field the editor's
 * shortcuts must leave alone. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || el.isContentEditable;
}
