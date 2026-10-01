import { useRef, useState } from "react";

import PopoverMenu, { type MenuItem } from "../components/common/PopoverMenu";
import { useProjectStore } from "../state/projectStore";
import { type ArtTool, activeLayer, flattenDoc, frameRects, newLayer, useArtStore } from "./artStore";
import { outline, reduceColors, replaceColor, resizeCanvas, rotate180, rotate90, scaleBitmap, flipBitmap } from "./effects";
import { bytesToBase64, encodeGif } from "./gif";
import { type Bitmap, colorsUsed, copyRegion, createBitmap, encodePng, flipRegion, loadBitmap, stamp, toGbaColor } from "./pixels";

// ---------------------------------------------------------------------------
// Shortcuts (customisable, kept per user in localStorage)

export type ShortcutAction =
  | ArtTool
  | "swap"
  | "brushDown"
  | "brushUp"
  | "zoomIn"
  | "zoomOut"
  | "fit"
  | "prevFrame"
  | "nextFrame"
  | "play"
  | "tileMode"
  | "tileGrid"
  | "pixelGrid";

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  pencil: "Pencil",
  eraser: "Eraser",
  fill: "Fill",
  line: "Line",
  rect: "Rectangle",
  ellipse: "Ellipse",
  gradient: "Gradient",
  shade: "Shading",
  stamp: "Stamp (custom brush)",
  picker: "Colour picker",
  select: "Select",
  move: "Move selection",
  pan: "Hand (pan)",
  swap: "Swap colours",
  brushDown: "Smaller brush",
  brushUp: "Bigger brush",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  fit: "Zoom to fit",
  prevFrame: "Previous frame",
  nextFrame: "Next frame",
  play: "Play / pause animation",
  tileMode: "Tile mode",
  tileGrid: "8×8 tile grid",
  pixelGrid: "Pixel grid",
};

export const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  pencil: "b",
  eraser: "e",
  fill: "g",
  line: "l",
  rect: "u",
  ellipse: "o",
  gradient: "d",
  shade: "s",
  stamp: "k",
  picker: "i",
  select: "m",
  move: "v",
  pan: "h",
  swap: "x",
  brushDown: "[",
  brushUp: "]",
  zoomIn: "=",
  zoomOut: "-",
  fit: "0",
  prevFrame: ",",
  nextFrame: ".",
  play: "p",
  tileMode: "t",
  tileGrid: "#",
  pixelGrid: "'",
};

const SHORTCUT_KEY = "shimmer-engine.art-shortcuts";

export function loadShortcuts(): Record<ShortcutAction, string> {
  try {
    const raw = localStorage.getItem(SHORTCUT_KEY);
    return { ...DEFAULT_SHORTCUTS, ...(raw ? (JSON.parse(raw) as Partial<Record<ShortcutAction, string>>) : {}) };
  } catch {
    return { ...DEFAULT_SHORTCUTS };
  }
}

