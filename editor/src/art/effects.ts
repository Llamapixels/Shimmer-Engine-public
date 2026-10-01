/**
 * Whole-image and region effects for the Art Editor: compositing layers,
 * resize/rotate/flip, outline, shading, gradients, dithering and colour
 * reduction. All exact, pixel by pixel, on RGBA bitmaps.
 */
import { type Bitmap, type Rect, type RGBA, createBitmap, getPixel, sameColor, setPixel } from "./pixels";

export interface LayerLike {
  visible: boolean;
  opacity: number; // 0-1
  image: Bitmap;
}

/** Layers bottom to top -> one image ("over" blending, hidden layers skipped). */
export function flatten(layers: LayerLike[], width: number, height: number): Bitmap {
  const out = createBitmap(width, height);
  const o = out.data;
  for (const layer of layers) {
    if (!layer.visible || layer.opacity <= 0) continue;
    const s = layer.image.data;
    for (let i = 0; i < o.length; i += 4) {
      const sa = (s[i + 3] / 255) * layer.opacity;
      if (sa <= 0) continue;
      const da = o[i + 3] / 255;
      const a = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) o[i + c] = Math.round((s[i + c] * sa + o[i + c] * da * (1 - sa)) / a);
      o[i + 3] = Math.round(a * 255);
    }
  }
  return out;
}

/** A cheap fingerprint of an image, to tell whether a PNG still matches
 * the layers saved next to it. */
export function checksum(b: Bitmap): string {
  let h1 = 0x811c9dc5;
  let h2 = 0;
  const d = b.data;
  for (let i = 0; i < d.length; i++) {
    h1 = Math.imul(h1 ^ d[i], 16777619);
    h2 = (h2 + d[i] * (i + 1)) | 0;
  }
  return `${b.width}x${b.height}:${(h1 >>> 0).toString(16)}:${(h2 >>> 0).toString(16)}`;
}

// ---------------------------------------------------------------------------
// Transform

/** Nearest-neighbour scale to w x h (pixel art stays crisp). */
export function scaleBitmap(b: Bitmap, w: number, h: number): Bitmap {
  const out = createBitmap(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) setPixel(out, x, y, getPixel(b, Math.floor((x * b.width) / w), Math.floor((y * b.height) / h)));
  return out;
}

/** Canvas resize: keep pixels, anchor at (ax, ay) in 0..1 (0,0 = top left). */
export function resizeCanvas(b: Bitmap, w: number, h: number, ax: number, ay: number): Bitmap {
  const out = createBitmap(w, h);
  const ox = Math.round((w - b.width) * ax);
  const oy = Math.round((h - b.height) * ay);
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) {
      const tx = x + ox;
      const ty = y + oy;
      if (tx >= 0 && ty >= 0 && tx < w && ty < h) setPixel(out, tx, ty, getPixel(b, x, y));
    }
  return out;
}

export function flipBitmap(b: Bitmap, horizontal: boolean): Bitmap {
  const out = createBitmap(b.width, b.height);
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) setPixel(out, horizontal ? b.width - 1 - x : x, horizontal ? y : b.height - 1 - y, getPixel(b, x, y));
  return out;
}

/** Rotate 90 degrees: clockwise = true. Width and height swap. */
export function rotate90(b: Bitmap, clockwise: boolean): Bitmap {
  const out = createBitmap(b.height, b.width);
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) {
      if (clockwise) setPixel(out, b.height - 1 - y, x, getPixel(b, x, y));
      else setPixel(out, y, b.width - 1 - x, getPixel(b, x, y));
    }
  return out;
}

export function rotate180(b: Bitmap): Bitmap {
  return flipBitmap(flipBitmap(b, true), false);
}

// ---------------------------------------------------------------------------
// Effects (in place, limited to `area` when given)

function inArea(area: Rect | null, x: number, y: number): boolean {
  return !area || (x >= area.x && y >= area.y && x < area.x + area.w && y < area.y + area.h);
}

/** A 1-pixel outline around every opaque shape: transparent pixels next to
 * an opaque one (4 neighbours, or 8 with `diagonal`) get `color`. */
export function outline(b: Bitmap, color: RGBA, diagonal: boolean, area: Rect | null): number {
  const src = new Uint8ClampedArray(b.data);
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < b.width && y < b.height && src[(y * b.width + x) * 4 + 3] >= 128;
  let n = 0;
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++) {
      if (!inArea(area, x, y) || opaque(x, y)) continue;
      let near = opaque(x - 1, y) || opaque(x + 1, y) || opaque(x, y - 1) || opaque(x, y + 1);
      if (!near && diagonal) near = opaque(x - 1, y - 1) || opaque(x + 1, y - 1) || opaque(x - 1, y + 1) || opaque(x + 1, y + 1);
      if (near) {
        setPixel(b, x, y, color);
        n++;
      }
    }
  return n;
}

