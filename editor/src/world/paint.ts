/*
 * Painting the scene's per-tile layers - collision, colors (palette_map)
 * and tiles (tile_overrides) - with GB Studio's brushes: 8px, 16px, fill,
 * magic (every matching tile) and lines (shift-click).
 */

import type { SceneJSON } from "../../shared/projectTypes";
import type { PaintLayer, RcBrush, RcLayer, TileStamp } from "../state/projectStore";

/** Value of one cell in a layer: a collision character; a palette id or
 * null; "sx,sy" for a tile override or null for the original tile. */
export type CellValue = string | null;
export type Cells = Map<number, CellValue>;

export function resizeCollision(rows: string[], w: number, h: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? "";
    out.push(row.length >= w ? row.slice(0, w) : row + ".".repeat(w - row.length));
  }
  return out;
}

function resizePaletteMap(rows: (string | null)[][], w: number, h: number): (string | null)[][] {
  const out: (string | null)[][] = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? [];
    const next: (string | null)[] = [];
    for (let x = 0; x < w; x++) next.push(row[x] ?? null);
    out.push(next);
  }
  return out;
}

/** First Person 3D: wall_textures characters, "0" = raycast.textures[0]. */
export const RC_TEX_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
export const RC_LAYERS: RcLayer[] = ["shape", "walltex", "floor_flat", "ceil_flat", "floor_h", "ceil_h"];
export const isRcLayer = (l: PaintLayer): l is RcLayer => (RC_LAYERS as string[]).includes(l);

/** The project's wall textures (what a scene with no raycast.textures
 * uses): set by the canvas from the asset listing. */
let projectTextures: string[] = ["bricks"];
export function setProjectTextures(names: string[]) {
  projectTextures = names.length ? names : ["bricks"];
}
export function sceneTextures(scene: SceneJSON): string[] {
  return scene.raycast?.textures ?? projectTextures;
}

const RC_HEIGHT_KEY = { floor_h: "floor_heights", ceil_h: "ceiling_heights" } as const;
const RC_CHAR_KEY = { walltex: "wall_textures", floor_flat: "floor_flats", ceil_flat: "ceiling_flats" } as const;

/** The scene's floor and ceiling where none is painted. */
export function rcDefaults(scene: SceneJSON): { floor: number; ceil: number } {
  return { floor: scene.raycast?.floor_height ?? 0, ceil: scene.raycast?.ceiling_height ?? 8 };
}

/** "Shape" cells: "wall" (a solid collision tile), "floor,ceiling", or
 * null (the scene's defaults). Heights equal to the defaults are stored
 * as null, so changing the defaults moves them. */
function applyShape(scene: SceneJSON, w: number, h: number, cells: Cells): SceneJSON {
  const d = rcDefaults(scene);
  const coll: Cells = new Map();
  const floors: Cells = new Map();
  const ceils: Cells = new Map();
  for (const [k, v] of cells) {
    const x = k % w;
    const y = Math.floor(k / w);
    const was = scene.collision?.[y]?.[x] ?? ".";
    if (v === "wall") {
      coll.set(k, "#");
      floors.set(k, null);
      ceils.set(k, null);
      continue;
    }
    if (was === "#") coll.set(k, ".");
    const [f, c] = v === null ? [d.floor, d.ceil] : v.split(",").map(Number);
    floors.set(k, f === d.floor ? null : String(f));
    ceils.set(k, c === d.ceil ? null : String(c));
  }
  let next = applyCells(scene, "collision", w, h, coll);
  next = applyRcCells(next, "floor_h", w, h, floors);
  return applyRcCells(next, "ceil_h", w, h, ceils);
}

function applyRcCells(scene: SceneJSON, layer: RcLayer, w: number, h: number, cells: Cells): SceneJSON {
  if (!cells.size) return scene;
  if (layer === "shape") return applyShape(scene, w, h, cells);
  if (layer === "floor_h" || layer === "ceil_h") {
    const key = RC_HEIGHT_KEY[layer];
    const grid = resizePaletteMap((scene[key] ?? []) as (string | null)[][], w, h) as unknown as (number | null)[][];
    for (const [k, v] of cells) {
      const x = k % w;
      const y = Math.floor(k / w);
      if (grid[y] && x < w) grid[y][x] = v === null ? null : Number(v);
    }
    const next: SceneJSON = { ...scene, [key]: grid };
    if (!grid.some((r) => r.some((v) => v !== null))) delete next[key];
    return next;
  }
  const key = RC_CHAR_KEY[layer];
  const grid = resizeCollision(scene[key] ?? [], w, h).map((r) => r.split(""));
  let next: SceneJSON = scene;
  let textures = sceneTextures(scene);
  for (const [k, v] of cells) {
    const x = k % w;
    const y = Math.floor(k / w);
    if (!grid[y] || x >= w) continue;
    let ch = ".";
    if (v !== null && layer === "walltex") {
      let i = textures.indexOf(v);
      if (i < 0 && textures.length < RC_TEX_CHARS.length) {
        textures = [...textures, v];
        i = textures.length - 1;
      }
      ch = i <= 0 ? "." : RC_TEX_CHARS[i];
    } else if (v !== null) ch = v;
    grid[y][x] = ch;
  }
  const rows = grid.map((r) => r.join(""));
  next = { ...next, [key]: rows };
  if (layer === "walltex" && (textures !== sceneTextures(scene) || !scene.raycast?.textures))
    next.raycast = { ...(scene.raycast ?? {}), textures };
  if (!rows.some((r) => /[^.]/.test(r))) delete next[key];
  return next;
}

