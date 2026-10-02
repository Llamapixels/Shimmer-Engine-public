/**
 * Video -> Shimmer cutscene (.cut), and back for the editor's preview.
 * Pure data code (no DOM), so it runs anywhere. The format is described in
 * engine/include/cutscene.h:
 *
 *   one 256-colour palette for the whole video, then per frame only the
 *   8x8 tiles that changed since the frame before (8bpp), GBA-LZ77
 *   compressed so the BIOS can unpack it.
 */

export type CutMode = "full" | "half";

export interface CutSettings {
  mode: CutMode; // full = 240x160, half = 120x80 shown 2x
  fps: number;
  /** 0 = every changed pixel counts; higher = small changes are ignored
   * (smaller file, a little smearing). Pixels per 8x8 tile, 0-64. */
  threshold: number;
  dither: boolean;
}

export const MODE_SIZE: Record<CutMode, { w: number; h: number }> = {
  full: { w: 240, h: 160 },
  half: { w: 120, h: 80 },
};

export const AUDIO_RATE = 16384; // engine/include/wav.h WAV_RATE
const HEADER = 524;

// ---------------------------------------------------------------------------
// Palette

const to5 = (v: number) => Math.round((v * 31) / 255);
const from5 = (v: number) => Math.round((v * 255) / 31);

/** 256 GBA colours (as 0xRRGGBB, already 5-bit exact) for a set of frames,
 * by median cut over a sample of their pixels. */
export function buildPalette(frames: Uint8ClampedArray[], size = 256): number[] {
  const counts = new Map<number, number>();
  const step = Math.max(1, Math.floor((frames.length * frames[0].length) / 4 / 400000));
  for (const f of frames)
    for (let i = 0; i < f.length; i += 4 * step) {
      const k = (to5(f[i]) << 10) | (to5(f[i + 1]) << 5) | to5(f[i + 2]);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  type C = [number, number, number, number]; // r5, g5, b5, count
  let boxes: C[][] = [[...counts.entries()].map(([k, n]) => [(k >> 10) & 31, (k >> 5) & 31, k & 31, n])];
  while (boxes.length < size) {
    let best = -1;
    let bestScore = 0;
    let bestCh = 0;
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      let weight = 0;
      for (const c of box) weight += c[3];
      for (let ch = 0; ch < 3; ch++) {
        let lo = 31;
        let hi = 0;
        for (const c of box) {
          if (c[ch] < lo) lo = c[ch];
          if (c[ch] > hi) hi = c[ch];
        }
        const score = (hi - lo) * Math.sqrt(weight);
        if (score > bestScore) {
          bestScore = score;
          best = i;
          bestCh = ch;
        }
      }
    });
    if (best < 0) break;
    const box = boxes[best].sort((a, b) => a[bestCh] - b[bestCh]);
    const total = box.reduce((s, c) => s + c[3], 0);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < box.length - 1; i++) {
      acc += box[i][3];
      if (acc >= total / 2) {
        cut = i + 1;
        break;
      }
    }
    boxes = [...boxes.slice(0, best), box.slice(0, cut), box.slice(cut), ...boxes.slice(best + 1)];
  }
  const pal = boxes.map((box) => {
    const t = box.reduce((s, c) => s + c[3], 0) || 1;
    const avg = [0, 1, 2].map((ch) => Math.round(box.reduce((s, c) => s + c[ch] * c[3], 0) / t));
    return (from5(avg[0]) << 16) | (from5(avg[1]) << 8) | from5(avg[2]);
  });
  while (pal.length < size) pal.push(0);
  return pal;
}

/** Nearest palette index for every 15-bit colour, built lazily. */
class Nearest {
  private cache = new Int16Array(32768).fill(-1);
  private pr: number[];
  private pg: number[];
  private pb: number[];
  constructor(palette: number[]) {
    this.pr = palette.map((c) => (c >> 16) & 255);
    this.pg = palette.map((c) => (c >> 8) & 255);
    this.pb = palette.map((c) => c & 255);
  }
  get(r: number, g: number, b: number): number {
    const k = (to5(r) << 10) | (to5(g) << 5) | to5(b);
    let v = this.cache[k];
    if (v >= 0) return v;
    const R = from5((k >> 10) & 31);
    const G = from5((k >> 5) & 31);
    const B = from5(k & 31);
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.pr.length; i++) {
      const dr = R - this.pr[i];
      const dg = G - this.pg[i];
      const db = B - this.pb[i];
      // Weighted for how eyes see brightness.
      const d = dr * dr * 3 + dg * dg * 4 + db * db * 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    this.cache[k] = best;
    return best;
  }
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** RGBA frame -> palette indices, as 8x8 tiles in reading order (64 bytes each). */
export function frameToTiles(rgba: Uint8ClampedArray, w: number, h: number, near: Nearest, dither: boolean): Uint8Array {
  const tw = w / 8;
  const th = h / 8;
  const out = new Uint8Array(tw * th * 64);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = rgba[i];
      let g = rgba[i + 1];
      let b = rgba[i + 2];
      if (dither) {
        const d = (BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.47) * 18;
        r = Math.max(0, Math.min(255, r + d));
        g = Math.max(0, Math.min(255, g + d));
        b = Math.max(0, Math.min(255, b + d));
      }
      const t = ((y >> 3) * tw + (x >> 3)) * 64 + (y & 7) * 8 + (x & 7);
      out[t] = near.get(r, g, b);
    }
  return out;
}

