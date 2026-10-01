import { useEffect, useMemo, useState } from "react";

import type { AssetInfo } from "../../shared/ipc";
import { useAssetUrl } from "../components/views/assetImages";
import { useProjectStore } from "../state/projectStore";
import ArtCanvas, { zoomStep } from "./ArtCanvas";
import ArtIcon from "./ArtIcons";
import { type ArtKind, type ArtTool, blankImage, useArtStore } from "./artStore";
import { type Pt, type RGBA, colorsUsed, encodePng, flipRegion, fromHex, tilesOverLimit, toGbaColor, toHex } from "./pixels";
import "./ArtEditor.css";

const SECTIONS: { kind: ArtKind; label: string }[] = [
  { kind: "backgrounds", label: "Backgrounds" },
  { kind: "sprites", label: "Sprites" },
  { kind: "fonts", label: "Fonts" },
  { kind: "frames", label: "Dialogue Frames" },
];

const TOOLS: { id: ArtTool; label: string; key: string }[] = [
  { id: "pencil", label: "Pencil", key: "B" },
  { id: "eraser", label: "Eraser", key: "E" },
  { id: "fill", label: "Fill", key: "G" },
  { id: "line", label: "Line", key: "L" },
  { id: "rect", label: "Rectangle", key: "U" },
  { id: "ellipse", label: "Ellipse", key: "O" },
  { id: "picker", label: "Colour picker", key: "I" },
  { id: "select", label: "Select", key: "M" },
  { id: "move", label: "Move selection", key: "V" },
  { id: "pan", label: "Hand (pan)", key: "H" },
];

const TOOL_HELP: Record<ArtTool, string> = {
  pencil: "Left click: primary colour, right click: secondary. Shift+click draws a line from the last point. Alt+click picks a colour.",
  eraser: "Erases to transparent.",
  fill: "Fills the area of the clicked colour. Global fills that colour everywhere.",
  line: "Drag to draw. Shift snaps to 45°.",
  rect: "Drag to draw. Shift makes a square.",
  ellipse: "Drag to draw. Shift makes a circle.",
  picker: "Left click sets the primary colour, right click the secondary.",
  select: "Drag to select. Drag inside the selection to move it. Ctrl+C / Ctrl+X / Ctrl+V, Delete clears, Esc deselects.",
  move: "Drag the selection (or arrow keys, Shift = 8 px). Enter or Esc drops it.",
  pan: "Drag to move around. Space+drag or middle-drag work with any tool.",
};

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

  const openAsset = async (asset: AssetInfo, kind: ArtKind) => {
    const st = useArtStore.getState();
    if (st.doc?.asset.relPath === asset.relPath) return;
    if (!(await resolveUnsaved())) return;
    await st.open(asset, kind);
  };

  useArtShortcuts();

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

      <ToolStrip />

      <section className="art-main">
        <OptionsBar hover={hover} />
        {doc ? (
          <ArtCanvas onHover={setHover} />
        ) : (
          <div className="art-empty">
            {loading ? "Opening…" : error ? error : "Pick an image on the left to edit it, or make a new one with + New."}
          </div>
        )}
        <PaletteBar />
      </section>

      {newOpen && <NewImageDialog onClose={() => setNewOpen(false)} />}
    </div>
  );
}

/** Before leaving an image with unsaved changes: save, discard, or stay.
 * Returns whether it's OK to move on. */
export async function resolveUnsaved(): Promise<boolean> {
  const st = useArtStore.getState();
  if (!st.dirty || !st.doc) return true;
  const name = st.doc.asset.fileName;
  if (window.confirm(`${name} has unsaved changes.\n\nOK = Save them\nCancel = more choices`)) return st.save();
  return window.confirm(`Discard your changes to ${name}?\n\nOK = Discard\nCancel = Keep editing`);
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

function ToolStrip() {
  const tool = useArtStore((s) => s.tool);
  const primary = useArtStore((s) => s.primary);
  const secondary = useArtStore((s) => s.secondary);
  const st = useArtStore.getState();
  return (
    <nav className="art-tools">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`art-tool${tool === t.id ? " art-tool-on" : ""}`}
          onClick={() => st.setTool(t.id)}
          title={`${t.label} (${t.key})\n${TOOL_HELP[t.id]}`}
        >
          <ArtIcon name={t.id} />
        </button>
      ))}
      <div className="art-tool-colors" title="Primary (left click) and secondary (right click) colours. X swaps them.">
        <ColorSwatch color={primary} onPick={(c) => st.set({ primary: c })} className="art-color-primary" />
        <ColorSwatch color={secondary} onPick={(c) => st.set({ secondary: c })} className="art-color-secondary" />
      </div>
      <button className="art-tool art-tool-small" onClick={() => st.swapColors()} title="Swap colours (X)">
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
      {color[3] === 0 && <span className="art-swatch-clear" />}
      <input type="color" value={toHex(color)} onChange={(e) => onPick(fromHex(e.target.value))} />
    </label>
  );
}