function readRcCell(scene: SceneJSON, layer: RcLayer, x: number, y: number): CellValue {
  if (layer === "shape") {
    if (scene.collision?.[y]?.[x] === "#") return "wall";
    const d = rcDefaults(scene);
    return `${scene.floor_heights?.[y]?.[x] ?? d.floor},${scene.ceiling_heights?.[y]?.[x] ?? d.ceil}`;
  }
  if (layer === "floor_h" || layer === "ceil_h") {
    const v = scene[RC_HEIGHT_KEY[layer]]?.[y]?.[x];
    return v === null || v === undefined ? null : String(v);
  }
  const ch = scene[RC_CHAR_KEY[layer]]?.[y]?.[x] ?? ".";
  if (ch === ".") return null;
  if (layer === "walltex") {
    const i = RC_TEX_CHARS.indexOf(ch.toLowerCase());
    return sceneTextures(scene)[i] ?? null;
  }
  return ch;
}

/** The scene with `cells` written into `layer`. */
export function applyCells(scene: SceneJSON, layer: PaintLayer, w: number, h: number, cells: Cells): SceneJSON {
  if (!cells.size) return scene;
  if (isRcLayer(layer)) return applyRcCells(scene, layer, w, h, cells);
  if (layer === "front") {
    const grid = resizeCollision(scene.front_tiles ?? [], w, h).map((r) => r.split(""));
    for (const [k, v] of cells) {
      const x = k % w;
      const y = Math.floor(k / w);
      if (grid[y] && x < w) grid[y][x] = v === "#" ? "#" : ".";
    }
    const rows = grid.map((r) => r.join(""));
    const next: SceneJSON = { ...scene, front_tiles: rows };
    if (!rows.some((r) => r.includes("#"))) delete next.front_tiles;
    return next;
  }
  if (layer === "collision") {
    const grid = resizeCollision(scene.collision ?? [], w, h).map((r) => r.split(""));
    for (const [k, v] of cells) {
      const x = k % w;
      const y = Math.floor(k / w);
      if (grid[y] && x < w) grid[y][x] = v ?? ".";
    }
    return { ...scene, collision: grid.map((r) => r.join("")) };
  }
  if (layer === "palette") {
    const grid = resizePaletteMap(scene.palette_map ?? [], w, h);
    for (const [k, v] of cells) {
      const x = k % w;
      const y = Math.floor(k / w);
      if (grid[y] && x < w) grid[y][x] = v;
    }
    return { ...scene, palette_map: grid };
  }
  const over: Record<string, [number, number]> = { ...(scene.tile_overrides ?? {}) };
  for (const [k, v] of cells) {
    const x = k % w;
    const y = Math.floor(k / w);
    const key = `${x},${y}`;
    if (v === null) delete over[key];
    else {
      const [sx, sy] = v.split(",").map(Number);
      if (sx === x && sy === y) delete over[key];
      else over[key] = [sx, sy];
    }
  }
  const next: SceneJSON = { ...scene, tile_overrides: over };
  if (!Object.keys(over).length) delete next.tile_overrides;
  return next;
}

/** What a cell holds now (for fill/magic comparisons). For tiles, the
 * pixel-content key of the tile shown there, so equal-looking tiles match. */
export function cellKey(scene: SceneJSON, layer: PaintLayer, x: number, y: number, tileKeys: string[] | null, w: number): string {
  if (isRcLayer(layer)) return readRcCell(scene, layer, x, y) ?? "";
  if (layer === "collision") return scene.collision?.[y]?.[x] ?? ".";
  if (layer === "front") return scene.front_tiles?.[y]?.[x] ?? ".";
  if (layer === "palette") return scene.palette_map?.[y]?.[x] ?? "";
  const o = scene.tile_overrides?.[`${x},${y}`];
  const sx = o ? o[0] : x;
  const sy = o ? o[1] : y;
  return tileKeys?.[sy * w + sx] ?? `${sx},${sy}`;
}

