import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

import type { BgLayerJSON, DoorJSON, NoteJSON, NpcJSON, ProjectJSON, SceneJSON } from "../../shared/projectTypes";
import { sceneName, useProjectStore, type Brush, type BrushShape, type PaintLayer, type TileStamp, type Tool } from "../state/projectStore";
import { loadSpriteImage, type SpriteImage } from "../sprites/image";
import { playerSpriteName, type Facing } from "../sprites/model";
import { drawActor, sheetFor } from "../sprites/render";
import {
  applyCells,
  brushValue,
  cellKey,
  floodCells,
  footprint,
  lineCells,
  magicCells,
  readCell,
  resizeCollision,
  tileKeysOf,
  type CellValue,
  type Cells,
} from "../world/paint";
import "./SceneCanvas.css";
import Icon, { type IconName } from "./common/Icon";

export { resizeCollision };

const TILE = 8;
/** NPCs and the player are 16x16 sprites anchored at their tile's
 * top-left - 2x2 tiles (same as the compiler's preview images). */
const ACTOR_TILES = 2;

const ZOOM_LEVELS = [1, 2, 3, 4, 6, 8];
/** Must match .scene-canvas-scroll's padding in SceneCanvas.css - used to
 * translate cursor position into unscaled canvas-content coordinates for
 * cursor-centered zoom (see zoomAnchorRef). */
const SCROLL_PAD = 24;

/** GB Studio's world tools (minus its multi-scene ones), same keys. */
const TOOLS: { id: Tool; label: string; key: string; icon: IconName; group: number }[] = [
  { id: "select", label: "Select / move", key: "V", icon: "select", group: 0 },
  { id: "npc", label: "Add actor", key: "A", icon: "actor", group: 0 },
  { id: "door", label: "Add trigger (drag a box)", key: "T", icon: "trigger", group: 0 },
  { id: "note", label: "Add note", key: "N", icon: "note", group: 0 },
  { id: "collision", label: "Paint collisions", key: "C", icon: "collision", group: 1 },
  { id: "palette", label: "Paint colors (BG palettes)", key: "Z", icon: "colors", group: 1 },
  { id: "tiles", label: "Paint tiles", key: "X", icon: "tiles", group: 1 },
  { id: "eraser", label: "Eraser", key: "E", icon: "eraser", group: 1 },
  { id: "spawn", label: "Set player start", key: "P", icon: "start", group: 2 },
];

const BRUSH_SHAPES: { id: BrushShape; label: string; title: string; key?: string }[] = [
  { id: "8px", label: "8px", title: "8px brush", key: "8" },
  { id: "16px", label: "16px", title: "16px brush", key: "9" },
  { id: "fill", label: "Fill", title: "Fill an area", key: "0" },
  { id: "magic", label: "Magic", title: "Paint every matching tile in the scene" },
  { id: "selection", label: "Select", title: "Select an area: Ctrl+C / Ctrl+V / Delete" },
];

const COLLISION_TYPES: { id: Brush; label: string; color: string; edge?: "top" | "bottom" | "left" | "right" }[] = [
  { id: "#", label: "Solid", color: "rgba(255, 64, 64, 0.5)" },
  { id: "^", label: "Top", color: "rgba(255, 210, 0, 0.45)", edge: "top" },
  { id: "v", label: "Bottom", color: "rgba(255, 210, 0, 0.45)", edge: "bottom" },
  { id: "<", label: "Left", color: "rgba(255, 210, 0, 0.45)", edge: "left" },
  { id: ">", label: "Right", color: "rgba(255, 210, 0, 0.45)", edge: "right" },
  { id: "~", label: "Water", color: "rgba(64, 128, 255, 0.5)" },
  { id: "!", label: "Damage", color: "rgba(255, 160, 0, 0.5)" },
  { id: "H", label: "Ladder", color: "rgba(64, 220, 120, 0.5)" },
];
const COLLISION_BY_CHAR = new Map(COLLISION_TYPES.map((c) => [c.id as string, c]));

const LAYER_LABEL: Record<PaintLayer, string> = { collision: "Collisions", palette: "Colors", tiles: "Tiles" };

/** Deterministic display color per palette id, purely for the canvas
 * overlay (the compiler doesn't use this - actual GBA colors come from
 * each palette's own swatches / the background art). */
function paletteTint(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return `hsla(${h % 360}, 70%, 55%, 0.45)`;
}

type Pt = { x: number; y: number };

type Drag =
  | { kind: "move-npc"; index: number; dx: number; dy: number; x: number; y: number }
  | { kind: "move-door"; index: number; dx: number; dy: number; x: number; y: number }
  | { kind: "move-note"; index: number; dx: number; dy: number; x: number; y: number }
  | { kind: "resize-door"; index: number; w: number; h: number }
  | { kind: "move-spawn"; dx: number; dy: number; x: number; y: number }
  | { kind: "new-door"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "select-rect"; x0: number; y0: number; x1: number; y1: number }
  | { kind: "paint"; layer: PaintLayer; erase: boolean; anchor: Pt; last: Pt; cells: Cells };

type Rect = { x: number; y: number; w: number; h: number };

/** Copied actor/trigger, or a copied area of a paint layer. */
let entityClipboard: { kind: "npc"; data: NpcJSON } | { kind: "door"; data: DoorJSON } | null = null;
let layerClipboard: { layer: PaintLayer; w: number; h: number; values: CellValue[] } | null = null;

function isTypingTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
}

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

/** Loads every sprite the scene shows (keyed by sprite name). */
function useSpriteImages(rootPath: string | null, names: string[], assetsVersion: unknown) {
  const [images, setImages] = useState<Record<string, SpriteImage>>({});
  const key = names.join("|");
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    for (const name of names) {
      window.api
        .readAsset({ rootPath, relPath: `assets/sprites/${name}.png`, base: "project" })
        .then((r) => (r.ok ? loadSpriteImage(r.value.dataUrl) : null))
        .then((img) => {
          if (!cancelled && img) setImages((s) => ({ ...s, [name]: img }));
        })
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, key, assetsVersion]);
  return images;
}

