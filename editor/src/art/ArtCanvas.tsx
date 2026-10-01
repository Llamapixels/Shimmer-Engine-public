import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { activeLayer, flattenDoc, frameRects, useArtStore } from "./artStore";
import { gradient, shadeColor } from "./effects";
import {
  type Bitmap,
  type Pt,
  type RGBA,
  brushPoints,
  colorsUsed,
  ellipsePoints,
  floodFill,
  getPixel,
  linePoints,
  mirrored,
  normRect,
  rectPoints,
  setPixel,
  stamp,
  TRANSPARENT,
} from "./pixels";

const MIN_ZOOM = 1;
const MAX_ZOOM = 64;

type Drag =
  | { kind: "draw"; color: RGBA; alt: RGBA; last: Pt; path: Pt[]; orig: Map<number, RGBA> }
  | { kind: "shade"; dir: 1 | -1; ramp: RGBA[]; last: Pt; done: Set<number> }
  | { kind: "stamp"; last: Pt }
  | { kind: "shape"; color: RGBA; start: Pt; end: Pt }
  | { kind: "gradient"; start: Pt; end: Pt; reverse: boolean }
  | { kind: "select"; start: Pt; end: Pt }
  | { kind: "move"; grabX: number; grabY: number }
  | { kind: "pan"; x: number; y: number; ox: number; oy: number };

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function bitmapCanvas(b: Bitmap, reuse?: HTMLCanvasElement | null): HTMLCanvasElement {
  const c = reuse ?? document.createElement("canvas");
  if (c.width !== b.width || c.height !== b.height) {
    c.width = b.width;
    c.height = b.height;
  }
  c.getContext("2d")!.putImageData(new ImageData(b.data, b.width, b.height), 0, 0);
  return c;
}

/**
 * The Art Editor's drawing surface: every layer at any zoom, with
 * checkerboard transparency, pixel and 8x8 tile grids, frames and onion
 * skin, tile mode, the selection and shape previews. Left click uses the
 * primary colour, right click the secondary; middle drag, Space+drag or
 * the Hand tool pans; the wheel zooms around the cursor.
 */
