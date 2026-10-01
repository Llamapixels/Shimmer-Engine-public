import { useEffect, useMemo, useState } from "react";

import type { AssetInfo } from "../../shared/ipc";
import { useAssetUrl } from "../components/views/assetImages";
import { useProjectStore } from "../state/projectStore";
import ArtCanvas, { zoomStep } from "./ArtCanvas";
import ArtIcon from "./ArtIcons";
import { ImageMenu, SHORTCUT_LABELS, type ShortcutAction, loadShortcuts } from "./ArtMenus";
import { FramesPanel, LayersPanel } from "./ArtPanels";
import { type ArtKind, type ArtTool, blankImage, flattenDoc, frameRects, useArtStore } from "./artStore";
import { tilesOverLimit } from "./pixels";
import { type Pt, type RGBA, colorsUsed, encodePng, fromHex, toGbaColor, toHex } from "./pixels";
import "./ArtEditor.css";

const SECTIONS: { kind: ArtKind; label: string }[] = [
  { kind: "backgrounds", label: "Backgrounds" },
  { kind: "sprites", label: "Sprites" },
  { kind: "fonts", label: "Fonts" },
  { kind: "frames", label: "Dialogue Frames" },
];

const TOOLS: ArtTool[] = ["pencil", "eraser", "fill", "line", "rect", "ellipse", "gradient", "shade", "stamp", "picker", "select", "move", "pan"];

const TOOL_HELP: Record<ArtTool, string> = {
  pencil: "Left click: primary colour, right click: secondary. Shift+click draws a line from the last point. Alt+click picks a colour.",
  eraser: "Erases to transparent.",
  fill: "Fills the area of the clicked colour. Global fills that colour everywhere.",
  line: "Drag to draw. Shift snaps to 45°.",
  rect: "Drag to draw. Shift makes a square.",
  ellipse: "Drag to draw. Shift makes a circle.",
  gradient: "Drag from where the primary colour starts to where the secondary ends. Fills the selection (or the layer), dithered.",
  shade: "Left click lightens, right click darkens - stepping through the image's own colours, so no new colours appear.",
  stamp: "Draws your custom brush. Make one with Image ▸ Brush from selection.",
  picker: "Left click sets the primary colour, right click the secondary.",
  select: "Drag to select. Drag inside the selection to move it. Ctrl+C / Ctrl+X / Ctrl+V, Delete clears, Esc deselects.",
  move: "Drag the selection (or arrow keys, Shift = 8 px). Enter or Esc drops it.",
  pan: "Drag to move around. Space+drag or middle-drag work with any tool.",
};

/** Before leaving an image with unsaved changes: save, discard, or stay.
 * Returns whether it's OK to move on. */
export async function resolveUnsaved(): Promise<boolean> {
  const st = useArtStore.getState();
  if (!st.dirty || !st.doc) return true;
  const name = st.doc.asset.fileName;
  if (window.confirm(`${name} has unsaved changes.\n\nOK = Save them\nCancel = more choices`)) return st.save();
  return window.confirm(`Discard your changes to ${name}?\n\nOK = Discard\nCancel = Keep editing`);
}

