/*
 * Sprite PNGs as the compiler sees them (compiler/sprites.py's SheetImage):
 * alpha < 128 is transparent, every other pixel is one of up to 15 colors.
 */

import { useEffect, useState } from "react";

import type { SpriteMode, SpriteTileJSON } from "../../shared/projectTypes";
import { tileSize } from "./model";

export interface SpriteImage {
  width: number;
  height: number;
  /** Color index per pixel, 0 = transparent, 1..n = colors[i - 1]. */
  index: Uint8Array;
  colors: [number, number, number][];
  /** The image with the compiler's transparency applied, for drawing. */
  canvas: HTMLCanvasElement;
}

const cache = new Map<string, Promise<SpriteImage>>();

function decode(url: string): Promise<SpriteImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, w, h);
      const px = data.data;
      const index = new Uint8Array(w * h);
      const colors: [number, number, number][] = [];
      const lookup = new Map<number, number>();
      for (let i = 0; i < w * h; i++) {
        if (px[i * 4 + 3] < 128) {
          px[i * 4 + 3] = 0;
          continue;
        }
        px[i * 4 + 3] = 255;
        const key = (px[i * 4] << 16) | (px[i * 4 + 1] << 8) | px[i * 4 + 2];
        let c = lookup.get(key);
        if (c === undefined) {
          colors.push([px[i * 4], px[i * 4 + 1], px[i * 4 + 2]]);
          c = colors.length;
          lookup.set(key, c);
        }
        index[i] = Math.min(c, 255);
      }
      ctx.putImageData(data, 0, 0);
      resolve({ width: w, height: h, index, colors, canvas });
    };
    img.onerror = () => reject(new Error("couldn't decode image"));
    img.src = url;
  });
}

export function loadSpriteImage(url: string): Promise<SpriteImage> {
  let p = cache.get(url);
  if (!p) {
    p = decode(url);
    cache.set(url, p);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return p;
}

export function useSpriteImage(url: string | null): SpriteImage | null {
  const [img, setImg] = useState<SpriteImage | null>(null);
  useEffect(() => {
    setImg(null);
    if (!url) return;
    let cancelled = false;
    loadSpriteImage(url).then(
      (v) => !cancelled && setImg(v),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  return img;
}

export function pixelAt(img: SpriteImage, x: number, y: number): number {
  return x >= 0 && y >= 0 && x < img.width && y < img.height ? img.index[y * img.width + x] : 0;
}

export function regionEmpty(img: SpriteImage, x: number, y: number, w: number, h: number): boolean {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) if (pixelAt(img, x + i, y + j)) return false;
  return true;
}

/** Smallest rectangle around the non-transparent pixels of a region, or
 * null if it's all transparent. */
export function trimRegion(
  img: SpriteImage,
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -1;
  let y1 = -1;
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++)
      if (pixelAt(img, x + i, y + j)) {
        x0 = Math.min(x0, i);
        y0 = Math.min(y0, j);
        x1 = Math.max(x1, i);
        y1 = Math.max(y1, j);
      }
  return x1 < 0 ? null : { x: x + x0, y: y + y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Draw a frame's tiles (in order) at (ox, oy), `scale` px per pixel. */
export function drawTiles(
  ctx: CanvasRenderingContext2D,
  img: SpriteImage,
  tiles: SpriteTileJSON[],
  mode: SpriteMode,
  ox: number,
  oy: number,
  scale: number,
  opts: { mirrorWidth?: number; alpha?: number } = {},
) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (opts.alpha !== undefined) ctx.globalAlpha = opts.alpha;
  for (const t of tiles) {
    const { w, h } = tileSize(t, mode);
    let x = t.x;
    let fx = !!t.flipX;
    if (opts.mirrorWidth !== undefined) {
      x = opts.mirrorWidth - t.x - w;
      fx = !fx;
    }
    // Only the part of the slice that's inside the image draws.
    const sx = Math.max(0, t.sliceX);
    const sy = Math.max(0, t.sliceY);
    const sw = Math.min(img.width, t.sliceX + w) - sx;
    const sh = Math.min(img.height, t.sliceY + h) - sy;
    if (sw <= 0 || sh <= 0) continue;
    const dxIn = sx - t.sliceX;
    const dyIn = sy - t.sliceY;
    ctx.save();
    ctx.translate(ox + x * scale, oy + t.y * scale);
    if (fx) {
      ctx.translate(w * scale, 0);
      ctx.scale(-1, 1);
    }
    if (t.flipY) {
      ctx.translate(0, h * scale);
      ctx.scale(1, -1);
    }
    ctx.drawImage(img.canvas, sx, sy, sw, sh, dxIn * scale, dyIn * scale, sw * scale, sh * scale);
    ctx.restore();
  }
  ctx.restore();
}

export function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r}, ${g}, ${b})`;
}

/** The color as the GBA shows it (5 bits per channel). */
export function gbaRgb([r, g, b]: [number, number, number]): [number, number, number] {
  const c = (v: number) => Math.round((Math.floor((v * 31 + 127) / 255) * 255) / 31);
  return [c(r), c(g), c(b)];
}
