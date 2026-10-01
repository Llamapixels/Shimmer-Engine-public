import { create } from "zustand";

import type { AssetInfo } from "../../shared/ipc";
import { useProjectStore } from "../state/projectStore";
import { loadAssetUrl } from "../components/views/assetImages";
import { checksum, flatten } from "./effects";
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

export type ArtTool =
  | "pencil"
  | "eraser"
  | "fill"
  | "line"
  | "rect"
  | "ellipse"
  | "gradient"
  | "shade"
  | "stamp"
  | "picker"
  | "select"
  | "move"
  | "pan";

/** Which project folder an image lives in - decides the colour limits. */
export type ArtKind = "backgrounds" | "sprites" | "fonts" | "frames";

export interface Layer {
  id: number;
  name: string;
  visible: boolean;
  /** 0-1. */
  opacity: number;
  locked: boolean;
  image: Bitmap;
}

export interface ArtDoc {
  asset: AssetInfo;
  kind: ArtKind;
  width: number;
  height: number;
  /** Bottom to top. The PNG on disk is these flattened. */
  layers: Layer[];
  active: number;
  /** Animation frames: the image cut into frameW x frameH cells, read left
   * to right, top to bottom (0 = no frames). */
  frameW: number;
  frameH: number;
  /** Bumped on every pixel change so views redraw. */
  version: number;
}

/** A lifted piece of the active layer being moved/pasted. */
export interface Floating {
  image: Bitmap;
  x: number;
  y: number;
}

/** One undo step: every layer as it was, and which edit state that was
 * (so undoing back to the saved state clears the unsaved mark). */
interface Snapshot {
  layers: Layer[];
  active: number;
  width: number;
  height: number;
  frameW: number;
  frameH: number;
  id: number;
}

/** Undo history is capped by memory. */
const UNDO_BYTES = 384 * 1024 * 1024;

let nextStateId = 1;
let nextLayerId = 1;

export function newLayer(name: string, width: number, height: number, image?: Bitmap): Layer {
  return { id: nextLayerId++, name, visible: true, opacity: 1, locked: false, image: image ?? createBitmap(width, height) };
}

function cloneLayers(layers: Layer[]): Layer[] {
  return layers.map((l) => ({ ...l, image: cloneBitmap(l.image) }));
}

/** The saved form of the layers ("<name>.art.json" beside the PNG). */
interface Sidecar {
  version: 1;
  width: number;
  height: number;
  /** checksum() of the flattened image when saved: if the PNG changed
   * outside the editor since, the layers are stale and ignored. */
  flat: string;
  active: number;
  frameW: number;
  frameH: number;
  layers: { name: string; visible: boolean; opacity: number; locked: boolean; png: string }[];
}

interface ArtState {
  doc: ArtDoc | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  past: Snapshot[];
  future: Snapshot[];
  stateId: number;
  savedId: number;

  tool: ArtTool;
  brushSize: number;
  /** Pencil draws a 50% checker of primary/secondary. */
  dither: boolean;
  /** Pencil/eraser: no doubled corners on curves ("pixel perfect"). */
  pixelPerfect: boolean;
  mirrorX: boolean;
  mirrorY: boolean;
  fillGlobal: boolean;
  shapeFilled: boolean;
  gradientRadial: boolean;
  gradientSteps: number;
  primary: RGBA;
  secondary: RGBA;
  pixelGrid: boolean;
  tileGrid: boolean;
  /** Show the image repeated around itself; drawing wraps at the edges. */
  tileMode: boolean;
  zoom: number;

  /** Animation (when the doc has frames). */
  frame: number;
  onion: boolean;
  fps: number;
  playing: boolean;

  selection: Rect | null;
  floating: Floating | null;
  clipboard: Bitmap | null;
  /** The Stamp tool's brush (made from a selection). */
  customBrush: Bitmap | null;
  /** Colours picked recently, newest first. */
  recent: RGBA[];

  open: (asset: AssetInfo, kind: ArtKind) => Promise<void>;
  openNew: (asset: AssetInfo, kind: ArtKind, image: Bitmap) => void;
  close: () => void;
  /** Call before changing pixels or layers: records an undo step. */
  checkpoint: () => void;
  /** Call after changing pixels in place. */
  touch: () => void;
  undo: () => void;
  redo: () => void;
  save: () => Promise<boolean>;

  setTool: (t: ArtTool) => void;
  set: (patch: Partial<ArtState>) => void;
  setPrimary: (c: RGBA) => void;
  swapColors: () => void;

