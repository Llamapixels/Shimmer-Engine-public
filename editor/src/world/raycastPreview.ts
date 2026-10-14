/*
 * The editor's First Person 3D preview: the engine's renderer
 * (engine/source/raycast.c) redone in floating point - same rules for
 * heights, faces, textures, colours and actors, so what it shows is what
 * the GBA shows - and the engine's walking rules (steps, headroom).
 */

import type { SceneJSON } from "../../shared/projectTypes";
import { RC_TEX_CHARS, sceneTextures } from "./paint";
import { ceilAt, floorAt, RC_EYE, RC_HEADROOM, RC_STEP } from "./raycastView";

export const VIEW_W = 120;
export const VIEW_H = 80;
const HORIZON = VIEW_H / 2;
const TEX = 32;
const MAX_STEPS = 64;
/** The camera plane: a ~67 degree view, as the engine's. */
const PLANE = 2 / 3;

export interface Camera {
  /** Position in tiles (cells), angle in radians (0 = right, +y = down). */
  x: number;
  y: number;
  angle: number;
  /** Floor the eye stands on, in 1/8 tiles. */
  floor: number;
}

/** A texture or actor frame as pixels (0 = see-through for actors). */
export interface Pixels {
  w: number;
  h: number;
  data: Uint32Array;
}

export interface Billboard {
  /** Footprint centre, in tiles. */
  x: number;
  y: number;
  /** The 64x64 actor canvas (16 px a tile, footprint at 24, 48). */
  px: Pixels;
}

const pixelCache = new WeakMap<object, Pixels>();

/** An image's pixels (cached per image). */
export function pixelsOf(img: CanvasImageSource & { width: number | SVGAnimatedLength; height: number | SVGAnimatedLength }, w = TEX, h = TEX): Pixels {
  const hit = pixelCache.get(img);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, 0, 0, w, h);
  const px = { w, h, data: new Uint32Array(ctx.getImageData(0, 0, w, h).data.buffer.slice(0)) };
  pixelCache.set(img, px);
  return px;
}

function hexColor(c: string | undefined, d: string): number {
  const v = c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d;
  const r = parseInt(v.slice(1, 3), 16);
  const g = parseInt(v.slice(3, 5), 16);
  const b = parseInt(v.slice(5, 7), 16);
  return (0xff << 24) | (b << 16) | (g << 8) | r;
}

const darken = (c: number) =>
  (0xff << 24) | ((((c >> 16) & 255) * 5) >> 3 << 16) | ((((c >> 8) & 255) * 5) >> 3 << 8) | (((c & 255) * 5) >> 3);

/** The scene as the engine sees it: per cell floor / ceiling (units),
 * texture and colours. */
export interface RcMap {
  w: number;
  h: number;
  floor: Float32Array;
  ceil: Float32Array;
  tex: (Pixels | null)[];
  fcol: Uint32Array;
  ccol: Uint32Array;
}

export function buildMap(s: SceneJSON, w: number, h: number, textures: Record<string, Pixels>): RcMap {
  const names = sceneTextures(s);
  const look = s.raycast ?? {};
  const floorC = hexColor(look.floor, "#3c3a36");
  const ceilC = hexColor(look.ceiling, "#22242c");
  const flats = (look.flats ?? []).map((c) => hexColor(c, "#000000"));
  const n = w * h;
  const m: RcMap = {
    w,
    h,
    floor: new Float32Array(n),
    ceil: new Float32Array(n),
    tex: new Array(n),
    fcol: new Uint32Array(n),
    ccol: new Uint32Array(n),
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const f = floorAt(s, x, y);
      m.floor[i] = f;
      m.ceil[i] = s.collision?.[y]?.[x] === "#" ? f : ceilAt(s, x, y);
      const ch = s.wall_textures?.[y]?.[x] ?? ".";
      const t = ch === "." ? 0 : Math.max(0, RC_TEX_CHARS.indexOf(ch.toLowerCase()));
      m.tex[i] = textures[names[t] ?? ""] ?? null;
      const fc = s.floor_flats?.[y]?.[x] ?? ".";
      const cc = s.ceiling_flats?.[y]?.[x] ?? ".";
      m.fcol[i] = fc === "." ? floorC : flats[Number(fc) - 1] ?? floorC;
      m.ccol[i] = cc === "." ? ceilC : flats[Number(cc) - 1] ?? ceilC;
    }
  return m;
}

const isSolid = (m: RcMap, i: number) => m.ceil[i] <= m.floor[i];

