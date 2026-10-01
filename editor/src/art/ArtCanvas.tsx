import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { useArtStore } from "./artStore";
import {
  type Pt,
  type RGBA,
  brushPoints,
  ellipsePoints,
  floodFill,
  getPixel,
  linePoints,
  mirrored,
  normRect,
  rectPoints,
  setPixel,
  TRANSPARENT,
} from "./pixels";

const MIN_ZOOM = 1;
const MAX_ZOOM = 64;

type Drag =
  | { kind: "draw"; color: RGBA; last: Pt }
  | { kind: "shape"; color: RGBA; start: Pt; end: Pt }
  | { kind: "select"; start: Pt; end: Pt }
  | { kind: "move"; grabX: number; grabY: number }
  | { kind: "pan"; x: number; y: number; ox: number; oy: number };

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * The Art Editor's drawing surface: the open image at any zoom, with
 * checkerboard transparency, pixel and 8x8 tile grids, the selection and
 * shape previews. Left click uses the primary colour, right click the
 * secondary; middle drag, Space+drag or the Hand tool pans; the wheel
 * zooms around the cursor.
 */
export default function ArtCanvas({ onHover }: { onHover: (p: Pt | null) => void }) {
  const doc = useArtStore((s) => s.doc);
  const zoom = useArtStore((s) => s.zoom);
  const tool = useArtStore((s) => s.tool);
  const selection = useArtStore((s) => s.selection);
  const floating = useArtStore((s) => s.floating);
  const pixelGrid = useArtStore((s) => s.pixelGrid);
  const tileGrid = useArtStore((s) => s.tileGrid);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const offscreen = useRef<HTMLCanvasElement | null>(null);
  const floatCanvas = useRef<HTMLCanvasElement | null>(null);
  const lastPoint = useRef<Pt | null>(null);

  // Fit the image when it's opened (zoom 0) or the view is first sized.
  useLayoutEffect(() => {
    if (!doc || size.w === 0 || zoom !== 0) return;
    const fit = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.floor(Math.min((size.w - 40) / doc.image.width, (size.h - 40) / doc.image.height))),
    );
    useArtStore.getState().set({ zoom: fit });
    setPan({ x: Math.round((size.w - doc.image.width * fit) / 2), y: Math.round((size.h - doc.image.height * fit) / 2) });
  }, [doc, size, zoom]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Space held = temporary hand tool (not while typing in a field).
  useEffect(() => {
    const typing = (t: EventTarget | null) => !!t && ["INPUT", "TEXTAREA", "SELECT"].includes((t as HTMLElement).tagName);
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !typing(e.target)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpaceDown(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // The image (and the floating piece) as canvases, redrawn when pixels change.
  useEffect(() => {
    if (!doc) return;
    const c = offscreen.current ?? document.createElement("canvas");
    offscreen.current = c;
    if (c.width !== doc.image.width || c.height !== doc.image.height) {
      c.width = doc.image.width;
      c.height = doc.image.height;
    }
    c.getContext("2d")!.putImageData(new ImageData(doc.image.data, doc.image.width, doc.image.height), 0, 0);
  }, [doc, doc?.version]);

  useEffect(() => {
    if (!floating) return;
    const c = floatCanvas.current ?? document.createElement("canvas");
    floatCanvas.current = c;
    c.width = floating.image.width;
    c.height = floating.image.height;
    c.getContext("2d")!.putImageData(new ImageData(floating.image.data, floating.image.width, floating.image.height), 0, 0);
  }, [floating]);

  const shapePreview = (d: Drag | null): Pt[] => {
    if (!d || d.kind !== "shape" || !doc) return [];
    const st = useArtStore.getState();
    const { start, end } = d;
    let pts: Pt[] =
      st.tool === "line"
        ? linePoints(start.x, start.y, end.x, end.y).flatMap((p) => brushPoints(p.x, p.y, st.brushSize))
        : st.tool === "rect"
          ? rectPoints(start.x, start.y, end.x, end.y, st.shapeFilled)
          : ellipsePoints(start.x, start.y, end.x, end.y, st.shapeFilled);
    pts = pts.flatMap((p) => mirrored(p, doc.image, st.mirrorX, st.mirrorY));
    return pts;
  };

  // ---- Render ----------------------------------------------------------
  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv || !doc || zoom === 0) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(size.w * dpr);
    cv.height = Math.round(size.h * dpr);
    const g = cv.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.imageSmoothingEnabled = false;
    g.fillStyle = cssVar("--canvas-bg", "#333");
    g.fillRect(0, 0, size.w, size.h);

    const W = doc.image.width * zoom;
    const H = doc.image.height * zoom;
    // Checkerboard behind the image (transparency).
    const cell = Math.max(4, Math.min(16, zoom * 4));
    g.save();
    g.beginPath();
    g.rect(pan.x, pan.y, W, H);
    g.clip();
    for (let y = 0; y < H; y += cell)
      for (let x = 0; x < W; x += cell) {
        g.fillStyle = ((x / cell + y / cell) & 1) === 0 ? "#cfcfcf" : "#9e9e9e";
        g.fillRect(pan.x + x, pan.y + y, cell, cell);
      }
    if (offscreen.current) g.drawImage(offscreen.current, pan.x, pan.y, W, H);
    if (floating && floatCanvas.current)
      g.drawImage(floatCanvas.current, pan.x + floating.x * zoom, pan.y + floating.y * zoom, floating.image.width * zoom, floating.image.height * zoom);

    // Shape preview in the drag colour.
    if (drag?.kind === "shape") {
      const c = drag.color;
      g.fillStyle = c[3] === 0 ? "rgba(255,255,255,0.55)" : `rgb(${c[0]},${c[1]},${c[2]})`;
      for (const p of shapePreview(drag)) g.fillRect(pan.x + p.x * zoom, pan.y + p.y * zoom, zoom, zoom);
    }

    // Grids.
    if (pixelGrid && zoom >= 8) {
      g.strokeStyle = "rgba(0,0,0,0.18)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 1; x < doc.image.width; x++) {
        g.moveTo(pan.x + x * zoom + 0.5, pan.y);
        g.lineTo(pan.x + x * zoom + 0.5, pan.y + H);
      }
      for (let y = 1; y < doc.image.height; y++) {
        g.moveTo(pan.x, pan.y + y * zoom + 0.5);
        g.lineTo(pan.x + W, pan.y + y * zoom + 0.5);
      }
      g.stroke();
    }
    if (tileGrid && zoom >= 2) {
      g.strokeStyle = "rgba(255, 210, 63, 0.75)";
      g.lineWidth = 1;
      g.beginPath();
      for (let x = 8; x < doc.image.width; x += 8) {
        g.moveTo(pan.x + x * zoom + 0.5, pan.y);
        g.lineTo(pan.x + x * zoom + 0.5, pan.y + H);
      }
      for (let y = 8; y < doc.image.height; y += 8) {
        g.moveTo(pan.x, pan.y + y * zoom + 0.5);
        g.lineTo(pan.x + W, pan.y + y * zoom + 0.5);
      }
      g.stroke();
    }
    g.restore();

    // Image border.
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.strokeRect(pan.x - 0.5, pan.y - 0.5, W + 1, H + 1);

    // Selection marquee (or the one being dragged out).
    const sel = drag?.kind === "select" ? normRect(drag.start.x, drag.start.y, drag.end.x, drag.end.y) : selection;
    if (sel) {
      const x = pan.x + sel.x * zoom + 0.5;
      const y = pan.y + sel.y * zoom + 0.5;
      g.lineWidth = 1;
      g.setLineDash([4, 4]);
      g.strokeStyle = "#000";
      g.strokeRect(x, y, sel.w * zoom - 1, sel.h * zoom - 1);
      g.lineDashOffset = 4;
      g.strokeStyle = "#fff";
      g.strokeRect(x, y, sel.w * zoom - 1, sel.h * zoom - 1);
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }

    // Brush outline under the cursor.
    const st = useArtStore.getState();
    if (hover && (tool === "pencil" || tool === "eraser") && !spaceDown) {
      const o = Math.floor((st.brushSize - 1) / 2);
      g.strokeStyle = cssVar("--canvas-accent", "#ffd23f");
      g.lineWidth = 1;
      g.strokeRect(pan.x + (hover.x - o) * zoom + 0.5, pan.y + (hover.y - o) * zoom + 0.5, st.brushSize * zoom - 1, st.brushSize * zoom - 1);
    }
    // doc.version isn't read here but must trigger a redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, doc?.version, zoom, pan, size, drag, hover, selection, floating, pixelGrid, tileGrid, tool, spaceDown]);

  // ---- Input -----------------------------------------------------------
  const toPixel = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const r = canvasRef.current!.getBoundingClientRect();
      return { x: Math.floor((e.clientX - r.left - pan.x) / zoom), y: Math.floor((e.clientY - r.top - pan.y) / zoom) };
    },
    [pan, zoom],
  );

  const paint = (pts: Pt[], color: RGBA) => {
    const st = useArtStore.getState();
    if (!st.doc) return;
    for (const p of pts) for (const m of mirrored(p, st.doc.image, st.mirrorX, st.mirrorY)) setPixel(st.doc.image, m.x, m.y, color);
  };

  const inImage = (p: Pt) => !!doc && p.x >= 0 && p.y >= 0 && p.x < doc.image.width && p.y < doc.image.height;

  const onMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!doc) return;
    e.preventDefault();
    canvasRef.current?.focus();
    const st = useArtStore.getState();
    if (e.button === 1 || spaceDown || st.tool === "pan") {
      setDrag({ kind: "pan", x: e.clientX, y: e.clientY, ox: pan.x, oy: pan.y });
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const p = toPixel(e);
    const color = e.button === 2 ? st.secondary : st.primary;
    const t = st.tool;

    // Alt+click with a drawing tool picks a colour, like Pixelorama.
    if (t === "picker" || (e.altKey && (t === "pencil" || t === "fill" || t === "line" || t === "rect" || t === "ellipse"))) {
      if (inImage(p)) st.set(e.button === 2 ? { secondary: getPixel(doc.image, p.x, p.y) } : { primary: getPixel(doc.image, p.x, p.y) });
      return;
    }

    if (t === "pencil" || t === "eraser") {
      const c = t === "eraser" ? TRANSPARENT : color;
      st.checkpoint();
      // Shift+click: a straight line from the last point drawn.
      const from = e.shiftKey && lastPoint.current ? lastPoint.current : p;
      paint(
        linePoints(from.x, from.y, p.x, p.y).flatMap((q) => brushPoints(q.x, q.y, st.brushSize)),
        c,
      );
      lastPoint.current = p;
      st.touch();
      setDrag({ kind: "draw", color: c, last: p });
      return;
    }
    if (t === "fill") {
      if (!inImage(p)) return;
      st.checkpoint();
      const changed = floodFill(doc.image, p.x, p.y, color, st.fillGlobal);
      if (changed && (st.mirrorX || st.mirrorY))
        for (const m of mirrored(p, doc.image, st.mirrorX, st.mirrorY).slice(1)) floodFill(doc.image, m.x, m.y, color, st.fillGlobal);
      if (changed) st.touch();
      else st.set({ past: st.past, stateId: st.stateId, dirty: st.dirty });
      return;
    }
    if (t === "line" || t === "rect" || t === "ellipse") {
      setDrag({ kind: "shape", color, start: p, end: p });
      return;
    }
    if (t === "select" || t === "move") {
      const sel = st.selection;
      const inside = sel && p.x >= sel.x && p.y >= sel.y && p.x < sel.x + sel.w && p.y < sel.y + sel.h;
      if (inside || (t === "move" && sel)) {
        if (!st.floating) st.lift();
        const f = useArtStore.getState().floating;
        if (f) setDrag({ kind: "move", grabX: p.x - f.x, grabY: p.y - f.y });
        return;
      }
      if (t === "select") {
        st.commitFloating();
        st.set({ selection: null });
        setDrag({ kind: "select", start: p, end: p });
      }
    }
  };

  const onMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (!doc) return;
    const p = toPixel(e);
    const h = inImage(p) ? p : null;
    if (h?.x !== hover?.x || h?.y !== hover?.y) {
      setHover(h);
      onHover(h);
    }
    if (!drag) return;
    const st = useArtStore.getState();
    if (drag.kind === "pan") {
      setPan({ x: drag.ox + e.clientX - drag.x, y: drag.oy + e.clientY - drag.y });
    } else if (drag.kind === "draw") {
      if (p.x === drag.last.x && p.y === drag.last.y) return;
      paint(
        linePoints(drag.last.x, drag.last.y, p.x, p.y).flatMap((q) => brushPoints(q.x, q.y, st.brushSize)),
        drag.color,
      );
      lastPoint.current = p;
      st.touch();
      setDrag({ ...drag, last: p });
    } else if (drag.kind === "shape") {
      let end = p;
      // Shift: perfect squares/circles, and 45-degree lines.
      if (e.shiftKey) {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        if (st.tool === "line") {
          if (Math.abs(dx) > Math.abs(dy) * 2) end = { x: p.x, y: drag.start.y };
          else if (Math.abs(dy) > Math.abs(dx) * 2) end = { x: drag.start.x, y: p.y };
          else {
            const d = Math.max(Math.abs(dx), Math.abs(dy));
            end = { x: drag.start.x + Math.sign(dx) * d, y: drag.start.y + Math.sign(dy) * d };
          }
        } else {
          const d = Math.max(Math.abs(dx), Math.abs(dy));
          end = { x: drag.start.x + (Math.sign(dx) || 1) * d, y: drag.start.y + (Math.sign(dy) || 1) * d };
        }
      }
      if (end.x !== drag.end.x || end.y !== drag.end.y) setDrag({ ...drag, end });
    } else if (drag.kind === "select") {
      const end = { x: Math.max(0, Math.min(doc.image.width - 1, p.x)), y: Math.max(0, Math.min(doc.image.height - 1, p.y)) };
      if (end.x !== drag.end.x || end.y !== drag.end.y) setDrag({ ...drag, end });
    } else if (drag.kind === "move") {
      const f = st.floating;
      const sel = st.selection;
      if (!f || !sel) return;
      const x = p.x - drag.grabX;
      const y = p.y - drag.grabY;
      if (x !== f.x || y !== f.y) st.set({ floating: { ...f, x, y }, selection: { ...sel, x, y } });
    }
  };

  const finish = () => {
    if (!drag || !doc) {
      setDrag(null);
      return;
    }
    const st = useArtStore.getState();
    if (drag.kind === "shape") {
      st.checkpoint();
      for (const p of shapePreview(drag)) setPixel(doc.image, p.x, p.y, drag.color);
      st.touch();
    } else if (drag.kind === "select") {
      const start = { x: Math.max(0, Math.min(doc.image.width - 1, drag.start.x)), y: Math.max(0, Math.min(doc.image.height - 1, drag.start.y)) };
      st.set({ selection: normRect(start.x, start.y, drag.end.x, drag.end.y) });
    }
    setDrag(null);
  };

  // Releasing the mouse anywhere (even outside the canvas) ends the drag.
  const finishRef = useRef(finish);
  finishRef.current = finish;
  useEffect(() => {
    if (!drag) return;
    const up = () => finishRef.current();
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [drag]);

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!doc) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, e.deltaY < 0 ? zoomStep(zoom, 1) : zoomStep(zoom, -1)));
    if (next === zoom) return;
    // Keep the pixel under the cursor where it is.
    setPan({ x: Math.round(mx - ((mx - pan.x) / zoom) * next), y: Math.round(my - ((my - pan.y) / zoom) * next) });
    useArtStore.getState().set({ zoom: next });
  };

  const cursor =
    drag?.kind === "pan" ? "grabbing" : spaceDown || tool === "pan" ? "grab" : tool === "move" ? "move" : tool === "picker" ? "copy" : "crosshair";

  return (
    <div ref={wrapRef} className="art-canvas-wrap">
      <canvas
        ref={canvasRef}
        className="art-canvas"
        style={{ width: size.w, height: size.h, cursor }}
        tabIndex={0}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={() => {
          setHover(null);
          onHover(null);
        }}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
      />
    </div>
  );
}

/** Next zoom level up (+1) or down (-1): 1,2,3,4,6,8,12,16,24,32,48,64. */
export function zoomStep(zoom: number, dir: 1 | -1): number {
  const steps = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64];
  if (dir > 0) return steps.find((s) => s > zoom) ?? 64;
  return [...steps].reverse().find((s) => s < zoom) ?? 1;
}
