/**
 * A small animated-GIF encoder for the Art Editor's export: GIF89a, one
 * global palette (up to 255 colours + transparency), looping, a fixed
 * delay per frame, LZW-compressed. Frames are RGBA bitmaps of equal size;
 * pixels with alpha < 128 are transparent.
 */
import type { Bitmap } from "./pixels";

class ByteWriter {
  bytes: number[] = [];
  byte(b: number) {
    this.bytes.push(b & 255);
  }
  word(w: number) {
    this.byte(w);
    this.byte(w >> 8);
  }
  str(s: string) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
}

function lzw(indices: Uint8Array, minCodeSize: number, out: ByteWriter) {
  const clear = 1 << minCodeSize;
  const end = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = end + 1;
  let dict = new Map<string, number>();
  const sub: number[] = [];
  let cur = 0;
  let curBits = 0;
  const emit = (code: number) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) {
      sub.push(cur & 255);
      cur >>>= 8;
      curBits -= 8;
    }
  };
  emit(clear);
  let prefix = String(indices[0]);
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = `${prefix},${k}`;
    if (dict.has(key)) {
      prefix = key;
      continue;
    }
    emit(prefix.includes(",") ? dict.get(prefix)! : Number(prefix));
    if (next < 4096) {
      dict.set(key, next++);
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      codeSize = minCodeSize + 1;
      next = end + 1;
    }
    prefix = String(k);
  }
  emit(prefix.includes(",") ? dict.get(prefix)! : Number(prefix));
  emit(end);
  if (curBits > 0) sub.push(cur & 255);
  out.byte(minCodeSize);
  for (let i = 0; i < sub.length; i += 255) {
    const chunk = sub.slice(i, i + 255);
    out.byte(chunk.length);
    for (const b of chunk) out.byte(b);
  }
  out.byte(0);
}

/** Encode frames as an animated GIF (bytes). `delayMs` per frame; `scale`
 * enlarges each pixel (nearest neighbour). */
export function encodeGif(frames: Bitmap[], delayMs: number, scale = 1): Uint8Array {
  const w0 = frames[0].width;
  const h0 = frames[0].height;
  const w = w0 * scale;
  const h = h0 * scale;

  // Global palette: index 0 = transparent, then every colour used.
  const palette: number[] = [0];
  const indexOf = new Map<number, number>();
  for (const f of frames)
    for (let i = 0; i < f.data.length; i += 4) {
      if (f.data[i + 3] < 128) continue;
      const k = (f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2];
      if (!indexOf.has(k)) {
        if (palette.length >= 256) throw new Error("Too many colours for a GIF (255 max).");
        indexOf.set(k, palette.length);
        palette.push(k);
      }
    }
  let bits = 1;
  while (1 << bits < palette.length) bits++;
  const size = 1 << bits;

  const o = new ByteWriter();
  o.str("GIF89a");
  o.word(w);
  o.word(h);
  o.byte(0x80 | ((bits - 1) << 4) | (bits - 1)); // global colour table
  o.byte(0);
  o.byte(0);
  for (let i = 0; i < size; i++) {
    const c = palette[i] ?? 0;
    o.byte(c >> 16);
    o.byte(c >> 8);
    o.byte(c);
  }
  // Loop forever (NETSCAPE2.0).
  o.byte(0x21);
  o.byte(0xff);
  o.byte(11);
  o.str("NETSCAPE2.0");
  o.byte(3);
  o.byte(1);
  o.word(0);
  o.byte(0);

  const delay = Math.max(2, Math.round(delayMs / 10));
  for (const f of frames) {
    o.byte(0x21);
    o.byte(0xf9);
    o.byte(4);
    o.byte((2 << 2) | 1); // dispose: restore to background; transparent colour on
    o.word(delay);
    o.byte(0);
    o.byte(0);
    o.byte(0x2c);
    o.word(0);
    o.word(0);
    o.word(w);
    o.word(h);
    o.byte(0);
    const idx = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = ((Math.floor(y / scale) * w0 + Math.floor(x / scale)) * 4) | 0;
        idx[y * w + x] =
          f.data[i + 3] < 128 ? 0 : (indexOf.get((f.data[i] << 16) | (f.data[i + 1] << 8) | f.data[i + 2]) ?? 0);
      }
    lzw(idx, Math.max(2, bits), o);
  }
  o.byte(0x3b);
  return new Uint8Array(o.bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