/** Draws the view into `out` (VIEW_W x VIEW_H, ABGR). */
export function renderView(m: RcMap, cam: Camera, actors: Billboard[], out: Uint32Array) {
  out.fill(0xff000000);
  const dirX = Math.cos(cam.angle);
  const dirY = Math.sin(cam.angle);
  const planeX = -dirY * PLANE;
  const planeY = dirX * PLANE;
  const eye = cam.floor + RC_EYE;
  const segs: { d: number; top: number; bot: number }[][] = [];
  const mx0 = Math.floor(cam.x);
  const my0 = Math.floor(cam.y);
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h;

  for (let x = 0; x < VIEW_W; x++) {
    const camX = (2 * x + 1) / VIEW_W - 1;
    const rayX = dirX + planeX * camX;
    const rayY = dirY + planeY * camX;
    const ddX = rayX === 0 ? 1e30 : Math.abs(1 / rayX);
    const ddY = rayY === 0 ? 1e30 : Math.abs(1 / rayY);
    let mapX = mx0;
    let mapY = my0;
    const stepX = rayX < 0 ? -1 : 1;
    const stepY = rayY < 0 ? -1 : 1;
    let sideX = rayX < 0 ? (cam.x - mapX) * ddX : (mapX + 1 - cam.x) * ddX;
    let sideY = rayY < 0 ? (cam.y - mapY) * ddY : (mapY + 1 - cam.y) * ddY;

    const ci = inMap(mx0, my0) ? my0 * m.w + mx0 : 0;
    let cFloor = m.floor[ci];
    let cCeil = m.ceil[ci];
    let cFc = m.fcol[ci];
    let cCc = m.ccol[ci];
    let ytop = 0;
    let ybot = VIEW_H;
    let nearF = VIEW_H;
    let nearC = 0;
    let closed = false;
    const colSegs: { d: number; top: number; bot: number }[] = [];

    const fill = (y0: number, y1: number, c: number) => {
      for (let y = Math.max(0, y0); y < Math.min(VIEW_H, y1); y++) out[y * VIEW_W + x] = c;
    };
    const face = (y0: number, y1: number, top: number, line: number, col: Pixels | null, texX: number, shade: boolean) => {
      for (let y = Math.max(0, y0); y < Math.min(VIEW_H, y1); y++) {
        let c = 0xff808080;
        if (col) {
          const v = Math.floor(((y - top) * TEX) / line) & (TEX - 1);
          c = col.data[v * TEX + texX];
        }
        out[y * VIEW_W + x] = shade ? darken(c) : c;
      }
    };

    for (let n = 0; n < MAX_STEPS && !closed; n++) {
      let side: 0 | 1;
      if (sideX < sideY) {
        sideX += ddX;
        mapX += stepX;
        side = 0;
      } else {
        sideY += ddY;
        mapY += stepY;
        side = 1;
      }
      const out_ = !inMap(mapX, mapY);
      const ni = out_ ? 0 : mapY * m.w + mapX;
      const nFloor = out_ ? cFloor : m.floor[ni];
      const nCeil = out_ ? cFloor : m.ceil[ni];
      // Nothing changes here (a solid cell never matches an open one).
      if (!out_ && nFloor === cFloor && nCeil === cCeil && m.fcol[ni] === cFc && m.ccol[ni] === cCc) continue;
      const solid = out_ || nCeil <= nFloor;
      const d = Math.max(1 / 64, side === 0 ? sideX - ddX : sideY - ddY);
      const line = VIEW_H / d;
      const yf = Math.floor(HORIZON + ((eye - cFloor) / 8) * line);
      const yc = Math.floor(HORIZON - ((cCeil - eye) / 8) * line);

      // The floor and ceiling of the stretch just crossed.
      fill(Math.max(yf, ytop), Math.min(nearF, ybot), cFc);
      fill(Math.max(nearC, ytop), Math.min(yc, ybot), cCc);
      if (yf < ybot) ybot = yf;
      if (yc > ytop) ytop = yc;

      const tex = out_ ? null : m.tex[ni];
      const wall = side === 0 ? cam.y + d * rayY : cam.x + d * rayX;
      let texX = Math.floor((wall - Math.floor(wall)) * TEX);
      if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texX = TEX - 1 - texX;
      const shade = side === 1;

      if (solid) {
        if (ytop < ybot) face(Math.max(ytop, yc), Math.min(ybot, yf), yc, line, tex, texX, shade);
        ytop = ybot;
        closed = true;
      } else {
        const nyc = Math.floor(HORIZON - ((nCeil - eye) / 8) * line);
        const nyf = Math.floor(HORIZON + ((eye - nFloor) / 8) * line);
        if (nCeil < cCeil && nyc > ytop) {
          face(Math.max(ytop, yc), Math.min(ybot, nyc), yc, line, tex, texX, shade);
          ytop = nyc;
        }
        if (nFloor > cFloor && nyf < ybot) {
          face(Math.max(ytop, nyf), Math.min(ybot, yf), nyf, line, tex, texX, shade);
          ybot = nyf;
        }
        cFloor = nFloor;
        cCeil = nCeil;
        cFc = m.fcol[ni];
        cCc = m.ccol[ni];
        nearF = nyf;
        nearC = nyc;
        if (ytop >= ybot) closed = true;
      }
      colSegs.push({ d, top: Math.max(0, Math.min(VIEW_H, ytop)), bot: Math.max(0, Math.min(VIEW_H, ybot)) });
    }
    if (!closed) {
      fill(Math.max(HORIZON, ytop), Math.min(nearF, ybot), cFc);
      fill(Math.max(nearC, ytop), Math.min(HORIZON, ybot), cCc);
    }
    segs.push(colSegs);
  }

  // Actors: billboards, far to near, each column inside the window still
  // open at its distance.
  const det = planeX * dirY - dirX * planeY;
  const boards = actors
    .map((a) => {
      const sx = a.x - cam.x;
      const sy = a.y - cam.y;
      const tx = (dirY * sx - dirX * sy) / det;
      const ty = (-planeY * sx + planeX * sy) / det;
      return { a, tx, ty };
    })
    .filter((b) => b.ty > 1 / 16)
    .sort((p, q) => q.ty - p.ty);
  for (const { a, tx, ty } of boards) {
    const screenX = (VIEW_W / 2) * (1 + tx / ty);
    const line = VIEW_H / ty;
    const cx = Math.floor(a.x);
    const cy = Math.floor(a.y);
    const fl = inMap(cx, cy) ? m.floor[cy * m.w + cx] : 0;
    const bottom = Math.floor(HORIZON + ((eye - fl) / 8) * line);
    const span = line * 4;
    const left = screenX - line * 2;
    const top = bottom - span;
    for (let x = Math.max(0, Math.floor(left)); x < Math.min(VIEW_W, Math.ceil(left + span)); x++) {
      let wt = 0;
      let wb = VIEW_H;
      for (const s of segs[x]) {
        if (s.d >= ty) break;
        wt = s.top;
        wb = s.bot;
      }
      const u = Math.floor(((x - left) / span) * a.px.w);
      if (u < 0 || u >= a.px.w) continue;
      for (let y = Math.max(wt, Math.ceil(top)); y < Math.min(wb, bottom); y++) {
        const v = Math.floor(((y - top) / span) * a.px.h);
        const c = a.px.data[v * a.px.w + u];
        if (c >>> 24 >= 128) out[y * VIEW_W + x] = c;
      }
    }
  }
}