export function readCell(scene: SceneJSON, layer: PaintLayer, x: number, y: number): CellValue {
  if (isRcLayer(layer)) return readRcCell(scene, layer, x, y);
  if (layer === "collision") return scene.collision?.[y]?.[x] ?? ".";
  if (layer === "front") return scene.front_tiles?.[y]?.[x] ?? ".";
  if (layer === "palette") return scene.palette_map?.[y]?.[x] ?? null;
  const o = scene.tile_overrides?.[`${x},${y}`];
  return o ? `${o[0]},${o[1]}` : null;
}

/** Cells a flood fill from (x, y) reaches: 4-connected, same key. */
export function floodCells(w: number, h: number, x: number, y: number, key: (x: number, y: number) => string): number[] {
  const target = key(x, y);
  const seen = new Uint8Array(w * h);
  const out: number[] = [];
  const stack = [y * w + x];
  seen[y * w + x] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    out.push(k);
    const cx = k % w;
    const cy = Math.floor(k / w);
    const push = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
      const nk = ny * w + nx;
      if (seen[nk]) return;
      seen[nk] = 1;
      if (key(nx, ny) === target) stack.push(nk);
    };
    push(cx + 1, cy);
    push(cx - 1, cy);
    push(cx, cy + 1);
    push(cx, cy - 1);
  }
  return out;
}

/** Every cell with the same key as (x, y) - GB Studio's magic brush. */
export function magicCells(w: number, h: number, x: number, y: number, key: (x: number, y: number) => string): number[] {
  const target = key(x, y);
  const out: number[] = [];
  for (let ty = 0; ty < h; ty++) for (let tx = 0; tx < w; tx++) if (key(tx, ty) === target) out.push(ty * w + tx);
  return out;
}

/** Cells on a line (Bresenham). */
export function lineCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const out: [number, number][] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    out.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

/** The value the brush puts in cell (x, y); `anchor` is where the stroke
 * started, so a multi-tile stamp repeats in step. */
export function brushValue(
  layer: PaintLayer,
  erase: boolean,
  collisionBrush: string,
  paletteBrush: string | null,
  stamp: TileStamp | null,
  anchor: { x: number; y: number },
  x: number,
  y: number,
  rc?: RcBrush,
): CellValue {
  if (isRcLayer(layer)) {
    if (erase || !rc) return null;
    if (layer === "shape") return rc.shape_wall ? "wall" : `${rc.shape_floor},${rc.shape_ceil}`;
    if (layer === "walltex") return rc.walltex || null;
    if (layer === "floor_flat" || layer === "ceil_flat") return rc[layer] > 0 ? String(rc[layer]) : null;
    return String(rc[layer]);
  }
  if (layer === "collision") return erase ? "." : collisionBrush;
  if (layer === "front") return erase ? "." : "#";
  if (layer === "palette") return erase ? null : paletteBrush;
  if (erase || !stamp) return null;
  const mod = (a: number, n: number) => ((a % n) + n) % n;
  return `${stamp.x + mod(x - anchor.x, stamp.w)},${stamp.y + mod(y - anchor.y, stamp.h)}`;
}

/** Cells an 8px / 16px brush (or a tile stamp) covers at (x, y). */
export function footprint(
  size: 1 | 2,
  stamp: TileStamp | null,
  anchor: { x: number; y: number },
  x: number,
  y: number,
): [number, number][] {
  if (stamp && (stamp.w > 1 || stamp.h > 1)) {
    // Snap to the stamp grid started at the anchor, stamp the whole block.
    const mod = (a: number, n: number) => ((a % n) + n) % n;
    const bx = x - mod(x - anchor.x, stamp.w);
    const by = y - mod(y - anchor.y, stamp.h);
    const out: [number, number][] = [];
    for (let j = 0; j < stamp.h; j++) for (let i = 0; i < stamp.w; i++) out.push([bx + i, by + j]);
    return out;
  }
  if (size === 2)
    return [
      [x, y],
      [x + 1, y],
      [x, y + 1],
      [x + 1, y + 1],
    ];
  return [[x, y]];
}

/** Content key per 8x8 tile of an image, row-major - equal keys look equal. */
export function tileKeysOf(img: HTMLImageElement): string[] {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const d = ctx.getImageData(0, 0, img.width, img.height).data;
  const tw = Math.floor(img.width / 8);
  const th = Math.floor(img.height / 8);
  const keys: string[] = [];
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      let hsh = 2166136261;
      let hsh2 = 0;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const i = ((ty * 8 + y) * img.width + tx * 8 + x) * 4;
          const v = d[i + 3] < 128 ? 0 : (d[i] << 16) | (d[i + 1] << 8) | d[i + 2] | 0x1000000;
          hsh = Math.imul(hsh ^ v, 16777619);
          hsh2 = (hsh2 * 31 + v) | 0;
        }
      keys.push(`${hsh >>> 0}:${hsh2 >>> 0}`);
    }
  return keys;
}