function saveShortcuts(map: Record<ShortcutAction, string>) {
  try {
    localStorage.setItem(SHORTCUT_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable - shortcuts just won't persist */
  }
}

export function ShortcutsDialog({ onClose, onChange }: { onClose: () => void; onChange: () => void }) {
  const [map, setMap] = useState(loadShortcuts);
  const [listening, setListening] = useState<ShortcutAction | null>(null);
  const set = (next: Record<ShortcutAction, string>) => {
    setMap(next);
    saveShortcuts(next);
    onChange();
  };
  return (
    <div className="art-modal-backdrop" onMouseDown={onClose}>
      <div className="art-modal art-modal-wide" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Art Editor shortcuts</h3>
        <p className="art-modal-note">
          Click a key to change it, then press the new key. Always on: Ctrl+Z/Y undo/redo, Ctrl+C/X/V, Ctrl+A select all, Ctrl+D deselect,
          Delete clears, Esc/Enter drop a selection, arrows nudge it, Space+drag pans, Alt+click picks a colour, Ctrl+S saves.
        </p>
        <div className="art-shortcuts">
          {(Object.keys(SHORTCUT_LABELS) as ShortcutAction[]).map((a) => (
            <div key={a} className="art-shortcut-row">
              <span>{SHORTCUT_LABELS[a]}</span>
              <button
                className={`art-key${listening === a ? " art-key-listening" : ""}`}
                onClick={() => setListening(a)}
                onKeyDown={(e) => {
                  if (listening !== a) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (e.key === "Escape") return setListening(null);
                  const key = e.key.toLowerCase();
                  if (key.length !== 1) return;
                  // A key moves from whatever had it before.
                  const next = { ...map };
                  for (const k of Object.keys(next) as ShortcutAction[]) if (next[k] === key) next[k] = "";
                  next[a] = key;
                  set(next);
                  setListening(null);
                }}
              >
                {listening === a ? "press a key…" : map[a] ? map[a].toUpperCase() : "—"}
              </button>
            </div>
          ))}
        </div>
        <div className="art-modal-actions">
          <button className="btn" onClick={() => set({ ...DEFAULT_SHORTCUTS })}>
            Reset to defaults
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Image menu

type DialogKind = "resize" | "reduce" | "shortcuts" | null;

export function ImageMenu({ onShortcutsChanged }: { onShortcutsChanged: () => void }) {
  const doc = useArtStore((s) => s.doc);
  const selection = useArtStore((s) => s.selection);
  const customBrush = useArtStore((s) => s.customBrush);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<DialogKind>(null);
  const st = useArtStore.getState();
  const notice = (m: string) => useProjectStore.getState().showNotice(m);
  const area = selection ? "selection" : "layer";

  const items: MenuItem[] = [
    { label: "Resize image / canvas…", disabled: !doc, onClick: () => setDialog("resize") },
    { label: "Flip horizontally", disabled: !doc, onClick: () => (selection ? flipSel(true) : st.transformAll((b) => flipBitmap(b, true))) },
    { label: "Flip vertically", disabled: !doc, onClick: () => (selection ? flipSel(false) : st.transformAll((b) => flipBitmap(b, false))) },
    { label: "Rotate 90° clockwise", disabled: !doc, onClick: () => st.transformAll((b) => rotate90(b, true)) },
    { label: "Rotate 90° anticlockwise", disabled: !doc, onClick: () => st.transformAll((b) => rotate90(b, false)) },
    { label: "Rotate 180°", disabled: !doc, onClick: () => st.transformAll(rotate180) },
    "separator",
    {
      label: `Outline (${area}, primary colour)`,
      disabled: !doc,
      onClick: () => st.editActive((b, a) => notice(`Outlined: ${outline(b, st.primary, false, a)} px`)),
    },
    {
      label: `Outline with corners (${area})`,
      disabled: !doc,
      onClick: () => st.editActive((b, a) => notice(`Outlined: ${outline(b, st.primary, true, a)} px`)),
    },
    {
      label: `Replace primary colour with secondary (${area})`,
      disabled: !doc,
      onClick: () => st.editActive((b, a) => notice(`Replaced ${replaceColor(b, st.primary, st.secondary, a)} px`)),
    },
    { label: "Reduce colours…", disabled: !doc, onClick: () => setDialog("reduce") },
    {
      label: "Snap all colours to GBA colours",
      disabled: !doc,
      onClick: () =>
        st.editActive((b) => {
          const d = b.data;
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] === 0) continue;
            const c = toGbaColor([d[i], d[i + 1], d[i + 2], d[i + 3]]);
            d[i] = c[0];
            d[i + 1] = c[1];
            d[i + 2] = c[2];
          }
        }),
    },
    "separator",
    { label: "Brush from selection", disabled: !doc || !selection, onClick: () => st.brushFromSelection() },
    { label: "Clear custom brush", disabled: !customBrush, onClick: () => st.set({ customBrush: null, tool: "pencil" }) },
    "separator",
    { label: "Import image as a new layer…", disabled: !doc, onClick: () => void importLayer() },
    { label: "Export PNG…", disabled: !doc, onClick: () => void exportPng() },
    { label: "Export animated GIF…", disabled: !doc, onClick: () => void exportGif(1) },
    { label: "Export animated GIF (4× size)…", disabled: !doc, onClick: () => void exportGif(4) },
    "separator",
    { label: "Keyboard shortcuts…", onClick: () => setDialog("shortcuts") },
  ];

  return (
    <>
      <button ref={btnRef} className="btn btn-small" onClick={() => setOpen((v) => !v)} aria-haspopup="menu">
        Image ▾
      </button>
      {open && btnRef.current && <PopoverMenu anchor={btnRef.current} items={items} onClose={() => setOpen(false)} />}
      {dialog === "resize" && <ResizeDialog onClose={() => setDialog(null)} />}
      {dialog === "reduce" && <ReduceDialog onClose={() => setDialog(null)} />}
      {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} onChange={onShortcutsChanged} />}
    </>
  );
}