// ---------------------------------------------------------------------------

function OptionsBar({ hover }: { hover: Pt | null }) {
  const s = useArtStore();
  const doc = s.doc;
  const toggle = (key: "mirrorX" | "mirrorY" | "fillGlobal" | "shapeFilled" | "pixelGrid" | "tileGrid", label: string, title: string) => (
    <label className="art-opt" title={title}>
      <input type="checkbox" checked={s[key]} onChange={(e) => s.set({ [key]: e.target.checked })} />
      {label}
    </label>
  );
  const zoomTo = (z: number) => s.set({ zoom: Math.max(1, Math.min(64, z)) });
  return (
    <div className="art-options">
      <span className="art-doc-name">
        {doc ? doc.asset.fileName : "No image"}
        {s.dirty && <span className="art-asset-dirty"> ●</span>}
        {doc && <span className="art-doc-size">{doc.image.width}×{doc.image.height}</span>}
      </span>
      {(s.tool === "pencil" || s.tool === "eraser" || s.tool === "line") && (
        <label className="art-opt" title="Brush size ([ and ])">
          Size
          <input
            type="range"
            min={1}
            max={16}
            value={s.brushSize}
            onChange={(e) => s.set({ brushSize: Number(e.target.value) })}
          />
          <span className="art-opt-value">{s.brushSize}</span>
        </label>
      )}
      {s.tool === "fill" && toggle("fillGlobal", "Global", "Fill every pixel of the clicked colour, not just the connected area")}
      {(s.tool === "rect" || s.tool === "ellipse") && toggle("shapeFilled", "Filled", "Draw filled shapes")}
      {(s.tool === "pencil" || s.tool === "eraser" || s.tool === "line" || s.tool === "rect" || s.tool === "ellipse" || s.tool === "fill") && (
        <>
          {toggle("mirrorX", "Mirror ↔", "Draw mirrored left/right around the image's centre")}
          {toggle("mirrorY", "Mirror ↕", "Draw mirrored up/down around the image's centre")}
        </>
      )}
      {s.selection && (
        <span className="art-opt-group">
          <button className="btn btn-small" onClick={() => flipSelection(true)} title="Flip the selection left/right">
            Flip ↔
          </button>
          <button className="btn btn-small" onClick={() => flipSelection(false)} title="Flip the selection up/down">
            Flip ↕
          </button>
        </span>
      )}
      <span className="art-options-spacer" />
      {toggle("pixelGrid", "Pixel grid", "Lines between pixels (from 8x zoom)")}
      {toggle("tileGrid", "8×8 tiles", "The GBA's 8x8 tile boundaries")}
      <span className="art-zoom">
        <button className="icon-btn" onClick={() => zoomTo(zoomStep(s.zoom, -1))} title="Zoom out (-)">
          −
        </button>
        <button className="art-zoom-value" onClick={() => s.set({ zoom: 0 })} title="Fit to the window (0)">
          {s.zoom}x
        </button>
        <button className="icon-btn" onClick={() => zoomTo(zoomStep(s.zoom, 1))} title="Zoom in (+)">
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

function flipSelection(horizontal: boolean) {
  const st = useArtStore.getState();
  if (!st.selection) return;
  if (!st.floating) st.lift();
  const f = useArtStore.getState().floating;
  if (!f) return;
  st.set({ floating: { ...f, image: flipRegion(f.image, horizontal) } });
  st.touch();
}

// ---------------------------------------------------------------------------

/** The bottom bar: every colour the image uses, with the GBA's limits. */
function PaletteBar() {
  const doc = useArtStore((s) => s.doc);
  const version = useArtStore((s) => s.doc?.version);
  const primary = useArtStore((s) => s.primary);
  const secondary = useArtStore((s) => s.secondary);
  const [stats, setStats] = useState<{ colors: { color: RGBA; count: number }[]; transparent: number; tilesOver: number } | null>(null);

  // Counting a big background takes a moment: do it shortly after edits stop.
  useEffect(() => {
    if (!doc) {
      setStats(null);
      return;
    }
    const t = setTimeout(() => {
      const used = colorsUsed(doc.image);
      const backdrop = used.transparent > 0 ? null : (used.colors[0]?.color ?? null);
      setStats({ ...used, tilesOver: doc.kind === "backgrounds" ? tilesOverLimit(doc.image, backdrop) : 0 });
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

  const isSel = (c: RGBA, sel: RGBA) => c[0] === sel[0] && c[1] === sel[1] && c[2] === sel[2] && sel[3] !== 0;
  const offGba = stats?.colors.some(({ color }) => toHex(toGbaColor(color)) !== toHex(color)) ?? false;

  return (
    <div className="art-palette">
      <div className={`art-palette-info${over ? " art-palette-over" : ""}`}>
        <span>{doc ? limit : "Palette"}</span>
        {offGba && (
          <span
            className="art-palette-note"
            title="The GBA has 5 bits per colour channel, so some colours will look very slightly different in the game. Snap rounds them now."
          >
            Some colours aren't exact GBA colours
          </span>
        )}
        {doc && offGba && (
          <button className="link-btn" onClick={() => snapToGba()}>
            Snap to GBA colours
          </button>
        )}
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
        {stats?.colors.map(({ color, count }) => (
          <button
            key={toHex(color)}
            className={`art-swatch${isSel(color, primary) ? " art-swatch-primary" : ""}${isSel(color, secondary) ? " art-swatch-secondary" : ""}`}
            style={{ background: toHex(color) }}
            title={`${toHex(color)} - ${count} px\nLeft click: primary, right click: secondary`}
            onClick={() => st.set({ primary: color })}
            onContextMenu={(e) => {
              e.preventDefault();
              st.set({ secondary: color });
            }}
          />
        ))}
      </div>
    </div>
  );
}

function snapToGba() {
  const st = useArtStore.getState();
  const doc = st.doc;
  if (!doc) return;
  st.checkpoint();
  const d = doc.image.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const c = toGbaColor([d[i], d[i + 1], d[i + 2], d[i + 3]]);
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
  }
  st.touch();
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
    const st = useArtStore.getState();
    if (!(await resolveUnsaved())) return;
    setBusy(true);
    const image = blankImage(w, h, kind === "backgrounds" ? fromHex(fill) : null);
    const relPath = `assets/${kind}/${stem}.png`;
    const r = await window.api.saveImage({ rootPath, relPath, pngBase64: await encodePng(image), overwrite: false });
    setBusy(false);
    if (!r.ok) return setError(r.error);
    useProjectStore.setState({ assets: r.value });
    const asset = (r.value[kind] as AssetInfo[]).find((a) => a.relPath === relPath);
    if (asset) st.openNew(asset, kind, image);
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

/** Pixelorama-style single-key tool shortcuts, plus the usual Ctrl ones. */
function useArtShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
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
      if (!st.doc) return;
      const tool = TOOLS.find((x) => x.key.toLowerCase() === k);
      if (tool && !e.altKey) return handled(), st.setTool(tool.id);
      if (k === "x") return handled(), st.swapColors();
      if (k === "[") return handled(), st.set({ brushSize: Math.max(1, st.brushSize - 1) });
      if (k === "]") return handled(), st.set({ brushSize: Math.min(16, st.brushSize + 1) });
      if (k === "+" || k === "=") return handled(), st.set({ zoom: zoomStep(st.zoom, 1) });
      if (k === "-") return handled(), st.set({ zoom: zoomStep(st.zoom, -1) });
      if (k === "0") return handled(), st.set({ zoom: 0 });
      if (e.key === "Delete" || e.key === "Backspace") return handled(), st.deleteSelection();
      if (e.key === "Escape" || e.key === "Enter") return handled(), e.key === "Escape" ? st.deselect() : st.commitFloating();
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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
