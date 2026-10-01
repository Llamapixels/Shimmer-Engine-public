import { create } from "zustand";

import type { AssetInfo } from "../../shared/ipc";
import { useProjectStore } from "../state/projectStore";
import { loadAssetUrl } from "../components/views/assetImages";
import {
  type Bitmap,
  type Rect,
  type RGBA,
  clearRegion,
  cloneBitmap,
  copyRegion,
  createBitmap,
  encodePng,
  loadBitmap,
  stamp,
} from "./pixels";

export type ArtTool = "pencil" | "eraser" | "fill" | "line" | "rect" | "ellipse" | "picker" | "select" | "move" | "pan";

/** Which project folder an image lives in - decides the colour limits. */
export type ArtKind = "backgrounds" | "sprites" | "fonts" | "frames";

export interface ArtDoc {
  asset: AssetInfo;
  kind: ArtKind;
  image: Bitmap;
  /** Bumped on every pixel change so views redraw. */
  version: number;
}

/** A lifted piece of the image being moved/pasted, not yet stamped down. */
export interface Floating {
  image: Bitmap;
  x: number;
  y: number;
}

/** Undo history is capped by memory: whole-image snapshots. */
const UNDO_BYTES = 256 * 1024 * 1024;

/** One undo step: the image as it was, and which edit state that was (so
 * undoing back to the saved state clears the unsaved mark). */
interface Snapshot {
  image: Bitmap;
  id: number;
}

let nextStateId = 1;

interface ArtState {
  doc: ArtDoc | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  past: Snapshot[];
  future: Snapshot[];
  /** Edit state of the image on screen, and of the file on disk. */
  stateId: number;
  savedId: number;

  tool: ArtTool;
  brushSize: number;
  mirrorX: boolean;
  mirrorY: boolean;
  fillGlobal: boolean;
  shapeFilled: boolean;
  primary: RGBA;
  secondary: RGBA;
  pixelGrid: boolean;
  tileGrid: boolean;
  zoom: number;

  selection: Rect | null;
  floating: Floating | null;
  clipboard: Bitmap | null;

  open: (asset: AssetInfo, kind: ArtKind) => Promise<void>;
  openNew: (asset: AssetInfo, kind: ArtKind, image: Bitmap) => void;
  close: () => void;
  /** Call before changing pixels: records an undo step, marks dirty. */
  checkpoint: () => void;
  /** Call after changing doc.image in place. */
  touch: () => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<boolean>;

  setTool: (t: ArtTool) => void;
  set: (patch: Partial<ArtState>) => void;
  swapColors: () => void;

  selectAll: () => void;
  deselect: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  deleteSelection: () => void;
  /** Lift the selection into a floating piece (for moving). */
  lift: () => void;
  /** Stamp the floating piece down. */
  commitFloating: () => void;
}