function flipSel(horizontal: boolean) {
  const st = useArtStore.getState();
  if (!st.selection) return;
  if (!st.floating) st.lift();
  const f = useArtStore.getState().floating;
  if (!f) return;
  st.set({ floating: { ...f, image: flipRegion(f.image, horizontal) } });
  st.touch();
}

async function importLayer() {
  const st = useArtStore.getState();
  const doc = st.doc;
  if (!doc) return;
  const r = await window.api.pickImageFile();
  if (!r.ok) return useProjectStore.getState().showNotice(`Import failed: ${r.error}`);
  if (!r.value) return;
  const img = await loadBitmap(r.value.dataUrl);
  const fitted = createBitmap(doc.width, doc.height);
  stamp(fitted, img, 0, 0);
  st.commitFloating();
  st.checkpoint();
  const layers = [...doc.layers];
  layers.splice(doc.active + 1, 0, newLayer(r.value.fileName.replace(/\.[^.]+$/, ""), doc.width, doc.height, fitted));
  st.set({ doc: { ...doc, layers, active: doc.active + 1, version: doc.version + 1 } });
  if (img.width > doc.width || img.height > doc.height)
    useProjectStore.getState().showNotice(`Imported ${img.width}×${img.height} - cropped to the image's ${doc.width}×${doc.height}.`);
}

async function exportPng() {
  const doc = useArtStore.getState().doc;
  if (!doc) return;
  const r = await window.api.exportFile({
    defaultName: doc.asset.fileName,
    filterName: "PNG image",
    extensions: ["png"],
    base64: await encodePng(flattenDoc(doc)),
  });
  if (r.ok && r.value) useProjectStore.getState().showNotice(`Exported ${r.value}`);
  else if (!r.ok) useProjectStore.getState().showNotice(`Export failed: ${r.error}`);
}

async function exportGif(scale: number) {
  const st = useArtStore.getState();
  const doc = st.doc;
  if (!doc) return;
  const flat = flattenDoc(doc);
  const cells = frameRects(doc);
  let frames: Bitmap[] = cells.length ? cells.map((c) => copyRegion(flat, c)) : [flat];
  // A GIF holds 255 colours: reduce a copy of all the frames together if needed.
  if (colorsUsed(flat).colors.length > 255) {
    const strip = createBitmap(frames[0].width, frames[0].height * frames.length);
    frames.forEach((f, i) => stamp(strip, f, 0, i * f.height));
    reduceColors(strip, 255);
    frames = frames.map((f, i) => copyRegion(strip, { x: 0, y: i * f.height, w: f.width, h: f.height }));
  }
  try {
    const bytes = encodeGif(frames, 1000 / st.fps, scale);
    const r = await window.api.exportFile({
      defaultName: doc.asset.fileName.replace(/\.png$/i, ".gif"),
      filterName: "Animated GIF",
      extensions: ["gif"],
      base64: bytesToBase64(bytes),
    });
    if (r.ok && r.value) useProjectStore.getState().showNotice(`Exported ${r.value} (${frames.length} frame${frames.length === 1 ? "" : "s"})`);
    else if (!r.ok) useProjectStore.getState().showNotice(`Export failed: ${r.error}`);
  } catch (e) {
    useProjectStore.getState().showNotice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ---------------------------------------------------------------------------

const ANCHORS: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 0.5],
  [0.5, 0.5],
  [1, 0.5],
  [0, 1],
  [0.5, 1],
  [1, 1],
];

