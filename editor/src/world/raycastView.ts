/*
 * First Person 3D scenes on the map canvas: how each 3D layer (heights,
 * wall textures, floor / ceiling colours) is drawn over the map, and the
 * built-in "bricks" texture (compiler default_wall_texture()).
 */

import type { SceneJSON } from "../../shared/projectTypes";
import type { RcLayer } from "../state/projectStore";
import { rcDefaults, RC_TEX_CHARS, sceneTextures } from "./paint";

export const RC_DEFAULT_CEILING = 8;
/** Ceiling height 255: open sky. */
export const RC_SKY = 255;
export const RC_DEFAULT_WALL = 16;
/** Engine limits (engine/include/raycast.h), in 1/8 tiles. */
export const RC_EYE = 4;
export const RC_STEP = 3;
export const RC_HEADROOM = 5;
export const RC_MAX_FLATS = 5;

export const RC_LAYER_LABEL: Record<RcLayer, string> = {
  shape: "Shape",
  floor_h: "Floor only",
  ceil_h: "Ceiling only",
  walltex: "Wall texture",
  floor_flat: "Floor colour",
  ceil_flat: "Ceiling colour",
};

/** The compiler's built-in wall texture, as a 32x32 canvas. */
export function bricksCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(32, 32);
  const put = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * 32 + x) * 4;
    img.data[i] = r;
    img.data[i + 1] = g;
    img.data[i + 2] = b;
    img.data[i + 3] = 255;
  };
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) put(x, y, 88, 84, 80);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 8;
    const shift = row % 2 === 0 ? 0 : 8;
    for (let col = -1; col < 3; col++) {
      const x0 = col * 16 + shift;
      for (let y = y0 + 1; y < y0 + 7; y++)
        for (let x = x0 + 1; x < x0 + 15; x++) if (x >= 0 && x < 32) put(x, y, (x + y) % 5 ? 150 : 135, 64, 44);
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function floorAt(s: SceneJSON, x: number, y: number): number {
  return s.floor_heights?.[y]?.[x] ?? rcDefaults(s).floor;
}

export function ceilAt(s: SceneJSON, x: number, y: number): number {
  return s.ceiling_heights?.[y]?.[x] ?? rcDefaults(s).ceil;
}

/** A wall in the game: a solid collision tile, or no room under the ceiling. */
export function isRcWall(s: SceneJSON, x: number, y: number): boolean {
  return s.collision?.[y]?.[x] === "#" || ceilAt(s, x, y) <= floorAt(s, x, y);
}

/** Heights in eighths of a tile, as words: "1½ tiles". */
export function tilesText(units: number): string {
  const whole = Math.floor(Math.abs(units) / 8);
  const rest = Math.abs(units) % 8;
  const frac = ["", "⅛", "¼", "⅜", "½", "⅝", "¾", "⅞"][rest];
  const n = whole === 0 && frac ? frac : `${whole}${frac}`;
  return `${units < 0 ? "-" : ""}${n} tile${whole === 1 && !frac ? "" : "s"}`;
}

function heightColor(v: number, ceiling: boolean): string {
  const t = Math.max(0, Math.min(1, v / 24));
  return ceiling ? `hsla(${270 - t * 90}, 55%, ${22 + t * 45}%, 0.7)` : `hsla(${210 - t * 180}, 60%, ${22 + t * 45}%, 0.7)`;
}

export interface RcDrawOptions {
  S: number;
  w: number;
  h: number;
  textures: Record<string, CanvasImageSource>;
  font: string;
  labels: boolean;
}

/** Draws `layer` of a 3D scene over the map. */
export function drawRcLayer(ctx: CanvasRenderingContext2D, s: SceneJSON, layer: RcLayer, o: RcDrawOptions) {
  const { S, w, h } = o;
  const label = (text: string, x: number, y: number, dim: boolean) => {
    if (!o.labels || !text) return;
    ctx.globalAlpha = dim ? 0.45 : 1;
    ctx.strokeText(text, x * S + S / 2, y * S + S / 2);
    ctx.fillText(text, x * S + S / 2, y * S + S / 2);
    ctx.globalAlpha = 1;
  };
  ctx.font = o.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(0,0,0,.85)";

  if (layer === "shape") {
    const d = rcDefaults(s);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const wall = isRcWall(s, x, y);
        const c = ceilAt(s, x, y);
        ctx.fillStyle = wall ? "rgba(255, 64, 64, 0.55)" : heightColor(floorAt(s, x, y) - d.floor + 6, false);
        ctx.fillRect(x * S, y * S, S, S);
        if (!wall && c >= RC_SKY && S >= 8) {
          ctx.fillStyle = "rgba(140, 200, 255, 0.55)";
          ctx.fillRect(x * S, y * S, S, Math.max(2, S / 6));
        } else if (!wall && c - floorAt(s, x, y) < 5 && S >= 8) {
          ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
          ctx.fillRect(x * S, y * S, S, Math.max(2, S / 6));
        }
      }
    ctx.fillStyle = "#fff";
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (isRcWall(s, x, y)) continue;
        const f = floorAt(s, x, y);
        const c = ceilAt(s, x, y);
        const changed = s.floor_heights?.[y]?.[x] != null || s.ceiling_heights?.[y]?.[x] != null;
        label(S >= 24 ? `${f}/${c >= RC_SKY ? "sky" : c}` : String(f), x, y, !changed);
      }
  } else if (layer === "floor_h" || layer === "ceil_h") {
    const ceiling = layer === "ceil_h";
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (isRcWall(s, x, y)) {
          ctx.fillStyle = "rgba(255, 64, 64, 0.5)";
          ctx.fillRect(x * S, y * S, S, S);
          continue;
        }
        const v = ceiling ? ceilAt(s, x, y) : floorAt(s, x, y);
        ctx.fillStyle = heightColor(v, ceiling);
        ctx.fillRect(x * S, y * S, S, S);
      }
    ctx.fillStyle = "#fff";
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        if (s.collision?.[y]?.[x] === "#") continue;
        const set = (ceiling ? s.ceiling_heights : s.floor_heights)?.[y]?.[x];
        const v = ceiling ? ceilAt(s, x, y) : floorAt(s, x, y);
        label(String(v), x, y, set === null || set === undefined);
      }
  } else if (layer === "walltex") {
    const names = sceneTextures(s);
    ctx.imageSmoothingEnabled = false;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const ch = s.wall_textures?.[y]?.[x] ?? ".";
        const i = ch === "." ? 0 : RC_TEX_CHARS.indexOf(ch.toLowerCase());
        const img = o.textures[names[i] ?? ""];
        const wall = isRcWall(s, x, y);
        if (!wall && ch === ".") continue;
        ctx.globalAlpha = wall ? 1 : 0.55;
        if (img) ctx.drawImage(img, x * S, y * S, S, S);
        else {
          ctx.fillStyle = "#f0f";
          ctx.fillRect(x * S, y * S, S, S);
        }
        ctx.globalAlpha = 1;
      }
  } else {
    const rows = layer === "floor_flat" ? s.floor_flats : s.ceiling_flats;
    const flats = s.raycast?.flats ?? [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const ch = rows?.[y]?.[x] ?? ".";
        if (ch === "." || isRcWall(s, x, y)) continue;
        ctx.fillStyle = flats[Number(ch) - 1] ?? "#f0f";
        ctx.globalAlpha = 0.8;
        ctx.fillRect(x * S, y * S, S, S);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#fff";
        label(ch, x, y, false);
      }
  }
  ctx.textAlign = "left";
}