/** The Art Editor section: a pixel art editor for the project's own images. */
export default function ArtEditorView() {
  const assets = useProjectStore((s) => s.assets);
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const doc = useArtStore((s) => s.doc);
  const dirty = useArtStore((s) => s.dirty);
  const loading = useArtStore((s) => s.loading);
  const error = useArtStore((s) => s.error);
  const [hover, setHover] = useState<Pt | null>(null);
  const [filter, setFilter] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [shortcuts, setShortcuts] = useState(loadShortcuts);

  const openAsset = async (asset: AssetInfo, kind: ArtKind) => {
    const st = useArtStore.getState();
    if (st.doc?.asset.relPath === asset.relPath) return;
    if (!(await resolveUnsaved())) return;
    await st.open(asset, kind);
  };

  useArtShortcuts(shortcuts);

  return (
    <div className="art-editor">
      <aside className="art-assets">
        <div className="art-assets-head">
          <input className="art-assets-filter" placeholder="Filter images…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button className="btn btn-small" onClick={() => setNewOpen(true)} title="Make a new background or sprite image">
            + New
          </button>
        </div>
        <div className="art-assets-list">
          {SECTIONS.map(({ kind, label }) => {
            const list = ((assets?.[kind] as AssetInfo[] | undefined) ?? []).filter(
              (a) => a.base === "project" && a.name.toLowerCase().includes(filter.toLowerCase()),
            );
            const open = !collapsed[kind];
            return (
              <div key={kind} className="art-assets-section">
                <button className="art-assets-section-head" onClick={() => setCollapsed({ ...collapsed, [kind]: open })}>
                  <span className={`art-chev${open ? " art-chev-open" : ""}`}>▸</span>
                  {label}
                  <span className="art-assets-count">{list.length}</span>
                </button>
                {open &&
                  list.map((a) => (
                    <AssetRow
                      key={a.relPath}
                      asset={a}
                      rootPath={rootPath}
                      active={doc?.asset.relPath === a.relPath}
                      dirty={doc?.asset.relPath === a.relPath && dirty}
                      onOpen={() => void openAsset(a, kind)}
                    />
                  ))}
                {open && list.length === 0 && <div className="art-assets-empty">None yet</div>}
              </div>
            );
          })}
        </div>
      </aside>

      <ToolStrip shortcuts={shortcuts} />

      <section className="art-main">
        <OptionsBar hover={hover} onShortcutsChanged={() => setShortcuts(loadShortcuts())} />
        {doc ? (
          <ArtCanvas onHover={setHover} />
        ) : (
          <div className="art-empty">
            {loading ? "Opening…" : error ? error : "Pick an image on the left to edit it, or make a new one with + New."}
          </div>
        )}
        <PaletteBar />
      </section>

      <aside className="art-side">
        {doc ? (
          <>
            <LayersPanel />
            <FramesPanel />
          </>
        ) : (
          <div className="art-panel-note art-side-empty">Layers and frames show here once an image is open.</div>
        )}
      </aside>

      {newOpen && <NewImageDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}

function AssetRow({
  asset,
  rootPath,
  active,
  dirty,
  onOpen,
}: {
  asset: AssetInfo;
  rootPath: string | undefined;
  active: boolean;
  dirty: boolean;
  onOpen: () => void;
}) {
  const url = useAssetUrl(rootPath, asset);
  return (
    <button className={`art-asset${active ? " art-asset-active" : ""}`} onClick={onOpen} title={asset.relPath}>
      <span className="art-asset-thumb">{url && <img src={url} alt="" />}</span>
      <span className="art-asset-name">
        {asset.name}
        {dirty && <span className="art-asset-dirty"> ●</span>}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------

function ToolStrip({ shortcuts }: { shortcuts: Record<ShortcutAction, string> }) {
  const tool = useArtStore((s) => s.tool);
  const primary = useArtStore((s) => s.primary);
  const secondary = useArtStore((s) => s.secondary);
  const st = useArtStore.getState();
  return (
    <nav className="art-tools">
      {TOOLS.map((t) => (
        <button
          key={t}
          className={`art-tool${tool === t ? " art-tool-on" : ""}`}
          onClick={() => st.setTool(t)}
          title={`${SHORTCUT_LABELS[t]}${shortcuts[t] ? ` (${shortcuts[t].toUpperCase()})` : ""}\n${TOOL_HELP[t]}`}
        >
          <ArtIcon name={t} />
        </button>
      ))}
      <div className="art-tool-colors" title="Primary (left click) and secondary (right click) colours. X swaps them.">
        <ColorSwatch color={primary} onPick={(c) => st.setPrimary(c)} className="art-color-primary" />
        <ColorSwatch color={secondary} onPick={(c) => st.set({ secondary: c })} className="art-color-secondary" />
      </div>
      <button className="art-tool art-tool-small" onClick={() => st.swapColors()} title="Swap colours">
        <ArtIcon name="swap" size={16} />
      </button>
      <button
        className="art-tool art-tool-small"
        onClick={() => st.set({ secondary: [0, 0, 0, 0] })}
        title="Make the secondary colour transparent (right click then erases)"
      >
        <ArtIcon name="clear" size={16} />
      </button>
    </nav>
  );
}

function ColorSwatch({ color, onPick, className }: { color: RGBA; onPick: (c: RGBA) => void; className?: string }) {
  return (
    <label className={`art-swatch-big ${className ?? ""}`} style={{ background: color[3] === 0 ? undefined : toHex(color) }}>
      <input type="color" value={toHex(color)} onChange={(e) => onPick(fromHex(e.target.value))} />
    </label>
  );
}

// ---------------------------------------------------------------------------

function OptionsBar({ hover, onShortcutsChanged }: { hover: Pt | null; onShortcutsChanged: () => void }) {
  const s = useArtStore();
  const doc = s.doc;
  const toggle = (
    key: "mirrorX" | "mirrorY" | "fillGlobal" | "shapeFilled" | "pixelGrid" | "tileGrid" | "tileMode" | "dither" | "pixelPerfect" | "gradientRadial",
    label: string,
    title: string,
  ) => (
    <label className="art-opt" title={title}>
      <input type="checkbox" checked={s[key]} onChange={(e) => s.set({ [key]: e.target.checked, ...(key === "tileMode" ? { zoom: 0 } : {}) })} />
      {label}
    </label>
  );
  const zoomTo = (z: number) => s.set({ zoom: Math.max(1, Math.min(64, z)) });
  const drawTool = ["pencil", "eraser", "line", "rect", "ellipse", "fill", "shade"].includes(s.tool);
  return (
    <div className="art-options">
      <span className="art-doc-name">
        {doc ? doc.asset.fileName : "No image"}
        {s.dirty && <span className="art-asset-dirty"> ●</span>}
        {doc && (
          <span className="art-doc-size">
            {doc.width}×{doc.height}
          </span>
        )}
      </span>
      <ImageMenu onShortcutsChanged={onShortcutsChanged} />
      {(s.tool === "pencil" || s.tool === "eraser" || s.tool === "line" || s.tool === "shade") && (
        <label className="art-opt" title="Brush size ([ and ])">
          Size
          <input type="range" min={1} max={16} value={s.brushSize} onChange={(e) => s.set({ brushSize: Number(e.target.value) })} />
          <span className="art-opt-value">{s.brushSize}</span>
        </label>
      )}
      {s.tool === "pencil" && toggle("dither", "Dither", "Draw a checkerboard of the primary and secondary colours")}
      {(s.tool === "pencil" || s.tool === "eraser") &&
        toggle("pixelPerfect", "Pixel perfect", "Removes the doubled corner pixels on 1-pixel curves and diagonals")}
      {s.tool === "fill" && toggle("fillGlobal", "Global", "Fill every pixel of the clicked colour, not just the connected area")}
      {(s.tool === "rect" || s.tool === "ellipse") && toggle("shapeFilled", "Filled", "Draw filled shapes")}
      {s.tool === "gradient" && (
        <>
          {toggle("gradientRadial", "Radial", "A circular gradient out from where you start dragging")}
          <label className="art-opt" title="Colours between primary and secondary (2 = just those two, dithered)">
            Steps
            <input type="number" min={2} max={16} value={s.gradientSteps} onChange={(e) => s.set({ gradientSteps: Math.max(2, Math.min(16, Number(e.target.value))) })} />
          </label>
        </>
      )}
      {drawTool && (
        <>
          {toggle("mirrorX", "Mirror ↔", "Draw mirrored left/right (around the frame's centre when using frames)")}
          {toggle("mirrorY", "Mirror ↕", "Draw mirrored up/down")}
        </>
      )}
      <span className="art-options-spacer" />
      {toggle("tileMode", "Tile mode", "Show the image repeated around itself - drawing wraps across the edges, for seamless tiles")}
      {toggle("pixelGrid", "Pixel grid", "Lines between pixels (from 8x zoom)")}
      {toggle("tileGrid", "8×8 tiles", "The GBA's 8x8 tile boundaries")}
      <span className="art-zoom">
        <button className="icon-btn" onClick={() => zoomTo(zoomStep(s.zoom, -1))} title="Zoom out">
          −
        </button>
        <button className="art-zoom-value" onClick={() => s.set({ zoom: 0 })} title="Fit to the window">
          {s.zoom}x
        </button>
        <button className="icon-btn" onClick={() => zoomTo(zoomStep(s.zoom, 1))} title="Zoom in">
          +
        </button>
      </span>
      <span className="art-hover">{hover ? `X=${hover.x} Y=${hover.y}` : ""}</span>
      <button className="btn btn-small" disabled={!s.past.length} onClick={() => s.undo()} title="Undo (Ctrl+Z)">
        Undo
      </button>
      <button className="btn btn-small" disabled={!s.future.length} onClick={() => s.redo()} title="Redo (Ctrl+Y)">
        Redo
      </button>
      <button className="btn btn-small btn-primary" disabled={!doc || !s.dirty} onClick={() => void s.save()} title="Save the image (Ctrl+S)">
        Save
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** The bottom bar: every colour the image uses, with the GBA's limits. */
function PaletteBar() {
  const doc = useArtStore((s) => s.doc);
  const version = useArtStore((s) => s.doc?.version);
  const primary = useArtStore((s) => s.primary);
  const secondary = useArtStore((s) => s.secondary);
  const recent = useArtStore((s) => s.recent);
  const [stats, setStats] = useState<{ colors: { color: RGBA; count: number }[]; transparent: number; tilesOver: number } | null>(null);

  // Counting a big background takes a moment: do it shortly after edits stop.
  useEffect(() => {
    if (!doc) {
      setStats(null);
      return;
    }
    const t = setTimeout(() => {
      const flat = flattenDoc(doc);
      const used = colorsUsed(flat);
      const backdrop = used.transparent > 0 ? null : (used.colors[0]?.color ?? null);
      setStats({ ...used, tilesOver: doc.kind === "backgrounds" ? tilesOverLimit(flat, backdrop) : 0 });
    }, 250);
    return () => clearTimeout(t);
  }, [doc, version]);

  const st = useArtStore.getState();
  const n = stats?.colors.length ?? 0;
  let limit: string;
  let over = false;
  if (!doc) limit = "";
  else if (doc.kind === "sprites") {
    over = n > 15;
    limit = `${n} / 15 colours + transparent (one sprite palette)`;
  } else if (doc.kind === "backgrounds") {
    over = (stats?.tilesOver ?? 0) > 0;
    limit = over
      ? `${n} colours - ${stats!.tilesOver} 8×8 tile(s) use more than 15 colours + backdrop`
      : `${n} colours (up to 15 per 8×8 tile, plus a shared backdrop)`;
  } else limit = `${n} colours - fonts and frames share the dialogue box's 15-colour palette`;

  const same = (c: RGBA, sel: RGBA) => c[0] === sel[0] && c[1] === sel[1] && c[2] === sel[2] && sel[3] !== 0;
  const offGba = stats?.colors.some(({ color }) => toHex(toGbaColor(color)) !== toHex(color)) ?? false;

  const swatch = (color: RGBA, title: string, key: string) => (
    <button
      key={key}
      className={`art-swatch${same(color, primary) ? " art-swatch-primary" : ""}${same(color, secondary) ? " art-swatch-secondary" : ""}`}
      style={{ background: toHex(color) }}
      title={`${title}\nLeft click: primary, right click: secondary`}
      onClick={() => st.setPrimary(color)}
      onContextMenu={(e) => {
        e.preventDefault();
        st.set({ secondary: color });
      }}
    />
  );

  return (
    <div className="art-palette">
      <div className={`art-palette-info${over ? " art-palette-over" : ""}`}>
        <span>{doc ? limit : "Palette"}</span>
        {offGba && (
          <span
            className="art-palette-note"
            title="The GBA has 5 bits per colour channel, so some colours will look very slightly different in the game. Image ▸ Snap rounds them."
          >
            Some colours aren't exact GBA colours
          </span>
        )}
        {doc && over && doc.kind === "sprites" && <span className="art-palette-note">Image ▸ Reduce colours can fix this.</span>}
      </div>
      <div className="art-palette-swatches">
        {doc && (stats?.transparent ?? 0) > 0 && (
          <button
            className={`art-swatch art-swatch-transparent${primary[3] === 0 ? " art-swatch-primary" : ""}`}
            title={`Transparent - ${stats!.transparent} px`}
            onClick={() => st.set({ primary: [0, 0, 0, 0] })}
            onContextMenu={(e) => {
              e.preventDefault();
              st.set({ secondary: [0, 0, 0, 0] });
            }}
          />
        )}
        {stats?.colors.map(({ color, count }) => swatch(color, `${toHex(color)} - ${count} px`, toHex(color)))}
        {recent.length > 0 && (
          <>
            <span className="art-palette-sep" title="Recently used colours">
              Recent
            </span>
            {recent.map((c, i) => swatch(c, toHex(c), `r${i}`))}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NewImageDialog({ onClose }: { onClose: () => void }) {
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const [kind, setKind] = useState<"backgrounds" | "sprites">("sprites");
  const [name, setName] = useState("");
  const [w, setW] = useState(16);
  const [h, setH] = useState(16);
  const [fill, setFill] = useState("#ffffff");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const presets = useMemo(
    () =>
      kind === "sprites"
        ? [
            [16, 16],
            [32, 32],
            [16, 128],
            [32, 256],
          ]
        : [
            [240, 160],
            [256, 256],
            [480, 320],
            [512, 512],
          ],
    [kind],
  );

  const create = async () => {
    setError(null);
    const stem = name.trim().replace(/[^A-Za-z0-9_ -]/g, "_");
    if (!stem) return setError("Give it a name.");
    if (w % 8 || h % 8 || w < 8 || h < 8) return setError("Width and height must be multiples of 8.");
    if (w > 2048 || h > 2048) return setError("Images are capped at 2048×2048.");
    if (!rootPath) return;
    if (!(await resolveUnsaved())) return;
    setBusy(true);
    const image = blankImage(w, h, kind === "backgrounds" ? fromHex(fill) : null);
    const relPath = `assets/${kind}/${stem}.png`;
    const r = await window.api.saveImage({ rootPath, relPath, pngBase64: await encodePng(image), overwrite: false });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    useProjectStore.setState({ assets: r.value });
    const asset = (r.value[kind] as AssetInfo[]).find((a) => a.relPath === relPath);
    if (asset) useArtStore.getState().openNew(asset, kind, image);
    onClose();
  };

  return (
    <div className="art-modal-backdrop" onMouseDown={onClose}>
      <div className="art-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>New Image</h3>
        <div className="art-modal-row">
          <label>
            <input type="radio" checked={kind === "sprites"} onChange={() => (setKind("sprites"), setW(16), setH(16))} /> Sprite
          </label>
          <label>
            <input type="radio" checked={kind === "backgrounds"} onChange={() => (setKind("backgrounds"), setW(240), setH(160))} /> Background
          </label>
        </div>
        <label className="art-modal-field">
          Name
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void create()} />
        </label>
        <div className="art-modal-row">
          <label className="art-modal-field">
            Width
            <input type="number" step={8} min={8} max={2048} value={w} onChange={(e) => setW(Number(e.target.value))} />
          </label>
          <label className="art-modal-field">
            Height
            <input type="number" step={8} min={8} max={2048} value={h} onChange={(e) => setH(Number(e.target.value))} />
          </label>
          {kind === "backgrounds" && (
            <label className="art-modal-field">
              Fill
              <input type="color" value={fill} onChange={(e) => setFill(e.target.value)} />
            </label>
          )}
        </div>
        <div className="art-modal-row art-modal-presets">
          {presets.map(([pw, ph]) => (
            <button key={`${pw}x${ph}`} className="btn btn-small" onClick={() => (setW(pw), setH(ph))}>
              {pw}×{ph}
            </button>
          ))}
        </div>
        {kind === "sprites" && <p className="art-modal-note">Sprite sheets stack frames top to bottom, e.g. 16×128 = eight 16×16 frames.</p>}
        {error && <p className="art-modal-error">{error}</p>}
        <div className="art-modal-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={() => void create()}>
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Pixelorama-style single-key shortcuts (customisable), plus the usual Ctrl ones. */
function useArtShortcuts(map: Record<ShortcutAction, string>) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
      if (document.querySelector(".art-modal-backdrop")) return;
      const st = useArtStore.getState();
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const handled = () => e.preventDefault();

      if (mod) {
        if (k === "z" && !e.shiftKey) (handled(), st.undo());
        else if (k === "y" || (k === "z" && e.shiftKey)) (handled(), st.redo());
        else if (k === "c") (handled(), st.copy());
        else if (k === "x") (handled(), st.cut());
        else if (k === "v") (handled(), st.paste());
        else if (k === "a") (handled(), st.selectAll());
        else if (k === "d") (handled(), st.deselect());
        return;
      }
      if (!st.doc || e.altKey) return;
      if (e.key === "Delete" || e.key === "Backspace") return handled(), st.deleteSelection();
      if (e.key === "Escape") return handled(), st.deselect();
      if (e.key === "Enter") return handled(), st.commitFloating();
      if (e.key.startsWith("Arrow") && st.selection) {
        handled();
        if (!st.floating) st.lift();
        const f = useArtStore.getState().floating;
        const sel = useArtStore.getState().selection;
        if (!f || !sel) return;
        const step = e.shiftKey ? 8 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        st.set({ floating: { ...f, x: f.x + dx, y: f.y + dy }, selection: { ...sel, x: sel.x + dx, y: sel.y + dy } });
        return;
      }
      const action = (Object.keys(map) as ShortcutAction[]).find((a) => map[a] && map[a] === k);
      if (!action) return;
      handled();
      const frames = frameRects(st.doc).length;
      switch (action) {
        case "swap":
          return st.swapColors();
        case "brushDown":
          return st.set({ brushSize: Math.max(1, st.brushSize - 1) });
        case "brushUp":
          return st.set({ brushSize: Math.min(16, st.brushSize + 1) });
        case "zoomIn":
          return st.set({ zoom: zoomStep(st.zoom, 1) });
        case "zoomOut":
          return st.set({ zoom: zoomStep(st.zoom, -1) });
        case "fit":
          return st.set({ zoom: 0 });
        case "prevFrame":
          return frames && st.set({ frame: (st.frame - 1 + frames) % frames, playing: false });
        case "nextFrame":
          return frames && st.set({ frame: (st.frame + 1) % frames, playing: false });
        case "play":
          return frames > 1 && st.set({ playing: !st.playing });
        case "tileMode":
          return st.set({ tileMode: !st.tileMode, zoom: 0 });
        case "tileGrid":
          return st.set({ tileGrid: !st.tileGrid });
        case "pixelGrid":
          return st.set({ pixelGrid: !st.pixelGrid });
        default:
          return st.setTool(action);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [map]);
}
