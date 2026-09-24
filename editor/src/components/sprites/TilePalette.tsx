import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { useSpriteEditor, type PaletteSelection } from "../../sprites/editorStore";
import { trimRegion } from "../../sprites/image";
import { tileSize } from "../../sprites/model";
import { useCurrentSprite } from "./useCurrentSprite";

/** The sprite's PNG: drag to pick a region (8px grid, or 1px in precision
 * mode) - that region is what clicking the canvas places, as one tile of
 * any size. */
export default function TilePalette() {
  const { img, sheet, frame } = useCurrentSprite();
  const ed = useSpriteEditor();
  const ref = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const Z = ed.paletteZoom;
  const grid = ed.precision ? 1 : 8;
  const tileH = sheet?.spriteMode === "8x8" ? 8 : 16;

  const selFrom = (d: { x0: number; y0: number; x1: number; y1: number }): PaletteSelection | null => {
    if (!img) return null;
    const x0 = Math.floor(Math.min(d.x0, d.x1) / grid) * grid;
    const y0 = Math.floor(Math.min(d.y0, d.y1) / grid) * grid;
    let x1 = Math.floor(Math.max(d.x0, d.x1) / grid) * grid + grid;
    let y1 = Math.floor(Math.max(d.y0, d.y1) / grid) * grid + grid;
    // A plain click picks one tile of the sprite mode's size.
    if (!ed.precision && x1 - x0 === 8 && y1 - y0 === 8 && tileH === 16) {
      const ty = Math.floor(y0 / 16) * 16;
      return { x: x0, y: ty, w: 8, h: Math.min(16, img.height - ty) };
    }
    x1 = Math.min(x1, img.width);
    y1 = Math.min(y1, img.height);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  useEffect(() => {
    const c = ref.current;
    if (!c || !img) return;
    c.width = img.width * Z;
    c.height = img.height * Z;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const cell = Math.max(4 * Z, 4);
    for (let y = 0; y < c.height; y += cell)
      for (let x = 0; x < c.width; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) & 1) === 0 ? "#3a3a3a" : "#333333";
        ctx.fillRect(x, y, cell, cell);
      }
    ctx.drawImage(img.canvas, 0, 0, c.width, c.height);
    if (Z >= 2) {
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath();
      for (let x = 8; x < img.width; x += 8) {
        ctx.moveTo(x * Z + 0.5, 0);
        ctx.lineTo(x * Z + 0.5, c.height);
      }
      for (let y = 8; y < img.height; y += 8) {
        ctx.moveTo(0, y * Z + 0.5);
        ctx.lineTo(c.width, y * Z + 0.5);
      }
      ctx.stroke();
    }
    // Where the selected canvas tiles come from.
    for (const t of frame?.tiles ?? []) {
      if (!ed.tileIds.includes(t.id)) continue;
      const { w, h } = tileSize(t, sheet?.spriteMode ?? "8x16");
      ctx.strokeStyle = "rgba(72,199,116,0.9)";
      ctx.lineWidth = 2;
      ctx.strokeRect(t.sliceX * Z + 1, t.sliceY * Z + 1, w * Z - 2, h * Z - 2);
    }
    const sel = drag ? selFrom(drag) : ed.palette;
    if (sel) {
      ctx.fillStyle = "rgba(121,31,255,0.25)";
      ctx.fillRect(sel.x * Z, sel.y * Z, sel.w * Z, sel.h * Z);
      ctx.strokeStyle = "#a36bff";
      ctx.lineWidth = 2;
      ctx.strokeRect(sel.x * Z + 1, sel.y * Z + 1, sel.w * Z - 2, sel.h * Z - 2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [img, Z, drag, ed.palette, ed.precision, ed.tileIds, frame, sheet?.spriteMode]);

  const pos = (e: ReactMouseEvent | MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.max(0, (e.clientX - r.left) / Z), y: Math.max(0, (e.clientY - r.top) / Z) };
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const p = pos(e);
      setDrag((d) => (d ? { ...d, x1: p.x, y1: p.y } : d));
    };
    const up = () => {
      const sel = selFrom(drag);
      ed.set({ palette: sel, tileIds: [] });
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, Z]);

  const trim = () => {
    if (!img || !ed.palette) return;
    const t = trimRegion(img, ed.palette.x, ed.palette.y, ed.palette.w, ed.palette.h);
    if (t) ed.set({ palette: { x: t.x, y: t.y, w: t.w, h: t.h } });
  };

  return (
    <div className="spr-pane spr-tiles">
      <div className="spr-pane-head">
        <span>Tiles</span>
        {ed.palette && (
          <span className="spr-pane-info" data-testid="palette-selection">
            {ed.palette.w}x{ed.palette.h} at {ed.palette.x},{ed.palette.y}
          </span>
        )}
        <span className="spr-spacer" />
        {ed.palette && (
          <button className="spr-tool" onClick={trim} title="Shrink the selection to its visible pixels">
            Trim
          </button>
        )}
        <button
          className={`spr-tool${ed.precision ? " spr-tool-on" : ""}`}
          onClick={() => ed.set({ precision: !ed.precision })}
          title="Precision selection: pick regions to the pixel instead of the 8px grid"
        >
          1px
        </button>
        <button className="spr-tool" onClick={() => ed.set({ paletteZoom: Math.max(1, Z - 1) })} title="Zoom out">
          −
        </button>
        <span className="spr-zoom-label">{Z}x</span>
        <button className="spr-tool" onClick={() => ed.set({ paletteZoom: Math.min(12, Z + 1) })} title="Zoom in">
          +
        </button>
      </div>
      <div className="spr-tiles-scroll">
        {img ? (
          <canvas
            ref={ref}
            className="spr-tiles-canvas"
            style={{ width: img.width * Z, height: img.height * Z }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              const p = pos(e);
              setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            data-testid="sprite-tiles"
          />
        ) : (
          <div className="spr-empty">No image.</div>
        )}
      </div>
    </div>
  );
}
