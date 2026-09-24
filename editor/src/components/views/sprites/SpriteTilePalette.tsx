/**
 * The TILES palette: a port of GB Studio's
 * components/sprites/SpriteTilePalette.tsx (MIT). The sheet image is shown
 * at `zoom` with a green 8px tile grid; mousedown selects the 8px-snapped
 * tile under the cursor and dragging (window mousemove/mouseup, NOT HTML5
 * drag-and-drop) grows a rectangular selection in tile units - height in
 * 8px or 16px rows depending on the sheet's sprite mode. The selection
 * (red box) persists after mouseup; the canvas then stamps it on every
 * click until Escape / the clear button cancels it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { tileHeightFor, type PaletteSelection, type SpriteMode } from "./metasprite";
import "./Metasprite.css";

interface Props {
  url: string | null;
  sheetW: number;
  sheetH: number;
  mode: SpriteMode;
  zoom: number;
  selection: PaletteSelection | null;
  onSelection: (sel: PaletteSelection) => void;
  /** GB Studio's "replace tile" mode: the next click swaps the selected
   * placed tile's source instead of starting a selection. */
  replaceMode?: boolean;
  onReplace?: (sheetX: number, sheetY: number) => void;
  disabled?: boolean;
}

export default function SpriteTilePalette({ url, sheetW, sheetH, mode, zoom, selection, onSelection, replaceMode, onReplace, disabled }: Props) {
  const th = tileHeightFor(mode);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const anchor = useRef<{ x: number; y: number } | null>(null);

  const snapX = useCallback((px: number) => Math.max(0, Math.min(sheetW - 8, Math.floor(px / 8) * 8)), [sheetW]);
  const snapY = useCallback((py: number) => Math.max(0, Math.min(sheetH - th, Math.floor(py / 8) * 8)), [sheetH, th]);

  const offsetOf = useCallback(
    (clientX: number, clientY: number) => {
      const r = wrapperRef.current!.getBoundingClientRect();
      return { x: Math.floor((clientX - r.left) / zoom), y: Math.floor((clientY - r.top) / zoom) };
    },
    [zoom],
  );

  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || disabled || !wrapperRef.current) return;
    e.preventDefault();
    const o = offsetOf(e.clientX, e.clientY);
    const x = snapX(o.x);
    const y = snapY(o.y);
    if (replaceMode && onReplace) {
      onReplace(x / 8, y / 8);
      return;
    }
    anchor.current = { x, y };
    onSelection({ x, y, width: 1, height: 1 });
    setDragging(true);
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const a = anchor.current;
      if (!a || !wrapperRef.current) return;
      const o = offsetOf(e.clientX, e.clientY);
      // Columns: 8px steps from the anchor, either direction, within the sheet.
      let x: number;
      let width: number;
      if (o.x >= a.x) {
        x = a.x;
        width = Math.max(1, Math.min(Math.floor((o.x - a.x) / 8) + 1, Math.floor((sheetW - a.x) / 8)));
      } else {
        const k = Math.min(Math.ceil((a.x - o.x) / 8), Math.floor(a.x / 8));
        x = a.x - k * 8;
        width = k + 1;
      }
      // Rows: sprite-mode-height steps (8 or 16px) from the anchor.
      let y: number;
      let height: number;
      if (o.y >= a.y) {
        y = a.y;
        height = Math.max(1, Math.min(Math.floor((o.y - a.y) / th) + 1, Math.floor((sheetH - a.y) / th)));
      } else {
        const k = Math.min(Math.ceil((a.y - o.y) / th), Math.floor(a.y / th));
        y = a.y - k * th;
        height = k + 1;
      }
      onSelection({ x, y, width, height });
    };
    const onUp = () => {
      setDragging(false);
      anchor.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, offsetOf, onSelection, sheetW, sheetH, th]);

  if (!url || !sheetW || !sheetH) return <div className="ms-palette-scroll" />;

  return (
    <div className="ms-palette-scroll">
      <div
        ref={wrapperRef}
        className={`ms-palette${replaceMode ? " ms-palette-replace" : ""}${disabled ? " ms-palette-disabled" : ""}`}
        data-testid="ms-palette"
        onMouseDown={onMouseDown}
        onMouseMove={(e) => {
          if (!wrapperRef.current) return;
          const o = offsetOf(e.clientX, e.clientY);
          setHover({ x: snapX(o.x), y: snapY(o.y) });
        }}
        onMouseLeave={() => setHover(null)}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          style={{ display: "block", width: sheetW * zoom, height: sheetH * zoom, imageRendering: "pixelated" }}
        />
        <div
          className="ms-palette-grid"
          style={{ width: sheetW * zoom, height: sheetH * zoom, backgroundSize: `${8 * zoom}px ${8 * zoom}px` }}
        />
        {hover && !dragging && (
          <div className="ms-palette-hover" style={{ left: hover.x * zoom, top: hover.y * zoom, width: 8 * zoom, height: th * zoom }} />
        )}
        {selection && (
          <div
            className="ms-palette-selection"
            data-testid="ms-palette-selection"
            style={{
              left: selection.x * zoom,
              top: selection.y * zoom,
              width: selection.width * 8 * zoom,
              height: selection.height * th * zoom,
            }}
          />
        )}
      </div>
    </div>
  );
}