/** A note's box on the canvas, in tiles. */
function noteRect(n: NoteJSON): Rect {
  const lines = (n.text || "Note").split("\n").slice(0, 6);
  const longest = Math.max(4, ...lines.map((l) => Math.min(l.length, 28)));
  return { x: n.x, y: n.y, w: Math.ceil(longest * 0.75) + 1, h: Math.max(2, lines.length * 1.5 + 0.5) };
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
  const brushShape = useProjectStore((s) => s.brushShape);
  const setBrushShape = useProjectStore((s) => s.setBrushShape);
  const eraseLayer = useProjectStore((s) => s.eraseLayer);
  const setEraseLayer = useProjectStore((s) => s.setEraseLayer);
  const tileStamp = useProjectStore((s) => s.tileStamp);
  const setTileStamp = useProjectStore((s) => s.setTileStamp);
  const paletteBrush = useProjectStore((s) => s.paletteBrush);
  const setPaletteBrush = useProjectStore((s) => s.setPaletteBrush);
  const placingPrefabId = useProjectStore((s) => s.placingPrefabId);
  const setPlacingPrefab = useProjectStore((s) => s.setPlacingPrefab);
  const placePrefab = useProjectStore((s) => s.placePrefab);
  const projectJson = useProjectStore((s) => s.project?.project);
  const tilePick = useProjectStore((s) => s.tilePick);
  const setTilePick = useProjectStore((s) => s.setTilePick);
  const updateScene = useProjectStore((s) => s.updateScene);
  const addNpc = useProjectStore((s) => s.addNpc);
  const addDoor = useProjectStore((s) => s.addDoor);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const assets = useProjectStore((s) => s.assets);
  const palettes = projectJson?.palettes ?? [];
  const prefabs = projectJson?.prefabs ?? [];

  const activeScene = scenes?.find((s) => s.fileId === activeSceneId);
  const data = activeScene?.data;

  const [zoom, setZoom] = useState(2);
  const [showCollision, setShowCollision] = useState(true);
  const [showPalettes, setShowPalettes] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showValues, setShowValues] = useState(false);
  const [showActors, setShowActors] = useState(true);
  const [opacity, setOpacity] = useState(100);
  const [hover, setHover] = useState<Pt | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [selRect, setSelRect] = useState<Rect | null>(null);
  const lastPaint = useRef<Pt | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Captured at ctrl+wheel time, consumed by the layout effect right
   * after the zoom-triggered resize so the point under the cursor stays
   * put (cursor-centered zoom). */
  const zoomAnchorRef = useRef<{ pointX: number; pointY: number; offsetX: number; offsetY: number; scale: number } | null>(null);
  const setHoverTile = useProjectStore((s) => s.setHoverTile);

  useEffect(() => {
    setHoverTile(hover);
    return () => setHoverTile(null);
  }, [hover, setHoverTile]);

  // The eraser works on whichever layer was painted last.
  useEffect(() => {
    if (tool === "collision" || tool === "palette" || tool === "tiles") setEraseLayer(tool);
  }, [tool, setEraseLayer]);

  // A selection belongs to the layer it was made on.
  useEffect(() => {
    if (brushShape !== "selection") setSelRect(null);
  }, [brushShape, tool, activeSceneId]);

  // Background paths in scene JSON are relative to scenes/ (the
  // compiler's `scene_file.parent / scene["background"]`).
  const bgRel = data?.background ? `scenes/${data.background}` : null;
  const { img: bgImage, error: bgError } = useImage(rootPath, bgRel);
  // Background layers (at most 2), shown as they'd look with the camera
  // at the top-left: behind ones under the map, front ones over it.
  const layer0 = data?.layers?.[0];
  const layer1 = data?.layers?.[1];
  const { img: layerImg0 } = useImage(rootPath, layer0?.image ? `scenes/${layer0.image}` : null);
  const { img: layerImg1 } = useImage(rootPath, layer1?.image ? `scenes/${layer1.image}` : null);
  const tileKeys = useMemo(() => (bgImage ? tileKeysOf(bgImage) : null), [bgImage]);

  const playerSprite = projectJson ? playerSpriteName(projectJson) : "player";
  const spriteNames = useMemo(
    () =>
      Array.from(
        new Set([playerSprite, data?.player_sprite || playerSprite, ...(data?.npcs ?? []).map((n) => n.sprite || playerSprite)]),
      ).sort(),
    [data?.npcs, data?.player_sprite, playerSprite],
  );
  const sheets = useSpriteImages(rootPath, spriteNames, assets);

  const bgTilesW = bgImage ? Math.floor(bgImage.width / TILE) : 0;
  const bgTilesH = bgImage ? Math.floor(bgImage.height / TILE) : 0;
  const collisionRows = data?.collision;
  const tileW = bgTilesW || collisionRows?.[0]?.length || 0;
  const tileH = bgTilesH || collisionRows?.length || 0;
  const collisionMismatch =
    !!bgImage && !!collisionRows && (collisionRows.length !== bgTilesH || collisionRows.some((r) => r.length !== bgTilesW));

  const paintLayer: PaintLayer | null =
    tool === "collision"
      ? "collision"
      : tool === "palette"
        ? "palette"
        : tool === "tiles"
          ? "tiles"
          : tool === "eraser"
            ? eraseLayer
            : null;

  // What the scene looks like mid-drag (moves/paint preview locally and
  // commit once on mouse-up, so one drag = one undo step and one save).
  const view = useMemo(() => {
    if (!data || !drag) return data;
    const d: SceneJSON = { ...data };
    if (drag.kind === "move-npc") {
      d.npcs = (data.npcs ?? []).map((n, i) => (i === drag.index ? { ...n, x: drag.x, y: drag.y } : n));
    } else if (drag.kind === "move-door") {
      d.doors = (data.doors ?? []).map((o, i) => (i === drag.index ? { ...o, x: drag.x, y: drag.y } : o));
    } else if (drag.kind === "move-note") {
      d.notes = (data.notes ?? []).map((o, i) => (i === drag.index ? { ...o, x: drag.x, y: drag.y } : o));
    } else if (drag.kind === "resize-door") {
      d.doors = (data.doors ?? []).map((o, i) => (i === drag.index ? { ...o, width: drag.w, height: drag.h } : o));
    } else if (drag.kind === "move-spawn") {
      d.player_start = { x: drag.x, y: drag.y };
    } else if (drag.kind === "paint") {
      return applyCells(d, drag.layer, tileW, tileH, drag.cells);
    }
    return d;
  }, [data, drag, tileW, tileH]);

  const S = TILE * zoom;

  /** The cells a brush stroke covers at `t` (and between it and `from`). */
  const strokeCells = (layer: PaintLayer, erase: boolean, anchor: Pt, from: Pt | null, t: Pt, into: Cells) => {
    const size = brushShape === "16px" ? 2 : 1;
    const stamp = layer === "tiles" && !erase ? tileStamp : null;
    const pts = from ? lineCells(from.x, from.y, t.x, t.y) : [[t.x, t.y] as [number, number]];
    for (const [px, py] of pts)
      for (const [cx, cy] of footprint(size, stamp, anchor, px, py)) {
        if (cx < 0 || cy < 0 || cx >= tileW || cy >= tileH) continue;
        into.set(cy * tileW + cx, brushValue(layer, erase, brush, paletteBrush, stamp, anchor, cx, cy));
      }
    return into;
  };

  // ---- Draw ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !view) return;
    const pxW = tileW * S;
    const pxH = tileH * S;
    canvas.width = Math.max(pxW, 1);
    canvas.height = Math.max(pxH, 1);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const css = getComputedStyle(canvas);
    const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;

    ctx.fillStyle = v("--canvas-bg", "#1c1c1c");
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const layerPairs: [BgLayerJSON | undefined, HTMLImageElement | null][] = [
      [layer1, layerImg1],
      [layer0, layerImg0],
    ];
    const drawLayer = (img: HTMLImageElement) => {
      // Repeats every 256 or 512 px, like the hardware background.
      const rw = img.width <= 256 ? 256 : 512;
      const rh = img.height <= 256 ? 256 : 512;
      const areaW = bgImage ? bgImage.width : 0;
      const areaH = bgImage ? bgImage.height : 0;
      for (let y = 0; y < areaH; y += rh)
        for (let x = 0; x < areaW; x += rw) ctx.drawImage(img, x * zoom, y * zoom, img.width * zoom, img.height * zoom);
    };
    for (const [layer, img] of layerPairs) if (layer && !layer.front && img) drawLayer(img);
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0, bgImage.width * zoom, bgImage.height * zoom);
      for (const [key, [sx, sy]] of Object.entries(view.tile_overrides ?? {})) {
        const [x, y] = key.split(",").map(Number);
        ctx.clearRect(x * S, y * S, S, S);
        ctx.fillStyle = v("--canvas-bg", "#1c1c1c");
        ctx.fillRect(x * S, y * S, S, S);
        ctx.drawImage(bgImage, sx * TILE, sy * TILE, TILE, TILE, x * S, y * S, S, S);
      }
    }
    ctx.globalAlpha = 0.5;
    for (const [layer, img] of layerPairs) if (layer && layer.front && img) drawLayer(img);
    ctx.globalAlpha = 1;

    ctx.globalAlpha = opacity / 100;
    if (showCollision && view.collision) {
      const edgeW = Math.max(2, Math.round(S / 5));
      view.collision.forEach((row, ty) => {
        for (let tx = 0; tx < row.length; tx++) {
          const c = COLLISION_BY_CHAR.get(row[tx]);
          if (!c) continue;
          ctx.fillStyle = c.color;
          ctx.fillRect(tx * S, ty * S, S, S);
          if (c.edge) {
            ctx.fillStyle = "rgba(255, 240, 150, 0.95)";
            const x = tx * S;
            const y = ty * S;
            if (c.edge === "top") ctx.fillRect(x, y, S, edgeW);
            else if (c.edge === "bottom") ctx.fillRect(x, y + S - edgeW, S, edgeW);
            else if (c.edge === "left") ctx.fillRect(x, y, edgeW, S);
            else ctx.fillRect(x + S - edgeW, y, edgeW, S);
          }
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
    ctx.globalAlpha = 1;

    if (showValues && S >= 12) {
      // GB Studio's "show tile values": what each cell holds, as text.
      ctx.font = `${Math.floor(S * 0.55)}px ${v("--font-mono", "monospace")}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "rgba(0,0,0,.8)";
      ctx.lineWidth = 2;
      for (let ty = 0; ty < tileH; ty++)
        for (let tx = 0; tx < tileW; tx++) {
          let label = "";
          if (paintLayer === "palette") {
            const pid = view.palette_map?.[ty]?.[tx];
            const pi = pid ? palettes.findIndex((p) => p.id === pid) : -1;
            label = pi >= 0 ? String(pi + 1) : "";
          } else if (paintLayer === "tiles") {
            label = view.tile_overrides?.[`${tx},${ty}`] ? "•" : "";
          } else {
            const ch = view.collision?.[ty]?.[tx] ?? ".";
            label = ch === "." ? "" : ch;
          }
          if (!label) continue;
          ctx.strokeText(label, tx * S + S / 2, ty * S + S / 2);
          ctx.fillText(label, tx * S + S / 2, ty * S + S / 2);
        }
      ctx.textAlign = "left";
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
    const dim = paintLayer !== null && !showActors;

    if (!dim) {
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
          ctx.fillStyle = "#fff";
          ctx.fillRect(x + w - 5, y + h - 5, 6, 6);
        }
      });

      // Parallax bands: where each one ends, from the top of the screen.
      if (view.parallax && view.parallax.length > 1) {
        let row = 0;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([6, 4]);
        ctx.fillStyle = accent;
        ctx.font = font;
        ctx.textBaseline = "bottom";
        view.parallax.slice(0, -1).forEach((layer, i) => {
          row += layer.rows ?? 1;
          const y = row * S + 0.5;
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(pxW, y);
          ctx.stroke();
          if (zoom >= 2) ctx.fillText(`Parallax ${i + 1}`, 3, y - 2);
        });
        ctx.setLineDash([]);
      }

      // NPCs.
      (view.npcs ?? []).forEach((npc, i) =>
        drawNpc(
          ctx,
          npc,
          i,
          S,
          sheets,
          projectJson,
          playerSprite,
          selection.kind === "npc" && selection.sceneId === activeScene?.fileId && selection.index === i,
          v,
        ),
      );

      // Player start.
      if (view.player_start) {
        const x = view.player_start.x * S;
        const y = view.player_start.y * S;
        const sz = ACTOR_TILES * S;
        const startSprite = view.player_sprite || playerSprite;
        const img = sheets[startSprite];
        const sheet = img && projectJson ? sheetFor(projectJson, startSprite, img) : null;
        const drew =
          !!img &&
          !!sheet &&
          drawActor(ctx, img, sheet, (view.player_start_direction ?? "down") as Facing, x, y, S / TILE, { alpha: 0.85 });
        ctx.strokeStyle = v("--success", "#3dd68c");
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(x + 1, y + 1, sz - 2, sz - 2);
        ctx.setLineDash([]);
        if (!drew) {
          ctx.fillStyle = v("--marker-spawn", "rgba(72,199,116,.65)");
          ctx.fillRect(x, y, sz, sz);
        }
      }

      // Notes.
      (view.notes ?? []).forEach((n, i) => {
        const r = noteRect(n);
        const selected = selection.kind === "note" && selection.sceneId === activeScene?.fileId && selection.index === i;
        ctx.fillStyle = "rgba(255, 226, 120, 0.92)";
        ctx.fillRect(r.x * S, r.y * S, r.w * S, r.h * S);
        ctx.strokeStyle = selected ? "#fff" : "rgba(120, 90, 0, 0.9)";
        ctx.lineWidth = selected ? 2 : 1;
        ctx.strokeRect(r.x * S + 0.5, r.y * S + 0.5, r.w * S - 1, r.h * S - 1);
        ctx.fillStyle = "#3a2c00";
        ctx.font = `${Math.max(8, Math.floor(S * 1.05))}px ${v("--font-ui", "sans-serif")}`;
        ctx.textBaseline = "top";
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x * S, r.y * S, r.w * S, r.h * S);
        ctx.clip();
        (n.text || "Note")
          .split("\n")
          .slice(0, 6)
          .forEach((line, li) => ctx.fillText(line, r.x * S + S * 0.4, r.y * S + S * 0.3 + li * S * 1.5));
        ctx.restore();
      });
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

    // Area selection (selection brush).
    const sr = drag?.kind === "select-rect" ? normRect(drag.x0, drag.y0, drag.x1, drag.y1) : selRect;
    if (sr) {
      ctx.fillStyle = "rgba(121,31,255,.15)";
      ctx.fillRect(sr.x * S, sr.y * S, sr.w * S, sr.h * S);
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(sr.x * S + 0.5, sr.y * S + 0.5, sr.w * S - 1, sr.h * S - 1);
      ctx.setLineDash([]);
    }

    // Hover cursor: the brush's footprint.
    if (hover && !drag) {
      let rect: Rect = { x: hover.x, y: hover.y, w: 1, h: 1 };
      if (tool === "npc" || tool === "spawn" || tool === "placePrefab") rect = { ...rect, w: ACTOR_TILES, h: ACTOR_TILES };
      else if (paintLayer && brushShape === "16px") rect = { ...rect, w: 2, h: 2 };
      else if (tool === "tiles" && tileStamp && brushShape !== "fill" && brushShape !== "magic" && brushShape !== "selection")
        rect = { ...rect, w: tileStamp.w, h: tileStamp.h };
      else if (paintLayer && brushShape === "selection" && layerClipboard?.layer === paintLayer)
        rect = { ...rect, w: layerClipboard.w, h: layerClipboard.h };
      if (tool === "tiles" && bgImage && tileStamp && rect.w === tileStamp.w && rect.h === tileStamp.h) {
        ctx.globalAlpha = 0.7;
        ctx.drawImage(
          bgImage,
          tileStamp.x * TILE,
          tileStamp.y * TILE,
          tileStamp.w * TILE,
          tileStamp.h * TILE,
          rect.x * S,
          rect.y * S,
          rect.w * S,
          rect.h * S,
        );
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = tilePick ? accent : tool === "eraser" ? "#ff7a7a" : "rgba(255,255,255,.8)";
      ctx.lineWidth = tilePick ? 2 : 1;
      ctx.strokeRect(rect.x * S + 0.5, rect.y * S + 0.5, rect.w * S - 1, rect.h * S - 1);
    }
  }, [
    view,
    bgImage,
    layer0,
    layer1,
    layerImg0,
    layerImg1,
    zoom,
    S,
    showCollision,
    showPalettes,
    showGrid,
    showValues,
    showActors,
    opacity,
    tileW,
    tileH,
    selection,
    activeScene?.fileId,
    sheets,
    projectJson,
    playerSprite,
    hover,
    drag,
    tool,
    tilePick,
    selRect,
    paintLayer,
    brushShape,
    tileStamp,
    palettes,
  ]);

  // Cursor-centered ctrl+wheel zoom (see zoomAnchorRef).
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const scroll = scrollRef.current;
    if (anchor && scroll) {
      scroll.scrollLeft = anchor.pointX * anchor.scale + SCROLL_PAD - anchor.offsetX;
      scroll.scrollTop = anchor.pointY * anchor.scale + SCROLL_PAD - anchor.offsetY;
      zoomAnchorRef.current = null;
    }
  }, [zoom]);

  // ---- Keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useProjectStore.getState().section !== "world") return;
      if (isTypingTarget(e.target)) return;
      handleKey.current?.(e);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const handleKey = useRef<((e: KeyboardEvent) => void) | null>(null);

  const sceneId = activeScene?.fileId ?? "";

  const copyArea = (r: Rect, layer: PaintLayer) => {
    if (!data) return;
    const values: CellValue[] = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) values.push(readCell(data, layer, x, y));
    layerClipboard = { layer, w: r.w, h: r.h, values };
  };
  const clearArea = (r: Rect, layer: PaintLayer) => {
    const cells: Cells = new Map();
    for (let y = r.y; y < r.y + r.h; y++)
      for (let x = r.x; x < r.x + r.w; x++) cells.set(y * tileW + x, layer === "collision" ? "." : null);
    updateScene(sceneId, (s) => applyCells(s, layer, tileW, tileH, cells));
  };
  const pasteArea = (at: Pt, layer: PaintLayer) => {
    const clip = layerClipboard;
    if (!clip || clip.layer !== layer) return;
    const cells: Cells = new Map();
    for (let j = 0; j < clip.h; j++)
      for (let i = 0; i < clip.w; i++) {
        const x = at.x + i;
        const y = at.y + j;
        if (x < tileW && y < tileH) cells.set(y * tileW + x, clip.values[j * clip.w + i]);
      }
    updateScene(sceneId, (s) => applyCells(s, layer, tileW, tileH, cells));
    setSelRect({ x: at.x, y: at.y, w: Math.min(clip.w, tileW - at.x), h: Math.min(clip.h, tileH - at.y) });
  };
  const pasteEntity = (at: Pt | null) => {
    const clip = entityClipboard;
    if (!clip || !data) return;
    if (clip.kind === "npc") {
      const pos = at ?? { x: clip.data.x + 2, y: clip.data.y };
      const npc: NpcJSON = {
        ...structuredClone(clip.data),
        x: Math.min(pos.x, tileW - ACTOR_TILES),
        y: Math.min(pos.y, tileH - ACTOR_TILES),
      };
      // Names are unique per scene.
      if (npc.name) {
        const names = new Set((data.npcs ?? []).map((n) => n.name));
        let n = 2;
        const base = npc.name.replace(/_\d+$/, "");
        while (names.has(`${base}_${n}`)) n++;
        npc.name = names.has(npc.name) ? `${base}_${n}` : npc.name;
      }
      const index = (data.npcs ?? []).length;
      updateScene(sceneId, (s) => ({ ...s, npcs: [...(s.npcs ?? []), npc] }));
      setSelection({ kind: "npc", sceneId, index });
    } else {
      const pos = at ?? { x: clip.data.x + 2, y: clip.data.y };
      const door: DoorJSON = { ...structuredClone(clip.data), x: pos.x, y: pos.y };
      const index = (data.doors ?? []).length;
      updateScene(sceneId, (s) => ({ ...s, doors: [...(s.doors ?? []), door] }));
      setSelection({ kind: "door", sceneId, index });
    }
  };

  handleKey.current = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && !e.shiftKey && !e.altKey) {
      if (!data) return;
      if (k === "c") {
        if (selRect && paintLayer) copyArea(selRect, paintLayer);
        else if (selection.kind === "npc" && selection.sceneId === sceneId && data.npcs?.[selection.index])
          entityClipboard = { kind: "npc", data: structuredClone(data.npcs[selection.index]) };
        else if (selection.kind === "door" && selection.sceneId === sceneId && data.doors?.[selection.index])
          entityClipboard = { kind: "door", data: structuredClone(data.doors[selection.index]) };
        else return;
        e.preventDefault();
      } else if (k === "x" && selRect && paintLayer) {
        e.preventDefault();
        copyArea(selRect, paintLayer);
        clearArea(selRect, paintLayer);
      } else if (k === "v") {
        if (paintLayer && layerClipboard?.layer === paintLayer) {
          e.preventDefault();
          pasteArea(hover ?? selRect ?? { x: 0, y: 0 }, paintLayer);
        } else if (entityClipboard) {
          e.preventDefault();
          pasteEntity(hover);
        }
      } else if (k === "d") {
        e.preventDefault();
        if (selection.kind === "npc" && data.npcs?.[selection.index]) {
          entityClipboard = { kind: "npc", data: structuredClone(data.npcs[selection.index]) };
          pasteEntity(null);
        } else if (selection.kind === "door" && data.doors?.[selection.index]) {
          entityClipboard = { kind: "door", data: structuredClone(data.doors[selection.index]) };
          pasteEntity(null);
        }
      }
      return;
    }
    if (mod || e.altKey) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selRect && paintLayer) {
      e.preventDefault();
      e.stopImmediatePropagation();
      clearArea(selRect, paintLayer);
      return;
    }
    if (e.key === "Escape") {
      if (document.querySelector(".popover-menu, .add-event-menu")) return;
      if (useProjectStore.getState().tilePick) setTilePick(null);
      else if (useProjectStore.getState().placingPrefabId) setPlacingPrefab(null);
      else if (selRect) setSelRect(null);
      else setTool("select");
      setDrag(null);
      return;
    }
    const shape = BRUSH_SHAPES.find((b) => b.key === e.key);
    if (shape) {
      setBrushShape(shape.id);
      return;
    }
    const match = TOOLS.find((x) => x.key.toLowerCase() === k);
    if (match) setTool(match.id);
  };

  if (!activeScene || !data) {
    const noScenesYet = !scenes || scenes.length === 0;
    return (
      <div className="scene-canvas-empty">
        {noScenesYet ? (
          <div className="scene-canvas-firstrun">
            <div>
              <p className="scene-canvas-firstrun-title">No scenes yet</p>
              <p>
                Add one with <span className="scene-canvas-firstrun-plus">+</span> next to Scenes.
              </p>
            </div>
          </div>
        ) : (
          <p>No scene selected. Add a scene to get started.</p>
        )}
      </div>
    );
  }

  const tileAt = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect();
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
  const hitNote = (px: number, py: number) => {
    const notes = data.notes ?? [];
    for (let i = notes.length - 1; i >= 0; i--) {
      const r = noteRect(notes[i]);
      if (px >= r.x * S && px < (r.x + r.w) * S && py >= r.y * S && py < (r.y + r.h) * S) return i;
    }
    return -1;
  };

  const keyFn = (layer: PaintLayer) => (x: number, y: number) => cellKey(data, layer, x, y, tileKeys, tileW);

  const onMouseDown = (e: ReactMouseEvent<HTMLCanvasElement>) => {
    // Take focus (commits any half-typed field in the panel first, and
    // makes Delete/tool keys go to the canvas).
    e.currentTarget.focus();
    if (tileW === 0) return;
    const t = tileAt(e);

    if (tilePick) {
      tilePick.onPick(t.x, t.y);
      setTilePick(null);
      return;
    }

    // Eyedropper: Alt+click picks what's under the cursor.
    if (e.altKey && paintLayer) {
      if (paintLayer === "collision") {
        const ch = data.collision?.[t.y]?.[t.x] ?? ".";
        if (ch !== ".") setBrush(ch as Brush);
      } else if (paintLayer === "palette") {
        const pid = data.palette_map?.[t.y]?.[t.x];
        if (pid) setPaletteBrush(pid);
      } else {
        const o = data.tile_overrides?.[`${t.x},${t.y}`];
        setTileStamp({ x: o ? o[0] : t.x, y: o ? o[1] : t.y, w: 1, h: 1 });
      }
      return;
    }

    // The eraser removes actors, triggers and notes it lands on.
    if (tool === "eraser" && e.button === 0 && showActors) {
      const ni = hitNpc(t.x, t.y);
      const di = ni < 0 ? hitDoor(t.x, t.y) : -1;
      const no = ni < 0 && di < 0 ? hitNote(t.px, t.py) : -1;
      if (ni >= 0 || di >= 0 || no >= 0) {
        setSelection(
          ni >= 0
            ? { kind: "npc", sceneId, index: ni }
            : di >= 0
              ? { kind: "door", sceneId, index: di }
              : { kind: "note", sceneId, index: no },
        );
        deleteSelected();
        return;
      }
    }

    const paintingTool = paintLayer !== null && tool !== "select";
    if (paintingTool || (e.button === 2 && (tool === "npc" || tool === "door" || tool === "spawn"))) {
      e.preventDefault();
      const layer: PaintLayer = paintLayer ?? "collision";
      const erase = tool === "eraser" || e.button === 2;
      if (brushShape === "selection" && paintingTool && e.button === 0) {
        setSelRect(null);
        setSelection({ kind: "scene", sceneId });
        setDrag({ kind: "select-rect", x0: t.x, y0: t.y, x1: t.x, y1: t.y });
        return;
      }
      if (!erase && layer === "palette" && !paletteBrush) return;
      if (!erase && layer === "tiles" && !tileStamp) return;
      const anchor = { x: t.x, y: t.y };
      if (paintingTool && (brushShape === "fill" || brushShape === "magic")) {
        const idx = (brushShape === "fill" ? floodCells : magicCells)(tileW, tileH, t.x, t.y, keyFn(layer));
        const stamp = layer === "tiles" && !erase ? tileStamp : null;
        const cells: Cells = new Map();
        for (const k of idx) {
          const x = k % tileW;
          const y = Math.floor(k / tileW);
          cells.set(k, brushValue(layer, erase, brush, paletteBrush, stamp, anchor, x, y));
        }
        updateScene(sceneId, (s) => applyCells(s, layer, tileW, tileH, cells));
        lastPaint.current = anchor;
        return;
      }
      const from = e.shiftKey && lastPaint.current ? lastPaint.current : null;
      const cells = strokeCells(layer, erase, from ?? anchor, from, t, new Map());
      setDrag({ kind: "paint", layer, erase, anchor: from ?? anchor, last: { x: t.x, y: t.y }, cells });
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
    if (tool === "note") {
      const index = (data.notes ?? []).length;
      updateScene(sceneId, (s) => ({ ...s, notes: [...(s.notes ?? []), { x: t.x, y: t.y, text: "" }] }));
      setSelection({ kind: "note", sceneId, index });
      setTool("select");
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
    const noi = hitNote(t.px, t.py);
    if (noi >= 0) {
      const n = data.notes![noi];
      setSelection({ kind: "note", sceneId, index: noi });
      setDrag({ kind: "move-note", index: noi, dx: t.x - n.x, dy: t.y - n.y, x: n.x, y: n.y });
      return;
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
      case "move-note": {
        const x = clampX(t.x - drag.dx, 1);
        const y = clampY(t.y - drag.dy, 1);
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
      case "select-rect":
        if (t.x !== drag.x1 || t.y !== drag.y1) setDrag({ ...drag, x1: t.x, y1: t.y });
        break;
      case "paint": {
        if (t.x === drag.last.x && t.y === drag.last.y) break;
        const cells = strokeCells(drag.layer, drag.erase, drag.anchor, drag.last, t, new Map(drag.cells));
        setDrag({ ...drag, last: { x: t.x, y: t.y }, cells });
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
      case "move-note":
        updateScene(sceneId, (s) => ({ ...s, notes: (s.notes ?? []).map((o, i) => (i === d.index ? { ...o, x: d.x, y: d.y } : o)) }));
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
      case "select-rect":
        setSelRect(normRect(d.x0, d.y0, d.x1, d.y1));
        break;
      case "paint":
        updateScene(sceneId, (s) => applyCells(s, d.layer, tileW, tileH, d.cells));
        lastPaint.current = d.last;
        break;
    }
  };

  const fixCollisionSize = () => updateScene(sceneId, (s) => ({ ...s, collision: resizeCollision(s.collision ?? [], bgTilesW, bgTilesH) }));

  // A background swapped for one of another size: fit the collision grid
  // to it (cut off / walkable padding) straight away.
  useEffect(() => {
    if (collisionMismatch && bgImage) fixCollisionSize();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collisionMismatch, bgImage, sceneId]);

  const cursor = tilePick ? "crosshair" : tool === "select" ? (drag ? "grabbing" : "default") : tool === "eraser" ? "cell" : "crosshair";

  return (
    <div className="scene-canvas-wrap">
      <div className="scene-canvas-toolbar">
        <div className="tool-group" role="toolbar" aria-label="Canvas tools">
          {TOOLS.map((t, i) => (
            <span key={t.id} className="tool-slot">
              {i > 0 && TOOLS[i - 1].group !== t.group && <span className="tool-sep" />}
              <button
                className={`tool-btn${tool === t.id && !tilePick ? " tool-btn-active" : ""}`}
                title={`${t.label} (${t.key})`}
                onClick={() => setTool(t.id)}
                data-testid={`tool-${t.id}`}
              >
                <Icon name={t.icon} size={14} />
              </button>
            </span>
          ))}
        </div>
        <div className="scene-canvas-zoom">
          <button
            className="scene-canvas-zoom-btn"
            title="Zoom out (Ctrl+wheel)"
            disabled={zoom === ZOOM_LEVELS[0]}
            onClick={() => setZoom(ZOOM_LEVELS[Math.max(0, ZOOM_LEVELS.indexOf(zoom) - 1)])}
          >
            −
          </button>
          <span className="scene-canvas-zoom-label">{zoom * 100}%</span>
          <button
            className="scene-canvas-zoom-btn"
            title="Zoom in (Ctrl+wheel)"
            disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
            onClick={() => setZoom(ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, ZOOM_LEVELS.indexOf(zoom) + 1)])}
          >
            +
          </button>
        </div>
        <label className="scene-canvas-toggle">
          <input type="checkbox" checked={showCollision} onChange={(e) => setShowCollision(e.target.checked)} />
          Collisions
        </label>
        <label className="scene-canvas-toggle">
          <input type="checkbox" checked={showPalettes} onChange={(e) => setShowPalettes(e.target.checked)} />
          Colors
        </label>
        <label className="scene-canvas-toggle">
          <input type="checkbox" checked={showGrid} onChange={(e) => setShowGrid(e.target.checked)} />
          Grid
        </label>
        <label className="scene-canvas-toggle" title="Show each tile's value as text (zoom 2x or more)">
          <input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} />
          Values
        </label>
        <label className="scene-canvas-toggle" title="Show actors, triggers and notes while painting">
          <input type="checkbox" checked={showActors} onChange={(e) => setShowActors(e.target.checked)} />
          Actors
        </label>
        <label className="scene-canvas-toggle" title="Layer opacity">
          <input
            type="range"
            min={10}
            max={100}
            step={5}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="scene-canvas-opacity"
          />
        </label>
        <span className="scene-canvas-coords">
          {tileW}×{tileH} tiles{hover ? ` · ${hover.x}, ${hover.y}` : ""}
        </span>
      </div>

      {collisionMismatch && (
        <div className="scene-canvas-banner scene-canvas-banner-warn">
          Collision grid is {collisionRows![0]?.length ?? 0}×{collisionRows!.length} but the background is {bgTilesW}×{bgTilesH} tiles.
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
        {paintLayer && !tilePick && (
          <div className="scene-canvas-float" role="toolbar" aria-label="Brush">
            {BRUSH_SHAPES.map((b) => (
              <button
                key={b.id}
                className={`brush-btn${brushShape === b.id ? " brush-btn-active" : ""}`}
                onClick={() => setBrushShape(b.id)}
                title={`${b.title}${b.key ? ` (${b.key})` : ""}`}
                data-testid={`brush-${b.id}`}
              >
                {b.label}
              </button>
            ))}
            <span className="brush-sep" />
            {tool === "collision" &&
              COLLISION_TYPES.map((c) => (
                <button
                  key={c.id}
                  className={`brush-btn${brush === c.id ? " brush-btn-active" : ""}`}
                  onClick={() => setBrush(c.id)}
                  title={c.edge ? `One-way: the ${c.edge} edge is solid` : c.label}
                  data-testid={`collision-${c.label.toLowerCase()}`}
                >
                  <span className={`scene-canvas-swatch${c.edge ? ` swatch-edge-${c.edge}` : ""}`} style={{ background: c.color }} />
                  {c.label}
                </button>
              ))}
            {tool === "palette" && palettes.length === 0 && (
              <span className="scene-canvas-float-hint">Add a palette in the sidebar first.</span>
            )}
            {tool === "palette" &&
              palettes.map((p, i) => (
                <button
                  key={p.id}
                  className={`brush-btn${paletteBrush === p.id ? " brush-btn-active" : ""}`}
                  onClick={() => setPaletteBrush(p.id)}
                  title={p.name}
                >
                  <span className="scene-canvas-swatch" style={{ background: paletteTint(p.id) }} />
                  {i + 1}. {p.name}
                </button>
              ))}
            {tool === "tiles" && (
              <span className="scene-canvas-float-hint">
                {tileStamp ? `Stamp ${tileStamp.w}×${tileStamp.h} from ${tileStamp.x}, ${tileStamp.y}` : "Pick tiles in the panel below"}
              </span>
            )}
            {tool === "eraser" &&
              (["collision", "palette", "tiles"] as PaintLayer[]).map((l) => (
                <button key={l} className={`brush-btn${eraseLayer === l ? " brush-btn-active" : ""}`} onClick={() => setEraseLayer(l)}>
                  {LAYER_LABEL[l]}
                </button>
              ))}
            <span className="scene-canvas-float-hint">
              {tool === "eraser" ? "also removes actors / triggers / notes" : "right-click erases · alt-click picks"}
            </span>
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
        {tool === "tiles" && bgImage && <TilePicker img={bgImage} stamp={tileStamp} onPick={setTileStamp} />}
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

/** Tiles tool: the scene's background as a tile sheet - drag to pick a
 * stamp (one tile or a block of them). */
function TilePicker({ img, stamp, onPick }: { img: HTMLImageElement; stamp: TileStamp | null; onPick: (s: TileStamp) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [z, setZ] = useState(2);
  const [open, setOpen] = useState(true);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.width = img.width * z;
    c.height = img.height * z;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.beginPath();
    for (let x = 8; x < img.width; x += 8) {
      ctx.moveTo(x * z + 0.5, 0);
      ctx.lineTo(x * z + 0.5, c.height);
    }
    for (let y = 8; y < img.height; y += 8) {
      ctx.moveTo(0, y * z + 0.5);
      ctx.lineTo(c.width, y * z + 0.5);
    }
    ctx.stroke();
    const r = drag ? normRect(drag.x0, drag.y0, drag.x1, drag.y1) : stamp;
    if (r) {
      ctx.fillStyle = "rgba(121,31,255,0.3)";
      ctx.fillRect(r.x * 8 * z, r.y * 8 * z, r.w * 8 * z, r.h * 8 * z);
      ctx.strokeStyle = "#a36bff";
      ctx.lineWidth = 2;
      ctx.strokeRect(r.x * 8 * z + 1, r.y * 8 * z + 1, r.w * 8 * z - 2, r.h * 8 * z - 2);
    }
  }, [img, z, drag, stamp]);

  const cell = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(Math.floor(img.width / 8) - 1, Math.floor((e.clientX - r.left) / (8 * z)))),
      y: Math.max(0, Math.min(Math.floor(img.height / 8) - 1, Math.floor((e.clientY - r.top) / (8 * z)))),
    };
  };
  useEffect(() => {
    if (!drag) return;
    const move = (e: MouseEvent) => {
      const c = cell(e);
      setDrag((d) => (d ? { ...d, x1: c.x, y1: c.y } : d));
    };
    const up = () => {
      onPick(normRect(drag.x0, drag.y0, drag.x1, drag.y1));
      setDrag(null);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, z]);

  return (
    <div className={`tile-picker${open ? "" : " tile-picker-closed"}`} data-testid="tile-picker">
      <div className="tile-picker-head">
        <button className="tile-picker-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? "▾" : "▸"} Tiles
        </button>
        {open && (
          <>
            <span className="scene-canvas-float-hint">drag to pick a stamp</span>
            <button className="brush-btn" onClick={() => setZ((v) => Math.max(1, v - 1))}>
              −
            </button>
            <button className="brush-btn" onClick={() => setZ((v) => Math.min(4, v + 1))}>
              +
            </button>
          </>
        )}
      </div>
      {open && (
        <div className="tile-picker-scroll">
          <canvas
            ref={ref}
            style={{ width: img.width * z, height: img.height * z }}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              const c = cell(e);
              setDrag({ x0: c.x, y0: c.y, x1: c.x, y1: c.y });
            }}
          />
        </div>
      )}
    </div>
  );
}

function drawNpc(
  ctx: CanvasRenderingContext2D,
  npc: NpcJSON,
  index: number,
  S: number,
  sheets: Record<string, SpriteImage>,
  project: ProjectJSON | undefined,
  playerSprite: string,
  selected: boolean,
  v: (name: string, fallback: string) => string,
) {
  const x = npc.x * S;
  const y = npc.y * S;
  const sz = ACTOR_TILES * S;
  const name = npc.sprite || playerSprite;
  const img = sheets[name];
  const sheet = img && project ? sheetFor(project, name, img) : null;
  const facing = (npc.direction ?? "down") as Facing;
  if (!img || !sheet || !drawActor(ctx, img, sheet, facing, x, y, S / TILE)) {
    ctx.fillStyle = v("--marker-npc", "rgba(64,200,220,.6)");
    ctx.fillRect(x, y, sz, sz);
  }
  ctx.strokeStyle = selected ? "#ffffff" : v("--marker-npc", "rgba(64,200,220,.6)");
  ctx.lineWidth = selected ? 2 : 1;
  // Pinned actors sit at a screen position: dashed, with a pin mark.
  if (npc.pinned) ctx.setLineDash([3, 2]);
  ctx.strokeRect(x + 0.5, y + 0.5, sz - 1, sz - 1);
  ctx.setLineDash([]);
  if (npc.pinned) {
    const r = Math.max(3, S / 4);
    ctx.fillStyle = v("--accent", "#791fff");
    ctx.beginPath();
    ctx.arc(x + sz - r, y + r, r, 0, Math.PI * 2);
    ctx.fill();
  }
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
