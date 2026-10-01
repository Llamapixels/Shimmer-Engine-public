/**
 * Pixel operations for the Art Editor: an image is a width x height RGBA
 * buffer (Uint8ClampedArray, 4 bytes per pixel). Everything here works on
 * those buffers directly - no canvas - so tools are exact (no smoothing,
 * no premultiplied alpha) and what's saved is exactly what was drawn.
 */

export type RGBA = [number, number, number, number];

export const TRANSPARENT: RGBA = [0, 0, 0, 0];

export interface Bitmap {
  width: number;
  height: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}

export function createBitmap(width: number, height: number, fill: RGBA = TRANSPARENT): Bitmap {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill[3] !== 0 || fill[0] || fill[1] || fill[2]) {
    for (let i = 0; i < data.length; i += 4) data.set(fill, i);
  }
  return { width, height, data };
}

export function cloneBitmap(b: Bitmap): Bitmap {
  return { width: b.width, height: b.height, data: new Uint8ClampedArray(b.data) };
}

export function getPixel(b: Bitmap, x: number, y: number): RGBA {
  const i = (y * b.width + x) * 4;
  return [b.data[i], b.data[i + 1], b.data[i + 2], b.data[i + 3]];
}

export function setPixel(b: Bitmap, x: number, y: number, c: RGBA): void {
  if (x < 0 || y < 0 || x >= b.width || y >= b.height) return;
  const i = (y * b.width + x) * 4;
  b.data[i] = c[0];
  b.data[i + 1] = c[1];
  b.data[i + 2] = c[2];
  b.data[i + 3] = c[3];
}

/** Transparent pixels are all the same colour, whatever RGB they carry. */
export function sameColor(a: RGBA, b: RGBA): boolean {
  if (a[3] === 0 && b[3] === 0) return true;
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3];
}

// ---------------------------------------------------------------------------
// Colours