export default function ArtCanvas({ onHover }: { onHover: (p: Pt | null) => void }) {
  const doc = useArtStore((s) => s.doc);
  const zoom = useArtStore((s) => s.zoom);
  const tool = useArtStore((s) => s.tool);
  const selection = useArtStore((s) => s.selection);
  const floating = useArtStore((s) => s.floating);
  const pixelGrid = useArtStore((s) => s.pixelGrid);
  const tileGrid = useArtStore((s) => s.tileGrid);
  const tileMode = useArtStore((s) => s.tileMode);
  const frame = useArtStore((s) => s.frame);
  const onion = useArtStore((s) => s.onion);
  const customBrush = useArtStore((s) => s.customBrush);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Pt | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const layerCanvases = useRef(new Map<number, HTMLCanvasElement>());
  const flatCanvas = useRef<HTMLCanvasElement | null>(null);
  const floatCanvas = useRef<HTMLCanvasElement | null>(null);
  const lastPoint = useRef<Pt | null>(null);

  // Fit the image when it's opened (zoom 0) or the view is first sized.
  useLayoutEffect(() => {
    if (!doc || size.w === 0 || zoom !== 0) return;
    const span = tileMode ? 3 : 1;
    const fit = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, Math.floor(Math.min((size.w - 40) / (doc.width * span), (size.h - 40) / (doc.height * span)))),
    );
    useArtStore.getState().set({ zoom: fit });
    setPan({ x: Math.round((size.w - doc.width * fit) / 2), y: Math.round((size.h - doc.height * fit) / 2) });
  }, [doc, size, zoom, tileMode]);

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

  // Layer canvases, redrawn when pixels change.
  useEffect(() => {
    if (!doc) return;
    const keep = new Set<number>();
    for (const l of doc.layers) {
      keep.add(l.id);
      layerCanvases.current.set(l.id, bitmapCanvas(l.image, layerCanvases.current.get(l.id)));
    }
    for (const id of [...layerCanvases.current.keys()]) if (!keep.has(id)) layerCanvases.current.delete(id);
    flatCanvas.current = tileMode || onion ? bitmapCanvas(flattenDoc(doc), flatCanvas.current) : null;
  }, [doc, doc?.version, tileMode, onion]);

  useEffect(() => {
    floatCanvas.current = floating ? bitmapCanvas(floating.image, floatCanvas.current) : null;
  }, [floating]);

  const frames = doc ? frameRects(doc) : [];
  const curFrame = frames.length ? frames[Math.min(frame, frames.length - 1)] : null;

  /** Mirror around the image centre - or the current frame's, with frames on. */
  const mirrorPoints = (p: Pt): Pt[] => {
    const st = useArtStore.getState();
    if (!doc) return [p];
    if (curFrame && p.x >= curFrame.x && p.y >= curFrame.y && p.x < curFrame.x + curFrame.w && p.y < curFrame.y + curFrame.h) {
      return mirrored({ x: p.x - curFrame.x, y: p.y - curFrame.y }, { width: curFrame.w, height: curFrame.h }, st.mirrorX, st.mirrorY).map((m) => ({
        x: m.x + curFrame.x,
        y: m.y + curFrame.y,
      }));
    }
    return mirrored(p, { width: doc.width, height: doc.height }, st.mirrorX, st.mirrorY);
  };

  const shapePreview = (d: Drag | null): Pt[] => {
    if (!d || d.kind !== "shape" || !doc) return [];
    const st = useArtStore.getState();
    const { start, end } = d;
    const pts =
      st.tool === "line"
        ? linePoints(start.x, start.y, end.x, end.y).flatMap((p) => brushPoints(p.x, p.y, st.brushSize))
        : st.tool === "rect"
          ? rectPoints(start.x, start.y, end.x, end.y, st.shapeFilled)
          : ellipsePoints(start.x, start.y, end.x, end.y, st.shapeFilled);
    return pts.flatMap((p) => mirrorPoints(p));
  };

  const wrap = (p: Pt): Pt => {
    if (!tileMode || !doc) return p;
    return { x: ((p.x % doc.width) + doc.width) % doc.width, y: ((p.y % doc.height) + doc.height) % doc.height };
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

    const W = doc.width * zoom;
    const H = doc.height * zoom;

    // Tile mode: the image repeated all around, slightly dimmed.
    if (tileMode && flatCanvas.current) {
      g.globalAlpha = 0.55;
      for (let ty = -1; ty <= 1; ty++)
        for (let tx = -1; tx <= 1; tx++) if (tx || ty) g.drawImage(flatCanvas.current, pan.x + tx * W, pan.y + ty * H, W, H);
      g.globalAlpha = 1;
    }

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
    doc.layers.forEach((l, i) => {
      const c = layerCanvases.current.get(l.id);
      if (!c || !l.visible) return;
      g.globalAlpha = l.opacity;
      g.drawImage(c, pan.x, pan.y, W, H);
      g.globalAlpha = 1;
      if (i === doc.active && floating && floatCanvas.current)
        g.drawImage(floatCanvas.current, pan.x + floating.x * zoom, pan.y + floating.y * zoom, floating.image.width * zoom, floating.image.height * zoom);
    });

    // Onion skin: the previous frame (red) and next frame (blue) over this one.
    if (onion && curFrame && flatCanvas.current) {
      const fi = frames.indexOf(curFrame);
      const ghost = (idx: number, tint: string) => {
        const f = frames[idx];
        if (!f) return;
        const tmp = document.createElement("canvas");
        tmp.width = f.w;
        tmp.height = f.h;
        const tg = tmp.getContext("2d")!;
        tg.drawImage(flatCanvas.current!, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
        tg.globalCompositeOperation = "source-atop";
        tg.fillStyle = tint;
        tg.fillRect(0, 0, f.w, f.h);
        g.globalAlpha = 0.35;
        g.drawImage(tmp, pan.x + curFrame.x * zoom, pan.y + curFrame.y * zoom, f.w * zoom, f.h * zoom);
        g.globalAlpha = 1;
      };
      ghost(fi - 1, "rgba(255,60,60,0.6)");
      ghost(fi + 1, "rgba(60,140,255,0.6)");
    }

    // Shape / gradient previews.
    if (drag?.kind === "shape") {
      const c = drag.color;
      g.fillStyle = c[3] === 0 ? "rgba(255,255,255,0.55)" : `rgb(${c[0]},${c[1]},${c[2]})`;
      for (const p of shapePreview(drag)) g.fillRect(pan.x + p.x * zoom, pan.y + p.y * zoom, zoom, zoom);
    }
    if (drag?.kind === "gradient") {
      g.strokeStyle = cssVar("--canvas-accent", "#ffd23f");
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(pan.x + (drag.start.x + 0.5) * zoom, pan.y + (drag.start.y + 0.5) * zoom);
      g.lineTo(pan.x + (drag.end.x + 0.5) * zoom, pan.y + (drag.end.y + 0.5) * zoom);
      g.stroke();
    }

    // Grids.
    const gridLines = (step: number, color: string) => {
      g.strokeStyle = color;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = step; x < doc.width; x += step) {
        g.moveTo(pan.x + x * zoom + 0.5, pan.y);
        g.lineTo(pan.x + x * zoom + 0.5, pan.y + H);
      }
      for (let y = step; y < doc.height; y += step) {
        g.moveTo(pan.x, pan.y + y * zoom + 0.5);
        g.lineTo(pan.x + W, pan.y + y * zoom + 0.5);
      }
      g.stroke();
    };
    if (pixelGrid && zoom >= 8) gridLines(1, "rgba(0,0,0,0.18)");
    if (tileGrid && zoom >= 2) gridLines(8, "rgba(255, 210, 63, 0.75)");
    g.restore();

    // Frame cells: thin lines, the current frame outlined.
    if (frames.length > 1) {
      g.strokeStyle = "rgba(120, 200, 255, 0.55)";
      g.lineWidth = 1;
      for (const f of frames) g.strokeRect(pan.x + f.x * zoom + 0.5, pan.y + f.y * zoom + 0.5, f.w * zoom - 1, f.h * zoom - 1);
      if (curFrame) {
        g.strokeStyle = "#78c8ff";
        g.lineWidth = 2;
        g.strokeRect(pan.x + curFrame.x * zoom - 1, pan.y + curFrame.y * zoom - 1, curFrame.w * zoom + 2, curFrame.h * zoom + 2);
      }
    }

    // Image border.
    g.lineWidth = 1;
    g.strokeStyle = "rgba(0,0,0,0.6)";
    g.strokeRect(pan.x - 0.5, pan.y - 0.5, W + 1, H + 1);

    // Selection marquee (or the one being dragged out).
    const sel = drag?.kind === "select" ? normRect(drag.start.x, drag.start.y, drag.end.x, drag.end.y) : selection;
    if (sel) {
      const x = pan.x + sel.x * zoom + 0.5;
      const y = pan.y + sel.y * zoom + 0.5;
      g.setLineDash([4, 4]);
      g.strokeStyle = "#000";
      g.strokeRect(x, y, sel.w * zoom - 1, sel.h * zoom - 1);
      g.lineDashOffset = 4;
      g.strokeStyle = "#fff";
      g.strokeRect(x, y, sel.w * zoom - 1, sel.h * zoom - 1);
      g.setLineDash([]);
      g.lineDashOffset = 0;
    }

    // Brush outline (or the custom brush) under the cursor.
    const st = useArtStore.getState();
    if (hover && !spaceDown) {
      g.strokeStyle = cssVar("--canvas-accent", "#ffd23f");
      g.lineWidth = 1;
      if (tool === "pencil" || tool === "eraser" || tool === "shade") {
        const o = Math.floor((st.brushSize - 1) / 2);
        g.strokeRect(pan.x + (hover.x - o) * zoom + 0.5, pan.y + (hover.y - o) * zoom + 0.5, st.brushSize * zoom - 1, st.brushSize * zoom - 1);
      } else if (tool === "stamp" && customBrush) {
        const bx = hover.x - Math.floor(customBrush.width / 2);
        const by = hover.y - Math.floor(customBrush.height / 2);
        g.globalAlpha = 0.6;
        g.drawImage(bitmapCanvas(customBrush), pan.x + bx * zoom, pan.y + by * zoom, customBrush.width * zoom, customBrush.height * zoom);
        g.globalAlpha = 1;
        g.strokeRect(pan.x + bx * zoom + 0.5, pan.y + by * zoom + 0.5, customBrush.width * zoom - 1, customBrush.height * zoom - 1);
      }
    }
    // doc.version isn't read here but must trigger a redraw.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, doc?.version, zoom, pan, size, drag, hover, selection, floating, pixelGrid, tileGrid, tileMode, tool, spaceDown, frame, onion, customBrush]);

  // ---- Input -----------------------------------------------------------
  const toPixel = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const r = canvasRef.current!.getBoundingClientRect();
      return { x: Math.floor((e.clientX - r.left - pan.x) / zoom), y: Math.floor((e.clientY - r.top - pan.y) / zoom) };
    },
    [pan, zoom],
  );

  const target = () => {
    const st = useArtStore.getState();
    return st.doc ? activeLayer(st.doc) : null;
  };

  /** Paint points (with mirroring and tile-mode wrapping) on the active layer. */
  const paint = (pts: Pt[], color: RGBA | ((p: Pt) => RGBA), orig?: Map<number, RGBA>) => {
    const layer = target();
    if (!layer || !doc) return;
    for (const p of pts)
      for (const m0 of mirrorPoints(p)) {
        const m = wrap(m0);
        if (m.x < 0 || m.y < 0 || m.x >= doc.width || m.y >= doc.height) continue;
        const key = m.y * doc.width + m.x;
        if (orig && !orig.has(key)) orig.set(key, getPixel(layer.image, m.x, m.y));
        setPixel(layer.image, m.x, m.y, typeof color === "function" ? color(m) : color);
      }
  };

  const inImage = (p: Pt) => !!doc && (tileMode || (p.x >= 0 && p.y >= 0 && p.x < doc.width && p.y < doc.height));

  const pickAt = (p: Pt, secondary: boolean) => {
    if (!doc) return;
    const w = wrap(p);
    if (w.x < 0 || w.y < 0 || w.x >= doc.width || w.y >= doc.height) return;
    const c = getPixel(flattenDoc(doc), w.x, w.y);
    const st = useArtStore.getState();
    if (secondary) st.set({ secondary: c });
    else st.setPrimary(c);
  };

  const shadeAt = (d: Extract<Drag, { kind: "shade" }>, pts: Pt[]) => {
    const layer = target();
    if (!layer || !doc) return;
    const st = useArtStore.getState();
    paint(
      pts.flatMap((q) => brushPoints(q.x, q.y, st.brushSize)).filter((q) => {
        const w = wrap(q);
        const key = w.y * doc.width + w.x;
        if (d.done.has(key)) return false;
        d.done.add(key);
        return true;
      }),
      (q) => shadeColor(getPixel(layer.image, q.x, q.y), d.ramp, d.dir),
    );
  };

  const stampAt = (p: Pt) => {
    const layer = target();
    const brush = useArtStore.getState().customBrush;
    if (!layer || !brush) return;
    stamp(layer.image, brush, p.x - Math.floor(brush.width / 2), p.y - Math.floor(brush.height / 2));
  };

  /** Pixel perfect: drop the corner pixel of an L-shaped step in a 1px stroke. */
  const pixelPerfectFix = (d: Extract<Drag, { kind: "draw" }>) => {
    const st = useArtStore.getState();
    const layer = target();
    if (!st.pixelPerfect || st.brushSize !== 1 || !layer || !doc || d.path.length < 3) return;
    const [a, b, c] = d.path.slice(-3);
    const adj = (p: Pt, q: Pt) => Math.abs(p.x - q.x) + Math.abs(p.y - q.y) === 1;
    if (adj(a, b) && adj(b, c) && Math.abs(a.x - c.x) === 1 && Math.abs(a.y - c.y) === 1) {
      for (const m of mirrorPoints(b)) {
        const w = wrap(m);
        const o = d.orig.get(w.y * doc.width + w.x);
        if (o) setPixel(layer.image, w.x, w.y, o);
      }
      d.path.splice(d.path.length - 2, 1);
    }
  };

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
    const right = e.button === 2;
    const color = right ? st.secondary : st.primary;
    const t = st.tool;

    // Alt+click with a drawing tool picks a colour, like Pixelorama.
    if (t === "picker" || (e.altKey && ["pencil", "fill", "line", "rect", "ellipse", "shade", "gradient"].includes(t))) {
      pickAt(p, right);
      return;
    }
    const layer = activeLayer(doc);
    const drawing = ["pencil", "eraser", "fill", "line", "rect", "ellipse", "gradient", "shade", "stamp"].includes(t);
    if (drawing && (layer.locked || !layer.visible)) return;

    if (t === "pencil" || t === "eraser") {
      const c = t === "eraser" ? TRANSPARENT : color;
      const alt = right ? st.primary : st.secondary;
      st.checkpoint();
      const from = e.shiftKey && lastPoint.current ? lastPoint.current : p;
      const orig = new Map<number, RGBA>();
      paint(
        linePoints(from.x, from.y, p.x, p.y).flatMap((q) => brushPoints(q.x, q.y, st.brushSize)),
        st.dither && t === "pencil" ? (q) => (((q.x + q.y) & 1) === 0 ? c : alt) : c,
        orig,
      );
      lastPoint.current = p;
      st.touch();
      setDrag({ kind: "draw", color: c, alt, last: p, path: [p], orig });
      return;
    }
    if (t === "shade") {
      st.checkpoint();
      const ramp = colorsUsed(layer.image).colors.map((u) => u.color);
      const d: Extract<Drag, { kind: "shade" }> = { kind: "shade", dir: right ? -1 : 1, ramp, last: p, done: new Set() };
      shadeAt(d, [p]);
      st.touch();
      setDrag(d);
      return;
    }
    if (t === "stamp") {
      if (!st.customBrush) return;
      st.checkpoint();
      stampAt(p);
      st.touch();
      setDrag({ kind: "stamp", last: p });
      return;
    }
    if (t === "fill") {
      if (!inImage(p)) return;
      const w = wrap(p);
      st.checkpoint();
      let changed = floodFill(layer.image, w.x, w.y, color, st.fillGlobal);
      for (const m of mirrorPoints(w).slice(1)) changed = floodFill(layer.image, m.x, m.y, color, st.fillGlobal) || changed;
      if (changed) st.touch();
      else st.set({ past: st.past, stateId: st.stateId, dirty: st.dirty });
      return;
    }
    if (t === "line" || t === "rect" || t === "ellipse") {
      setDrag({ kind: "shape", color, start: p, end: p });
      return;
    }
    if (t === "gradient") {
      setDrag({ kind: "gradient", start: p, end: p, reverse: right });
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
      onHover(h ? wrap(h) : null);
    }
    if (!drag) return;
    const st = useArtStore.getState();
    if (drag.kind === "pan") {
      setPan({ x: drag.ox + e.clientX - drag.x, y: drag.oy + e.clientY - drag.y });
    } else if (drag.kind === "draw") {
      if (p.x === drag.last.x && p.y === drag.last.y) return;
      const c = drag.color;
      const alt = drag.alt;
      for (const q of linePoints(drag.last.x, drag.last.y, p.x, p.y).slice(1)) {
        paint(brushPoints(q.x, q.y, st.brushSize), st.dither && st.tool === "pencil" ? (r) => (((r.x + r.y) & 1) === 0 ? c : alt) : c, drag.orig);
        drag.path.push(q);
        pixelPerfectFix(drag);
      }
      lastPoint.current = p;
      st.touch();
      setDrag({ ...drag, last: p });
    } else if (drag.kind === "shade") {
      if (p.x === drag.last.x && p.y === drag.last.y) return;
      shadeAt(drag, linePoints(drag.last.x, drag.last.y, p.x, p.y));
      st.touch();
      setDrag({ ...drag, last: p });
    } else if (drag.kind === "stamp") {
      const brush = st.customBrush;
      if (!brush) return;
      // Stamp again once the cursor has moved a brush-width away.
      if (Math.abs(p.x - drag.last.x) < brush.width && Math.abs(p.y - drag.last.y) < brush.height) return;
      stampAt(p);
      st.touch();
      setDrag({ ...drag, last: p });
    } else if (drag.kind === "shape" || drag.kind === "gradient") {
      let end = p;
      // Shift: perfect squares/circles, and 45-degree lines.
      if (e.shiftKey) {
        const dx = p.x - drag.start.x;
        const dy = p.y - drag.start.y;
        if (st.tool === "line" || drag.kind === "gradient") {
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
      const end = { x: Math.max(0, Math.min(doc.width - 1, p.x)), y: Math.max(0, Math.min(doc.height - 1, p.y)) };
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
    const layer = activeLayer(doc);
    if (drag.kind === "shape") {
      st.checkpoint();
      paint(shapePreview(drag), drag.color);
      st.touch();
    } else if (drag.kind === "gradient") {
      const area = st.selection ?? { x: 0, y: 0, w: doc.width, h: doc.height };
      st.checkpoint();
      const [a, b] = drag.reverse ? [st.secondary, st.primary] : [st.primary, st.secondary];
      gradient(layer.image, area, drag.start, drag.end, a, b, st.gradientSteps, st.gradientRadial);
      st.touch();
    } else if (drag.kind === "select") {
      const start = { x: Math.max(0, Math.min(doc.width - 1, drag.start.x)), y: Math.max(0, Math.min(doc.height - 1, drag.start.y)) };
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
