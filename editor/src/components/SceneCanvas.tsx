import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import { SPRITE_LEFT_SLOT_TO_RIGHT } from "../../shared/projectTypes";
import type { DoorJSON, NpcJSON, SceneJSON, SpriteSheetJSON, SpriteStateJSON } from "../../shared/projectTypes";
import { sceneName, useProjectStore, type Brush, type Tool } from "../state/projectStore";
import { mirrorTilesForLeft, normalizeTileIds, tileHeightFor } from "./views/sprites/metasprite";
import "./SceneCanvas.css";

const TILE = 8;
/** NPCs and the player are 16x16 sprites anchored at their tile's
 * top-left - 2x2 tiles (same as the compiler's preview images). */
const ACTOR_TILES = 2;

const COLLISION_VAR: Record<string, string | null> = {
  ".": null,
  "#": "--collision-solid",
  "~": "--collision-water",
  "!": "--collision-damage",
};

const ZOOM_LEVELS = [1, 2, 3, 4, 6];
/** Must match .scene-canvas-scroll's padding in SceneCanvas.css - used to
 * translate cursor position into unscaled canvas-content coordinates for
 * cursor-centered zoom (see zoomAnchorRef). */
const SCROLL_PAD = 24;

const TOOLS: { id: Tool; label: string; key: string; icon: string }[] = [
  { id: "select", label: "Select / move", key: "V", icon: "↖" },
  { id: "npc", label: "Add NPC", key: "N", icon: "☺" },
  { id: "door", label: "Add door / trigger (drag a box)", key: "T", icon: "▭" },
  { id: "collision", label: "Paint collision (right-click erases)", key: "C", icon: "▦" },
  { id: "palette", label: "Paint BG palette (right-click clears)", key: "G", icon: "🎨" },
  { id: "spawn", label: "Set player start", key: "P", icon: "⚑" },
];

/** Deterministic display color per palette id, purely for the canvas
 * overlay (the compiler doesn't use this - actual GBA colors come from
 * each palette's own swatches / the background art). */