  // Layers
  addLayer: () => void;
  duplicateLayer: () => void;
  removeLayer: () => void;
  moveLayer: (dir: 1 | -1) => void;
  mergeDown: () => void;
  setActiveLayer: (i: number) => void;
  updateLayer: (i: number, patch: Partial<Omit<Layer, "id" | "image">>) => void;
  /** Replace every layer's image (resize/rotate) - one undo step. */
  transformAll: (fn: (b: Bitmap) => Bitmap) => void;
  /** Change the active layer's pixels (inside the selection if any). */
  editActive: (fn: (b: Bitmap, area: Rect | null) => void) => void;
  setFrames: (w: number, h: number) => void;

  // Selection
  selectAll: () => void;
  deselect: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  deleteSelection: () => void;
  lift: () => void;
  commitFloating: () => void;
  brushFromSelection: () => void;
}

export function activeLayer(doc: ArtDoc): Layer {
  return doc.layers[Math.min(doc.active, doc.layers.length - 1)];
}

export function flattenDoc(doc: ArtDoc): Bitmap {
  return flatten(doc.layers, doc.width, doc.height);
}

/** Frame cells of the doc (empty when it has no frames). */
export function frameRects(doc: ArtDoc): Rect[] {
  if (!doc.frameW || !doc.frameH) return [];
  const cols = Math.floor(doc.width / doc.frameW);
  const rows = Math.floor(doc.height / doc.frameH);
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: c * doc.frameW, y: r * doc.frameH, w: doc.frameW, h: doc.frameH });
  return out;
}

function sidecarPath(asset: AssetInfo): string {
  return asset.relPath.replace(/\.png$/i, ".art.json");
}

async function readSidecar(rootPath: string, asset: AssetInfo): Promise<Sidecar | null> {
  const r = await window.api.readAsset({ rootPath, relPath: sidecarPath(asset), base: asset.base });
  if (!r.ok) return null;
  try {
    const b64 = r.value.dataUrl.slice(r.value.dataUrl.indexOf(",") + 1);
    const text = new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
    const s = JSON.parse(text) as Sidecar;
    return s.version === 1 && Array.isArray(s.layers) ? s : null;
  } catch {
    return null;
  }
}