/** Highest floor under a box (tiles), as raycast_floor_under(). */
function floorUnder(m: RcMap, x: number, y: number, half: number): number {
  let top = 0;
  for (let cy = Math.floor(y - half); cy <= Math.floor(y + half - 1e-6); cy++)
    for (let cx = Math.floor(x - half); cx <= Math.floor(x + half - 1e-6); cx++) {
      if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) continue;
      const i = cy * m.w + cx;
      if (!isSolid(m, i) && m.floor[i] > top) top = m.floor[i];
    }
  return top;
}

/** Can the player's box stand here, from `floor`? (raycast_box_ok()) */
function boxOk(m: RcMap, x: number, y: number, half: number, floor: number): boolean {
  for (let cy = Math.floor(y - half); cy <= Math.floor(y + half - 1e-6); cy++)
    for (let cx = Math.floor(x - half); cx <= Math.floor(x + half - 1e-6); cx++) {
      if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return false;
      const i = cy * m.w + cx;
      if (isSolid(m, i)) return false;
      if (m.floor[i] - floor > RC_STEP) return false;
      if (m.ceil[i] - Math.max(m.floor[i], floor) < RC_HEADROOM) return false;
    }
  return true;
}

/** The player is 6x6 px: 3/8 of a tile either side of its centre. */
const HALF = 3 / 8;

/** Moves the camera by (fwd, side) tiles, sliding along walls, and lets
 * it step up and fall like the engine's player. */
export function walk(m: RcMap, cam: Camera, fwd: number, side: number): Camera {
  const dx = Math.cos(cam.angle) * fwd - Math.sin(cam.angle) * side;
  const dy = Math.sin(cam.angle) * fwd + Math.cos(cam.angle) * side;
  let { x, y } = cam;
  if (boxOk(m, x + dx, y, HALF, cam.floor)) x += dx;
  if (boxOk(m, x, y + dy, HALF, cam.floor)) y += dy;
  return { ...cam, x, y };
}

/** The floor under the camera: up at once, down falling by `fall`. */
export function settle(m: RcMap, cam: Camera, fall: number): Camera {
  const under = floorUnder(m, cam.x, cam.y, HALF);
  if (under >= cam.floor) return { ...cam, floor: under };
  return { ...cam, floor: Math.max(under, cam.floor - fall) };
}

export function startCamera(m: RcMap, s: SceneJSON): Camera {
  const p = s.player_start ?? { x: 1, y: 1 };
  const angle = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[s.player_start_direction ?? "down"] ?? 0;
  const cam = { x: p.x + 3 / 8, y: p.y + 3 / 8, angle, floor: 0 };
  return { ...cam, floor: floorUnder(m, cam.x, cam.y, HALF) };
}