function ResizeDialog({ onClose }: { onClose: () => void }) {
  const doc = useArtStore((s) => s.doc)!;
  const [mode, setMode] = useState<"scale" | "canvas">("canvas");
  const [w, setW] = useState(doc.width);
  const [h, setH] = useState(doc.height);
  const [anchor, setAnchor] = useState(0);
  const [keep, setKeep] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    if (w < 1 || h < 1 || w > 2048 || h > 2048) return setError("Sizes go from 1 to 2048.");
    const st = useArtStore.getState();
    const [ax, ay] = ANCHORS[anchor];
    st.transformAll((b) => (mode === "scale" ? scaleBitmap(b, w, h) : resizeCanvas(b, w, h, ax, ay)));
    if (w % 8 || h % 8) useProjectStore.getState().showNotice("Heads up: the GBA needs sizes in multiples of 8 for backgrounds and sprites.");
    onClose();
  };

  return (
    <div className="art-modal-backdrop" onMouseDown={onClose}>
      <div className="art-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Resize</h3>
        <div className="art-modal-row">
          <label>
            <input type="radio" checked={mode === "canvas"} onChange={() => setMode("canvas")} /> Canvas (keep pixels, add/crop edges)
          </label>
          <label>
            <input type="radio" checked={mode === "scale"} onChange={() => setMode("scale")} /> Scale image (nearest neighbour)
          </label>
        </div>
        <div className="art-modal-row">
          <label className="art-modal-field">
            Width
            <input
              type="number"
              min={1}
              max={2048}
              value={w}
              onChange={(e) => {
                const v = Number(e.target.value);
                setW(v);
                if (keep && mode === "scale") setH(Math.max(1, Math.round((v * doc.height) / doc.width)));
              }}
            />
          </label>
          <label className="art-modal-field">
            Height
            <input
              type="number"
              min={1}
              max={2048}
              value={h}
              onChange={(e) => {
                const v = Number(e.target.value);
                setH(v);
                if (keep && mode === "scale") setW(Math.max(1, Math.round((v * doc.width) / doc.height)));
              }}
            />
          </label>
        </div>
        {mode === "scale" ? (
          <label className="art-opt">
            <input type="checkbox" checked={keep} onChange={(e) => setKeep(e.target.checked)} /> Keep proportions
          </label>
        ) : (
          <div className="art-anchor">
            <span className="art-modal-note">Anchor</span>
            <div className="art-anchor-grid">
              {ANCHORS.map((_, i) => (
                <button key={i} className={`art-anchor-cell${i === anchor ? " art-anchor-on" : ""}`} onClick={() => setAnchor(i)} />
              ))}
            </div>
          </div>
        )}
        <p className="art-modal-note">
          Now {doc.width}×{doc.height}. Every layer is resized. Undo puts it back.
        </p>
        {error && <p className="art-modal-error">{error}</p>}
        <div className="art-modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={apply}>
            Resize
          </button>
        </div>
      </div>
    </div>
  );
}

function ReduceDialog({ onClose }: { onClose: () => void }) {
  const doc = useArtStore((s) => s.doc)!;
  const [n, setN] = useState(doc.kind === "sprites" ? 15 : 15);
  const apply = () => {
    const st = useArtStore.getState();
    st.editActive((b) => {
      const got = reduceColors(b, Math.max(1, Math.min(255, n)));
      useProjectStore.getState().showNotice(`${activeLayer(doc).name}: now ${got} colours`);
    });
    onClose();
  };
  return (
    <div className="art-modal-backdrop" onMouseDown={onClose}>
      <div className="art-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Reduce colours</h3>
        <p className="art-modal-note">
          Merges similar colours on the selected layer until it has at most this many. A GBA sprite can use 15 (plus transparent); each 8×8
          background tile can use 15 plus the backdrop.
        </p>
        <label className="art-modal-field">
          Colours
          <input type="number" min={1} max={255} value={n} onChange={(e) => setN(Number(e.target.value))} />
        </label>
        <div className="art-modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={apply}>
            Reduce
          </button>
        </div>
      </div>
    </div>
  );
}