export const useArtStore = create<ArtState>((set, get) => {
  const fresh = (asset: AssetInfo, kind: ArtKind, layers: Layer[], extra: Partial<ArtDoc> = {}) => {
    const id = nextStateId++;
    const w = layers[0].image.width;
    const h = layers[0].image.height;
    const doc: ArtDoc = { asset, kind, width: w, height: h, layers, active: layers.length - 1, frameW: 0, frameH: 0, version: 0, ...extra };
    // Sprites: a one-column strip of square frames (16x128 = eight 16x16)
    // gets frames straight away; wider sheets are set up in the Frames panel.
    if (!extra.frameW && kind === "sprites" && w <= 32 && h > w && h % w === 0) {
      doc.frameW = w;
      doc.frameH = w;
    }
    set({ doc, dirty: false, loading: false, past: [], future: [], stateId: id, savedId: id, selection: null, floating: null, zoom: 0, frame: 0, playing: false });
  };

  const snapshot = (doc: ArtDoc, id: number): Snapshot => ({
    layers: cloneLayers(doc.layers),
    active: doc.active,
    width: doc.width,
    height: doc.height,
    frameW: doc.frameW,
    frameH: doc.frameH,
    id,
  });

  const restore = (doc: ArtDoc, s: Snapshot): ArtDoc => ({
    ...doc,
    layers: s.layers,
    active: s.active,
    width: s.width,
    height: s.height,
    frameW: s.frameW,
    frameH: s.frameH,
    version: doc.version + 1,
  });

  const bump = (doc: ArtDoc, patch: Partial<ArtDoc> = {}) => set({ doc: { ...doc, ...patch, version: doc.version + 1 } });

  return {
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
    dither: false,
    pixelPerfect: false,
    mirrorX: false,
    mirrorY: false,
    fillGlobal: false,
    shapeFilled: false,
    gradientRadial: false,
    gradientSteps: 2,
    primary: [0, 0, 0, 255],
    secondary: [0, 0, 0, 0],
    pixelGrid: true,
    tileGrid: false,
    tileMode: false,
    zoom: 0,

    frame: 0,
    onion: false,
    fps: 8,
    playing: false,

    selection: null,
    floating: null,
    clipboard: null,
    customBrush: null,
    recent: [],

    open: async (asset, kind) => {
      const rootPath = useProjectStore.getState().project?.rootPath;
      if (!rootPath) return;
      set({ loading: true, error: null });
      try {
        const url = await loadAssetUrl(rootPath, asset);
        if (!url) throw new Error(`Couldn't read ${asset.fileName}.`);
        const image = await loadBitmap(url);
        const side = await readSidecar(rootPath, asset);
        if (side && side.width === image.width && side.height === image.height) {
          const layers: Layer[] = [];
          for (const l of side.layers) {
            const img = await loadBitmap(`data:image/png;base64,${l.png}`);
            layers.push({ ...newLayer(l.name, image.width, image.height, img), visible: l.visible, opacity: l.opacity, locked: l.locked });
          }
          if (layers.length && checksum(image) === side.flat) {
            fresh(asset, kind, layers, { active: Math.min(side.active, layers.length - 1), frameW: side.frameW, frameH: side.frameH });
            return;
          }
          useProjectStore.getState().showNotice(`${asset.fileName} changed outside the Art Editor - its saved layers were reset.`);
        }
        fresh(asset, kind, [newLayer("Layer 1", image.width, image.height, image)]);
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    openNew: (asset, kind, image) => fresh(asset, kind, [newLayer("Layer 1", image.width, image.height, image)]),

    close: () => set({ doc: null, dirty: false, past: [], future: [], selection: null, floating: null, playing: false }),

    checkpoint: () => {
      const { doc, past, stateId } = get();
      if (!doc) return;
      const next = [...past, snapshot(doc, stateId)];
      const size = (s: Snapshot) => s.layers.reduce((n, l) => n + l.image.data.length, 0);
      let bytes = next.reduce((n, s) => n + size(s), 0);
      while (next.length > 1 && bytes > UNDO_BYTES) bytes -= size(next.shift()!);
      set({ past: next, future: [], stateId: nextStateId++, dirty: true });
    },

    touch: () => {
      const { doc } = get();
      if (doc) bump(doc);
    },

    undo: () => {
      get().commitFloating();
      const { doc, past, future, stateId, savedId } = get();
      if (!doc || past.length === 0) return;
      const prev = past[past.length - 1];
      set({
        past: past.slice(0, -1),
        future: [...future, snapshot(doc, stateId)],
        doc: restore(doc, prev),
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
        past: [...past, snapshot(doc, stateId)],
        doc: restore(doc, next),
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
        const flat = flattenDoc(doc);
        const pngBase64 = await encodePng(flat);
        // A single plain layer and no frames needs no sidecar.
        const plain =
          doc.layers.length === 1 && doc.layers[0].visible && doc.layers[0].opacity === 1 && !doc.frameW;
        let sidecar: string | null = null;
        if (!plain) {
          const s: Sidecar = {
            version: 1,
            width: doc.width,
            height: doc.height,
            flat: checksum(await loadBitmap(`data:image/png;base64,${pngBase64}`)),
            active: doc.active,
            frameW: doc.frameW,
            frameH: doc.frameH,
            layers: [],
          };
          for (const l of doc.layers)
            s.layers.push({ name: l.name, visible: l.visible, opacity: l.opacity, locked: l.locked, png: await encodePng(l.image) });
          sidecar = JSON.stringify(s);
        }
        const r = await window.api.saveImage({ rootPath, relPath: doc.asset.relPath, pngBase64, overwrite: true, sidecar });
        if (!r.ok) throw new Error(r.error);
        // The rest of the app (scenes, sprite editor, builds) sees it at once.
        useProjectStore.setState({ assets: r.value });
        const asset = (r.value[doc.kind] as AssetInfo[]).find((a) => a.relPath === doc.asset.relPath);
        set({ dirty: false, savedId: get().stateId, doc: { ...doc, asset: asset ?? doc.asset } });
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
    setPrimary: (c) =>
      set((s) => ({
        primary: c,
        recent: c[3] === 0 ? s.recent : [c, ...s.recent.filter((r) => r[0] !== c[0] || r[1] !== c[1] || r[2] !== c[2])].slice(0, 16),
      })),
    swapColors: () => set((s) => ({ primary: s.secondary, secondary: s.primary })),

    // ---- Layers ----
    addLayer: () => {
      const { doc } = get();
      if (!doc) return;
      get().commitFloating();
      get().checkpoint();
      const layers = [...doc.layers];
      layers.splice(doc.active + 1, 0, newLayer(`Layer ${layers.length + 1}`, doc.width, doc.height));
      bump(doc, { layers, active: doc.active + 1 });
    },
    duplicateLayer: () => {
      const { doc } = get();
      if (!doc) return;
      get().commitFloating();
      get().checkpoint();
      const src = activeLayer(doc);
      const layers = [...doc.layers];
      layers.splice(doc.active + 1, 0, { ...newLayer(`${src.name} copy`, doc.width, doc.height, cloneBitmap(src.image)), opacity: src.opacity });
      bump(doc, { layers, active: doc.active + 1 });
    },
    removeLayer: () => {
      const { doc } = get();
      if (!doc || doc.layers.length < 2) return;
      get().commitFloating();
      get().checkpoint();
      const layers = doc.layers.filter((_, i) => i !== doc.active);
      bump(doc, { layers, active: Math.max(0, doc.active - 1) });
    },
    moveLayer: (dir) => {
      const { doc } = get();
      if (!doc) return;
      const to = doc.active + dir;
      if (to < 0 || to >= doc.layers.length) return;
      get().commitFloating();
      get().checkpoint();
      const layers = [...doc.layers];
      [layers[doc.active], layers[to]] = [layers[to], layers[doc.active]];
      bump(doc, { layers, active: to });
    },
    mergeDown: () => {
      const { doc } = get();
      if (!doc || doc.active === 0) return;
      get().commitFloating();
      get().checkpoint();
      const below = doc.layers[doc.active - 1];
      const top = doc.layers[doc.active];
      const merged = flatten([{ ...below, opacity: 1, visible: true }, { ...top, visible: true }], doc.width, doc.height);
      const layers = doc.layers.filter((_, i) => i !== doc.active);
      layers[doc.active - 1] = { ...below, image: merged };
      bump(doc, { layers, active: doc.active - 1 });
    },
    setActiveLayer: (i) => {
      const { doc } = get();
      if (!doc || i === doc.active) return;
      get().commitFloating();
      set({ doc: { ...doc, active: i }, selection: get().selection });
    },
    updateLayer: (i, patch) => {
      const { doc } = get();
      if (!doc) return;
      get().checkpoint();
      const layers = doc.layers.map((l, k) => (k === i ? { ...l, ...patch } : l));
      bump(doc, { layers });
    },
    transformAll: (fn) => {
      const { doc } = get();
      if (!doc) return;
      get().commitFloating();
      get().checkpoint();
      const layers = doc.layers.map((l) => ({ ...l, image: fn(l.image) }));
      const w = layers[0].image.width;
      const h = layers[0].image.height;
      const keepFrames = doc.frameW && w % doc.frameW === 0 && h % doc.frameH === 0;
      set({ selection: null, frame: 0 });
      bump(doc, { layers, width: w, height: h, frameW: keepFrames ? doc.frameW : 0, frameH: keepFrames ? doc.frameH : 0 });
    },
    editActive: (fn) => {
      const { doc, selection } = get();
      if (!doc) return;
      const layer = activeLayer(doc);
      if (layer.locked) {
        useProjectStore.getState().showNotice("That layer is locked.");
        return;
      }
      get().commitFloating();
      get().checkpoint();
      fn(layer.image, selection);
      get().touch();
    },
    setFrames: (w, h) => {
      const { doc } = get();
      if (!doc) return;
      get().checkpoint();
      set({ frame: 0, playing: false });
      bump(doc, { frameW: w, frameH: h });
    },

    // ---- Selection ----
    selectAll: () => {
      const { doc } = get();
      get().commitFloating();
      if (doc) set({ selection: { x: 0, y: 0, w: doc.width, h: doc.height } });
    },
    deselect: () => {
      get().commitFloating();
      set({ selection: null });
    },
    copy: () => {
      const { doc, selection, floating } = get();
      if (floating) set({ clipboard: cloneBitmap(floating.image) });
      else if (doc && selection) set({ clipboard: copyRegion(activeLayer(doc).image, selection) });
    },
    cut: () => {
      const { doc, selection, floating } = get();
      if (floating) {
        set({ clipboard: cloneBitmap(floating.image), floating: null, selection: null });
        get().touch();
        return;
      }
      if (!doc || !selection) return;
      set({ clipboard: copyRegion(activeLayer(doc).image, selection) });
      get().checkpoint();
      clearRegion(activeLayer(doc).image, selection);
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
      clearRegion(activeLayer(doc).image, selection);
      get().touch();
    },
    lift: () => {
      const { doc, selection, floating } = get();
      if (!doc || !selection || floating) return;
      get().checkpoint();
      const img = activeLayer(doc).image;
      const piece = copyRegion(img, selection);
      clearRegion(img, selection);
      set({ floating: { image: piece, x: selection.x, y: selection.y } });
      get().touch();
    },
    commitFloating: () => {
      const { doc, floating } = get();
      if (!doc || !floating) return;
      stamp(activeLayer(doc).image, floating.image, floating.x, floating.y);
      set({ floating: null });
      get().touch();
    },
    brushFromSelection: () => {
      const { doc, selection, floating } = get();
      if (!doc) return;
      const img = floating ? floating.image : selection ? copyRegion(flattenDoc(doc), selection) : null;
      if (!img) return;
      set({ customBrush: cloneBitmap(img), tool: "stamp" });
      useProjectStore.getState().showNotice(`Brush made from the selection (${img.width}×${img.height}) - the Stamp tool draws it.`);
    },
  };
});

/** A blank image for New Image. */
export function blankImage(width: number, height: number, fill: RGBA | null): Bitmap {
  return createBitmap(width, height, fill ?? [0, 0, 0, 0]);
}

// A different project (or none) means the open image belongs to another
// project: close it.
useProjectStore.subscribe((s, prev) => {
  if (s.project?.rootPath !== prev.project?.rootPath) useArtStore.getState().close();
});