export function toHex(c: RGBA): string {
  return "#" + [c[0], c[1], c[2]].map((v) => v.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string, alpha = 255): RGBA {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

/** The nearest colour the GBA can show (5 bits per channel). */
export function toGbaColor(c: RGBA): RGBA {
  const q = (v: number) => Math.round((Math.round((v * 31) / 255) * 255) / 31);
  return [q(c[0]), q(c[1]), q(c[2]), c[3]];
}

// ---------------------------------------------------------------------------
// Shapes: lists of points, so tools can preview them before committing.

export type Pt = { x: number; y: number };

/** Bresenham line, both ends included. */
export function linePoints(x0: number, y0: number, x1: number, y1: number): Pt[] {
  const pts: Pt[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    pts.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
  return pts;
}

export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Pt[] {
  const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
  const pts: Pt[] = [];
  for (let y = t; y <= b; y++)
    for (let x = l; x <= r; x++) if (filled || y === t || y === b || x === l || x === r) pts.push({ x, y });
  return pts;
}

/** An ellipse inside the box (x0,y0)-(x1,y1): outline or filled. */
export function ellipsePoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): Pt[] {
  const [l, r] = x0 < x1 ? [x0, x1] : [x1, x0];
  const [t, b] = y0 < y1 ? [y0, y1] : [y1, y0];
  const w = r - l + 1;
  const h = b - t + 1;
  const cx = (l + r) / 2;
  const cy = (t + b) / 2;
  const rx = w / 2;
  const ry = h / 2;
  const inside = (x: number, y: number) => {
    const nx = (x - cx) / rx;
    const ny = (y - cy) / ry;
    return nx * nx + ny * ny <= 1.0001;
  };
  const pts: Pt[] = [];
  for (let y = t; y <= b; y++)
    for (let x = l; x <= r; x++) {
      if (!inside(x, y)) continue;
      // Outline: an inside pixel with an outside 4-neighbour.
      if (filled || !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) pts.push({ x, y });
    }
  return pts;
}

/** A square brush of `size` pixels centred on (x, y). */
export function brushPoints(x: number, y: number, size: number): Pt[] {
  if (size <= 1) return [{ x, y }];
  const pts: Pt[] = [];
  const o = Math.floor((size - 1) / 2);
  for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) pts.push({ x: x - o + dx, y: y - o + dy });
  return pts;
}

/** The point and its mirror images (around the image's centre lines). */
export function mirrored(p: Pt, b: { width: number; height: number }, mx: boolean, my: boolean): Pt[] {
  const out = [p];
  if (mx) out.push({ x: b.width - 1 - p.x, y: p.y });
  if (my) out.push({ x: p.x, y: b.height - 1 - p.y });
  if (mx && my) out.push({ x: b.width - 1 - p.x, y: b.height - 1 - p.y });
  return out;
}

// ---------------------------------------------------------------------------
// Fill

/** Paint bucket: the area of the clicked colour (4-connected), or every
 * pixel of that colour when `global` is set. Returns whether anything changed. */
export function floodFill(b: Bitmap, x: number, y: number, c: RGBA, global: boolean): boolean {
  if (x < 0 || y < 0 || x >= b.width || y >= b.height) return false;
  const target = getPixel(b, x, y);
  if (sameColor(target, c)) return false;
  const { width, height } = b;
  if (global) {
    for (let py = 0; py < height; py++)
      for (let px = 0; px < width; px++) if (sameColor(getPixel(b, px, py), target)) setPixel(b, px, py, c);
    return true;
  }
  const seen = new Uint8Array(width * height);
  const stack = [y * width + x];
  while (stack.length) {
    const i = stack.pop()!;
    if (seen[i]) continue;
    seen[i] = 1;
    const px = i % width;
    const py = (i - px) / width;
    if (!sameColor(getPixel(b, px, py), target)) continue;
    setPixel(b, px, py, c);
    if (px > 0) stack.push(i - 1);
    if (px < width - 1) stack.push(i + 1);
    if (py > 0) stack.push(i - width);
    if (py < height - 1) stack.push(i + width);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Regions (selection, clipboard)

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function normRect(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

export function clipRect(r: Rect, b: { width: number; height: number }): Rect | null {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  const x2 = Math.min(b.width, r.x + r.w);
  const y2 = Math.min(b.height, r.y + r.h);
  return x2 > x && y2 > y ? { x, y, w: x2 - x, h: y2 - y } : null;
}

export function copyRegion(b: Bitmap, r: Rect): Bitmap {
  const out = createBitmap(r.w, r.h);
  for (let y = 0; y < r.h; y++)
    for (let x = 0; x < r.w; x++) {
      const sx = r.x + x;
      const sy = r.y + y;
      if (sx >= 0 && sy >= 0 && sx < b.width && sy < b.height) setPixel(out, x, y, getPixel(b, sx, sy));
    }
  return out;
}

export function clearRegion(b: Bitmap, r: Rect): void {
  for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) setPixel(b, x, y, TRANSPARENT);
}

/** Paste `src` at (x, y); transparent source pixels leave what's there. */
export function stamp(b: Bitmap, src: Bitmap, x: number, y: number): void {
  for (let sy = 0; sy < src.height; sy++)
    for (let sx = 0; sx < src.width; sx++) {
      const c = getPixel(src, sx, sy);
      if (c[3] !== 0) setPixel(b, x + sx, y + sy, c);
    }
}

export function flipRegion(src: Bitmap, horizontal: boolean): Bitmap {
  const out = createBitmap(src.width, src.height);
  for (let y = 0; y < src.height; y++)
    for (let x = 0; x < src.width; x++)
      setPixel(out, horizontal ? src.width - 1 - x : x, horizontal ? y : src.height - 1 - y, getPixel(src, x, y));
  return out;
}

// ---------------------------------------------------------------------------
// Palette / GBA limits

export interface ColorUse {
  color: RGBA;
  count: number;
}

/** Opaque colours in the image, most used first, plus the transparent count. */
export function colorsUsed(b: Bitmap): { colors: ColorUse[]; transparent: number } {
  const map = new Map<number, number>();
  let transparent = 0;
  const d = b.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) {
      transparent++;
      continue;
    }
    const key = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  const colors = [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, count]) => ({ color: [(k >> 16) & 255, (k >> 8) & 255, k & 255, 255] as RGBA, count }));
  return { colors, transparent };
}

/** Backgrounds: the compiler gives every 8x8 tile 15 colours plus the
 * image's backdrop (its most common colour, or transparency). Returns how
 * many tiles go over that. */
export function tilesOverLimit(b: Bitmap, backdrop: RGBA | null): number {
  const tw = Math.floor(b.width / 8);
  const th = Math.floor(b.height / 8);
  const bd = backdrop ? (backdrop[0] << 16) | (backdrop[1] << 8) | backdrop[2] : -1;
  let over = 0;
  const seen = new Set<number>();
  for (let ty = 0; ty < th; ty++)
    for (let tx = 0; tx < tw; tx++) {
      seen.clear();
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const i = ((ty * 8 + y) * b.width + tx * 8 + x) * 4;
          if (b.data[i + 3] < 128) continue;
          const k = (b.data[i] << 16) | (b.data[i + 1] << 8) | b.data[i + 2];
          if (k !== bd) seen.add(k);
        }
      if (seen.size > 15) over++;
    }
  return over;
}

// ---------------------------------------------------------------------------
// Load / save

export function loadBitmap(dataUrl: string): Promise<Bitmap> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext("2d", { willReadFrequently: true })!;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height);
      resolve({ width: d.width, height: d.height, data: new Uint8ClampedArray(d.data) });
    };
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = dataUrl;
  });
}

/** PNG bytes (base64) of the bitmap, exactly as drawn. */
export async function encodePng(b: Bitmap): Promise<string> {
  const c = document.createElement("canvas");
  c.width = b.width;
  c.height = b.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(b.data), b.width, b.height), 0, 0);
  const blob = await new Promise<Blob>((resolve, reject) =>
    c.toBlob((bl) => (bl ? resolve(bl) : reject(new Error("Couldn't encode the PNG."))), "image/png"),
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