/** Replace one colour with another everywhere (in `area`). */
export function replaceColor(b: Bitmap, from: RGBA, to: RGBA, area: Rect | null): number {
  let n = 0;
  for (let y = 0; y < b.height; y++)
    for (let x = 0; x < b.width; x++)
      if (inArea(area, x, y) && sameColor(getPixel(b, x, y), from)) {
        setPixel(b, x, y, to);
        n++;
      }
  return n;
}

const luma = (c: RGBA) => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/** Shading tool: move a pixel one step lighter (+1) or darker (-1) along
 * the image's own colours ordered by brightness - so shading stays inside
 * the palette instead of inventing new colours. */
export function shadeColor(c: RGBA, ramp: RGBA[], dir: 1 | -1): RGBA {
  if (c[3] === 0 || ramp.length < 2) return c;
  const sorted = [...ramp].sort((a, b) => luma(a) - luma(b));
  let i = sorted.findIndex((r) => sameColor(r, c));
  if (i < 0) {
    // Not in the ramp: start from the nearest by brightness.
    const l = luma(c);
    i = sorted.reduce((best, r, k) => (Math.abs(luma(r) - l) < Math.abs(luma(sorted[best]) - l) ? k : best), 0);
  }
  return sorted[Math.max(0, Math.min(sorted.length - 1, i + dir))];
}

/** Ordered (Bayer 4x4) dither threshold for pixel (x, y), 0..1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function bayer(x: number, y: number): number {
  return (BAYER[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
}

/** Gradient from `a` (at p0) to `b` (at p1) over `area`, using only those
 * two colours with ordered dithering in between (`steps` > 2 adds blended
 * colours between them). */
export function gradient(
  img: Bitmap,
  area: Rect,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  a: RGBA,
  b: RGBA,
  steps: number,
  radial: boolean,
): void {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len2 = dx * dx + dy * dy || 1;
  const colors: RGBA[] = [];
  const n = Math.max(2, steps);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    colors.push([
      Math.round(a[0] + (b[0] - a[0]) * t),
      Math.round(a[1] + (b[1] - a[1]) * t),
      Math.round(a[2] + (b[2] - a[2]) * t),
      Math.round(a[3] + (b[3] - a[3]) * t),
    ]);
  }
  for (let y = area.y; y < area.y + area.h; y++)
    for (let x = area.x; x < area.x + area.w; x++) {
      let t = radial ? Math.sqrt(((x - p0.x) ** 2 + (y - p0.y) ** 2) / len2) : ((x - p0.x) * dx + (y - p0.y) * dy) / len2;
      t = Math.max(0, Math.min(1, t)) * (n - 1);
      const lo = Math.floor(t);
      const frac = t - lo;
      const idx = frac > bayer(x, y) ? Math.min(n - 1, lo + 1) : lo;
      setPixel(img, x, y, colors[idx]);
    }
}

// ---------------------------------------------------------------------------
// Colour reduction (median cut), for fitting the GBA's palettes

/** Reduce the image to at most `max` opaque colours. Returns the colour count. */
export function reduceColors(b: Bitmap, max: number): number {
  const counts = new Map<number, number>();
  const d = b.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (counts.size <= max) return counts.size;
  type Box = { colors: [number, number, number, number][] };
  let boxes: Box[] = [{ colors: [...counts.entries()].map(([k, n]) => [(k >> 16) & 255, (k >> 8) & 255, k & 255, n]) }];
  while (boxes.length < max) {
    // Split the box with the widest channel range (weighted by size).
    let best = -1;
    let bestScore = -1;
    let bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.colors.length < 2) return;
      for (let ch = 0; ch < 3; ch++) {
        let lo = 255;
        let hi = 0;
        for (const c of box.colors) {
          lo = Math.min(lo, c[ch]);
          hi = Math.max(hi, c[ch]);
        }
        const score = (hi - lo) * Math.log2(box.colors.length + 1);
        if (score > bestScore) {
          bestScore = score;
          best = i;
          bestCh = ch;
        }
      }
    });
    if (best < 0) break;
    const box = boxes[best];
    box.colors.sort((p, q) => p[bestCh] - q[bestCh]);
    const total = box.colors.reduce((s, c) => s + c[3], 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.colors.length - 1; i++) {
      acc += box.colors[i][3];
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes = [...boxes.slice(0, best), { colors: box.colors.slice(0, cut) }, { colors: box.colors.slice(cut) }, ...boxes.slice(best + 1)];
  }
  // Each box -> its weighted average; map every colour to its box's colour.
  const map = new Map<number, [number, number, number]>();
  for (const box of boxes) {
    const total = box.colors.reduce((s, c) => s + c[3], 0) || 1;
    const avg: [number, number, number] = [0, 1, 2].map((ch) => Math.round(box.colors.reduce((s, c) => s + c[ch] * c[3], 0) / total)) as [
      number,
      number,
      number,
    ];
    for (const c of box.colors) map.set((c[0] << 16) | (c[1] << 8) | c[2], avg);
  }
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    const m = map.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    if (m) {
      d[i] = m[0];
      d[i + 1] = m[1];
      d[i + 2] = m[2];
    }
  }
  return boxes.length;
}
