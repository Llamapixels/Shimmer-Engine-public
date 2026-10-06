import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { SpriteFrameJSON, SpriteTileJSON } from "../../../shared/projectTypes";
import { editFrame, editFrames, useSpriteEditor } from "../../sprites/editorStore";
import { drawTiles } from "../../sprites/image";
import { canvasAnchor, frame as newFrame, newId, tileSize } from "../../sprites/model";
import { frameCost } from "../../sprites/pack";
import { useProjectStore } from "../../state/projectStore";
import { useCurrentSprite } from "./useCurrentSprite";

type Drag =
  | { kind: "move"; startX: number; startY: number; dx: number; dy: number; orig: Map<string, { x: number; y: number }> }
  | { kind: "marquee"; x0: number; y0: number; x1: number; y1: number; add: boolean };

const MARGIN = 16;

function isTyping(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

/** The frame being edited, drawn on its canvas: place tiles from the
 * palette, select / drag / nudge them, marquee-select. */
export default function MetaspriteCanvas() {
  const cur = useCurrentSprite();
  const { img, sheet, state, animIndex, frames, frameIndex, frame } = cur;
  const ed = useSpriteEditor();
  const section = useProjectStore((s) => s.section);
  const engine = useProjectStore((s) => s.project?.project.engine);
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wrapSize, setWrapSize] = useState({ w: 600, h: 400 });
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setWrapSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Animation playback: one tick per VBlank (60 Hz).
  useEffect(() => {
    if (!ed.playing) return;
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = (now: number) => {
      acc += now - last;
      last = now;
      const n = Math.floor(acc / (1000 / 60));
      if (n > 0) {
        acc -= n * (1000 / 60);
        setTick((t) => t + n);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ed.playing]);

  const speed = cur.anim?.speed ?? sheet?.animSpeed ?? 8;
  const shownIndex = ed.playing && frames.length ? Math.floor(tick / speed) % frames.length : frameIndex;
  const shown: SpriteFrameJSON | null = frames[shownIndex] ?? null;

  // The tiles as drawn right now (mid-drag positions included).
  const tiles: SpriteTileJSON[] = useMemo(() => {
    const t = shown?.tiles ?? [];
    if (drag?.kind !== "move" || ed.playing) return t;
    return t.map((tl) => {
      const o = drag.orig.get(tl.id);
      return o ? { ...tl, x: o.x + drag.dx, y: o.y + drag.dy } : tl;
    });
  }, [shown, drag, ed.playing]);

  const mode = sheet?.spriteMode ?? "8x16";
  const cw = sheet?.canvasWidth ?? 16;
  const ch = sheet?.canvasHeight ?? 16;
  const anchor = sheet ? canvasAnchor(sheet) : { x: 0, y: 0 };

  // World extents in canvas px: the canvas, the actor's footprint and
  // bounds, and every tile, plus a margin.
  const ext = useMemo(() => {
    let x0 = Math.min(0, -anchor.x);
    let y0 = Math.min(0, -anchor.y);
    let x1 = Math.max(cw, 16 - anchor.x);
    let y1 = Math.max(ch, 16 - anchor.y);
    if (sheet) {
      const b = sheet.bounds;
      x0 = Math.min(x0, b.x - anchor.x);
      y0 = Math.min(y0, b.y - anchor.y);
      x1 = Math.max(x1, b.x - anchor.x + b.width);
      y1 = Math.max(y1, b.y - anchor.y + b.height);
    }
    for (const t of frame?.tiles ?? []) {
      const { w, h } = tileSize(t, mode);
      x0 = Math.min(x0, t.x);
      y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x + w);
      y1 = Math.max(y1, t.y + h);
    }
    return { x0: x0 - MARGIN, y0: y0 - MARGIN, x1: x1 + MARGIN, y1: y1 + MARGIN };
  }, [anchor.x, anchor.y, cw, ch, sheet, frame, mode]);

  const fitZoom = Math.max(
    1,
    Math.min(24, Math.floor(Math.min((wrapSize.w - 16) / (ext.x1 - ext.x0), (wrapSize.h - 16) / (ext.y1 - ext.y0)))),
  );
  const Z = ed.zoom || fitZoom;
  useEffect(() => {
    if (useSpriteEditor.getState().fitZoom !== fitZoom) useSpriteEditor.getState().set({ fitZoom });
  }, [fitZoom]);
  const W = (ext.x1 - ext.x0) * Z;
  const H = (ext.y1 - ext.y0) * Z;
  const toScreen = (x: number, y: number) => [(x - ext.x0) * Z, (y - ext.y0) * Z] as const;

  const ghost = useMemo(() => {
    if (!ed.palette || !mouse || ed.playing) return null;
    const { w, h } = ed.palette;
    let x = Math.round(mouse.x - w / 2);
    let y = Math.round(mouse.y - h / 2);
    if (ed.snap8) {
      x = Math.round(x / 8) * 8;
      y = Math.round(y / 8) * 8;
    }
    return { x, y, w, h };
  }, [ed.palette, mouse, ed.snap8, ed.playing]);

  const cost = img && shown ? frameCost(img, shown.tiles, mode) : null;

  // ---- drawing ----
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#262626";
    ctx.fillRect(0, 0, W, H);
    // Checkerboard canvas.
    const [cx, cy] = toScreen(0, 0);
    const cell = Math.max(Z * 4, 4);
    for (let y = 0; y < ch * Z; y += cell)
      for (let x = 0; x < cw * Z; x += cell) {
        ctx.fillStyle = ((x / cell + y / cell) & 1) === 0 ? "#3a3a3a" : "#333333";
        ctx.fillRect(cx + x, cy + y, Math.min(cell, cw * Z - x), Math.min(cell, ch * Z - y));
      }
    if (ed.showGrid && Z >= 3) {
      ctx.strokeStyle = "rgba(255,255,255,0.07)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 8; x < cw; x += 8) {
        ctx.moveTo(cx + x * Z + 0.5, cy);
        ctx.lineTo(cx + x * Z + 0.5, cy + ch * Z);
      }
      for (let y = ch - 8; y > 0; y -= 8) {
        ctx.moveTo(cx, cy + y * Z + 0.5);
        ctx.lineTo(cx + cw * Z, cy + y * Z + 0.5);
      }
      ctx.stroke();
    }
    if (img && ed.onionSkin && !ed.playing && frames.length > 1) {
      const prev = frames[(frameIndex - 1 + frames.length) % frames.length];
      drawTiles(ctx, img, prev.tiles, mode, cx, cy, Z, { alpha: 0.3 });
    }
    if (img) drawTiles(ctx, img, tiles, mode, cx, cy, Z);
    if (img && ghost && ed.palette) {
      drawTiles(
        ctx,
        img,
        [{ id: "ghost", x: ghost.x, y: ghost.y, sliceX: ed.palette.x, sliceY: ed.palette.y, width: ghost.w, height: ghost.h }],
        mode,
        cx,
        cy,
        Z,
        { alpha: 0.7 },
      );
      const [gx, gy] = toScreen(ghost.x, ghost.y);
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.setLineDash([3, 3]);
      ctx.strokeRect(gx + 0.5, gy + 0.5, ghost.w * Z - 1, ghost.h * Z - 1);
      ctx.setLineDash([]);
    }
    // Canvas border.
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 0.5, cy - 0.5, cw * Z + 1, ch * Z + 1);
    if (ed.showBounds && sheet) {
      // The 16x16 footprint the actor stands on, and its collision box.
      const [fx, fy] = toScreen(-anchor.x, -anchor.y);
      ctx.strokeStyle = "rgba(121,180,255,0.55)";
      ctx.setLineDash([2, 3]);
      ctx.strokeRect(fx + 0.5, fy + 0.5, 16 * Z - 1, 16 * Z - 1);
      ctx.setLineDash([]);
      const b = sheet.bounds;
      const [bx, by] = toScreen(b.x - anchor.x, b.y - anchor.y);
      ctx.fillStyle = "rgba(255,70,90,0.12)";
      ctx.fillRect(bx, by, b.width * Z, b.height * Z);
      ctx.strokeStyle = "rgba(255,70,90,0.85)";
      ctx.strokeRect(bx + 0.5, by + 0.5, b.width * Z - 1, b.height * Z - 1);
      // Platformer "Crouch height": the shorter box on the crouch state.
      const ch = Number(engine?.pl_crouch_height ?? 0);
      const crouchState = String(engine?.pl_state_crouch || "crouch").toLowerCase();
      const stateName = (state?.name || "Default").toLowerCase();
      if (engine?.pl_crouch && ch > 0 && ch < b.height && stateName === crouchState) {
        const cy2 = by + (b.height - ch) * Z;
        ctx.fillStyle = "rgba(255,200,60,0.18)";
        ctx.fillRect(bx, cy2, b.width * Z, ch * Z);
        ctx.strokeStyle = "rgba(255,200,60,0.95)";
        ctx.setLineDash([4, 2]);
        ctx.strokeRect(bx + 0.5, cy2 + 0.5, b.width * Z - 1, ch * Z - 1);
        ctx.setLineDash([]);
      }
    }
    if (ed.showObjs && cost) {
      ctx.lineWidth = 1;
      cost.objs.forEach((o, i) => {
        const [ox, oy] = toScreen(o.x, o.y);
        ctx.strokeStyle = `hsla(${(i * 67) % 360}, 90%, 65%, 0.9)`;
        ctx.strokeRect(ox + 1.5, oy + 1.5, o.w * Z - 3, o.h * Z - 3);
        if (Z >= 4) {
          ctx.fillStyle = ctx.strokeStyle;
          ctx.font = "10px sans-serif";
          ctx.fillText(`${o.w}x${o.h}`, ox + 4, oy + 12);
        }
      });
    }
    if (!ed.playing) {
      for (const t of tiles) {
        const sel = ed.tileIds.includes(t.id);
        if (!sel) continue;
        const { w, h } = tileSize(t, mode);
        const [tx, ty] = toScreen(t.x, t.y);
        ctx.strokeStyle = "#a36bff";
        ctx.lineWidth = 2;
        ctx.strokeRect(tx + 1, ty + 1, w * Z - 2, h * Z - 2);
      }
    }
    if (drag?.kind === "marquee") {
      const [ax, ay] = toScreen(Math.min(drag.x0, drag.x1), Math.min(drag.y0, drag.y1));
      ctx.fillStyle = "rgba(121,31,255,0.18)";
      ctx.strokeStyle = "rgba(163,107,255,0.9)";
      ctx.lineWidth = 1;
      ctx.fillRect(ax, ay, Math.abs(drag.x1 - drag.x0) * Z, Math.abs(drag.y1 - drag.y0) * Z);
      ctx.strokeRect(ax + 0.5, ay + 0.5, Math.abs(drag.x1 - drag.x0) * Z, Math.abs(drag.y1 - drag.y0) * Z);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    W,
    H,
    Z,
    img,
    tiles,
    ghost,
    ed.showGrid,
    ed.showBounds,
    engine,
    state,
    ed.showObjs,
    ed.onionSkin,
    ed.playing,
    ed.tileIds,
    ed.palette,
    drag,
    sheet,
    frames,
    frameIndex,
    cost,
    cw,
    ch,
    mode,
  ]);

  // ---- editing ----
  const eventPos = (e: ReactMouseEvent | MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / Z + ext.x0, y: (e.clientY - r.top) / Z + ext.y0 };
  };

  const hitTile = (x: number, y: number): SpriteTileJSON | null => {
    const list = frame?.tiles ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const t = list[i];
      const { w, h } = tileSize(t, mode);
      if (x >= t.x && y >= t.y && x < t.x + w && y < t.y + h) return t;
    }
    return null;
  };

  const placeTile = () => {
    if (!sheet || !state || !ghost || !ed.palette) return;
    const t: SpriteTileJSON = {
      id: newId(),
      x: ghost.x,
      y: ghost.y,
      sliceX: ed.palette.x,
      sliceY: ed.palette.y,
      width: ed.palette.w,
      height: ed.palette.h,
    };
    if (!frames.length) {
      editFrames(sheet, state.id, animIndex, () => [newFrame([t])]);
      ed.set({ frameIndex: 0, tileIds: [t.id] });
    } else {
      editFrame(sheet, state.id, animIndex, frameIndex, (f) => ({ ...f, tiles: [...f.tiles, t] }));
      ed.set({ tileIds: [t.id] });
    }
  };

  const onMouseDown = (e: ReactMouseEvent) => {
    if (!sheet || !state || ed.playing) return;
    canvasRef.current?.focus();
    const p = eventPos(e);
    if (e.button === 2) {
      ed.set({ palette: null });
      return;
    }
    if (ed.palette) {
      placeTile();
      return;
    }
    const hit = hitTile(p.x, p.y);
    if (hit) {
      let ids = ed.tileIds;
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        ids = ids.includes(hit.id) ? ids.filter((i) => i !== hit.id) : [...ids, hit.id];
        ed.set({ tileIds: ids });
        return;
      }
      if (!ids.includes(hit.id)) {
        ids = [hit.id];
        ed.set({ tileIds: ids });
      }
      const orig = new Map<string, { x: number; y: number }>();
      for (const t of frame?.tiles ?? []) if (ids.includes(t.id)) orig.set(t.id, { x: t.x, y: t.y });
      setDrag({ kind: "move", startX: p.x, startY: p.y, dx: 0, dy: 0, orig });
    } else {
      setDrag({ kind: "marquee", x0: p.x, y0: p.y, x1: p.x, y1: p.y, add: e.shiftKey });
      if (!e.shiftKey) ed.set({ tileIds: [] });
    }
  };

  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const p = eventPos(e);
      if (drag.kind === "move") {
        let dx = Math.round(p.x - drag.startX);
        let dy = Math.round(p.y - drag.startY);
        if (useSpriteEditor.getState().snap8 || e.altKey) {
          dx = Math.round(dx / 8) * 8;
          dy = Math.round(dy / 8) * 8;
        }
        if (dx !== drag.dx || dy !== drag.dy) setDrag({ ...drag, dx, dy });
      } else {
        setDrag({ ...drag, x1: p.x, y1: p.y });
      }
    };
    const up = () => {
      if (drag.kind === "move" && (drag.dx || drag.dy) && sheet && state) {
        editFrame(sheet, state.id, animIndex, frameIndex, (f) => ({
          ...f,
          tiles: f.tiles.map((t) => {
            const o = drag.orig.get(t.id);
            return o ? { ...t, x: o.x + drag.dx, y: o.y + drag.dy } : t;
          }),
        }));
      } else if (drag.kind === "marquee") {
        const x0 = Math.min(drag.x0, drag.x1);
        const x1 = Math.max(drag.x0, drag.x1);
        const y0 = Math.min(drag.y0, drag.y1);
        const y1 = Math.max(drag.y0, drag.y1);
        const inside = (frame?.tiles ?? [])
          .filter((t) => {
            const { w, h } = tileSize(t, mode);
            return t.x < x1 && t.x + w > x0 && t.y < y1 && t.y + h > y0;
          })
          .map((t) => t.id);
        const prev = drag.add ? useSpriteEditor.getState().tileIds : [];
        ed.set({ tileIds: Array.from(new Set([...prev, ...inside])) });
      }
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, Z, ext.x0, ext.y0]);

  // ---- keyboard ----
  useEffect(() => {
    if (section !== "sprites") return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = useSpriteEditor.getState();
      if (!sheet || !state) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const selTiles = (frame?.tiles ?? []).filter((t) => s.tileIds.includes(t.id));
      if (e.key === "Escape") {
        s.set({ palette: null, tileIds: [] });
      } else if (e.key === " ") {
        e.preventDefault();
        s.set({ playing: !s.playing });
      } else if (s.playing) {
        return;
      } else if ((e.key === "Delete" || e.key === "Backspace") && selTiles.length) {
        e.preventDefault();
        editFrame(sheet, state.id, animIndex, frameIndex, (f) => ({ ...f, tiles: f.tiles.filter((t) => !s.tileIds.includes(t.id)) }));
        s.set({ tileIds: [] });
      } else if (e.key.startsWith("Arrow") && selTiles.length) {
        e.preventDefault();
        const step = e.shiftKey ? 8 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        editFrame(
          sheet,
          state.id,
          animIndex,
          frameIndex,
          (f) => ({ ...f, tiles: f.tiles.map((t) => (s.tileIds.includes(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)) }),
          "nudge",
        );
      } else if (e.key === "," || e.key === "[") {
        if (frames.length) s.set({ frameIndex: (frameIndex - 1 + frames.length) % frames.length, tileIds: [] });
      } else if (e.key === "." || e.key === "]") {
        if (frames.length) s.set({ frameIndex: (frameIndex + 1) % frames.length, tileIds: [] });
      } else if (mod && k === "a") {
        e.preventDefault();
        s.set({ tileIds: (frame?.tiles ?? []).map((t) => t.id) });
      } else if (mod && k === "c" && selTiles.length) {
        e.preventDefault();
        s.set({ clipboard: { tiles: selTiles.map((t) => ({ ...t })) } });
      } else if (mod && k === "x" && selTiles.length) {
        e.preventDefault();
        s.set({ clipboard: { tiles: selTiles.map((t) => ({ ...t })) }, tileIds: [] });
        editFrame(sheet, state.id, animIndex, frameIndex, (f) => ({ ...f, tiles: f.tiles.filter((t) => !s.tileIds.includes(t.id)) }));
      } else if (mod && k === "v" && s.clipboard?.tiles?.length) {
        e.preventDefault();
        const pasted = s.clipboard.tiles.map((t) => ({ ...t, id: newId() }));
        if (!frames.length) editFrames(sheet, state.id, animIndex, () => [newFrame(pasted)]);
        else editFrame(sheet, state.id, animIndex, frameIndex, (f) => ({ ...f, tiles: [...f.tiles, ...pasted] }));
        s.set({ tileIds: pasted.map((t) => t.id) });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [section, sheet, state, animIndex, frameIndex, frame, frames]);

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const next = Math.max(1, Math.min(32, Z + (e.deltaY < 0 ? 1 : -1)));
    ed.set({ zoom: next });
  };

  const hoverTile = mouse && !ed.palette && !drag ? hitTile(mouse.x, mouse.y) : null;

  return (
    <div className="spr-canvas-wrap" ref={wrapRef} onWheel={onWheel}>
      {!sheet ? (
        <div className="spr-empty">{img === null && cur.asset ? "Loading…" : "Select a sprite on the left, or import one with +."}</div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className={`spr-canvas${ed.palette ? " spr-canvas-placing" : hoverTile ? " spr-canvas-over-tile" : ""}`}
            style={{ width: W, height: H }}
            tabIndex={0}
            onMouseDown={onMouseDown}
            onMouseMove={(e) => setMouse(eventPos(e))}
            onMouseLeave={() => setMouse(null)}
            onContextMenu={(e) => e.preventDefault()}
            data-testid="sprite-canvas"
          />
          {!frames.length && (
            <div className="spr-canvas-hint">This animation has no frames. Pick tiles below and click here to start one.</div>
          )}
          {frames.length > 0 && !frame?.tiles.length && !ed.palette && (
            <div className="spr-canvas-hint">Empty frame - drag over the tiles below to pick some, then click here to place them.</div>
          )}
        </>
      )}
    </div>
  );
}
