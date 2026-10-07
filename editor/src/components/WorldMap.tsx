/*
 * Game World > World map: every scene laid out on one big canvas, like
 * GB Studio's world view. Drag scenes to arrange them (saved as each
 * scene's "world_pos"), drag empty space or use the wheel to pan and
 * zoom, double-click a scene to open it. Click an actor or trigger to
 * select it (its properties show on the right). Lines show where Change
 * Scene events and doors lead (toggle with "Connections").
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { NpcJSON, ProjectJSON, SceneJSON, SceneRecord } from "../../shared/projectTypes";
import { loadSpriteImage, type SpriteImage } from "../sprites/image";
import { playerSpriteName, type Facing } from "../sprites/model";
import { drawActor, sheetFor } from "../sprites/render";
import { sceneName, useProjectStore } from "../state/projectStore";
import "./WorldMap.css";

const TILE = 8;
const GAP = 64;   /* px between scenes laid out automatically */

interface Link {
  from: string;
  to: string;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  kind: "door" | "actor" | "scene";
}

/** Every "switch_scene" event anywhere inside `value`. */
function switchEvents(value: unknown, out: { scene: string; x: number; y: number }[] = []) {
  if (Array.isArray(value)) value.forEach((v) => switchEvents(v, out));
  else if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (o.type === "switch_scene" && typeof o.scene === "string")
      out.push({ scene: o.scene, x: Number(o.x ?? 0), y: Number(o.y ?? 0) });
    for (const v of Object.values(o)) if (v && typeof v === "object") switchEvents(v, out);
  }
  return out;
}

/** A scene change: where it starts in its scene and where it leads, in px. */
interface RawLink {
  to: string;
  sx: number;
  sy: number;
  dx: number;
  dy: number;
  kind: Link["kind"];
}

/** Where each of a scene's scene changes start and lead. */
function sceneLinks(rec: SceneRecord): RawLink[] {
  const s = rec.data;
  const out: RawLink[] = [];
  for (const d of s.doors ?? []) {
    const cx = (d.x + (d.width ?? 1) / 2) * TILE;
    const cy = (d.y + (d.height ?? 1) / 2) * TILE;
    if (d.target_scene) out.push({ to: d.target_scene, sx: cx, sy: cy, dx: (d.target_x ?? 0) * TILE, dy: (d.target_y ?? 0) * TILE, kind: "door" });
    for (const e of switchEvents(d.events)) out.push({ to: e.scene, sx: cx, sy: cy, dx: e.x * TILE, dy: e.y * TILE, kind: "door" });
  }
  for (const n of s.npcs ?? []) {
    const evs = switchEvents([n.on_interact, n.on_init, (n as { on_update?: unknown }).on_update, (n as { on_hit?: unknown }).on_hit]);
    for (const e of evs) out.push({ to: e.scene, sx: n.x * TILE + 8, sy: n.y * TILE + 8, dx: e.x * TILE, dy: e.y * TILE, kind: "actor" });
  }
  const rest: Partial<SceneJSON> = { ...s, doors: undefined, npcs: undefined };
  for (const e of switchEvents(rest)) out.push({ to: e.scene, sx: 12, sy: 12, dx: e.x * TILE, dy: e.y * TILE, kind: "scene" });
  return out;
}

/** Scene background images, as data URLs, keyed by file id. */
function useSceneImages(rootPath: string | null, scenes: SceneRecord[]) {
  const [imgs, setImgs] = useState<Record<string, { url: string; w: number; h: number }>>({});
  const key = scenes.map((s) => `${s.fileId}:${s.data.background}`).join("|");
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    for (const s of scenes) {
      if (!s.data.background) continue;
      window.api
        .readAsset({ rootPath, relPath: `scenes/${s.data.background}` })
        .then((r) => {
          if (cancelled || !r.ok) return;
          const im = new Image();
          im.onload = () => !cancelled && setImgs((m) => ({ ...m, [s.fileId]: { url: r.value.dataUrl, w: im.width, h: im.height } }));
          im.src = r.value.dataUrl;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, key]);
  return imgs;
}

/** Every sprite sheet the scenes' actors use, keyed by sprite name. */
function useSpriteSheets(rootPath: string | null, names: string[]) {
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
  }, [rootPath, key]);
  return images;
}

/** An actor's first frame, drawn as in the scene view (sprites larger
 * than 16 px spill over the box, so the canvas has a margin). */
function ActorSprite({ npc, img, project, sprite }: { npc: NpcJSON; img?: SpriteImage; project: ProjectJSON; sprite: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !img) return;
    ctx.clearRect(0, 0, 48, 48);
    ctx.imageSmoothingEnabled = false;
    const sheet = sheetFor(project, sprite, img);
    if (sheet) drawActor(ctx, img, sheet, (npc.direction ?? "down") as Facing, 16, 16, 1);
  }, [img, project, sprite, npc.direction]);
  return (
    <canvas
      ref={ref}
      className="world-map-sprite"
      width={48}
      height={48}
      style={{ left: npc.x * TILE - 16, top: npc.y * TILE - 16 }}
    />
  );
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