// ---------------------------------------------------------------------------
// GBA LZ77 (BIOS LZ77UnComp*): header 0x10 | size << 8, then groups of 8
// items behind a flag byte (MSB first; 1 = a back-reference of 3-18 bytes,
// 1-4096 back).

export function lz77Compress(src: Uint8Array): Uint8Array {
  const out: number[] = [0x10, src.length & 255, (src.length >> 8) & 255, (src.length >> 16) & 255];
  const head = new Map<number, number[]>();
  const key = (i: number) => (src[i] << 16) | (src[i + 1] << 8) | src[i + 2];
  let i = 0;
  while (i < src.length) {
    const flagPos = out.length;
    out.push(0);
    let flags = 0;
    for (let bit = 7; bit >= 0 && i < src.length; bit--) {
      let bestLen = 0;
      let bestDisp = 0;
      if (i + 2 < src.length) {
        const chain = head.get(key(i));
        if (chain) {
          for (let c = chain.length - 1, tries = 0; c >= 0 && tries < 48; c--, tries++) {
            const j = chain[c];
            const disp = i - j;
            if (disp > 4096) break;
            let len = 0;
            while (len < 18 && i + len < src.length && src[j + len] === src[i + len]) len++;
            if (len > bestLen) {
              bestLen = len;
              bestDisp = disp;
              if (len === 18) break;
            }
          }
        }
      }
      const advance = bestLen >= 3 ? bestLen : 1;
      if (bestLen >= 3) {
        flags |= 1 << bit;
        out.push((((bestLen - 3) & 15) << 4) | (((bestDisp - 1) >> 8) & 15), (bestDisp - 1) & 255);
      } else out.push(src[i]);
      for (let k = 0; k < advance; k++, i++) {
        if (i + 2 < src.length) {
          const kk = key(i);
          let list = head.get(kk);
          if (!list) head.set(kk, (list = []));
          list.push(i);
          if (list.length > 64) list.shift();
        }
      }
    }
    out[flagPos] = flags;
  }
  while (out.length % 4) out.push(0);
  return new Uint8Array(out);
}

