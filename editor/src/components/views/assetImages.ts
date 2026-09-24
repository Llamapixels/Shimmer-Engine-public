import { useEffect, useState } from "react";

import type { AssetInfo } from "../../../shared/ipc";

/** data: URLs by path+mtime, so flipping between tabs doesn't re-read
 * every PNG over IPC (and an edited file on disk gets a fresh read). */
const cache = new Map<string, string>();

export function useAssetUrl(rootPath: string | undefined, asset: AssetInfo | null | undefined): string | null {
  const key = asset && rootPath ? `${rootPath}|${asset.base}|${asset.relPath}|${asset.mtimeMs}` : null;
  const [url, setUrl] = useState<string | null>(key ? (cache.get(key) ?? null) : null);

  useEffect(() => {
    if (!key || !asset || !rootPath) {
      setUrl(null);
      return;
    }
    const hit = cache.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let cancelled = false;
    window.api.readAsset({ rootPath, relPath: asset.relPath, base: asset.base }).then((r) => {
      if (cancelled || !r.ok) return;
      cache.set(key, r.value.dataUrl);
      setUrl(r.value.dataUrl);
    });
    return () => {
      cancelled = true;
    };
  }, [key, asset, rootPath]);

  return url;
}

export interface ImageStats {
  width: number;
  height: number;
  /** Distinct opaque colors in the whole image. */
  colors: number;
  /** Worst 8x8 tile's color count (the compiler allows 16 incl. backdrop). */
  maxTileColors: number;
  /** Distinct 8x8 tiles, not counting flipped duplicates - an upper
   * bound on what the compiler will count (it also dedupes flips). */
  uniqueTiles: number;
}

/** Decode an image and gather the numbers the GBA limits care about. */
export function useImageStats(url: string | null): ImageStats | null {
  const [stats, setStats] = useState<ImageStats | null>(null);
  useEffect(() => {
    setStats(null);
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      const w = img.width;
      const h = img.height;
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, w, h).data;
      const all = new Set<number>();
      const tiles = new Set<string>();
      let maxTileColors = 0;
      for (let ty = 0; ty + 8 <= h; ty += 8) {
        for (let tx = 0; tx + 8 <= w; tx += 8) {
          const tc = new Set<number>();
          const sig: number[] = [];
          for (let y = 0; y < 8; y++) {
            for (let x = 0; x < 8; x++) {
              const i = ((ty + y) * w + tx + x) * 4;
              const v = px[i + 3] < 128 ? -1 : (px[i] << 16) | (px[i + 1] << 8) | px[i + 2];
              if (v >= 0) {
                tc.add(v);
                all.add(v);
              }
              sig.push(v);
            }
          }
          maxTileColors = Math.max(maxTileColors, tc.size);
          tiles.add(sig.join(","));
        }
      }
      setStats({ width: w, height: h, colors: all.size, maxTileColors, uniqueTiles: tiles.size });
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return stats;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
