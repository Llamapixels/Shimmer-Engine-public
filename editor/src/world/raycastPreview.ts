/*
 * The editor's First Person 3D preview: the engine's renderer
 * (engine/source/raycast.c) redone in floating point - same rules for
 * heights, faces, textures, colours, the sky and actors, so what it shows
 * is what the GBA shows - and the engine's walking rules (steps, headroom).
 */

import type { SceneJSON } from "../../shared/projectTypes";
import { rcDefaults, RC_TEX_CHARS, sceneTextures } from "./paint";
import { ceilAt, floorAt, RC_DEFAULT_WALL, RC_SKY } from "./raycastView";

export const VIEW_W = 120;
export const VIEW_H = 80;
const HORIZON = VIEW_H / 2;
const TEX = 32;
const MAX_STEPS = 64;
/** Field of view choices (engine settings rc_fov): the camera plane. */
const FOV_PLANE = [0.5, 2 / 3, 0.85];
/** Distance shading (rc_fog): walls farther than this (tiles) are darker. */
const FOG_DIST = [Infinity, 8, 4];

export interface Camera {
  /** Position in tiles (cells), angle in radians (0 = right, +y = down). */
  x: number;
  y: number;
  angle: number;
  /** The feet's height, in 1/8 tiles (the eye is above it). */
  floor: number;
}

/** The engine settings the view uses. */
export interface ViewOptions {
  eye: number;
  step: number;
  fov: number;
  fog: number;
  crosshair: boolean;
}

/** A texture, sky or actor frame as pixels (alpha < 128 = see-through). */
export interface Pixels {
  w: number;
  h: number;
  data: Uint32Array;
}

export interface Billboard {
  /** Footprint centre, in tiles. */
  x: number;
  y: number;
  /** Which way it faces (actors turn to the camera). */
  facing: "down" | "up" | "right" | "left";
  /** The 64x64 actor canvas (16 px a tile, footprint at 24, 48), per
   * facing shown. */
  px: Record<"down" | "up" | "right" | "left", Pixels>;
}

const pixelCache = new WeakMap<object, Pixels>();

