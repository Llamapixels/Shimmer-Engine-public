/*
 * Sprites section UI state (what's selected, zoom, toggles, clipboard).
 * The sprite data itself lives in project.json via projectStore; edits go
 * through editSheet() so they're undoable like everything else.
 */

import { create } from "zustand";

import type { SpriteFrameJSON, SpriteSheetJSON, SpriteTileJSON } from "../../shared/projectTypes";
import { useProjectStore } from "../state/projectStore";
import type { Facing } from "./model";

export interface PaletteSelection {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SpriteEditorState {
  sprite: string | null;
  /** Selected state id (falls back to the first state). */
  stateId: string | null;
  /** Index into state.animations. */
  animIndex: number;
  frameIndex: number;
  /** Selected tiles on the canvas, by id. */
  tileIds: string[];
  /** Region picked in the tile palette; while set, clicking the canvas
   * places it as a tile. */
  palette: PaletteSelection | null;
  /** 0 = fit the view. */
  zoom: number;
  /** The zoom "fit" currently works out to (set by the canvas). */
  fitZoom: number;
  paletteZoom: number;
  showGrid: boolean;
  showBounds: boolean;
  onionSkin: boolean;
  /** Outline the GBA hardware sprites (OBJs) each frame compiles to. */
  showObjs: boolean;
  snap8: boolean;
  /** Tile palette selections snap to 1px instead of 8px. */
  precision: boolean;
  playing: boolean;
  previewFacing: Facing;
  previewMoving: boolean;
  clipboard: { tiles?: SpriteTileJSON[]; frames?: SpriteFrameJSON[] } | null;

  set: (patch: Partial<Omit<SpriteEditorState, "set" | "selectSprite" | "selectAnimation">>) => void;
  selectSprite: (name: string | null) => void;
  selectAnimation: (stateId: string, animIndex: number) => void;
}

export const useSpriteEditor = create<SpriteEditorState>((set) => ({
  sprite: null,
  stateId: null,
  animIndex: 0,
  frameIndex: 0,
  tileIds: [],
  palette: null,
  zoom: 0,
  fitZoom: 4,
  paletteZoom: 3,
  showGrid: true,
  showBounds: true,
  onionSkin: false,
  showObjs: false,
  snap8: false,
  precision: false,
  playing: false,
  previewFacing: "down",
  previewMoving: false,
  clipboard: null,

  set: (patch) => set(patch),
  selectSprite: (name) =>
    set({ sprite: name, stateId: null, animIndex: 0, frameIndex: 0, tileIds: [], palette: null, playing: false, zoom: 0 }),
  selectAnimation: (stateId, animIndex) => set({ stateId, animIndex, frameIndex: 0, tileIds: [], playing: false }),
}));

/**
 * Change sprite `base.name`'s sheet. `base` is the sheet as shown (its
 * project.json entry, or the automatic layout for a sprite without one -
 * the first edit writes it into project.json).
 */
export function editSheet(base: SpriteSheetJSON, updater: (s: SpriteSheetJSON) => SpriteSheetJSON, coalesceKey?: string) {
  useProjectStore.getState().updateProject(
    (p) => {
      const sheets = p.spriteSheets ?? [];
      const i = sheets.findIndex((s) => s.name === base.name);
      const cur = i >= 0 ? sheets[i] : base;
      const next = updater(cur);
      if (next === cur && i >= 0) return p;
      const list = sheets.slice();
      if (i >= 0) list[i] = next;
      else list.push(next);
      return { ...p, spriteSheets: list };
    },
    coalesceKey ? `sprite:${base.name}:${coalesceKey}` : undefined,
  );
}

/** Update one frame of one animation. */
export function editFrame(
  base: SpriteSheetJSON,
  stateId: string,
  animIndex: number,
  frameIndex: number,
  updater: (f: SpriteFrameJSON) => SpriteFrameJSON,
  coalesceKey?: string,
) {
  editSheet(
    base,
    (s) => ({
      ...s,
      states: s.states.map((st) =>
        st.id !== stateId
          ? st
          : {
              ...st,
              animations: st.animations.map((a, ai) =>
                ai !== animIndex ? a : { ...a, frames: a.frames.map((f, fi) => (fi === frameIndex ? updater(f) : f)) },
              ),
            },
      ),
    }),
    coalesceKey,
  );
}

/** Update the frame list of one animation. */
export function editFrames(
  base: SpriteSheetJSON,
  stateId: string,
  animIndex: number,
  updater: (frames: SpriteFrameJSON[]) => SpriteFrameJSON[],
) {
  editSheet(base, (s) => ({
    ...s,
    states: s.states.map((st) =>
      st.id !== stateId
        ? st
        : { ...st, animations: st.animations.map((a, ai) => (ai !== animIndex ? a : { ...a, frames: updater(a.frames) })) },
    ),
  }));
}
