/**
 * The centre canvas for a tile-composed ("metasprite") frame. A port of GB
 * Studio's components/sprites/MetaspriteEditor.tsx + MetaspriteGrid.tsx
 * (MIT), adjusted only for Shimmer Engine's y-down, canvas-top-left pixel
 * coordinates:
 *
 *  - zoom = screen px per SPRITE PIXEL. The canvas is cw*zoom x ch*zoom and
 *    the grid draws a line every `zoom` px (every square = one pixel) with
 *    darker lines every 8px, like MetaspriteGrid's generateGridBackground.
 *  - With a TILES-palette selection active, a 50% "stamp" of the selected
 *    tiles follows the cursor at pixel precision, centred on it
 *    (onMoveCreateCursor) and every mousedown stamps ALL selected tiles as
 *    NEW tiles (onCreateTiles) - nothing is ever overwritten, and the
 *    palette selection stays active so you can keep stamping. Escape clears.
 *    If the cursor is over an already-placed tile instead, that mousedown
 *    deletes just that tile (onDeleteTile) rather than stamping on top of
 *    it - see eraseTarget below, highlighted via Metasprite.css's
 *    .ms-tile-erase-target/.ms-scroll-erasing.
 *  - Without a palette selection: mousedown on a tile selects it (shift
 *    toggles), dragging moves the whole selection pixel by pixel;
 *    mousedown on empty space starts a marquee; arrows nudge 1px (shift
 *    8px); X/Z flip; Delete/Backspace remove; Ctrl/Cmd+A selects all.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import type { CollisionBoxJSON } from "../../../../shared/projectTypes";
import {
  footprintInCanvas,
  isTypingTarget,
  stampTiles,
  tileAt,
  tileHeightFor,
  type PaletteSelection,
  type SpriteMode,
  type Tile,
} from "./metasprite";
import "./Metasprite.css";

export interface MetaspriteEditorProps {
  url: string | null;
  sheetW: number;
  sheetH: number;
  cw: number;
  ch: number;
  originX: number;
  originY: number;
  mode: SpriteMode;
  zoom: number;
  showGrid: boolean;
  darkBg: boolean;
  showBoundingBox: boolean;
  collisionBox: CollisionBoxJSON;
  tiles: Tile[];
  /** Previous frame, drawn at 50% behind the current one (onion skin). */
  onionTiles: Tile[] | null;
  /** Playing back / derived Left state / no frame: show only, no editing. */
  readOnly: boolean;
  paletteSel: PaletteSelection | null;
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  onStamp: (tiles: Tile[]) => void;
  /** Deletes one placed tile by id - the cursor-over-an-existing-tile
   * case while a palette selection is armed (a left-click eraser: see
   * onAreaMouseDown/eraseTarget below). */
  onDeleteTile: (tileId: string) => void;
  onMoveCommit: (ids: string[], dx: number, dy: number) => void;
  onClearPalette: () => void;
  onNudge: (dx: number, dy: number) => void;
  onFlipX: () => void;
  onFlipY: () => void;
  onRemove: () => void;
  hint?: string | null;
}

interface DragState {
  ids: string[];
  startX: number;
  startY: number;
  dx: number;
  dy: number;
}

interface Marquee {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** One placed tile, rendered as a slice of the sheet image at `zoom`. */
export function TileSlice({
  url,
  sheetW,
  sheetH,
  sheetX,
  sheetY,
  width,
  height,
  flipX,
  flipY,
  zoom,
}: {
  url: string;
  sheetW: number;
  sheetH: number;
  sheetX: number;
  sheetY: number;
  width: number;
  height: number;
  flipX?: boolean;
  flipY?: boolean;
  zoom: number;
}) {
  return (
    <div
      className="ms-slice"
      style={{
        width: width * zoom,
        height: height * zoom,
        backgroundImage: `url(${url})`,
        backgroundSize: `${sheetW * zoom}px ${sheetH * zoom}px`,
        backgroundPosition: `${-sheetX * 8 * zoom}px ${-sheetY * 8 * zoom}px`,
        transform: flipX || flipY ? `scale(${flipX ? -1 : 1}, ${flipY ? -1 : 1})` : undefined,
      }}
    />
  );
}

/** GB Studio MetaspriteGrid's pixel grid: a line every `zoom` px (one per
 * sprite pixel) plus darker lines every 8px (tile boundaries). */
function gridBackground(zoom: number, dark: boolean): { backgroundImage: string; backgroundSize: string } {
  // Drawn OVER the tiles (translucent), so every sprite pixel reads as its
  // own grid square even where art covers the canvas.
  const pix = dark ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.12)";
  const tile = dark ? "rgba(255,255,255,0.32)" : "rgba(0,0,0,0.34)";
  const layers = [
    `linear-gradient(to right, ${tile} 1px, transparent 1px)`,
    `linear-gradient(to bottom, ${tile} 1px, transparent 1px)`,
  ];
  const sizes = [`${8 * zoom}px ${8 * zoom}px`, `${8 * zoom}px ${8 * zoom}px`];
  if (zoom >= 3) {
    layers.push(`linear-gradient(to right, ${pix} 1px, transparent 1px)`, `linear-gradient(to bottom, ${pix} 1px, transparent 1px)`);
    sizes.push(`${zoom}px ${zoom}px`, `${zoom}px ${zoom}px`);
  }
  return { backgroundImage: layers.join(", "), backgroundSize: sizes.join(", ") };
}

