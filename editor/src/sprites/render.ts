import type { ProjectJSON, SpriteSheetJSON } from "../../shared/projectTypes";
import { drawTiles, type SpriteImage } from "./image";
import { animationFor, canvasAnchor, defaultSheet, type Facing } from "./model";

const defaults = new Map<string, SpriteSheetJSON>();

/** A sprite's sheet: its project.json entry, or the automatic layout the
 * compiler gives a sprite without one. */
export function sheetFor(project: ProjectJSON, name: string, img: { width: number; height: number } | null): SpriteSheetJSON | null {
  const entry = project.spriteSheets?.find((s) => s.name === name);
  if (entry) return entry;
  if (!img) return null;
  const key = `${name}|${img.width}x${img.height}`;
  let sheet = defaults.get(key);
  if (!sheet) {
    sheet = defaultSheet(name, img.width, img.height);
    defaults.set(key, sheet);
  }
  return sheet;
}

/** Draw an actor standing at footprint (x, y) (screen px, top-left of its
 * 16x16 cell) facing `facing`, `scale` screen px per game pixel: the
 * first frame of its default state's idle animation, as the ROM shows it. */
export function drawActor(
  ctx: CanvasRenderingContext2D,
  img: SpriteImage,
  sheet: SpriteSheetJSON,
  facing: Facing,
  x: number,
  y: number,
  scale: number,
  opts: { alpha?: number; stateIndex?: number; moving?: boolean; frame?: number } = {},
): boolean {
  const state = sheet.states[opts.stateIndex ?? 0] ?? sheet.states[0];
  if (!state) return false;
  const { anim, flip } = animationFor(state, facing, !!opts.moving);
  const frames = anim?.frames ?? [];
  const f = frames.length ? frames[(opts.frame ?? 0) % frames.length] : undefined;
  if (!f || !f.tiles.length) return false;
  const a = canvasAnchor(sheet);
  drawTiles(ctx, img, f.tiles, sheet.spriteMode, x + a.x * scale, y + a.y * scale, scale, {
    mirrorWidth: flip ? sheet.canvasWidth : undefined,
    alpha: opts.alpha,
  });
  return true;
}