/** An image's pixels, at w x h (cached per image). */
export function pixelsOf(img: CanvasImageSource & { width: number | SVGAnimatedLength; height: number | SVGAnimatedLength }, w = TEX, h = TEX): Pixels {
  const hit = pixelCache.get(img);
  if (hit && hit.w === w && hit.h === h) return hit;
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
 * texture, colours and whether its ceiling is the sky. */
export interface RcMap {
  w: number;
  h: number;
  floor: Float32Array;
  ceil: Float32Array;
  tex: (Pixels | null)[];
  fcol: Uint32Array;
  ccol: Uint32Array;
  /** Textured floors / ceilings (null: the colour). */
  ftex: (Pixels | null)[];
  ctex: (Pixels | null)[];
  sky: Uint8Array;
  /** The texture past the map's edge (the scene's first). */
  edgeTex: Pixels | null;
  skyColor: number;
  skyPx: Pixels | null;
}

export function buildMap(s: SceneJSON, w: number, h: number, textures: Record<string, Pixels>, skyPx: Pixels | null): RcMap {
  const names = sceneTextures(s);
  const look = s.raycast ?? {};
  const floorC = hexColor(look.floor, "#3c3a36");
  const ceilC = hexColor(look.ceiling, "#22242c");
  const flats = (look.flats ?? []).map((c) => hexColor(c, "#000000"));
  const wallH = look.wall_height ?? RC_DEFAULT_WALL;
  const n = w * h;
  const m: RcMap = {
    w,
    h,
    floor: new Float32Array(n),
    ceil: new Float32Array(n),
    tex: new Array(n),
    fcol: new Uint32Array(n),
    ccol: new Uint32Array(n),
    ftex: new Array(n).fill(null),
    ctex: new Array(n).fill(null),
    sky: new Uint8Array(n),
    edgeTex: textures[names[0] ?? ""] ?? null,
    skyColor: hexColor(look.sky_color, "#6c94d0"),
    skyPx,
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let f = floorAt(s, x, y);
      let c = ceilAt(s, x, y);
      const sky = c >= RC_SKY;
      // Open sky: a ceiling drawn as the sky, as high as the walls (compiler).
      if (sky) c = Math.min(254, Math.max(rcDefaults(s).floor + wallH, f + 16));
      // A solid tile: its floor value is its top (what shows under the sky).
      if (s.collision?.[y]?.[x] === "#") {
        f = Math.min(255, f + wallH);
        c = 0;
      } else if (c <= f && c === 0) {
        f = Math.max(f, 1);
        c = 1;
      }
      m.floor[i] = f;
      m.ceil[i] = c;
      m.sky[i] = sky ? 1 : 0;
      const ch = s.wall_textures?.[y]?.[x] ?? ".";
      const t = ch === "." ? 0 : Math.max(0, RC_TEX_CHARS.indexOf(ch.toLowerCase()));
      m.tex[i] = textures[names[t] ?? ""] ?? null;
      const fc = s.floor_flats?.[y]?.[x] ?? ".";
      const cc = s.ceiling_flats?.[y]?.[x] ?? ".";
      m.fcol[i] = fc === "." ? floorC : flats[Number(fc) - 1] ?? floorC;
      m.ccol[i] = cc === "." ? ceilC : flats[Number(cc) - 1] ?? ceilC;
      const texOf = (rows: string[] | undefined) => {
        const ch = rows?.[y]?.[x] ?? ".";
        return ch === "." ? null : textures[names[RC_TEX_CHARS.indexOf(ch.toLowerCase())] ?? ""] ?? null;
      };
      m.ftex[i] = texOf(s.floor_textures);
      m.ctex[i] = sky ? null : texOf(s.ceiling_textures);
    }
  return m;
}

const isSolid = (m: RcMap, i: number) => m.ceil[i] <= m.floor[i];

/** Which way an actor facing `facing` looks seen from (vx, vy) away: its
 * front ("down"), back ("up") or a side - the engine's turned_frame(). */
export function turnedFacing(facing: Billboard["facing"], vx: number, vy: number): Billboard["facing"] {
  const F = { down: [0, 1], up: [0, -1], right: [1, 0], left: [-1, 0] }[facing];
  const dot = F[0] * vx + F[1] * vy;
  const cross = F[0] * vy - F[1] * vx;
  if (Math.abs(dot) >= Math.abs(cross)) return dot >= 0 ? "down" : "up";
  return cross > 0 ? "right" : "left";
}

/** Draws the view into `out` (VIEW_W x VIEW_H, ABGR). */
export function renderView(m: RcMap, cam: Camera, actors: Billboard[], opt: ViewOptions, turnActors: boolean, out: Uint32Array) {
  out.fill(0xff000000);
  const plane = FOV_PLANE[opt.fov] ?? FOV_PLANE[1];
  const fogD = FOG_DIST[opt.fog] ?? Infinity;
  const dirX = Math.cos(cam.angle);
  const dirY = Math.sin(cam.angle);
  const planeX = -dirY * plane;
  const planeY = dirX * plane;
  const eye = cam.floor + opt.eye;
  const segs: { d: number; top: number; bot: number }[][] = [];
  const mx0 = Math.floor(cam.x);
  const my0 = Math.floor(cam.y);
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < m.w && y < m.h;
  // The sky picture repeats a whole number of times a turn, like the engine.
  const turnPx = (VIEW_W * Math.PI) / Math.atan(plane);
  const sky = m.skyPx;
  const skySpan = sky ? sky.w * Math.max(1, Math.round(turnPx / sky.w)) : 0;
  const a = ((cam.angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const skyX0 = sky ? Math.floor((a / (2 * Math.PI)) * skySpan) % sky.w : 0;

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
    const skyCol = sky ? (skyX0 + x) % sky.w : 0;

    const ci = inMap(mx0, my0) ? my0 * m.w + mx0 : 0;
    let cFloor = m.floor[ci];
    let cCeil = m.ceil[ci];
    let cFc = m.fcol[ci];
    let cCc = m.ccol[ci];
    let cSky = m.sky[ci] === 1;
    let cFt = m.ftex[ci];
    let cCt = m.ctex[ci];
    let ytop = 0;
    let ybot = VIEW_H;
    let nearF = VIEW_H;
    let nearC = 0;
    let closed = false;
    const colSegs: { d: number; top: number; bot: number }[] = [];

    const fill = (y0: number, y1: number, c: number) => {
      for (let y = Math.max(0, y0); y < Math.min(VIEW_H, y1); y++) out[y * VIEW_W + x] = c;
    };
    // Textured floors and ceilings: each pixel's spot on the plane `h`
    // (eighths) below / above the eye, and that texel.
    const fillFlat = (y0: number, y1: number, tex: Pixels, h: number) => {
      for (let y = Math.max(0, y0); y < Math.min(VIEW_H, y1); y++) {
        const r = y >= HORIZON ? y - HORIZON : HORIZON - 1 - y;
        const d = ((Math.abs(h) / 8) * VIEW_H) / (r + 0.5);
        const wx = cam.x + rayX * d;
        const wy = cam.y + rayY * d;
        const u = Math.floor((wx - Math.floor(wx)) * TEX);
        const v = Math.floor((wy - Math.floor(wy)) * TEX);
        const c = tex.data[v * TEX + u];
        out[y * VIEW_W + x] = d > fogD ? darken(c) : c;
      }
    };
    const fillFloor = (y0: number, y1: number, c: number, tex: Pixels | null, h: number) =>
      tex ? fillFlat(y0, y1, tex, h) : fill(y0, y1, c);
    const fillCeil = (y0: number, y1: number, c: number, isSky: boolean, tex: Pixels | null = null, h = 0) => {
      if (!isSky && tex) return fillFlat(y0, y1, tex, h);
      if (!isSky) return fill(y0, y1, c);
      for (let y = Math.max(0, y0); y < Math.min(VIEW_H, y1); y++)
        out[y * VIEW_W + x] = sky ? sky.data[Math.min(y, sky.h - 1) * sky.w + skyCol] | 0xff000000 : m.skyColor;
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
      const outside = !inMap(mapX, mapY);
      const ni = outside ? 0 : mapY * m.w + mapX;
      let nFloor = outside ? cFloor : m.floor[ni];
      let nCeil = outside ? cFloor : m.ceil[ni];
      let nSky = !outside && m.sky[ni] === 1;
      // Nothing changes here (a solid cell never matches an open one).
      if (
        !outside && nFloor === cFloor && nCeil === cCeil && m.fcol[ni] === cFc && m.ccol[ni] === cCc && nSky === cSky &&
        m.ftex[ni] === cFt && m.ctex[ni] === cCt
      )
        continue;
      let solid = outside || nCeil <= nFloor;
      if (solid && cSky && !outside) {
        // Under the sky a wall is a block: a collision wall (ceiling 0) as
        // tall as its floor value, anything else closed up to the sky.
        solid = false;
        if (nCeil !== 0) nFloor = cCeil;
        nCeil = cCeil;
        nSky = true;
      }
      const d = Math.max(1 / 64, side === 0 ? sideX - ddX : sideY - ddY);
      const line = VIEW_H / d;
      const yf = Math.floor(HORIZON + ((eye - cFloor) / 8) * line);
      const yc = Math.floor(HORIZON - ((cCeil - eye) / 8) * line);

      // The floor and ceiling of the stretch just crossed.
      fillFloor(Math.max(yf, ytop), Math.min(nearF, ybot), cFc, cFt, eye - cFloor);
      fillCeil(Math.max(nearC, ytop), Math.min(yc, ybot), cCc, cSky, cCt, cCeil - eye);
      if (yf < ybot) ybot = yf;
      if (yc > ytop) ytop = yc;

      const tex = outside ? m.edgeTex : m.tex[ni];
      const wall = side === 0 ? cam.y + d * rayY : cam.x + d * rayX;
      let texX = Math.floor((wall - Math.floor(wall)) * TEX);
      if ((side === 0 && rayX > 0) || (side === 1 && rayY < 0)) texX = TEX - 1 - texX;
      const shade = side === 1 || d > fogD;

      if (solid && outside && cSky) {
        // The edge of the world under the sky: sky to the horizon, endless ground below.
        const hz = Math.min(HORIZON, ybot);
        fillCeil(ytop, hz, 0, true);
        fillFloor(Math.max(hz, ytop), ybot, cFc, cFt, eye - cFloor);
        ytop = ybot;
        closed = true;
      } else if (solid) {
        if (ytop < ybot) face(Math.max(ytop, yc), Math.min(ybot, yf), yc, line, tex, texX, shade);
        ytop = ybot;
        closed = true;
      } else {
        let nyc = Math.floor(HORIZON - ((nCeil - eye) / 8) * line);
        const nyf = Math.floor(HORIZON + ((eye - nFloor) / 8) * line);
        if (cSky && nSky && nyc > ytop) nyc = ytop;   // sky to sky: no wall between them
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
        cFt = m.ftex[ni];
        cCt = nSky ? null : m.ctex[ni];
        cSky = nSky;
        nearF = nyf;
        nearC = nyc;
        if (ytop >= ybot) closed = true;
      }
      colSegs.push({ d, top: Math.max(0, Math.min(VIEW_H, ytop)), bot: Math.max(0, Math.min(VIEW_H, ybot)) });
    }
    if (!closed) {
      fillFloor(Math.max(HORIZON, ytop), Math.min(nearF, ybot), cFc, cFt, eye - cFloor);
      fillCeil(Math.max(nearC, ytop), Math.min(HORIZON, ybot), cCc, cSky, cCt, cCeil - eye);
    }
    segs.push(colSegs);
  }

  // Actors: billboards, far to near, each column inside the window still
  // open at its distance.
  const det = planeX * dirY - dirX * planeY;
  const boards = actors
    .map((b) => {
      const sx = b.x - cam.x;
      const sy = b.y - cam.y;
      const tx = (dirY * sx - dirX * sy) / det;
      const ty = (-planeY * sx + planeX * sy) / det;
      return { b, tx, ty };
    })
    .filter((b) => b.ty > 1 / 16)
    .sort((p, q) => q.ty - p.ty);
  for (const { b, tx, ty } of boards) {
    const px = b.px[turnActors ? turnedFacing(b.facing, cam.x - b.x, cam.y - b.y) : b.facing];
    const screenX = (VIEW_W / 2) * (1 + tx / ty);
    const line = VIEW_H / ty;
    const cx = Math.floor(b.x);
    const cy = Math.floor(b.y);
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
      const u = Math.floor(((x - left) / span) * px.w);
      if (u < 0 || u >= px.w) continue;
      for (let y = Math.max(wt, Math.ceil(top)); y < Math.min(wb, bottom); y++) {
        const v = Math.floor(((y - top) / span) * px.h);
        const c = px.data[v * px.w + u];
        if (c >>> 24 >= 128) out[y * VIEW_W + x] = c;
      }
    }
  }

  if (opt.crosshair)
    for (const [dx, dy] of [[-3, 0], [-2, 0], [2, 0], [3, 0], [0, -3], [0, -2], [0, 2], [0, 3]])
      out[(HORIZON + dy) * VIEW_W + VIEW_W / 2 + dx] = 0xffffffff;
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
function boxOk(m: RcMap, x: number, y: number, half: number, floor: number, opt: ViewOptions): boolean {
  for (let cy = Math.floor(y - half); cy <= Math.floor(y + half - 1e-6); cy++)
    for (let cx = Math.floor(x - half); cx <= Math.floor(x + half - 1e-6); cx++) {
      if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return false;
      const i = cy * m.w + cx;
      if (isSolid(m, i)) return false;
      if (m.floor[i] - floor > opt.step) return false;
      if (m.ceil[i] - Math.max(m.floor[i], floor) < opt.eye + 1) return false;
    }
  return true;
}

/** The player is 6x6 px: 3/8 of a tile either side of its centre. */
const HALF = 3 / 8;

/** Moves the camera by (fwd, side) tiles, sliding along walls. */
export function walk(m: RcMap, cam: Camera, fwd: number, side: number, opt: ViewOptions): Camera {
  const dx = Math.cos(cam.angle) * fwd - Math.sin(cam.angle) * side;
  const dy = Math.sin(cam.angle) * fwd + Math.cos(cam.angle) * side;
  let { x, y } = cam;
  if (boxOk(m, x + dx, y, HALF, cam.floor, opt)) x += dx;
  if (boxOk(m, x, y + dy, HALF, cam.floor, opt)) y += dy;
  return { ...cam, x, y };
}

/** The floor under the camera: up at once, small drops kept, bigger ones fall by `fall`. */
export function settle(m: RcMap, cam: Camera, fall: number, opt: ViewOptions): Camera {
  const under = floorUnder(m, cam.x, cam.y, HALF);
  if (under >= cam.floor || cam.floor - under <= opt.step) return { ...cam, floor: under };
  return { ...cam, floor: Math.max(under, cam.floor - fall) };
}

export function startCamera(m: RcMap, s: SceneJSON): Camera {
  const p = s.player_start ?? { x: 1, y: 1 };
  const angle = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }[s.player_start_direction ?? "down"] ?? 0;
  const cam = { x: p.x + 3 / 8, y: p.y + 3 / 8, angle, floor: rcDefaults(s).floor };
  return { ...cam, floor: floorUnder(m, cam.x, cam.y, HALF) };
}