/** Canvas-pixel extents the editor must keep visible (canvas + footprint). */
export function editorExtents(cw: number, ch: number, originX: number, originY: number) {
  const fp = footprintInCanvas(cw, ch, originX, originY);
  const minX = Math.min(0, fp.x);
  const minY = Math.min(0, fp.y);
  const maxX = Math.max(cw, fp.x + 16);
  const maxY = Math.max(ch, fp.y + 16);
  return { minX, minY, maxX, maxY, spanX: maxX - minX, spanY: maxY - minY };
}

/** Screen margin (px) kept around the canvas inside the scroll area. */
export const EDITOR_MARGIN = 40;

export default function MetaspriteEditor(props: MetaspriteEditorProps) {
  const { url, sheetW, sheetH, cw, ch, originX, originY, mode, zoom, tiles, paletteSel, selectedIds, readOnly } = props;
  const th = tileHeightFor(mode);
  const gridRef = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  latest.current = props;

  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [marquee, setMarquee] = useState<Marquee | null>(null);
  const marqueeRef = useRef<Marquee | null>(null);

  const toCanvas = useCallback((clientX: number, clientY: number) => {
    const r = gridRef.current!.getBoundingClientRect();
    const z = latest.current.zoom;
    return { x: (clientX - r.left) / z, y: (clientY - r.top) / z };
  }, []);

  /** GB Studio's onMoveCreateCursor: the stamp is centred on the cursor. */
  const stampOriginAt = useCallback(
    (pt: { x: number; y: number }, sel: PaletteSelection) => ({
      x: Math.floor(pt.x - (sel.width * 8) / 2),
      y: Math.floor(pt.y - (sel.height * th) / 2),
    }),
    [th],
  );
  /** Stamping is live while the stamp would overlap the canvas at all. */
  const stampOverlapsCanvas = (o: { x: number; y: number }, sel: PaletteSelection) =>
    o.x < cw && o.x + sel.width * 8 > 0 && o.y < ch && o.y + sel.height * th > 0;

  /** Placed tile the cursor is over while a palette selection is armed -
   * a click here deletes it instead of stamping a new tile on top (see
   * onAreaMouseDown and MetaspriteEditorProps.onDeleteTile). */
  const eraseTarget = paletteSel && hover && !readOnly ? tileAt(tiles, hover.x, hover.y, th) : null;

  const stampOrigin = paletteSel && hover && !readOnly && !eraseTarget ? stampOriginAt(hover, paletteSel) : null;
  const stampActive = !!(stampOrigin && paletteSel && stampOverlapsCanvas(stampOrigin, paletteSel));

  const blurFocus = () => {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body && el.blur) el.blur();
  };

  // ---- Background mousedown: stamp (palette selection) or marquee --------
  const onAreaMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || readOnly || !gridRef.current) return;
    const pt = toCanvas(e.clientX, e.clientY);
    if (paletteSel) {
      const hit = tileAt(tiles, pt.x, pt.y, th);
      if (hit) {
        e.preventDefault();
        blurFocus();
        props.onDeleteTile(hit.id);
        return;
      }
      const o = stampOriginAt(pt, paletteSel);
      if (!stampOverlapsCanvas(o, paletteSel)) return;
      e.preventDefault();
      blurFocus();
      props.onStamp(stampTiles(paletteSel, o.x, o.y, mode));
      return;
    }
    e.preventDefault();
    blurFocus();
    const m = { x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y };
    marqueeRef.current = m;
    setMarquee(m);
    if (!e.shiftKey) props.onSelectIds([]);
  };

  // ---- Tile mousedown: select / toggle / start moving --------------------
  const onTileMouseDown = (tileId: string) => (e: React.MouseEvent) => {
    if (e.button !== 0 || readOnly || paletteSel) return;
    e.stopPropagation();
    e.preventDefault();
    blurFocus();
    if (e.shiftKey) {
      // GB Studio's toggleSelectedMetaspriteTileId (never empties the selection).
      if (selectedIds.includes(tileId)) {
        if (selectedIds.length > 1) props.onSelectIds(selectedIds.filter((id) => id !== tileId));
      } else {
        props.onSelectIds([...selectedIds, tileId]);
      }
      return;
    }
    let ids = selectedIds;
    if (!selectedIds.includes(tileId)) {
      ids = [tileId];
      props.onSelectIds(ids);
    }
    const d = { ids, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0 };
    dragRef.current = d;
    setDrag(d);
  };

  const dragging = !!drag;
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const z = latest.current.zoom;
      const dx = Math.round((e.clientX - d.startX) / z);
      const dy = Math.round((e.clientY - d.startY) / z);
      if (dx === d.dx && dy === d.dy) return;
      const next = { ...d, dx, dy };
      dragRef.current = next;
      setDrag(next);
    };
    const onUp = () => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      // One store write (= one undo step) for the whole drag.
      if (d && (d.dx !== 0 || d.dy !== 0)) latest.current.onMoveCommit(d.ids, d.dx, d.dy);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  const selecting = !!marquee;
  useEffect(() => {
    if (!selecting) return;
    const onMove = (e: MouseEvent) => {
      const m = marqueeRef.current;
      if (!m || !gridRef.current) return;
      const pt = toCanvas(e.clientX, e.clientY);
      const next = { ...m, x1: pt.x, y1: pt.y };
      marqueeRef.current = next;
      setMarquee(next);
      const x1 = Math.min(next.x0, next.x1);
      const x2 = Math.max(next.x0, next.x1);
      const y1 = Math.min(next.y0, next.y1);
      const y2 = Math.max(next.y0, next.y1);
      const p = latest.current;
      const h = tileHeightFor(p.mode);
      const ids = p.tiles.filter((t) => t.x + 8 > x1 && t.x < x2 && t.y + h > y1 && t.y < y2).map((t) => t.id);
      const cur = p.selectedIds;
      if (ids.length !== cur.length || ids.some((id, i) => cur[i] !== id)) p.onSelectIds(ids);
    };
    const onUp = () => {
      marqueeRef.current = null;
      setMarquee(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [selecting, toCanvas]);

  // ---- Keyboard (GB Studio MetaspriteEditor.onKeyDown) -------------------
  useEffect(() => {
    if (readOnly) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const p = latest.current;
      const key = e.key;
      if (e.ctrlKey || e.metaKey) {
        if (key.toLowerCase() === "a" && p.tiles.length > 0) {
          e.preventDefault();
          p.onSelectIds(p.tiles.map((t) => t.id));
        }
        return;
      }
      if (key === "Escape") {
        p.onClearPalette();
        p.onSelectIds([]);
        return;
      }
      if (p.selectedIds.length === 0) return;
      let nx = 0;
      let ny = 0;
      if (key === "ArrowUp") ny = -1;
      else if (key === "ArrowDown") ny = 1;
      else if (key === "ArrowLeft") nx = -1;
      else if (key === "ArrowRight") nx = 1;
      if (nx || ny) {
        e.preventDefault();
        const step = e.shiftKey ? 8 : 1;
        p.onNudge(nx * step, ny * step);
        return;
      }
      const k = key.toLowerCase();
      if (k === "x") {
        e.preventDefault();
        p.onFlipX();
      } else if (k === "z") {
        e.preventDefault();
        p.onFlipY();
      } else if (key === "Backspace" || key === "Delete") {
        e.preventDefault();
        p.onRemove();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [readOnly]);

  // Stop an in-progress drag/marquee if editing becomes disabled.
  useEffect(() => {
    if (readOnly) {
      dragRef.current = null;
      marqueeRef.current = null;
      setDrag(null);
      setMarquee(null);
    }
  }, [readOnly]);

  const ext = editorExtents(cw, ch, originX, originY);
  const fp = footprintInCanvas(cw, ch, originX, originY);
  const box = props.collisionBox;
  const grid = props.showGrid ? gridBackground(zoom, props.darkBg) : null;
  const innerW = ext.spanX * zoom + EDITOR_MARGIN * 2;
  const innerH = ext.spanY * zoom + EDITOR_MARGIN * 2;

  return (
    <div
      className={`ms-scroll${stampActive ? " ms-scroll-stamping" : eraseTarget ? " ms-scroll-erasing" : ""}`}
      data-testid="ms-scroll"
      onMouseDown={onAreaMouseDown}
      onMouseMove={(e) => {
        if (gridRef.current) setHover(toCanvas(e.clientX, e.clientY));
      }}
      onMouseLeave={() => setHover(null)}
    >
      <div className="ms-center">
        <div className="ms-inner" style={{ width: innerW, height: innerH }}>
          <div
            ref={gridRef}
            className={`ms-canvas${props.darkBg ? " ms-canvas-dark" : ""}`}
            data-testid="ms-canvas"
            data-zoom={zoom}
            style={{
              left: EDITOR_MARGIN - ext.minX * zoom,
              top: EDITOR_MARGIN - ext.minY * zoom,
              width: cw * zoom,
              height: ch * zoom,
            }}
          >
            <div
              className="ms-footprint"
              title="Actor position (16x16 collision cell)"
              style={{ left: fp.x * zoom, top: fp.y * zoom, width: 16 * zoom, height: 16 * zoom }}
            />
            {url && props.onionTiles && (
              <div className="ms-onion">
                {props.onionTiles.map((t) => (
                  <div key={t.id} className="ms-tile-static" style={{ left: t.x * zoom, top: t.y * zoom }}>
                    <TileSlice url={url} sheetW={sheetW} sheetH={sheetH} sheetX={t.sheetX} sheetY={t.sheetY} width={8} height={th} flipX={t.flipX} flipY={t.flipY} zoom={zoom} />
                  </div>
                ))}
              </div>
            )}
            {url &&
              tiles.map((t) => {
                const moving = drag && drag.ids.includes(t.id);
                const x = t.x + (moving ? drag!.dx : 0);
                const y = t.y + (moving ? drag!.dy : 0);
                const sel = selectedIds.includes(t.id);
                const erasing = eraseTarget?.id === t.id;
                return (
                  <div
                    key={t.id}
                    className={`ms-tile${sel ? " ms-tile-selected" : ""}${erasing ? " ms-tile-erase-target" : ""}`}
                    data-testid="ms-tile"
                    data-id={t.id}
                    style={{
                      left: x * zoom,
                      top: y * zoom,
                      width: 8 * zoom,
                      height: th * zoom,
                      pointerEvents: paletteSel || readOnly ? "none" : "auto",
                    }}
                    title={`x ${x}, y ${y} - sheet tile (${t.sheetX}, ${t.sheetY})`}
                    onMouseDown={onTileMouseDown(t.id)}
                  >
                    <TileSlice url={url} sheetW={sheetW} sheetH={sheetH} sheetX={t.sheetX} sheetY={t.sheetY} width={8} height={th} flipX={t.flipX} flipY={t.flipY} zoom={zoom} />
                  </div>
                );
              })}
            {grid && <div className="ms-grid" style={grid} />}
            {url && stampActive && stampOrigin && paletteSel && (
              <div
                className="ms-stamp"
                data-testid="ms-stamp"
                style={{ left: stampOrigin.x * zoom, top: stampOrigin.y * zoom }}
              >
                <div
                  className="ms-slice"
                  style={{
                    width: paletteSel.width * 8 * zoom,
                    height: paletteSel.height * th * zoom,
                    backgroundImage: `url(${url})`,
                    backgroundSize: `${sheetW * zoom}px ${sheetH * zoom}px`,
                    backgroundPosition: `${-paletteSel.x * zoom}px ${-paletteSel.y * zoom}px`,
                  }}
                />
              </div>
            )}
            {props.showBoundingBox && (
              <div
                className="ms-bounds"
                title="Collision bounding box"
                style={{
                  left: (fp.x + (box.x ?? 0)) * zoom,
                  top: (fp.y + (box.y ?? 0)) * zoom,
                  width: box.width * zoom,
                  height: box.height * zoom,
                }}
              />
            )}
            {marquee && (
              <div
                className="ms-marquee"
                style={{
                  left: Math.min(marquee.x0, marquee.x1) * zoom,
                  top: Math.min(marquee.y0, marquee.y1) * zoom,
                  width: Math.abs(marquee.x1 - marquee.x0) * zoom,
                  height: Math.abs(marquee.y1 - marquee.y0) * zoom,
                }}
              />
            )}
          </div>
        </div>
      </div>
      {props.hint && <div className="ms-hint">{props.hint}</div>}
    </div>
  );
}
