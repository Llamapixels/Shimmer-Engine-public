/*
 * Game World > World map: every scene laid out on one big canvas, like
 * GB Studio's world view. Drag scenes to arrange them (saved as each
 * scene's "world_pos"), drag empty space or use the wheel to pan and
 * zoom, double-click a scene to open it. Click an actor or trigger to
 * select it (its properties show on the right). Lines show where Change
 * Scene events and doors lead (toggle with "Connections").
 */
import SceneCanvas from "./SceneCanvas";
import { memo, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";

import type { NpcJSON, ProjectJSON, SceneJSON, SceneRecord } from "../../shared/projectTypes";
import { loadSpriteImage, type SpriteImage } from "../sprites/image";
import { playerSpriteName, type Facing } from "../sprites/model";
import { drawActor, sheetFor } from "../sprites/render";
import { sceneName, useProjectStore } from "../state/projectStore";
import "./WorldMap.css";
import PopoverMenu from "./common/PopoverMenu";
import { ColorPopover } from "../script/ScriptEditor";
import { inkOn, SCENE_MAX_ACTORS, SCENE_MAX_TRIGGERS } from "./sceneColor";
import { PREFAB_DRAG_TYPE, prefabDropTile } from "../world/prefabs";

const TILE = 8;
const GAP = 64;   /* px between scenes laid out automatically */
/* Scenes stay inside this area (px), so none can be dragged off and lost. */
const WORLD_SIZE = 16384;
const clampTo = (v: number, size: number) => Math.max(0, Math.min(WORLD_SIZE - size, v));

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
    const evs = switchEvents([n.on_interact, n.on_init, (n as { on_update?: unknown }).on_update, (n as { on_hit?: unknown }).on_hit, n.on_player_hit, n.on_hit_1, n.on_hit_2, n.on_hit_3, n.on_hit_4, n.on_collect]);
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
const ActorSprite = memo(function ActorSprite({
  npc,
  img,
  project,
  sprite,
}: {
  npc: NpcJSON;
  img?: SpriteImage;
  project: ProjectJSON;
  sprite: string;
}) {
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
});

/** What a scene card asks the map to do (one stable object, so cards
 * only redraw when their own scene changes). */
interface CardActions {
  drop: (e: ReactDragEvent, rec: SceneRecord) => void;
  down: (e: ReactPointerEvent, rec: SceneRecord, i: number) => void;
  open: (rec: SceneRecord) => void;
  select: (rec: SceneRecord, kind: "npc" | "door", index: number) => void;
  /** Right-click: the scene, or one of its actors / triggers. */
  menu: (e: ReactMouseEvent, rec: SceneRecord, target: { kind: "npc" | "door"; index: number } | null) => void;
}

const SceneCard = memo(function SceneCard({
  rec,
  index,
  x,
  y,
  img,
  active,
  selDoor,
  selNpc,
  labelSize,
  sheets,
  project,
  playerSprite,
  actions,
  placing,
  editing,
  slotRef,
}: {
  placing: boolean;
  /** This scene is edited right here: the scene editor's canvas goes in
   * its slot (and its name bar is the handle to move it). */
  editing: boolean;
  slotRef?: (el: HTMLDivElement | null) => void;
  rec: SceneRecord;
  index: number;
  x: number;
  y: number;
  img?: { url: string; w: number; h: number };
  active: boolean;
  selDoor: number;
  selNpc: number;
  labelSize: number;
  sheets: Record<string, SpriteImage>;
  project: ProjectJSON;
  playerSprite: string;
  actions: CardActions;
}) {
  const [prefabHover, setPrefabHover] = useState(false);
  return (
    <div
      className={`world-map-scene${active ? " world-map-scene-active" : ""}${editing ? " world-map-scene-editing" : ""}${prefabHover ? " world-map-scene-prefab-drop" : ""}`}
      style={{
        transform: `translate(${x}px, ${y}px)`,
        width: img?.w ?? 240,
        height: img?.h ?? 160,
        ...(rec.data.color && !active ? { outline: `3px solid ${rec.data.color}` } : {}),
      }}
      onPointerDownCapture={(e) => {
        if (placing && e.button === 0) { e.stopPropagation(); actions.down(e, rec, index); }
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PREFAB_DRAG_TYPE)) return;
        e.preventDefault(); e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setPrefabHover(true);
      }}
      onDragLeave={(e) => {
        if (!(e.relatedTarget instanceof Node) || !e.currentTarget.contains(e.relatedTarget)) setPrefabHover(false);
      }}
      onDrop={(e) => { setPrefabHover(false); actions.drop(e, rec); }}
      onPointerDown={(e) => actions.down(e, rec, index)}
      onDoubleClick={() => actions.open(rec)}
      onContextMenu={(e) => actions.menu(e, rec, null)}
    >
      <div
        className="world-map-label"
        style={{ fontSize: labelSize, ...(rec.data.color ? { background: rec.data.color, color: inkOn(rec.data.color) } : {}) }}
      >
        {sceneName(rec)}
      </div>
      <div
        className="world-map-info"
        style={{ fontSize: labelSize, ...(rec.data.color ? { background: rec.data.color, color: inkOn(rec.data.color) } : {}) }}
        title="Actors and triggers in this scene"
      >
        <span className={(rec.data.npcs ?? []).length > SCENE_MAX_ACTORS ? "world-map-info-over" : ""}>
          A: {(rec.data.npcs ?? []).length}/{SCENE_MAX_ACTORS}
        </span>
        <span className={(rec.data.doors ?? []).length > SCENE_MAX_TRIGGERS ? "world-map-info-over" : ""}>
          T: {(rec.data.doors ?? []).length}
        </span>
      </div>
      {editing ? (
        <div ref={slotRef} className="world-map-edit-slot" />
      ) : img ? (
        <img src={img.url} alt="" draggable={false} />
      ) : (
        <div className="world-map-missing">no background</div>
      )}
      {!editing && (rec.data.doors ?? []).map((d, k) => (
        <div
          key={`d${k}`}
          className={`world-map-thing world-map-door${selDoor === k ? " world-map-thing-on" : ""}`}
          style={{ left: d.x * TILE, top: d.y * TILE, width: (d.width ?? 1) * TILE, height: (d.height ?? 1) * TILE }}
          title={`Trigger ${k + 1}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            actions.select(rec, "door", k);
          }}
          onContextMenu={(e) => actions.menu(e, rec, { kind: "door", index: k })}
        />
      ))}
      {!editing && (rec.data.npcs ?? []).map((n, k) => (
        <ActorSprite key={`s${k}`} npc={n} img={sheets[n.sprite || playerSprite]} project={project} sprite={n.sprite || playerSprite} />
      ))}
      {!editing && (rec.data.npcs ?? []).map((n, k) => (
        <div
          key={`n${k}`}
          className={`world-map-thing world-map-npc${selNpc === k ? " world-map-thing-on" : ""}`}
          style={{ left: n.x * TILE, top: n.y * TILE, width: 2 * TILE, height: 2 * TILE }}
          title={n.name || `Actor ${k + 1}`}
          onPointerDown={(e) => {
            e.stopPropagation();
            actions.select(rec, "npc", k);
          }}
          onContextMenu={(e) => actions.menu(e, rec, { kind: "npc", index: k })}
        />
      ))}
    </div>
  );
});

/** The world map's zoom and scroll, per project: kept when you go to the
 * scene view and back (and across restarts). */
type WorldView = { zoom: number; pan: { x: number; y: number } };
const viewCache = new Map<string, WorldView>();
function loadView(root: string | undefined): WorldView | null {
  if (!root) return null;
  const hit = viewCache.get(root);
  if (hit) return hit;
  try {
    const v = JSON.parse(localStorage.getItem(`worldmap.view:${root}`) ?? "null") as WorldView | null;
    if (v && typeof v.zoom === "number" && v.pan && typeof v.pan.x === "number") return v;
  } catch {
    /* none saved */
  }
  return null;
}
function saveView(root: string | undefined, v: WorldView) {
  if (!root) return;
  viewCache.set(root, v);
  try {
    localStorage.setItem(`worldmap.view:${root}`, JSON.stringify(v));
  } catch {
    /* not saved */
  }
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
  const tool = useProjectStore((s) => s.tool);
  const placingPrefabId = useProjectStore((s) => s.placingPrefabId);
  const setPlacingPrefab = useProjectStore((s) => s.setPlacingPrefab);
  const placePrefab = useProjectStore((s) => s.placePrefab);
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
  useEffect(() => {
    if (tool !== "placePrefab") return;
    const cancel = (e: KeyboardEvent) => { if (e.key === "Escape") setPlacingPrefab(null); };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [tool, setPlacingPrefab]);

  const savedView = useMemo(() => loadView(project?.rootPath), [project?.rootPath]);
  const [zoom, setZoom] = useState(savedView?.zoom ?? 0.5);
  const [pan, setPan] = useState(savedView?.pan ?? { x: 40, y: 40 });
  // Remember where the map was, for coming back from the scene view.
  useEffect(() => {
    saveView(project?.rootPath, { zoom, pan });
  }, [project?.rootPath, zoom, pan]);
  const [showLinks, setShowLinks] = useState(() => readPref("worldmap.links", true));
  const [drag, setDrag] = useState<
    | { kind: "pan"; sx: number; sy: number; px: number; py: number }
    | { kind: "scene"; id: string; sx: number; sy: number; ox: number; oy: number; x: number; y: number }
    | null
  >(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const removeScene = useProjectStore((s) => s.removeScene);
  const [ctx, setCtx] = useState<{
    x: number;
    y: number;
    rec: SceneRecord;
    target: { kind: "npc" | "door"; index: number } | null;
  } | null>(null);
  const [colorFor, setColorFor] = useState<{ x: number; y: number; id: string } | null>(null);
  // While dragging the view, it moves by setting the transform directly
  // (no re-render per mouse move); the new pan is saved on release.
  const livePan = useRef<{ x: number; y: number } | null>(null);
  // The selected scene is edited in place: the scene editor's canvas goes here.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null);

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
  const sizeOf = (rec: SceneRecord) => ({ w: imgs[rec.fileId]?.w ?? 240, h: imgs[rec.fileId]?.h ?? 160 });
  const pos = (rec: SceneRecord, _i: number) => {
    const p = rec.data.world_pos ?? defaults.get(rec.fileId) ?? { x: 0, y: 0 };
    const { w, h } = sizeOf(rec);
    return { x: clampTo(p.x, w), y: clampTo(p.y, h) };
  };
  const posOf = (rec: SceneRecord, i: number) =>
    drag?.kind === "scene" && drag.id === rec.fileId ? { x: drag.x, y: drag.y } : pos(rec, i);

  const byName = useMemo(() => {
    const m = new Map<string, number>();
    scenes.forEach((s, i) => m.set(sceneName(s), i));
    return m;
  }, [scenes]);

  // Each scene's scene changes, found once per edit (not per mouse move),
  // without repeats (the same spot leading to the same place).
  const rawLinks = useMemo(
    () =>
      new Map(
        scenes.map((rec) => {
          const seen = new Set<string>();
          const list = sceneLinks(rec).filter((l) => {
            const k = `${l.to}|${l.kind}|${l.sx}|${l.sy}|${l.dx}|${l.dy}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          return [rec.fileId, list];
        }),
      ),
    [scenes],
  );

  const links: Link[] = [];
  if (showLinks)
    scenes.forEach((rec, i) => {
      const p = posOf(rec, i);
      for (const l of rawLinks.get(rec.fileId) ?? []) {
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

  const placeAt = (e: { clientX: number; clientY: number; currentTarget: EventTarget & Element }, rec: SceneRecord, id: string) => {
    const prefab = project?.project.prefabs?.find((p) => p.id === id);
    if (!prefab) return;
    const size = sizeOf(rec);
    const tile = prefabDropTile(e, e.currentTarget.getBoundingClientRect(), size.w / TILE, size.h / TILE, prefab);
    if (tile) placePrefab(rec.fileId, id, tile.x, tile.y);
  };
  const onDown = (e: ReactPointerEvent, rec?: SceneRecord, i?: number) => {
    e.stopPropagation();
    if (tool === "placePrefab" && placingPrefabId && rec && e.button === 0) {
      placeAt(e, rec, placingPrefabId);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    if (rec && i !== undefined && e.button === 0) {
      const p = pos(rec, i);
      const w = toWorld(e.clientX, e.clientY);
      setDrag({ kind: "scene", id: rec.fileId, sx: w.x, sy: w.y, ox: p.x, oy: p.y, x: p.x, y: p.y });
    } else setDrag({ kind: "pan", sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y });
  };
  const onMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    if (drag.kind === "pan") {
      const next = { x: drag.px + e.clientX - drag.sx, y: drag.py + e.clientY - drag.sy };
      livePan.current = next;
      if (planeRef.current) planeRef.current.style.transform = `translate(${next.x}px, ${next.y}px) scale(${zoom})`;
    } else {
      const w = toWorld(e.clientX, e.clientY);
      // Snap to 8 px so scenes line up neatly, inside the world area.
      const rec = scenes.find((s) => s.fileId === drag.id);
      const size = rec ? sizeOf(rec) : { w: 240, h: 160 };
      setDrag({
        ...drag,
        x: clampTo(Math.round((drag.ox + w.x - drag.sx) / 8) * 8, size.w),
        y: clampTo(Math.round((drag.oy + w.y - drag.sy) / 8) * 8, size.h),
      });
    }
  };
  const onUp = () => {
    if (livePan.current) {
      setPan(livePan.current);
      livePan.current = null;
    }
    if (drag?.kind === "scene" && (drag.x !== drag.ox || drag.y !== drag.oy)) {
      const { id, x, y } = drag;
      // Scenes never moved are laid out below the placed ones, so moving
      // one would shift them all: pin each where it is now first.
      for (const s of scenes)
        if (!s.data.world_pos && s.fileId !== id) {
          const p = defaults.get(s.fileId);
          if (p) updateScene(s.fileId, (d) => (d.world_pos ? d : { ...d, world_pos: { x: p.x, y: p.y } }), "world-pin");
        }
      updateScene(id, (s) => ({ ...s, world_pos: { x, y } }));
    }
    // Select it once it's let go, so opening its properties never
    // interrupts the drag.
    if (drag?.kind === "scene") setActiveScene(drag.id);
    setDrag(null);
  };

  /** Middle-drag (or Space + drag) over the scene being edited pans the map. */
  const panFromCanvas = (e: ReactPointerEvent) => {
    e.preventDefault();
    const start = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    let last = { x: pan.x, y: pan.y };
    const move = (ev: PointerEvent) => {
      last = { x: start.px + ev.clientX - start.sx, y: start.py + ev.clientY - start.sy };
      if (planeRef.current) planeRef.current.style.transform = `translate(${last.x}px, ${last.y}px) scale(${zoom})`;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setPan(last);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const actionsRef = useRef<CardActions>(null!);
  actionsRef.current = {
    drop: (e, rec) => {
      const id = e.dataTransfer.getData(PREFAB_DRAG_TYPE);
      if (!id) return;
      e.preventDefault(); e.stopPropagation();
      placeAt(e, rec, id);
    },
    down: (e, rec, i) => onDown(e, rec, i),
    open: (rec) => {
      setActiveScene(rec.fileId);
      setWorldMap(false);
    },
    select: (rec, kind, index) => {
      setActiveScene(rec.fileId);
      setSelection({ kind, sceneId: rec.fileId, index });
    },
    menu: (e, rec, target) => {
      e.preventDefault();
      e.stopPropagation();
      if (target) {
        setActiveScene(rec.fileId);
        setSelection({ kind: target.kind, sceneId: rec.fileId, index: target.index });
      }
      setCtx({ x: e.clientX, y: e.clientY, rec, target });
    },
  };
  const actions = useMemo<CardActions>(
    () => ({
      drop: (e, rec) => actionsRef.current.drop(e, rec),
      down: (e, rec, i) => actionsRef.current.down(e, rec, i),
      open: (rec) => actionsRef.current.open(rec),
      select: (rec, kind, index) => actionsRef.current.select(rec, kind, index),
      menu: (e, rec, target) => actionsRef.current.menu(e, rec, target),
    }),
    [],
  );

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

  const editingRec = scenes.find((s) => s.fileId === activeSceneId);
  const bar = (
    <>
        <button className="btn btn-small" onClick={() => setWorldMap(false)} title="Edit the selected scene on its own">
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
        {tool === "placePrefab" && placingPrefabId ? <>
          <span className="world-map-hint">Click a scene tile to place {project?.project.prefabs?.find((p) => p.id === placingPrefabId)?.name ?? "prefab"}</span>
          <button className="btn btn-small" onClick={() => setPlacingPrefab(null)}>Cancel placement</button>
        </> : <span className="world-map-hint">Edit the selected scene right here · drag a scene (or its name bar) to move it · click one to edit it · wheel to zoom · middle-drag to pan</span>}
    </>
  );
  const area = (
      <div
        ref={boxRef}
        className={`world-map-area${drag?.kind === "pan" ? " world-map-panning" : ""}`}
        onPointerDown={(e) => onDown(e)}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onWheel={onWheel}
      >
        <div ref={planeRef} className="world-map-plane" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {project &&
            scenes.map((rec, i) => {
              const p = posOf(rec, i);
              const selHere = (selection.kind === "npc" || selection.kind === "door") && selection.sceneId === rec.fileId;
              return (
                <SceneCard
                  key={rec.fileId}
                  rec={rec}
                  index={i}
                  x={p.x}
                  y={p.y}
                  img={imgs[rec.fileId]}
                  active={rec.fileId === activeSceneId}
                  selDoor={selHere && selection.kind === "door" ? selection.index : -1}
                  selNpc={selHere && selection.kind === "npc" ? selection.index : -1}
                  labelSize={13 / Math.max(zoom, 0.05)}
                  sheets={sheets}
                  project={project.project}
                  playerSprite={playerSprite}
                  actions={actions}
                  placing={tool === "placePrefab" && !!placingPrefabId}
                  editing={rec.fileId === editingRec?.fileId}
                  slotRef={rec.fileId === editingRec?.fileId ? setSlot : undefined}
                />
              );
            })}
          {/* Menus are portals, but their pointer events still bubble here:
              keep them from starting a pan or scene drag. */}
          <div onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          {ctx && (
            <PopoverMenu
              anchor={{ x: ctx.x, y: ctx.y }}
              onClose={() => setCtx(null)}
              items={
                ctx.target
                  ? [
                      {
                        label: `Delete ${ctx.target.kind === "npc" ? `actor "${ctx.rec.data.npcs?.[ctx.target.index]?.name || `#${ctx.target.index}`}"` : `trigger #${ctx.target.index}`}`,
                        danger: true,
                        onClick: () => deleteSelected(),
                      },
                    ]
                  : [
                      { label: "Open", onClick: () => actionsRef.current.open(ctx.rec) },
                      { label: "Duplicate", onClick: () => void useProjectStore.getState().duplicateScene(ctx.rec.fileId) },
                      { label: "Copy scene", onClick: () => useProjectStore.getState().copyScene(ctx.rec.fileId) },
                      {
                        label: "Paste scene",
                        disabled: !useProjectStore.getState().sceneClipboard,
                        onClick: () => void useProjectStore.getState().pasteScene(),
                      },
                      { label: ctx.rec.data.color ? "Change color…" : "Color…", onClick: () => setColorFor({ x: ctx.x, y: ctx.y, id: ctx.rec.fileId }) },
                      ...(ctx.rec.data.color
                        ? [{ label: "Remove color", onClick: () => updateScene(ctx.rec.fileId, (s) => ({ ...s, color: undefined })) }]
                        : []),
                      "separator",
                      {
                        label: `Delete scene "${sceneName(ctx.rec)}"`,
                        danger: true,
                        onClick: () => {
                          if (window.confirm(`Delete scene "${sceneName(ctx.rec)}"? This deletes scenes/${ctx.rec.fileId}.json and can't be undone.`))
                            void removeScene(ctx.rec.fileId);
                        },
                      },
                    ]
              }
            />
          )}
          {colorFor && (
            <ColorPopover
              at={colorFor}
              value={scenes.find((s) => s.fileId === colorFor.id)?.data.color}
              onChange={(c) => updateScene(colorFor.id, (s) => ({ ...s, color: c }), `color:${colorFor.id}`)}
              onClose={() => setColorFor(null)}
            />
          )}
          </div>
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
  );

  if (editingRec)
    return (
      <div className="world-map world-map-editing">
        <SceneCanvas embedded={{ slot, worldZoom: zoom, bar, area, onWheel, onPanStart: panFromCanvas }} />
      </div>
    );
  return (
    <div className="world-map">
      <div className="world-map-bar">{bar}</div>
      {area}
    </div>
  );
}