export function lz77Decompress(src: Uint8Array, offset = 0): Uint8Array {
  const size = src[offset + 1] | (src[offset + 2] << 8) | (src[offset + 3] << 16);
  const out = new Uint8Array(size);
  let o = 0;
  let i = offset + 4;
  while (o < size) {
    const flags = src[i++];
    for (let bit = 7; bit >= 0 && o < size; bit--) {
      if (flags & (1 << bit)) {
        const b0 = src[i++];
        const b1 = src[i++];
        const len = (b0 >> 4) + 3;
        const disp = (((b0 & 15) << 8) | b1) + 1;
        for (let k = 0; k < len && o < size; k++, o++) out[o] = out[o - disp];
      } else out[o++] = src[i++];
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Encode / decode

export interface EncodeProgress {
  (done: number, total: number): void;
}

/** Frames (RGBA at the mode's size) -> the .cut file bytes. */
export function encodeCut(frames: Uint8ClampedArray[], s: CutSettings, progress?: EncodeProgress): Uint8Array {
  const { w, h } = MODE_SIZE[s.mode];
  const tw = w / 8;
  const th = h / 8;
  const tiles = tw * th;
  const palette = buildPalette(frames);
  const near = new Nearest(palette);
  const bitmapBytes = (Math.ceil(tiles / 8) + 3) & ~3;

  const shown = new Uint8Array(tiles * 64); // what the GBA shows now
  const packed: Uint8Array[] = [];
  frames.forEach((rgba, f) => {
    const cur = frameToTiles(rgba, w, h, near, s.dither);
    const bitmap = new Uint8Array(bitmapBytes);
    const changed: number[] = [];
    for (let t = 0; t < tiles; t++) {
      let diff = 0;
      if (f > 0) for (let p = 0; p < 64; p++) if (cur[t * 64 + p] !== shown[t * 64 + p]) diff++;
      // Frame 0 sets every tile; later frames only the ones that changed.
      if (f === 0 || diff > s.threshold) {
        bitmap[t >> 3] |= 1 << (t & 7);
        changed.push(t);
        shown.set(cur.subarray(t * 64, t * 64 + 64), t * 64);
      }
    }
    const raw = new Uint8Array(bitmapBytes + changed.length * 64);
    raw.set(bitmap, 0);
    changed.forEach((t, k) => raw.set(shown.subarray(t * 64, t * 64 + 64), bitmapBytes + k * 64));
    packed.push(lz77Compress(raw));
    progress?.(f + 1, frames.length);
  });

  const n = frames.length;
  const tableBytes = (n + 1) * 4;
  let size = HEADER + tableBytes;
  const offsets: number[] = [];
  for (const p of packed) {
    offsets.push(size);
    size += p.length;
  }
  offsets.push(size);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  out.set([0x53, 0x48, 0x43, 0x56], 0); // "SHCV"
  dv.setUint16(4, 1, true);
  out[6] = s.mode === "half" ? 1 : 0;
  out[7] = s.fps;
  dv.setUint16(8, n, true);
  out[10] = tw;
  out[11] = th;
  palette.forEach((c, i) => {
    const bgr = to5((c >> 16) & 255) | (to5((c >> 8) & 255) << 5) | (to5(c & 255) << 10);
    dv.setUint16(12 + i * 2, bgr, true);
  });
  offsets.forEach((o, i) => dv.setUint32(HEADER + i * 4, o, true));
  packed.forEach((p, i) => out.set(p, offsets[i]));
  return out;
}

export interface CutInfo {
  mode: CutMode;
  fps: number;
  frames: number;
  width: number;
  height: number;
}

export function cutInfo(file: Uint8Array): CutInfo | null {
  if (file.length < HEADER || file[0] !== 0x53 || file[1] !== 0x48 || file[2] !== 0x43 || file[3] !== 0x56) return null;
  const dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
  return {
    mode: file[6] === 1 ? "half" : "full",
    fps: file[7],
    frames: dv.getUint16(8, true),
    width: file[10] * 8,
    height: file[11] * 8,
  };
}

/** Decodes frames one after another (as the GBA does) into RGBA. */
export class CutDecoder {
  readonly info: CutInfo;
  private file: Uint8Array;
  private dv: DataView;
  private palette: number[] = [];
  private tiles: Uint8Array;
  private next = 0;
  readonly rgba: Uint8ClampedArray;

  constructor(file: Uint8Array) {
    const info = cutInfo(file);
    if (!info) throw new Error("Not a Shimmer cutscene file.");
    this.info = info;
    this.file = file;
    this.dv = new DataView(file.buffer, file.byteOffset, file.byteLength);
    for (let i = 0; i < 256; i++) {
      const v = this.dv.getUint16(12 + i * 2, true);
      this.palette.push((from5(v & 31) << 16) | (from5((v >> 5) & 31) << 8) | from5((v >> 10) & 31));
    }
    this.tiles = new Uint8Array((info.width / 8) * (info.height / 8) * 64);
    this.rgba = new Uint8ClampedArray(info.width * info.height * 4);
  }

  /** Bytes frame `i` takes in the file. */
  frameBytes(i: number): number {
    return this.dv.getUint32(HEADER + (i + 1) * 4, true) - this.dv.getUint32(HEADER + i * 4, true);
  }

  reset() {
    this.next = 0;
  }

  /** Decode up to frame `i` (must not go backwards without reset()). */
  seek(i: number): Uint8ClampedArray {
    if (i < this.next - 1) this.reset();
    while (this.next <= i && this.next < this.info.frames) this.decodeNext();
    return this.rgba;
  }

  private decodeNext() {
    const { width, height } = this.info;
    const tw = width / 8;
    const tiles = tw * (height / 8);
    const raw = lz77Decompress(this.file, this.dv.getUint32(HEADER + this.next * 4, true));
    const bitmapBytes = (Math.ceil(tiles / 8) + 3) & ~3;
    let p = bitmapBytes;
    for (let t = 0; t < tiles; t++) {
      if (!(raw[t >> 3] & (1 << (t & 7)))) continue;
      this.tiles.set(raw.subarray(p, p + 64), t * 64);
      p += 64;
      const tx = (t % tw) * 8;
      const ty = Math.floor(t / tw) * 8;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const c = this.palette[this.tiles[t * 64 + y * 8 + x]];
          const o = ((ty + y) * width + tx + x) * 4;
          this.rgba[o] = (c >> 16) & 255;
          this.rgba[o + 1] = (c >> 8) & 255;
          this.rgba[o + 2] = c & 255;
          this.rgba[o + 3] = 255;
        }
    }
    this.next++;
  }
}

/** Float samples (any rate already resampled to AUDIO_RATE) -> signed 8-bit. */
export function audioToS8(samples: Float32Array, gain = 1): Uint8Array {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const norm = peak > 0 ? Math.min(4, 0.98 / peak) * gain : gain;
  const out = new Uint8Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.round(Math.max(-1, Math.min(1, samples[i] * norm)) * 127);
    out[i] = v < 0 ? v + 256 : v;
  }
  return out;
}

export { Nearest };