function paletteTint(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsla(${h % 360}, 70%, 55%, 0.45)`;
}

const BRUSHES: { id: Brush; label: string; swatch: string }[] = [
  { id: "#", label: "Solid", swatch: "collision-solid" },
  { id: "~", label: "Water", swatch: "collision-water" },
  { id: "!", label: "Damage", swatch: "collision-damage" },
  { id: ".", label: "Erase", swatch: "erase" },
];

/** Frame column per facing in a 96x16 sheet (see the compiler's
 * convert_npc_sprite): down 0, up 2, right 4; left = mirrored right. */
const FRAME_COL: Record<string, number> = { down: 0, up: 2, right: 4, left: 4 };

type Drag =
  | { kind: "move-npc"; index: number; dx: number; dy: number; x: number; y: number }
  | { kind: "move-door"; index: number; dx: number; dy: number; x: number; y: number }
  | { kind: "resize-door"; index: number; w: number; h: number }
  | { kind: "move-spawn"; dx: number; dy: number; x: number; y: number }
  | { kind: "new-door"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "paint"; value: string; cells: Map<number, string> }
  | { kind: "paint-palette"; value: string | null; cells: Map<number, string | null> };

function useImage(rootPath: string | null, relPath: string | null, base: "project" | "engine" = "project") {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setImg(null);
    setError(null);
    if (!rootPath || !relPath) return;
    let cancelled = false;
    window.api
      .readAsset({ rootPath, relPath, base })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          setError(r.error);
          return;
        }
        const im = new Image();
        im.onload = () => !cancelled && setImg(im);
        im.onerror = () => !cancelled && setError("Couldn't decode image.");
        im.src = r.value.dataUrl;
      })
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [rootPath, relPath, base]);
  return { img, error };
}

/** Loads every sprite sheet the scene's NPCs use (keyed by sprite name). */
function useSpriteSheets(rootPath: string | null, names: string[], hasPlayer: boolean, assetsVersion: unknown) {
  const [sheets, setSheets] = useState<Record<string, HTMLImageElement>>({});
  const key = names.join("|");
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    for (const name of names) {
      const isPlayer = name === "player";
      if (isPlayer && !hasPlayer) continue;
      window.api
        .readAsset({
          rootPath,
          relPath: isPlayer ? "engine/data/player.png" : `assets/sprites/${name}.png`,
          base: isPlayer ? "engine" : "project",
        })
        .then((r) => {
          if (cancelled || !r.ok) return;
          const im = new Image();
          im.onload = () => !cancelled && setSheets((s) => ({ ...s, [name]: im }));
          im.src = r.value.dataUrl;
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, key, hasPlayer, assetsVersion]);
  return sheets;
}

export default function SceneCanvas() {
  const rootPath = useProjectStore((s) => s.project?.rootPath ?? null);
  const scenes = useProjectStore((s) => s.project?.scenes);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const selection = useProjectStore((s) => s.selection);
  const setSelection = useProjectStore((s) => s.setSelection);
  const tool = useProjectStore((s) => s.tool);
  const setTool = useProjectStore((s) => s.setTool);
  const brush = useProjectStore((s) => s.brush);
  const setBrush = useProjectStore((s) => s.setBrush);
  const paletteBrush = useProjectStore((s) => s.paletteBrush);
  const setPaletteBrush = useProjectStore((s) => s.setPaletteBrush);
  const placingPrefabId = useProjectStore((s) => s.placingPrefabId);
  const setPlacingPrefab = useProjectStore((s) => s.setPlacingPrefab);
  const placePrefab = useProjectStore((s) => s.placePrefab);
  const palettes = useProjectStore((s) => s.project?.project.palettes ?? []);
  const prefabs = useProjectStore((s) => s.project?.project.prefabs ?? []);
  /** Authored per-sprite canvas size/composed-frame data (see
   * SpriteSheetJSON) - so NPCs drawn on the canvas can show their real,
   * possibly-bigger-than-16x16 composed frame instead of always cropping
   * a fixed 16x16 legacy-layout square out of the sheet image. */
  const spriteSheetDefs = useProjectStore((s) => s.project?.project.spriteSheets ?? []);
  const tilePick = useProjectStore((s) => s.tilePick);
  const setTilePick = useProjectStore((s) => s.setTilePick);
  const updateScene = useProjectStore((s) => s.updateScene);
  const addNpc = useProjectStore((s) => s.addNpc);
  const addDoor = useProjectStore((s) => s.addDoor);
  const assets = useProjectStore((s) => s.assets);

  const activeScene = scenes?.find((s) => s.fileId === activeSceneId);
  const data = activeScene?.data;

  const [zoom, setZoom] = useState(2);
  const [showCollision, setShowCollision] = useState(true);
  const [showPalettes, setShowPalettes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Captured at ctrl+wheel time, consumed by the layout effect right
   * after the zoom-triggered resize so the point under the cursor stays
   * put (cursor-centered zoom), instead of the canvas re-centering on
   * whatever happened to be at the top-left of the scroll viewport. */
  const zoomAnchorRef = useRef<{ pointX: number; pointY: number; offsetX: number; offsetY: number; scale: number } | null>(null);
  const setHoverTile = useProjectStore((s) => s.setHoverTile);

  // Mirror the hover tile into the store so the bottom status bar can
  // show "<scene name> · x, y" without SceneCanvas and StatusBar needing
  // a direct prop/context link between them.
  useEffect(() => {
    setHoverTile(hover);
    return () => setHoverTile(null);
  }, [hover, setHoverTile]);

  // Background paths in scene JSON are relative to scenes/ (the
  // compiler's `scene_file.parent / scene["background"]`).
  const bgRel = data?.background ? `scenes/${data.background}` : null;
  const { img: bgImage, error: bgError } = useImage(rootPath, bgRel);

  const spriteNames = useMemo(
    () => Array.from(new Set((data?.npcs ?? []).map((n) => n.sprite ?? "player"))).sort(),
    [data?.npcs],
  );
  const sheets = useSpriteSheets(rootPath, spriteNames, !!assets?.playerSprite, assets);

  const bgTilesW = bgImage ? Math.floor(bgImage.width / TILE) : 0;
  const bgTilesH = bgImage ? Math.floor(bgImage.height / TILE) : 0;
  const collisionRows = data?.collision;
  const tileW = bgTilesW || collisionRows?.[0]?.length || 0;
  const tileH = bgTilesH || collisionRows?.length || 0;
  const collisionMismatch =
    !!bgImage && !!collisionRows && (collisionRows.length !== bgTilesH || collisionRows.some((r) => r.length !== bgTilesW));

  // What the scene looks like mid-drag (moves/paint preview locally and
  // commit once on mouse-up, so one drag = one undo step and one save).
  const view = useMemo(() => {
    if (!data || !drag) return data;
    const d: SceneJSON = { ...data };
    if (drag.kind === "move-npc") {
      d.npcs = (data.npcs ?? []).map((n, i) => (i === drag.index ? { ...n, x: drag.x, y: drag.y } : n));
    } else if (drag.kind === "move-door") {
      d.doors = (data.doors ?? []).map((o, i) => (i === drag.index ? { ...o, x: drag.x, y: drag.y } : o));
    } else if (drag.kind === "resize-door") {
      d.doors = (data.doors ?? []).map((o, i) => (i === drag.index ? { ...o, width: drag.w, height: drag.h } : o));
    } else if (drag.kind === "move-spawn") {
      d.player_start = { x: drag.x, y: drag.y };
    } else if (drag.kind === "paint") {
      d.collision = applyPaint(data.collision, tileW, tileH, drag.cells);
    } else if (drag.kind === "paint-palette") {
      d.palette_map = applyPalettePaint(data.palette_map, tileW, tileH, drag.cells);
    }
    return d;
  }, [data, drag, tileW, tileH]);

  // ---- Draw ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    const S = TILE * zoom;
    const pxW = tileW * S;
    const pxH = tileH * S;
    canvas.width = Math.max(pxW, 1);
    canvas.height = Math.max(pxH, 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const css = getComputedStyle(canvas);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;

    ctx.fillStyle = v("--canvas-bg", "#101115");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (bgImage) ctx.drawImage(bgImage, 0, 0, bgImage.width * zoom, bgImage.height * zoom);

    if (showCollision && view.collision) {
      view.collision.forEach((row, ty) => {
        for (let tx = 0; tx < row.length; tx++) {
          const name = COLLISION_VAR[row[tx]];
          if (!name) continue;
          ctx.fillStyle = v(name, "rgba(255,0,0,.4)");
          ctx.fillRect(tx * S, ty * S, S, S);
        }
      });
    }

    if (showPalettes && view.palette_map) {
      view.palette_map.forEach((row, ty) => {
        row.forEach((pid, tx) => {
          if (!pid) return;
          ctx.fillStyle = paletteTint(pid);
          ctx.fillRect(tx * S, ty * S, S, S);
        });
      });
    }

    if (showGrid && zoom >= 2) {
      ctx.strokeStyle = v("--grid-line", "rgba(255,255,255,.06)");
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let tx = 0; tx <= tileW; tx++) {
        ctx.moveTo(tx * S + 0.5, 0);
        ctx.lineTo(tx * S + 0.5, pxH);
      }
      for (let ty = 0; ty <= tileH; ty++) {
        ctx.moveTo(0, ty * S + 0.5);
        ctx.lineTo(pxW, ty * S + 0.5);
      }
      ctx.stroke();
    }

    const accent = v("--accent", "#791fff");
    const font = `${Math.max(9, 5 * zoom)}px ${v("--font-ui", "sans-serif")}`;

    // Doors / triggers.
    (view.doors ?? []).forEach((door, i) => {
      const x = door.x * S;
      const y = door.y * S;
      const w = (door.width ?? 1) * S;
      const h = (door.height ?? 1) * S;
      const selected = selection.kind === "door" && selection.sceneId === activeScene?.fileId && selection.index === i;
      ctx.fillStyle = v("--marker-door", "rgba(121,31,255,.55)");
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = selected ? "#ffffff" : accent;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (zoom >= 2) {
        ctx.fillStyle = "#fff";
        ctx.font = font;
        ctx.textBaseline = "top";
        const label = door.events ? "script" : `→ ${door.target_scene ?? "?"}`;
        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, Math.max(w, S * 6), h);
        ctx.clip();
        ctx.fillText(label, x + 2, y + 2);
        ctx.restore();
      }
      if (selected) {
        // Resize handle.
        ctx.fillStyle = "#fff";
        ctx.fillRect(x + w - 5, y + h - 5, 6, 6);
      }
    });

    // NPCs.
    (view.npcs ?? []).forEach((npc, i) => drawNpc(ctx, npc, i, S, sheets, spriteSheetDefs, selection.kind === "npc" && selection.sceneId === activeScene?.fileId && selection.index === i, v));

    // Player start.
    if (view.player_start) {
      const x = view.player_start.x * S;
      const y = view.player_start.y * S;
      const sz = ACTOR_TILES * S;
      const sheet = sheets.player;
      if (sheet) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(sheet, 0, 0, 16, 16, x, y, sz, sz);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = v("--success", "#3dd68c");
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 1, y + 1, sz - 2, sz - 2);
      ctx.setLineDash([]);
      if (!sheet) {
        ctx.fillStyle = v("--marker-spawn", "rgba(72,199,116,.65)");
        ctx.fillRect(x, y, sz, sz);
      }
    }

    // New-door rubber band.
    if (drag?.kind === "new-door") {
      const r = normRect(drag.x0, drag.y0, drag.x1, drag.y1);
      ctx.fillStyle = "rgba(121,31,255,.35)";
      ctx.fillRect(r.x * S, r.y * S, r.w * S, r.h * S);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x * S + 0.5, r.y * S + 0.5, r.w * S - 1, r.h * S - 1);
    }

    // Hover cursor.
    if (hover && !drag) {
      const size = tool === "npc" || tool === "spawn" ? ACTOR_TILES : 1;
      ctx.strokeStyle = tilePick ? accent : "rgba(255,255,255,.7)";
      ctx.lineWidth = tilePick ? 2 : 1;
      ctx.strokeRect(hover.x * S + 0.5, hover.y * S + 0.5, size * S - 1, size * S - 1);
    }
  }, [view, bgImage, zoom, showCollision, showPalettes, showGrid, tileW, tileH, selection, activeScene?.fileId, sheets, spriteSheetDefs, hover, drag, tool, tilePick]);

  // Cursor-centered ctrl+wheel zoom: the wheel handler below stores the
  // cursor's content-space position (see zoomAnchorRef) before changing
  // zoom, and once the resulting canvas resize has been laid out, this
  // effect scrolls the container so that same point is still under the
  // cursor - instead of the view jumping to whatever was at the
  // viewport's top-left corner.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const scroll = scrollRef.current;
    if (anchor && scroll) {
      scroll.scrollLeft = anchor.pointX * anchor.scale + SCROLL_PAD - anchor.offsetX;
      scroll.scrollTop = anchor.pointY * anchor.scale + SCROLL_PAD - anchor.offsetY;
      zoomAnchorRef.current = null;
    }
  }, [zoom]);

  // ---- Keyboard shortcuts for tools ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        // Escape belongs to an open menu first.
        if (document.querySelector(".popover-menu, .add-event-menu")) return;
        if (useProjectStore.getState().tilePick) setTilePick(null);
        else if (useProjectStore.getState().placingPrefabId) setPlacingPrefab(null);
        else setTool("select");
        setDrag(null);
        return;
      }
      const match = TOOLS.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (match) setTool(match.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setTool, setTilePick, setPlacingPrefab]);

  if (!activeScene || !data) {
    const noScenesYet = !scenes || scenes.length === 0;
    return (
      <div className="scene-canvas-empty">
        {noScenesYet ? (
          <div className="scene-canvas-firstrun">
            <span className="scene-canvas-firstrun-arrow" aria-hidden>
              ↖
            </span>
            <div>
              <p className="scene-canvas-firstrun-title">Let's build something</p>
              <p>
                Click the <span className="scene-canvas-firstrun-plus">+</span> next to "Scenes" in the sidebar on the left to add your
                first scene.
              </p>
            </div>
          </div>
        ) : (
          <p>No scene selected. Add a scene to get started.</p>
        )}
      </div>
    );
  }
  const sceneId = activeScene.fileId;

  const tileAt = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const S = TILE * zoom;
    return {
      x: Math.max(0, Math.min(tileW - 1, Math.floor((e.clientX - r.left) / S))),
      y: Math.max(0, Math.min(tileH - 1, Math.floor((e.clientY - r.top) / S))),
      px: e.clientX - r.left,
      py: e.clientY - r.top,
    };
  };

  const hitNpc = (x: number, y: number) => {
    const npcs = data.npcs ?? [];
    for (let i = npcs.length - 1; i >= 0; i--) {
      const n = npcs[i];
      if (x >= n.x && x < n.x + ACTOR_TILES && y >= n.y && y < n.y + ACTOR_TILES) return i;
    }
    return -1;
  };
  const hitDoor = (x: number, y: number) => {
    const doors = data.doors ?? [];
    for (let i = doors.length - 1; i >= 0; i--) {
      const d = doors[i];
      if (x >= d.x && x < d.x + (d.width ?? 1) && y >= d.y && y < d.y + (d.height ?? 1)) return i;
    }
    return -1;
  };

  const onMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    // Take focus (commits any half-typed field in the panel first, and
    // makes Delete/tool keys go to the canvas).
    e.currentTarget.focus();
    if (tileW === 0) return;
    const t = tileAt(e);
    const S = TILE * zoom;

    if (tilePick) {
      tilePick.onPick(t.x, t.y);
      setTilePick(null);
      return;
    }

    if (tool === "collision" || (e.button === 2 && tool !== "select" && tool !== "palette")) {
      e.preventDefault();
      const value = e.button === 2 ? "." : brush;
      const cells = new Map<number, string>([[t.y * tileW + t.x, value]]);
      setDrag({ kind: "paint", value, cells });
      return;
    }
    if (tool === "palette") {
      e.preventDefault();
      const value = e.button === 2 ? null : paletteBrush;
      const cells = new Map<number, string | null>([[t.y * tileW + t.x, value]]);
      setDrag({ kind: "paint-palette", value, cells });
      return;
    }
    if (e.button !== 0) return;

    if (tool === "placePrefab") {
      if (placingPrefabId) placePrefab(sceneId, placingPrefabId, t.x, t.y);
      return;
    }

    if (tool === "npc") {
      addNpc(sceneId, Math.min(t.x, Math.max(0, tileW - ACTOR_TILES)), Math.min(t.y, Math.max(0, tileH - ACTOR_TILES)));
      return;
    }
    if (tool === "spawn") {
      updateScene(sceneId, (s) => ({ ...s, player_start: { x: t.x, y: t.y } }));
      setTool("select");
      return;
    }
    if (tool === "door") {
      setDrag({ kind: "new-door", x0: t.x, y0: t.y, x1: t.x, y1: t.y });
      return;
    }

    // Select tool: resize handle of the selected door first.
    if (selection.kind === "door" && selection.sceneId === sceneId) {
      const d = data.doors?.[selection.index];
      if (d) {
        const hx = (d.x + (d.width ?? 1)) * S;
        const hy = (d.y + (d.height ?? 1)) * S;
        if (Math.abs(t.px - hx) <= 6 && Math.abs(t.py - hy) <= 6) {
          setDrag({ kind: "resize-door", index: selection.index, w: d.width ?? 1, h: d.height ?? 1 });
          return;
        }
      }
    }
    const ni = hitNpc(t.x, t.y);
    if (ni >= 0) {
      const n = data.npcs![ni];
      setSelection({ kind: "npc", sceneId, index: ni });
      setDrag({ kind: "move-npc", index: ni, dx: t.x - n.x, dy: t.y - n.y, x: n.x, y: n.y });
      return;
    }
    const ps = data.player_start;
    if (ps && t.x >= ps.x && t.x < ps.x + ACTOR_TILES && t.y >= ps.y && t.y < ps.y + ACTOR_TILES) {
      setSelection({ kind: "scene", sceneId });
      setDrag({ kind: "move-spawn", dx: t.x - ps.x, dy: t.y - ps.y, x: ps.x, y: ps.y });
      return;
    }
    const di = hitDoor(t.x, t.y);
    if (di >= 0) {
      const d = data.doors![di];
      setSelection({ kind: "door", sceneId, index: di });
      setDrag({ kind: "move-door", index: di, dx: t.x - d.x, dy: t.y - d.y, x: d.x, y: d.y });
      return;
    }
    setSelection({ kind: "scene", sceneId });
  };

  const onMouseMove = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    if (tileW === 0) return;
    const t = tileAt(e);
    setHover((h) => (h && h.x === t.x && h.y === t.y ? h : { x: t.x, y: t.y }));
    if (!drag) return;
    const clampX = (x: number, w: number) => Math.max(0, Math.min(tileW - w, x));
    const clampY = (y: number, h: number) => Math.max(0, Math.min(tileH - h, y));
    switch (drag.kind) {
      case "move-npc":
      case "move-spawn": {
        const x = clampX(t.x - drag.dx, ACTOR_TILES);
        const y = clampY(t.y - drag.dy, ACTOR_TILES);
        if (x !== drag.x || y !== drag.y) setDrag({ ...drag, x, y });
        break;
      }
      case "move-door": {
        const d = data.doors![drag.index];
        const x = clampX(t.x - drag.dx, d.width ?? 1);
        const y = clampY(t.y - drag.dy, d.height ?? 1);
        if (x !== drag.x || y !== drag.y) setDrag({ ...drag, x, y });
        break;
      }
      case "resize-door": {
        const d = data.doors![drag.index];
        const w = Math.max(1, t.x - d.x + 1);
        const h = Math.max(1, t.y - d.y + 1);
        if (w !== drag.w || h !== drag.h) setDrag({ ...drag, w, h });
        break;
      }
      case "new-door":
        if (t.x !== drag.x1 || t.y !== drag.y1) setDrag({ ...drag, x1: t.x, y1: t.y });
        break;
      case "paint": {
        const k = t.y * tileW + t.x;
        if (drag.cells.get(k) !== drag.value) {
          const cells = new Map(drag.cells);
          cells.set(k, drag.value);
          setDrag({ ...drag, cells });
        }
        break;
      }
      case "paint-palette": {
        const k = t.y * tileW + t.x;
        if (drag.cells.get(k) !== drag.value) {
          const cells = new Map(drag.cells);
          cells.set(k, drag.value);
          setDrag({ ...drag, cells });
        }
        break;
      }
    }
  };

  const finishDrag = () => {
    if (!drag) return;
    const d = drag;
    setDrag(null);
    switch (d.kind) {
      case "move-npc":
        updateScene(sceneId, (s) => ({ ...s, npcs: (s.npcs ?? []).map((n, i) => (i === d.index ? { ...n, x: d.x, y: d.y } : n)) }));
        break;
      case "move-door":
        updateScene(sceneId, (s) => ({ ...s, doors: (s.doors ?? []).map((o, i) => (i === d.index ? { ...o, x: d.x, y: d.y } : o)) }));
        break;
      case "resize-door":
        updateScene(sceneId, (s) => ({
          ...s,
          doors: (s.doors ?? []).map((o, i) => (i === d.index ? { ...o, width: d.w, height: d.h } : o)),
        }));
        break;
      case "move-spawn":
        updateScene(sceneId, (s) => ({ ...s, player_start: { x: d.x, y: d.y } }));
        break;
      case "new-door": {
        let r = normRect(d.x0, d.y0, d.x1, d.y1);
        if (r.w === 1 && r.h === 1) {
          // A single click makes a 2x2 trigger - the player triggers
          // doors with its center, so 1-tile-tall ones can be unreachable.
          r = { x: Math.min(r.x, tileW - 2), y: Math.min(r.y, tileH - 2), w: Math.min(2, tileW), h: Math.min(2, tileH) };
        }
        const others = (scenes ?? []).map(sceneName).filter((n) => n !== sceneName(activeScene));
        const door: DoorJSON = {
          x: Math.max(0, r.x),
          y: Math.max(0, r.y),
          width: r.w,
          height: r.h,
          target_scene: others[0] ?? sceneName(activeScene),
          target_x: 0,
          target_y: 0,
        };
        addDoor(sceneId, door);
        break;
      }
      case "paint":
        updateScene(sceneId, (s) => ({ ...s, collision: applyPaint(s.collision, tileW, tileH, d.cells) }));
        break;
      case "paint-palette":
        updateScene(sceneId, (s) => ({ ...s, palette_map: applyPalettePaint(s.palette_map, tileW, tileH, d.cells) }));
        break;
    }
  };

  const fixCollisionSize = () =>
    updateScene(sceneId, (s) => ({ ...s, collision: resizeCollision(s.collision ?? [], bgTilesW, bgTilesH) }));

  const cursor = tilePick ? "crosshair" : tool === "select" ? (drag ? "grabbing" : "default") : "crosshair";

  return (
    <div className="scene-canvas-wrap">
      <div className="scene-canvas-toolbar">
        <div className="tool-group" role="toolbar" aria-label="Canvas tools">
          {TOOLS.map((t) => (
            <button
              key={t.id}
              className={`tool-btn${tool === t.id && !tilePick ? " tool-btn-active" : ""}`}
              title={`${t.label} (${t.key})`}
              onClick={() => setTool(t.id)}
            >
              <span className="tool-icon">{t.icon}</span>
            </button>
          ))}
        </div>
        <div className="scene-canvas-zoom">
          {ZOOM_LEVELS.map((z) => (
            <button key={z} className={`scene-canvas-zoom-btn${z === zoom ? " scene-canvas-zoom-btn-active" : ""}`} onClick={() => setZoom(z)}>
              {z}×
            </button>
          ))}
        </div>
        <label className="scene-canvas-toggle">
          <input type="checkbox" checked={showCollision} onChange={(e) => setShowCollision(e.target.checked)} />
          Collision
        </label>
        <label className="scene-canvas-toggle">
          <input type="checkbox" checked={showPalettes} onChange={(e) => setShowPalettes(e.target.checked)} />
          Palettes
        </label>
        <label className="scene-canvas-toggle">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          Grid
        </label>
        <span className="scene-canvas-coords">
          {tileW}×{tileH} tiles{hover ? ` · ${hover.x}, ${hover.y}` : ""}
        </span>
      </div>

      {collisionMismatch && (
        <div className="scene-canvas-banner scene-canvas-banner-warn">
          Collision grid is {collisionRows![0]?.length ?? 0}×{collisionRows!.length} but the background is {bgTilesW}×{bgTilesH} tiles — the
          compiler will reject this.
          <button className="btn btn-small" onClick={fixCollisionSize}>
            Resize collision to fit
          </button>
        </div>
      )}

      <div className="scene-canvas-stage">
      {tilePick && (
        <div className="scene-canvas-float scene-canvas-float-pick">
          Click a tile to set <b>{tilePick.label}</b>
          <button className="btn btn-small" onClick={() => setTilePick(null)}>
            Cancel (Esc)
          </button>
        </div>
      )}
      {tool === "collision" && !tilePick && (
        <div className="scene-canvas-float" role="toolbar" aria-label="Collision brush">
          {BRUSHES.map((b) => (
            <button
              key={b.id}
              className={`brush-btn${brush === b.id ? " brush-btn-active" : ""}`}
              onClick={() => setBrush(b.id)}
              title={b.label}
            >
              <span className={`scene-canvas-swatch scene-canvas-swatch-${b.swatch}`} />
              {b.label}
            </button>
          ))}
          <span className="scene-canvas-float-hint">right-click erases</span>
        </div>
      )}
      {tool === "palette" && !tilePick && (
        <div className="scene-canvas-float" role="toolbar" aria-label="Palette brush">
          {palettes.length === 0 && <span className="scene-canvas-float-hint">Add a palette in the sidebar first.</span>}
          {palettes.map((p) => (
            <button
              key={p.id}
              className={`brush-btn${paletteBrush === p.id ? " brush-btn-active" : ""}`}
              onClick={() => setPaletteBrush(p.id)}
              title={p.name}
            >
              <span className="scene-canvas-swatch" style={{ background: paletteTint(p.id) }} />
              {p.name}
            </button>
          ))}
          <span className="scene-canvas-float-hint">right-click clears</span>
        </div>
      )}
      {tool === "placePrefab" && placingPrefabId && (
        <div className="scene-canvas-float scene-canvas-float-pick">
          Click a tile to place <b>{prefabs.find((p) => p.id === placingPrefabId)?.name ?? "prefab"}</b>
          <button className="btn btn-small" onClick={() => setPlacingPrefab(null)}>
            Cancel (Esc)
          </button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="scene-canvas-scroll"
        onWheel={(e) => {
          if (!e.ctrlKey) return;
          e.preventDefault();
          const i = ZOOM_LEVELS.indexOf(zoom);
          const next = ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, i + (e.deltaY < 0 ? 1 : -1)))];
          if (next === zoom) return;
          const scroll = scrollRef.current;
          if (scroll) {
            const r = scroll.getBoundingClientRect();
            const offsetX = e.clientX - r.left;
            const offsetY = e.clientY - r.top;
            zoomAnchorRef.current = {
              pointX: scroll.scrollLeft + offsetX - SCROLL_PAD,
              pointY: scroll.scrollTop + offsetY - SCROLL_PAD,
              offsetX,
              offsetY,
              scale: next / zoom,
            };
          }
          setZoom(next);
        }}
      >
        {bgError && <div className="scene-canvas-error">{bgError}</div>}
        {!data.background && (
          <div className="scene-canvas-error scene-canvas-hint">No background set — pick one in the Properties panel.</div>
        )}
        <canvas
          ref={canvasRef}
          className="scene-canvas"
          style={{ cursor }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={finishDrag}
          onMouseLeave={() => {
            setHover(null);
            finishDrag();
          }}
          onContextMenu={(e) => e.preventDefault()}
          tabIndex={0}
          data-testid="scene-canvas"
        />
      </div>
      </div>
    </div>
  );
}

/** Best animation state on `states` to represent facing `dir` in a static
 * (non-animated) canvas preview: an explicit "idle<Dir>" slot first, then
 * "moving<Dir>"/"jumping<Dir>", then any slot merely ending in that
 * direction, then (for sheets with no `slot`s authored at all - a plain
 * custom-named state) a name that happens to mention the direction word,
 * preferring one that also says "idle" over "walk"/"jump"/etc. */
function findStateForDir(states: SpriteStateJSON[], dir: "up" | "down" | "left" | "right"): SpriteStateJSON | undefined {
  const cap = dir[0].toUpperCase() + dir.slice(1);
  const bySlot = (slot: string) => states.find((st) => (st.slot ?? "").toLowerCase() === slot.toLowerCase());
  const slotMatch =
    bySlot(`idle${cap}`) ??
    bySlot(`moving${cap}`) ??
    bySlot(`jumping${cap}`) ??
    states.find((st) => (st.slot ?? "").toLowerCase().endsWith(dir));
  if (slotMatch) return slotMatch;
  const byName = states.filter((st) => !st.slot && st.name.toLowerCase().includes(dir));
  if (!byName.length) return undefined;
  return byName.find((st) => /idle/i.test(st.name)) ?? byName[0];
}

/** The composed ("metasprite") tiles to show for `def`'s sprite facing
 * `dir`, or null if this sheet has no composed frames at all (the caller
 * falls back to the legacy fixed 96x16 crop in that case) - see
 * SpriteSheetJSON/SpriteStateJSON's doc comments for the data shape this
 * mirrors (same rules SpritesView's own preview uses: a "*Left" state
 * with no frames of its own is derived from its "Right" sibling, mirrored,
 * unless `flipLeft` is explicitly off). */
function composedFrameFor(def: SpriteSheetJSON, dir: "up" | "down" | "left" | "right") {
  const states = def.states ?? [];
  const frames = def.frames ?? [];
  const byId = (id: string) => frames.find((f) => f.id === id);
  const state = findStateForDir(states, dir);
  if (!state) return null;
  let refs = state.frameRefs ?? [];
  let mirror = false;
  if (!refs.length && dir === "left") {
    const rightSlot = state.slot ? SPRITE_LEFT_SLOT_TO_RIGHT[state.slot] : undefined;
    const rightState = rightSlot
      ? states.find((st) => st.slot === rightSlot)
      : states.find((st) => !st.slot && st.name.toLowerCase().includes("right"));
    if (rightState?.frameRefs?.length) {
      refs = rightState.frameRefs;
      mirror = def.flipLeft !== false;
    }
  }
  if (!refs.length) return null;
  const frame = byId(refs[0]);
  if (!frame || !frame.tiles.length) return null;
  const cw = def.canvasWidth ?? 16;
  const ch = def.canvasHeight ?? 16;
  const th = tileHeightFor(def.spriteMode === "8x8" ? "8x8" : "8x16");
  const tiles = normalizeTileIds(frame.tiles);
  return {
    tiles: mirror ? mirrorTilesForLeft(tiles, cw) : tiles,
    cw,
    ch,
    th,
    originX: def.canvasOriginX ?? 0,
    originY: def.canvasOriginY ?? 0,
  };
}

/** Draws one composed frame's tiles at the entity's footprint (x, y) in
 * screen px, using the exact anchoring rule SpriteSheetJSON's doc comment
 * gives (a bigger-than-16x16 canvas grows upward/sideways from the
 * footprint's bottom-centre, shifted by canvasOrigin). Returns true if it
 * drew anything, so the caller knows not to fall back to the legacy crop. */
function drawComposedNpc(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLImageElement,
  def: SpriteSheetJSON | undefined,
  dir: "up" | "down" | "left" | "right",
  x: number,
  y: number,
  S: number,
): boolean {
  if (!def) return false;
  const composed = composedFrameFor(def, dir);
  if (!composed) return false;
  const pxZoom = S / 8; // screen px per sprite (game) pixel
  for (const t of composed.tiles) {
    const dx = t.x + Math.floor((16 - composed.cw) / 2) + composed.originX;
    const dy = t.y + (16 - composed.ch) + composed.originY;
    const sx = t.sheetX * 8;
    const sy = t.sheetY * composed.th;
    const dw = 8 * pxZoom;
    const dh = composed.th * pxZoom;
    ctx.save();
    ctx.translate(x + dx * pxZoom + dw / 2, y + dy * pxZoom + dh / 2);
    ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
    ctx.drawImage(sheet, sx, sy, 8, composed.th, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  }
  return true;
}

function drawNpc(
  ctx: CanvasRenderingContext2D,
  npc: NpcJSON,
  index: number,
  S: number,
  sheets: Record<string, HTMLImageElement>,
  spriteSheetDefs: SpriteSheetJSON[],
  selected: boolean,
  v: (name: string, fallback: string) => string,
) {
  const x = npc.x * S;
  const y = npc.y * S;
  const sz = ACTOR_TILES * S;
  const sheet = sheets[npc.sprite ?? "player"];
  const dir = (npc.direction ?? "down") as "up" | "down" | "left" | "right";
  const def = spriteSheetDefs.find((sd) => sd.name === (npc.sprite ?? "player"));
  const drewComposed = !!sheet && drawComposedNpc(ctx, sheet, def, dir, x, y, S);
  if (!drewComposed) {
    if (sheet && sheet.width >= 96) {
      const col = FRAME_COL[dir] ?? 0;
      ctx.save();
      if (dir === "left") {
        ctx.translate(x + sz, y);
        ctx.scale(-1, 1);
        ctx.drawImage(sheet, col * 16, 0, 16, 16, 0, 0, sz, sz);
      } else {
        ctx.drawImage(sheet, col * 16, 0, 16, 16, x, y, sz, sz);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = v("--marker-npc", "rgba(64,200,220,.6)");
      ctx.fillRect(x, y, sz, sz);
    }
  }
  ctx.strokeStyle = selected ? "#ffffff" : v("--marker-npc", "rgba(64,200,220,.6)");
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
  if (S >= 16) {
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(9, S / 2)}px sans-serif`;
    ctx.textBaseline = "bottom";
    ctx.fillText(npc.name ?? `#${index}`, x + 1, y - 1);
  }
}