export default function WorldMap() {
  const project = useProjectStore((s) => s.project);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const setActiveScene = useProjectStore((s) => s.setActiveScene);
  const setWorldMap = useProjectStore((s) => s.setWorldMap);
  const updateScene = useProjectStore((s) => s.updateScene);
  const selection = useProjectStore((s) => s.selection);
  const setSelection = useProjectStore((s) => s.setSelection);
  const scenes = useMemo(() => project?.scenes ?? [], [project]);
  const imgs = useSceneImages(project?.rootPath ?? null, scenes);
  const playerSprite = project ? playerSpriteName(project.project) : "player";
  const spriteNames = useMemo(
    () => Array.from(new Set(scenes.flatMap((s) => (s.data.npcs ?? []).map((n) => n.sprite || playerSprite)))).sort(),
    [scenes, playerSprite],
  );
  const sheets = useSpriteSheets(project?.rootPath ?? null, spriteNames);

  const [zoom, setZoom] = useState(0.5);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [showLinks, setShowLinks] = useState(() => readPref("worldmap.links", true));
  const [drag, setDrag] = useState<
    | { kind: "pan"; sx: number; sy: number; px: number; py: number }
    | { kind: "scene"; id: string; sx: number; sy: number; ox: number; oy: number; x: number; y: number }
    | null
  >(null);
  const boxRef = useRef<HTMLDivElement>(null);

  // Scenes not placed yet: in rows of 4, spaced by their real sizes,
  // below any that have been placed.
  const defaults = useMemo(() => {
    const out = new Map<string, { x: number; y: number }>();
    let top = 0;
    for (const s of scenes) {
      const p = s.data.world_pos;
      if (p) top = Math.max(top, p.y + (imgs[s.fileId]?.h ?? 160) + GAP);
    }
    let x = 0, y = top, rowH = 0, n = 0;
    for (const s of scenes) {
      if (s.data.world_pos) continue;
      const w = imgs[s.fileId]?.w ?? 240;
      const h = imgs[s.fileId]?.h ?? 160;
      if (n === 4) {
        x = 0;
        y += rowH + GAP;
        rowH = 0;
        n = 0;
      }
      out.set(s.fileId, { x, y });
      x += w + GAP;
      rowH = Math.max(rowH, h);
      n++;
    }
    return out;
  }, [scenes, imgs]);
  const pos = (rec: SceneRecord, _i: number) => rec.data.world_pos ?? defaults.get(rec.fileId) ?? { x: 0, y: 0 };
  const posOf = (rec: SceneRecord, i: number) =>
    drag?.kind === "scene" && drag.id === rec.fileId ? { x: drag.x, y: drag.y } : pos(rec, i);

  const byName = useMemo(() => {
    const m = new Map<string, number>();
    scenes.forEach((s, i) => m.set(sceneName(s), i));
    return m;
  }, [scenes]);

  const links: Link[] = [];
  if (showLinks)
    scenes.forEach((rec, i) => {
      const p = posOf(rec, i);
      for (const l of sceneLinks(rec)) {
        const j = byName.get(l.to);
        if (j === undefined) continue;
        const q = posOf(scenes[j], j);
        links.push({ from: rec.fileId, to: scenes[j].fileId, fx: p.x + l.sx, fy: p.y + l.sy, tx: q.x + l.dx + 8, ty: q.y + l.dy + 8, kind: l.kind });
      }
    });

  const toWorld = (cx: number, cy: number) => {
    const r = boxRef.current?.getBoundingClientRect();
    return { x: (cx - (r?.left ?? 0) - pan.x) / zoom, y: (cy - (r?.top ?? 0) - pan.y) / zoom };
  };

  const onWheel = (e: React.WheelEvent) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const next = Math.min(2, Math.max(0.1, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    setPan({ x: mx - ((mx - pan.x) / zoom) * next, y: my - ((my - pan.y) / zoom) * next });
    setZoom(next);
  };

  const onDown = (e: ReactPointerEvent, rec?: SceneRecord, i?: number) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (rec && i !== undefined && e.button === 0) {
      setActiveScene(rec.fileId);
      const p = pos(rec, i);
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ kind: "scene", id: rec.fileId, sx: w.x, sy: w.y, ox: p.x, oy: p.y, x: p.x, y: p.y });
    } else setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    if (drag.kind === "pan") setPan({ x: drag.px + e.clientX - drag.sx, y: drag.py + e.clientY - drag.sy });
    else {
      const w = toWorld(e.clientX, e.clientY);
      // Snap to 8 px so scenes line up neatly.
      setDrag({ ...drag, x: Math.round((drag.ox + w.x - drag.sx) / 8) * 8, y: Math.round((drag.oy + w.y - drag.sy) / 8) * 8 });
    }
  };
  const onUp = () => {
    if (drag?.kind === "scene" && (drag.x !== drag.ox || drag.y !== drag.oy)) {
      const { id, x, y } = drag;
      updateScene(id, (s) => ({ ...s, world_pos: { x, y } }));
    }
    setDrag(null);
  };

  const fit = () => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || !scenes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    scenes.forEach((s, i) => {
      const p = pos(s, i);
      const im = imgs[s.fileId];
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x + (im?.w ?? 240));
      y1 = Math.max(y1, p.y + (im?.h ?? 160) + 20);
    });
    const z = Math.min(2, Math.max(0.1, Math.min((r.width - 80) / (x1 - x0), (r.height - 80) / (y1 - y0))));
    setZoom(z);
    setPan({ x: 40 - x0 * z, y: 40 - y0 * z });
  };

  return (
    <div className="world-map">
      <div className="world-map-bar">
        <button className="btn btn-small" onClick={() => setWorldMap(false)} title="Back to editing the selected scene">
          ← Scene view
        </button>
        <button className="btn btn-small" onClick={fit}>
          Fit all
        </button>
        <span className="world-map-zoom">{Math.round(zoom * 100)}%</span>
        <label className="scene-canvas-toggle" title="Lines from doors and Change Scene events to where they lead">
          <input
            type="checkbox"
            checked={showLinks}
            onChange={(e) => {
              setShowLinks(e.target.checked);
              try {
                localStorage.setItem("worldmap.links", e.target.checked ? "1" : "0");
              } catch {
                /* not saved */
              }
            }}
          />
          Connections
        </label>
        <span className="world-map-hint">Drag scenes to arrange them · double-click one to open it · wheel to zoom</span>
      </div>
      <div
        ref={boxRef}
        className={`world-map-area${drag?.kind === "pan" ? " world-map-panning" : ""}`}
        onPointerDown={(e) => onDown(e)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onWheel={onWheel}
      >
        <div className="world-map-plane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {scenes.map((rec, i) => {
            const p = posOf(rec, i);
            const im = imgs[rec.fileId];
            return (
              <div
                key={rec.fileId}
                className={`world-map-scene${rec.fileId === activeSceneId ? " world-map-scene-active" : ""}`}
                style={{ left: p.x, top: p.y, width: im?.w ?? 240, height: im?.h ?? 160 }}
                onPointerDown={(e) => onDown(e, rec, i)}
                onDoubleClick={() => {
                  setActiveScene(rec.fileId);
                  setWorldMap(false);
                }}
              >
                <div className="world-map-label" style={{ fontSize: 12 / Math.max(zoom, 0.35) }}>
                  {sceneName(rec)}
                </div>
                {im ? <img src={im.url} alt="" draggable={false} /> : <div className="world-map-missing">no background</div>}
                {(rec.data.doors ?? []).map((d, k) => (
                  <div
                    key={`d${k}`}
                    className={`world-map-thing world-map-door${
                      selection.kind === "door" && selection.sceneId === rec.fileId && selection.index === k ? " world-map-thing-on" : ""
                    }`}
                    style={{ left: d.x * TILE, top: d.y * TILE, width: (d.width ?? 1) * TILE, height: (d.height ?? 1) * TILE }}
                    title={`Trigger ${k + 1}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setActiveScene(rec.fileId);
                      setSelection({ kind: "door", sceneId: rec.fileId, index: k });
                    }}
                  />
                ))}
                {project &&
                  (rec.data.npcs ?? []).map((n, k) => (
                    <ActorSprite
                      key={`s${k}`}
                      npc={n}
                      img={sheets[n.sprite || playerSprite]}
                      project={project.project}
                      sprite={n.sprite || playerSprite}
                    />
                  ))}
                {(rec.data.npcs ?? []).map((n, k) => (
                  <div
                    key={`n${k}`}
                    className={`world-map-thing world-map-npc${
                      selection.kind === "npc" && selection.sceneId === rec.fileId && selection.index === k ? " world-map-thing-on" : ""
                    }`}
                    style={{ left: n.x * TILE, top: n.y * TILE, width: 2 * TILE, height: 2 * TILE }}
                    title={n.name || `Actor ${k + 1}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setActiveScene(rec.fileId);
                      setSelection({ kind: "npc", sceneId: rec.fileId, index: k });
                    }}
                  />
                ))}
              </div>
            );
          })}
          {showLinks && (
            <svg className="world-map-links" style={{ overflow: "visible" }} width={1} height={1}>
              <defs>
                <marker id="wm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
                </marker>
              </defs>
              {links.map((l, k) => {
                const mx = (l.fx + l.tx) / 2;
                const my = (l.fy + l.ty) / 2 - Math.min(120, Math.abs(l.tx - l.fx) / 4 + 30);
                return (
                  <path
                    key={k}
                    className={`world-map-link world-map-link-${l.kind}`}
                    d={`M ${l.fx} ${l.fy} Q ${mx} ${my} ${l.tx} ${l.ty}`}
                    strokeWidth={2 / Math.max(zoom, 0.25)}
                    markerEnd="url(#wm-arrow)"
                  />
                );
              })}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