export const useArtStore = create<ArtState>((set, get) => ({
  doc: null,
  dirty: false,
  loading: false,
  error: null,
  past: [],
  future: [],
  stateId: 0,
  savedId: 0,

  tool: "pencil",
  brushSize: 1,
  mirrorX: false,
  mirrorY: false,
  fillGlobal: false,
  shapeFilled: false,
  primary: [0, 0, 0, 255],
  secondary: [0, 0, 0, 0],
  pixelGrid: true,
  tileGrid: false,
  zoom: 0, // 0 = fit on open

  selection: null,
  floating: null,
  clipboard: null,

  open: async (asset, kind) => {
    const rootPath = useProjectStore.getState().project?.rootPath;
    if (!rootPath) return;
    set({ loading: true, error: null });
    try {
      const url = await loadAssetUrl(rootPath, asset);
      if (!url) throw new Error(`Couldn't read ${asset.fileName}.`);
      const image = await loadBitmap(url);
      const id = nextStateId++;
      set({
        doc: { asset, kind, image, version: 0 },
        dirty: false,
        loading: false,
        past: [],
        future: [],
        stateId: id,
        savedId: id,
        selection: null,
        floating: null,
        zoom: 0,
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  openNew: (asset, kind, image) => {
    const id = nextStateId++;
    set({ doc: { asset, kind, image, version: 0 }, dirty: false, past: [], future: [], stateId: id, savedId: id, selection: null, floating: null, zoom: 0 });
  },

  close: () => set({ doc: null, dirty: false, past: [], future: [], selection: null, floating: null }),

  checkpoint: () => {
    const { doc, past, stateId } = get();
    if (!doc) return;
    const next = [...past, { image: cloneBitmap(doc.image), id: stateId }];
    let bytes = next.reduce((n, s) => n + s.image.data.length, 0);
    while (next.length > 1 && bytes > UNDO_BYTES) bytes -= next.shift()!.image.data.length;
    set({ past: next, future: [], stateId: nextStateId++, dirty: true });
  },

  touch: () => {
    const { doc } = get();
    if (doc) set({ doc: { ...doc, version: doc.version + 1 } });
  },

  undo: () => {
    get().commitFloating();
    const { doc, past, future, stateId, savedId } = get();
    if (!doc || past.length === 0) return;
    const prev = past[past.length - 1];
    set({
      past: past.slice(0, -1),
      future: [...future, { image: doc.image, id: stateId }],
      doc: { ...doc, image: prev.image, version: doc.version + 1 },
      stateId: prev.id,
      dirty: prev.id !== savedId,
      selection: null,
    });
  },

  redo: () => {
    const { doc, past, future, stateId, savedId } = get();
    if (!doc || future.length === 0) return;
    const next = future[future.length - 1];
    set({
      future: future.slice(0, -1),
      past: [...past, { image: doc.image, id: stateId }],
      doc: { ...doc, image: next.image, version: doc.version + 1 },
      stateId: next.id,
      dirty: next.id !== savedId,
      selection: null,
    });
  },

  save: async () => {
    get().commitFloating();
    const { doc } = get();
    const project = useProjectStore.getState();
    const rootPath = project.project?.rootPath;
    if (!doc || !rootPath) return false;
    try {
      const pngBase64 = await encodePng(doc.image);
      const r = await window.api.saveImage({ rootPath, relPath: doc.asset.relPath, pngBase64, overwrite: true });
      if (!r.ok) throw new Error(r.error);
      // The rest of the app (scenes, sprite editor, builds) sees it at once.
      useProjectStore.setState({ assets: r.value });
      const fresh = (r.value[doc.kind] as AssetInfo[]).find((a) => a.relPath === doc.asset.relPath);
      set({ dirty: false, savedId: get().stateId, doc: { ...doc, asset: fresh ?? doc.asset } });
      project.showNotice(`Saved ${doc.asset.fileName}`);
      return true;
    } catch (e) {
      project.showNotice(`Couldn't save: ${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  },

  setTool: (tool) => {
    if (tool !== "move" && tool !== "select") get().commitFloating();
    set({ tool });
  },
  set: (patch) => set(patch),
  swapColors: () => set((s) => ({ primary: s.secondary, secondary: s.primary })),

  selectAll: () => {
    const { doc } = get();
    get().commitFloating();
    if (doc) set({ selection: { x: 0, y: 0, w: doc.image.width, h: doc.image.height } });
  },
  deselect: () => {
    get().commitFloating();
    set({ selection: null });
  },
  copy: () => {
    const { doc, selection, floating } = get();
    if (floating) set({ clipboard: cloneBitmap(floating.image) });
    else if (doc && selection) set({ clipboard: copyRegion(doc.image, selection) });
  },
  cut: () => {
    const { doc, selection, floating } = get();
    if (floating) {
      set({ clipboard: cloneBitmap(floating.image), floating: null, selection: null });
      get().touch();
      return;
    }
    if (!doc || !selection) return;
    set({ clipboard: copyRegion(doc.image, selection) });
    get().checkpoint();
    clearRegion(doc.image, selection);
    get().touch();
  },
  paste: () => {
    const { doc, clipboard, selection } = get();
    if (!doc || !clipboard) return;
    get().commitFloating();
    const x = selection ? selection.x : 0;
    const y = selection ? selection.y : 0;
    get().checkpoint();
    set({
      floating: { image: cloneBitmap(clipboard), x, y },
      selection: { x, y, w: clipboard.width, h: clipboard.height },
      tool: "move",
    });
    get().touch();
  },
  deleteSelection: () => {
    const { doc, selection, floating } = get();
    if (floating) {
      set({ floating: null, selection: null });
      get().touch();
      return;
    }
    if (!doc || !selection) return;
    get().checkpoint();
    clearRegion(doc.image, selection);
    get().touch();
  },
  lift: () => {
    const { doc, selection, floating } = get();
    if (!doc || !selection || floating) return;
    get().checkpoint();
    const piece = copyRegion(doc.image, selection);
    clearRegion(doc.image, selection);
    set({ floating: { image: piece, x: selection.x, y: selection.y } });
    get().touch();
  },
  commitFloating: () => {
    const { doc, floating } = get();
    if (!doc || !floating) return;
    stamp(doc.image, floating.image, floating.x, floating.y);
    set({ floating: null });
    get().touch();
  },
}));

/** A blank image for New Image. */
export function blankImage(width: number, height: number, fill: RGBA | null): Bitmap {
  return createBitmap(width, height, fill ?? [0, 0, 0, 0]);
}

// A different project (or none) means the open image belongs to another
// project: close it.
useProjectStore.subscribe((s, prev) => {
  if (s.project?.rootPath !== prev.project?.rootPath) useArtStore.getState().close();
});
