/** Text color that reads on a scene's color bar: near-black on light
 * colors, white on dark ones. */
export function inkOn(color: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return "#111";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#111" : "#fff";
}

/** Per-scene limits (the compiler's MAX_NPCS, MAX_TILES and the engine's
 * 8-bit trigger count). */
export const SCENE_MAX_ACTORS = 16;
export const SCENE_MAX_TRIGGERS = 255;
export const SCENE_MAX_TILES = 1024;