function normRect(x0: number, y0: number, x1: number, y1: number) {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0) + 1, h: Math.abs(y1 - y0) + 1 };
}

/** Pad/crop collision rows to exactly w x h (new cells walkable). */
export function resizeCollision(rows: string[], w: number, h: number): string[] {
  const out: string[] = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? "";
    out.push(row.length >= w ? row.slice(0, w) : row + ".".repeat(w - row.length));
  }
  return out;
}

function applyPaint(rows: string[] | undefined, w: number, h: number, cells: Map<number, string>): string[] {
  const base = resizeCollision(rows ?? [], w, h);
  const grid = base.map((r) => r.split(""));
  for (const [k, val] of cells) {
    const x = k % w;
    const y = Math.floor(k / w);
    if (grid[y] && x < w) grid[y][x] = val;
  }
  return grid.map((r) => r.join(""));
}

/** Pad/crop a palette_map to exactly w x h (new cells unpainted/null). */
function resizePaletteMap(rows: (string | null)[][], w: number, h: number): (string | null)[][] {
  const out: (string | null)[][] = [];
  for (let y = 0; y < h; y++) {
    const row = rows[y] ?? [];
    const next: (string | null)[] = [];
    for (let x = 0; x < w; x++) next.push(row[x] ?? null);
    out.push(next);
  }
  return out;
}

function applyPalettePaint(
  rows: (string | null)[][] | undefined,
  w: number,
  h: number,
  cells: Map<number, string | null>,
): (string | null)[][] {
  const grid = resizePaletteMap(rows ?? [], w, h);
  for (const [k, val] of cells) {
    const x = k % w;
    const y = Math.floor(k / w);
    if (grid[y] && x < w) grid[y][x] = val;
  }
  return grid;
}
