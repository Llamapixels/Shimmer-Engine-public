/*
 * How much GBA hardware a frame costs - the same packing as
 * compiler/sprites.py's rasterize()/pack_layer()/pack_frame(), so the
 * numbers the editor shows are the ones the ROM gets.
 */

import type { SpriteMode, SpriteTileJSON } from "../../shared/projectTypes";
import { pixelAt, type SpriteImage } from "./image";
import { tileSize } from "./model";

// OBJ sizes in 8px cells, largest first (then as listed).
const SHAPES: [number, number][] = [
  [8, 8],
  [8, 4],
  [4, 8],
  [4, 4],
  [4, 2],
  [2, 4],
  [2, 2],
  [4, 1],
  [1, 4],
  [2, 1],
  [1, 2],
  [1, 1],
].sort((a, b) => b[0] * b[1] - a[0] * a[1]) as [number, number][];

export interface PackedObj {
  /** Canvas px. */
  x: number;
  y: number;
  w: number;
  h: number;
  behind: boolean;
}

export interface FrameCost {
  objs: PackedObj[];
  /** Unique 8x8 VRAM tiles the frame streams in. */
  vramTiles: number;
}

type Layer = { behind: boolean; pixels: Map<number, number> };

const key = (x: number, y: number) => (y + 4096) * 16384 + (x + 4096);
const unkey = (k: number): [number, number] => [(k % 16384) - 4096, Math.floor(k / 16384) - 4096];

function rasterize(img: SpriteImage, tiles: SpriteTileJSON[], mode: SpriteMode): Layer[] {
  const layers: Layer[] = [];
  for (const t of tiles) {
    const { w, h } = tileSize(t, mode);
    if (w <= 0 || h <= 0) continue;
    const behind = !!t.priority;
    if (!layers.length || layers[layers.length - 1].behind !== behind) layers.push({ behind, pixels: new Map() });
    const px = layers[layers.length - 1].pixels;
    for (let py = 0; py < h; py++) {
      const sy = t.sliceY + (t.flipY ? h - 1 - py : py);
      for (let pxx = 0; pxx < w; pxx++) {
        const sx = t.sliceX + (t.flipX ? w - 1 - pxx : pxx);
        const c = pixelAt(img, sx, sy);
        if (c) px.set(key(t.x + pxx, t.y + py), c);
      }
    }
  }
  return layers;
}

function packLayer(pixels: Map<number, number>): [number, number, number, number][] {
  if (!pixels.size) return [];
  let ox = Infinity;
  let oy = Infinity;
  for (const k of pixels.keys()) {
    const [x, y] = unkey(k);
    ox = Math.min(ox, x);
    oy = Math.min(oy, y);
  }
  const cells = new Set<number>();
  for (const k of pixels.keys()) {
    const [x, y] = unkey(k);
    cells.add(key(Math.floor((x - ox) / 8), Math.floor((y - oy) / 8)));
  }
  const uncovered = new Set(cells);
  const order = [...cells].map(unkey).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: [number, number, number, number][] = [];
  for (const [cx, cy] of order) {
    if (!uncovered.has(key(cx, cy))) continue;
    let best: { s: [number, number, number]; x0: number; wc: number; hc: number } | null = null;
    for (const [wc, hc] of SHAPES) {
      for (let x0 = Math.max(0, cx - wc + 1); x0 <= cx; x0++) {
        let fresh = 0;
        let overlap = 0;
        for (let j = 0; j < hc; j++)
          for (let i = 0; i < wc; i++) {
            const c = key(x0 + i, cy + j);
            if (uncovered.has(c)) fresh++;
            else if (cells.has(c)) overlap++;
          }
        if (fresh * 2 < wc * hc) continue;
        const s: [number, number, number] = [fresh, -wc * hc, -overlap];
        if (!best || s[0] > best.s[0] || (s[0] === best.s[0] && (s[1] > best.s[1] || (s[1] === best.s[1] && s[2] > best.s[2]))))
          best = { s, x0, wc, hc };
      }
    }
    const b = best!;
    for (let j = 0; j < b.hc; j++) for (let i = 0; i < b.wc; i++) uncovered.delete(key(b.x0 + i, cy + j));
    out.push([ox + b.x0 * 8, oy + cy * 8, b.wc, b.hc]);
  }
  return out;
}

const costCache = new WeakMap<SpriteTileJSON[], Map<SpriteImage, FrameCost>>();

export function frameCost(img: SpriteImage, tiles: SpriteTileJSON[], mode: SpriteMode): FrameCost {
  let byImg = costCache.get(tiles);
  const hit = byImg?.get(img);
  if (hit) return hit;
  const objs: PackedObj[] = [];
  const seen = new Set<string>();
  let vram = 0;
  for (const layer of rasterize(img, tiles, mode)) {
    for (const [x, y, wc, hc] of packLayer(layer.pixels)) {
      const bytes: number[] = [];
      for (let py = 0; py < hc * 8; py++) for (let px = 0; px < wc * 8; px++) bytes.push(layer.pixels.get(key(x + px, y + py)) ?? 0);
      const sig = `${wc},${hc}:${bytes.join(",")}`;
      if (!seen.has(sig)) {
        seen.add(sig);
        vram += wc * hc;
      }
      objs.push({ x, y, w: wc * 8, h: hc * 8, behind: layer.behind });
    }
  }
  const cost = { objs, vramTiles: vram };
  if (!byImg) {
    byImg = new Map();
    costCache.set(tiles, byImg);
  }
  byImg.set(img, cost);
  return cost;
}
