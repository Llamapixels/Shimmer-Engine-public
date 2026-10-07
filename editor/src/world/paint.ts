/*
 * Painting the scene's per-tile layers - collision, colors (palette_map)
 * and tiles (tile_overrides) - with GB Studio's brushes: 8px, 16px, fill,
 * magic (every matching tile) and lines (shift-click).
 */

import type { SceneJSON } from "../../shared/projectTypes";
import type { PaintLayer, TileStamp } from "../state/projectStore";

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

/** The scene with `cells` written into `layer`. */
export function applyCells(scene: SceneJSON, layer: PaintLayer, w: number, h: number, cells: Cells): SceneJSON {
  if (!cells.size) return scene;
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
  if (layer === "collision") return scene.collision?.[y]?.[x] ?? ".";
  if (layer === "front") return scene.front_tiles?.[y]?.[x] ?? ".";
  if (layer === "palette") return scene.palette_map?.[y]?.[x] ?? "";
  const o = scene.tile_overrides?.[`${x},${y}`];
  const sx = o ? o[0] : x;
  const sy = o ? o[1] : y;
  return tileKeys?.[sy * w + sx] ?? `${sx},${sy}`;
}

export function readCell(scene: SceneJSON, layer: PaintLayer, x: number, y: number): CellValue {
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
): CellValue {
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
