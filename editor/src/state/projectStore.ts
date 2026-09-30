import { create } from "zustand";

import { migrateProjectSprites } from "../sprites/model";
import type { AssetListing } from "../../shared/ipc";
import type { EventScript } from "../../shared/eventTypes";
import type { DoorJSON, NpcJSON, ProjectData, ProjectJSON, SceneJSON, SceneRecord } from "../../shared/projectTypes";
import {
  markDeletedCustomScript,
  markDeletedCustomScriptInScript,
  renameRefsInScene,
  shiftIndexRefs,
  type RefKind,
} from "../script/scriptRefs";

/** What's selected in the world view / properties panel right now.
 * "scene" selects the scene itself (its own properties, not a door/npc
 * inside it); door/npc select one entry within the currently-open
 * scene by index. */
export type Selection =
  | { kind: "none" }
  | { kind: "scene"; sceneId: string }
  | { kind: "player"; sceneId: string }
  | { kind: "door"; sceneId: string; index: number }
  | { kind: "npc"; sceneId: string; index: number }
  | { kind: "note"; sceneId: string; index: number }
  | { kind: "customScript"; id: string }
  | { kind: "palette"; id: string }
  | { kind: "prefab"; id: string };

export type Section = "world" | "sprites" | "backgrounds" | "music" | "settings";

export type Tool =
  | "select"
  | "npc"
  | "door"
  | "note"
  | "collision"
  | "palette"
  | "tiles"
  | "eraser"
  | "spawn"
  | "placePrefab";

/** Collision brush: the same characters scene JSON uses. */
export type Brush = "#" | "~" | "!" | "." | "^" | "v" | "<" | ">" | "H";

/** How painting tools apply (GB Studio's brush toolbar). */
export type BrushShape = "8px" | "16px" | "fill" | "magic" | "selection";

/** Which layer the paint tools / eraser work on. */
export type PaintLayer = "collision" | "palette" | "tiles";

/** Tiles tool stamp: a rectangle of the background's own tiles. */
export interface TileStamp {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An in-progress "click a tile on the canvas" request from a script
 * field (e.g. Move Actor To's x/y). */
export interface TilePick {
  label: string;
  onPick: (x: number, y: number) => void;
  /** Also outline the screen area a camera centred on the tile shows. */
  screenOutline?: boolean;
}

interface Snapshot {
  project: ProjectJSON;
  scenes: SceneRecord[];
}

const HISTORY_LIMIT = 200;
/** Edits with the same coalesce key this close together become one undo
 * step - so typing a line of dialogue is one undo, not one per key. */
const COALESCE_MS = 800;

const RECENT_KEY = "shimmer-engine.recent-projects";
/** Pre-rename key, still read (never written) so an existing user's
 * recent-projects list survives the app's rename from Advance Studio. */
const LEGACY_RECENT_KEY = "advance-studio.recent-projects";

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY) ?? localStorage.getItem(LEGACY_RECENT_KEY);
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    /* storage unavailable - recent list just won't persist */
  }
}

// ---------------------------------------------------------------------------
// Write queue: at most one write in flight per file, always the latest
// content. Autosave-on-every-keystroke would otherwise fire overlapping
// fs.writeFile calls at the same file, which can interleave.
// ---------------------------------------------------------------------------

type WriteJob = () => Promise<{ ok: boolean; error?: string }>;
const pending = new Map<string, WriteJob>();
const inFlight = new Map<string, Promise<void>>();

function queueWrite(key: string, job: WriteJob, onResult: (key: string, error: string | null) => void) {
  pending.set(key, job);
  if (inFlight.has(key)) return;
  const run = async (): Promise<void> => {
    const next = pending.get(key);
    if (!next) {
      inFlight.delete(key);
      return;
    }
    pending.delete(key);
    try {
      const r = await next();
      onResult(key, r.ok ? null : (r.error ?? "unknown error"));
    } catch (err) {
      onResult(key, err instanceof Error ? err.message : String(err));
    }
    return run();
  };
  inFlight.set(key, run());
}

/** Drop any queued write for `key` and wait out the one in flight - so a
 * scene file that's about to be deleted can't be re-created by a save
 * that lands just after the delete. */
async function cancelWrites(key: string): Promise<void> {
  pending.delete(key);
  await inFlight.get(key);
}

/** Save failures per file, so one file's successful save doesn't hide
 * another file's failure. */
const writeErrors = new Map<string, string>();

interface ProjectState {
  project: ProjectData | null;
  /** Which scene the World canvas is currently showing. */
  activeSceneId: string | null;
  selection: Selection;
  section: Section;
  tool: Tool;
  brush: Brush;
  brushShape: BrushShape;
  /** Layer the eraser clears (the last paint tool used). */
  eraseLayer: PaintLayer;
  tileStamp: TileStamp | null;
  /** id of the palette being painted with the "palette" tool. */
  paletteBrush: string | null;
  /** id of the prefab armed for placement with the "placePrefab" tool. */
  placingPrefabId: string | null;
  tilePick: TilePick | null;
  loading: boolean;
  error: string | null;
  saveError: string | null;
  assets: AssetListing | null;
  recentProjects: string[];
  /** Events copied with Copy in the script editor. */
  scriptClipboard: EventScript | null;
  /** Tile the cursor is currently over on the scene canvas, or null -
   * mirrored here (SceneCanvas writes it, StatusBar reads it) purely so
   * the bottom status bar can show it without a direct prop/context link
   * between the two components. Transient UI state, never persisted. */
  hoverTile: { x: number; y: number } | null;

  past: Snapshot[];
  future: Snapshot[];
  lastCoalesce: { key: string; at: number } | null;

  openProjectDialog: () => Promise<void>;
  openProjectAtPath: (rootPath: string) => Promise<void>;
  newProject: (name: string) => Promise<void>;
  closeProject: () => void;
  setActiveScene: (sceneId: string) => void;
  setSelection: (selection: Selection) => void;
  setSection: (section: Section) => void;
  setTool: (tool: Tool) => void;
  setBrush: (brush: Brush) => void;
  setBrushShape: (shape: BrushShape) => void;
  setEraseLayer: (layer: PaintLayer) => void;
  setTileStamp: (stamp: TileStamp | null) => void;
  setPaletteBrush: (id: string | null) => void;
  setPlacingPrefab: (id: string | null) => void;
  setTilePick: (pick: TilePick | null) => void;
  setScriptClipboard: (events: EventScript | null) => void;
  setHoverTile: (tile: { x: number; y: number } | null) => void;

  updateScene: (sceneId: string, updater: (scene: SceneJSON) => SceneJSON, coalesceKey?: string) => void;
  updateProject: (updater: (p: ProjectJSON) => ProjectJSON, coalesceKey?: string) => void;
  renameRef: (kind: RefKind, from: string, to: string) => void;
  /** After a sprite's PNG was renamed on disk: point every use of it
   * (NPCs, prefabs, the player, its spriteSheets entry) at the new name -
   * in the undo history too, since the old file is gone. */
  renameSpriteRefs: (from: string, to: string) => void;
  /** Rename a scene-scoped name (an NPC's or timer's) and fix up every
   * reference to it in that scene's scripts, as one undo step. */
  renameInScene: (
    sceneId: string,
    kind: "actor" | "timer",
    from: string,
    to: string,
    index: number,
    updater: (s: SceneJSON) => SceneJSON,
  ) => void;
  /** Remove NPC/timer number `index` and fix numeric references to the
   * ones after it. */
  deleteIndexed: (sceneId: string, kind: "actor" | "timer", index: number) => void;
  /** Change a scene's "name" and every door/switch_scene/start_scene
   * reference to it. */
  renameScene: (sceneId: string, newName: string) => void;
  /** Rename every scene in folder `from` (e.g. "Forest") to be in `to`
   * ("" = out of any folder), moving their files. */
  renameSceneFolder: (from: string, to: string) => void;
  addScene: (name: string, background?: string) => Promise<void>;
  removeScene: (sceneId: string) => Promise<void>;
  addNpc: (sceneId: string, x: number, y: number) => void;
  addDoor: (sceneId: string, door: DoorJSON) => void;
  /** Drop a prefab's template onto a scene at (x, y), as a real NPC or
   * door (a one-time copy, not a live link - see PrefabJSON). */
  placePrefab: (sceneId: string, prefabId: string, x: number, y: number) => void;
  deleteSelected: () => void;
  undo: () => void;
  redo: () => void;
  refreshAssets: () => Promise<void>;

  addConstant: (name: string, value: number) => void;
  renameConstant: (name: string, next: string) => void;
  setConstantValue: (name: string, value: number) => void;
  removeConstant: (name: string) => void;

  addCustomScript: (name: string) => void;
  renameCustomScript: (id: string, name: string) => void;
  removeCustomScript: (id: string) => void;
  updateCustomScript: (id: string, updater: (script: EventScript) => EventScript, coalesceKey?: string) => void;

  addPalette: (name: string) => void;
  renamePalette: (id: string, name: string) => void;
  setPaletteColors: (id: string, colors: string[]) => void;
  removePalette: (id: string) => void;

  addPrefab: (kind: "npc" | "door", name: string) => void;
  renamePrefab: (id: string, name: string) => void;
  updatePrefabTemplate: (id: string, template: Partial<NpcJSON> | Partial<DoorJSON>) => void;
  removePrefab: (id: string) => void;
}

/** Every reference to sprite `from` renamed to `to`. */
function renameSpriteIn(project: ProjectJSON, scenes: SceneRecord[], from: string, to: string) {
  let pj = project;
  if ((pj.playerSprite || "player") === from) pj = { ...pj, playerSprite: to };
  if (pj.spriteSheets?.some((s) => s.name === from))
    pj = { ...pj, spriteSheets: pj.spriteSheets.map((s) => (s.name === from ? { ...s, name: to } : s)) };
  if (pj.prefabs?.some((p) => (p.template as Partial<NpcJSON>).sprite === from))
    pj = {
      ...pj,
      prefabs: pj.prefabs.map((p) =>
        (p.template as Partial<NpcJSON>).sprite === from ? { ...p, template: { ...p.template, sprite: to } } : p,
      ),
    };
  const nextScenes = scenes.map((rec) =>
    rec.data.npcs?.some((n) => n.sprite === from)
      ? { ...rec, data: { ...rec.data, npcs: rec.data.npcs.map((n) => (n.sprite === from ? { ...n, sprite: to } : n)) } }
      : rec,
  );
  return { project: pj, scenes: nextScenes };
}

function loadedState(data: ProjectData) {
  const first = data.scenes.find((s) => (s.data.name ?? s.fileId) === data.project.start_scene) ?? data.scenes[0];
  return {
    project: data,
    activeSceneId: first?.fileId ?? null,
    selection: first ? ({ kind: "scene", sceneId: first.fileId } as Selection) : ({ kind: "none" } as Selection),
    section: "world" as Section,
    tool: "select" as Tool,
    tilePick: null,
    loading: false,
    error: null,
    saveError: null,
    past: [],
    future: [],
    lastCoalesce: null,
  };
}

export const useProjectStore = create<ProjectState>((set, get) => {
  const onWriteResult = (key: string, error: string | null) => {
    if (error) writeErrors.set(key, error);
    else writeErrors.delete(key);
    set({ saveError: writeErrors.size ? [...writeErrors.values()][0] : null });
  };

  const sceneKey = (rootPath: string, fileId: string) => `scene:${rootPath}:${fileId}`;

  const persistScene = (rootPath: string, fileId: string, scene: SceneJSON) =>
    queueWrite(sceneKey(rootPath, fileId), () => window.api.saveScene({ rootPath, fileId, scene }), onWriteResult);

  const persistProject = (rootPath: string, project: ProjectJSON) =>
    queueWrite(`project:${rootPath}`, () => window.api.saveProject({ rootPath, project }), onWriteResult);

  /** Push the current state onto the undo stack (unless this edit
   * coalesces with the previous one). */
  const recordHistory = (coalesceKey?: string) => {
    const { project, past, lastCoalesce } = get();
    if (!project) return;
    const now = Date.now();
    if (coalesceKey && lastCoalesce && lastCoalesce.key === coalesceKey && now - lastCoalesce.at < COALESCE_MS) {
      set({ lastCoalesce: { key: coalesceKey, at: now }, future: [] });
      return;
    }
    const snap: Snapshot = { project: project.project, scenes: project.scenes };
    set({
      past: [...past, snap].slice(-HISTORY_LIMIT),
      future: [],
      lastCoalesce: coalesceKey ? { key: coalesceKey, at: now } : null,
    });
  };

  /** GB Studio keeps a scene's file in the folder its name says ("Forest/
   * Cave 1" -> scenes/forest/): move it there if it isn't, and point
   * everything that knew the old file id at the new one. */
  const syncSceneFile = async (fileId: string) => {
    const start = get().project;
    if (!start) return;
    const key = sceneKey(start.rootPath, fileId);
    await cancelWrites(key);
    const rec = get().project?.scenes.find((s) => s.fileId === fileId);
    if (!rec) return;
    const r = await window.api.moveScene({ rootPath: start.rootPath, fileId, scene: rec.data });
    if (!r.ok) {
      set({ saveError: r.error });
      return;
    }
    const next = r.value;
    if (next === fileId) return;
    // An edit made while moving queued a save to the old file: drop it and
    // save the latest data at the new place instead.
    await cancelWrites(key);
    writeErrors.delete(key);
    const remap = (list: SceneRecord[]) => list.map((s) => (s.fileId === fileId ? { ...s, fileId: next } : s));
    const st = get();
    if (!st.project) return;
    const scenes = remap(st.project.scenes);
    const latest = scenes.find((s) => s.fileId === next);
    if (latest && latest.data !== rec.data) persistScene(st.project.rootPath, next, latest.data);
    const sel = st.selection;
    set({
      project: { ...st.project, scenes },
      activeSceneId: st.activeSceneId === fileId ? next : st.activeSceneId,
      selection: "sceneId" in sel && sel.sceneId === fileId ? { ...sel, sceneId: next } : sel,
      past: st.past.map((p) => ({ ...p, scenes: remap(p.scenes) })),
      future: st.future.map((p) => ({ ...p, scenes: remap(p.scenes) })),
    });
  };

  /** Swap in a snapshot and write whatever differs to disk. */
  const restore = (snap: Snapshot) => {
    const { project } = get();
    if (!project) return;
    // Undoing a rename puts the scene back in its old folder too.
    for (const rec of snap.scenes) {
      const cur = project.scenes.find((s) => s.fileId === rec.fileId);
      if (cur && (cur.data.name ?? "") !== (rec.data.name ?? "")) queueMicrotask(() => void syncSceneFile(rec.fileId));
    }
    for (const rec of snap.scenes) {
      const cur = project.scenes.find((s) => s.fileId === rec.fileId);
      if (!cur || cur.data !== rec.data) persistScene(project.rootPath, rec.fileId, rec.data);
    }
    if (snap.project !== project.project) persistProject(project.rootPath, snap.project);
    set({ project: { ...project, project: snap.project, scenes: snap.scenes }, lastCoalesce: null });
    // Drop a selection that no longer exists.
    const sel = get().selection;
    if (sel.kind === "door" || sel.kind === "npc" || sel.kind === "note") {
      const scene = snap.scenes.find((s) => s.fileId === sel.sceneId)?.data;
      const list = sel.kind === "door" ? scene?.doors : sel.kind === "npc" ? scene?.npcs : scene?.notes;
      if (!list || sel.index >= list.length) set({ selection: { kind: "scene", sceneId: sel.sceneId } });
    }
  };

  const rememberRecent = (rootPath: string) => {
    const list = [rootPath, ...get().recentProjects.filter((p) => p !== rootPath)].slice(0, 8);
    saveRecent(list);
    set({ recentProjects: list });
  };

  const afterOpen = (data: ProjectData) => {
    // Sprite sheets saved by the previous sprite editor get upgraded once.
    const migrated = migrateProjectSprites(data.project);
    if (migrated !== data.project) {
      data = { ...data, project: migrated };
      persistProject(data.rootPath, migrated);
    }
    set(loadedState(data));
    rememberRecent(data.rootPath);
    void get().refreshAssets();
  };

  return {
    project: null,
    activeSceneId: null,
    selection: { kind: "none" },
    section: "world",
    tool: "select",
    brush: "#",
    brushShape: "8px",
    eraseLayer: "collision",
    tileStamp: null,
    paletteBrush: null,
    placingPrefabId: null,
    tilePick: null,
    loading: false,
    error: null,
    saveError: null,
    assets: null,
    recentProjects: loadRecent(),
    scriptClipboard: null,
    hoverTile: null,
    past: [],
    future: [],
    lastCoalesce: null,

    openProjectDialog: async () => {
      set({ loading: true, error: null });
      const result = await window.api.openProjectDialog();
      if (!result.ok) {
        set({ loading: false, error: result.error });
        return;
      }
      if (!result.value) {
        set({ loading: false });
        return;
      }
      afterOpen(result.value.data);
    },


    openProjectAtPath: async (rootPath: string) => {
      set({ loading: true, error: null });
      const result = await window.api.openProjectAtPath(rootPath);
      if (!result.ok) {
        set({ loading: false, error: result.error });
        return;
      }
      afterOpen(result.value.data);
    },

    newProject: async (name: string) => {
      set({ error: null });
      const picked = await window.api.newProjectDialog();
      if (!picked.ok) {
        set({ error: picked.error });
        return;
      }
      if (!picked.value) return;
      set({ loading: true });
      const result = await window.api.createProject({ parentDir: picked.value.parentDir, name });
      if (!result.ok) {
        set({ loading: false, error: result.error });
        return;
      }
      afterOpen(result.value.data);
    },

    closeProject: () => set({ project: null, assets: null, past: [], future: [], selection: { kind: "none" } }),

    // A pending tile pick belongs to whatever was selected when it
    // started; changing scene/selection (or deleting/undoing, below)
    // cancels it rather than letting the click land somewhere else.
    setActiveScene: (sceneId) => set({ activeSceneId: sceneId, selection: { kind: "scene", sceneId }, tilePick: null }),
    setSelection: (selection) => {
      const cur = get().selection;
      let same = cur.kind === selection.kind;
      if (same) {
        if (cur.kind === "customScript" || cur.kind === "palette" || cur.kind === "prefab") {
          same = cur.id === (selection as { id: string }).id;
        } else if (cur.kind !== "none") {
          same =
            cur.sceneId === (selection as { sceneId: string }).sceneId &&
            (cur.kind === "scene" || cur.kind === "player" || cur.index === (selection as { index: number }).index);
        }
      }
      set(same ? { selection } : { selection, tilePick: null });
    },
    setSection: (section) => set({ section, tilePick: null }),
    setTool: (tool) => set({ tool, tilePick: null }),
    setBrush: (brush) => set({ brush, tool: "collision", tilePick: null }),
    setBrushShape: (brushShape) => set({ brushShape }),
    setEraseLayer: (eraseLayer) => set({ eraseLayer }),
    setTileStamp: (tileStamp) => set({ tileStamp, tool: "tiles", tilePick: null }),
    setPaletteBrush: (paletteBrush) => set({ paletteBrush, tool: "palette", tilePick: null }),
    setPlacingPrefab: (placingPrefabId) => set({ placingPrefabId, tool: placingPrefabId ? "placePrefab" : "select", tilePick: null }),
    setTilePick: (tilePick) => set({ tilePick, section: tilePick ? "world" : get().section }),
    setScriptClipboard: (scriptClipboard) => set({ scriptClipboard }),
    setHoverTile: (hoverTile) => set({ hoverTile }),

    updateScene: (sceneId, updater, coalesceKey) => {
      const { project } = get();
      if (!project) return;
      const idx = project.scenes.findIndex((s) => s.fileId === sceneId);
      if (idx === -1) return;
      const nextScene = updater(project.scenes[idx].data);
      if (nextScene === project.scenes[idx].data) return;

      recordHistory(coalesceKey ? `${sceneId}:${coalesceKey}` : undefined);
      const nextScenes = project.scenes.slice();
      nextScenes[idx] = { fileId: sceneId, data: nextScene };
      set({ project: { ...project, scenes: nextScenes } });
      persistScene(project.rootPath, sceneId, nextScene);
    },

    updateProject: (updater, coalesceKey) => {
      const { project } = get();
      if (!project) return;
      const next = updater(project.project);
      if (next === project.project) return;
      recordHistory(coalesceKey ? `project:${coalesceKey}` : undefined);
      set({ project: { ...project, project: next } });
      persistProject(project.rootPath, next);
    },

    renameRef: (kind, from, to) => {
      const { project } = get();
      if (!project || from === to) return;
      recordHistory();
      const scenes = project.scenes.map((rec) => {
        const data = renameRefsInScene(rec.data, kind, from, to);
        return data === rec.data ? rec : { ...rec, data };
      });
      let pj = project.project;
      const listKey = kind === "flag" ? "flags" : kind === "item" ? "items" : kind === "variable" ? "variables" : null;
      if (listKey) {
        pj = { ...pj, [listKey]: (pj[listKey] ?? []).map((n) => (n === from ? to : n)) };
      }
      if (kind === "scene" && pj.start_scene === from) pj = { ...pj, start_scene: to };

      scenes.forEach((rec, i) => {
        if (rec !== project.scenes[i]) persistScene(project.rootPath, rec.fileId, rec.data);
      });
      if (pj !== project.project) persistProject(project.rootPath, pj);
      set({ project: { ...project, project: pj, scenes } });
    },

    renameSpriteRefs: (from, to) => {
      const { project, past, future } = get();
      if (!project || from === to) return;
      const fix = (snap: Snapshot): Snapshot => {
        const r = renameSpriteIn(snap.project, snap.scenes, from, to);
        return { project: r.project, scenes: r.scenes };
      };
      const next = fix({ project: project.project, scenes: project.scenes });
      next.scenes.forEach((rec, i) => {
        if (rec !== project.scenes[i]) persistScene(project.rootPath, rec.fileId, rec.data);
      });
      if (next.project !== project.project) persistProject(project.rootPath, next.project);
      set({
        project: { ...project, project: next.project, scenes: next.scenes },
        past: past.map(fix),
        future: future.map(fix),
        lastCoalesce: null,
      });
    },

    renameInScene: (sceneId, kind, from, to, index, updater) => {
      get().updateScene(sceneId, (s) => {
        const renamed = updater(s);
        if (!from || from === to) return renamed;
        // Clearing a name: events that used it now refer to it by number.
        return renameRefsInScene(renamed, kind, from, to || index);
      });
    },

    deleteIndexed: (sceneId, kind, index) => {
      get().updateScene(sceneId, (s) => {
        const next =
          kind === "actor"
            ? { ...s, npcs: (s.npcs ?? []).filter((_, i) => i !== index) }
            : { ...s, timers: (s.timers ?? []).filter((_, i) => i !== index) };
        return shiftIndexRefs(next, kind, index);
      });
      set({ tilePick: null });
    },

    renameScene: (sceneId, newName) => {
      const { project } = get();
      if (!project) return;
      const rec = project.scenes.find((s) => s.fileId === sceneId);
      if (!rec) return;
      const oldName = sceneName(rec);
      // "/" makes folders, as in GB Studio. Tidy the path ("Forest / Cave"
      // -> "Forest/Cave", "/Cave" -> "Cave"), and a name ending in "/"
      // ("Forest/") keeps the scene's own name inside that folder.
      const parts = newName.split("/").map((p) => p.trim());
      const leaf = parts.pop() || oldName.split("/").pop()!.trim();
      const trimmed = newName.trim() ? [...parts.filter(Boolean), leaf].join("/") : "";
      const effective = trimmed || sceneId;
      if (effective === oldName) {
        if ((rec.data.name ?? "") !== trimmed) {
          get().updateScene(sceneId, (s) => ({ ...s, name: trimmed || undefined }));
        }
        return;
      }
      recordHistory();
      const scenes = project.scenes.map((r) => {
        let data = r.fileId === sceneId ? { ...r.data, name: trimmed || undefined } : r.data;
        data = renameRefsInScene(data, "scene", oldName, effective);
        return data === r.data ? r : { ...r, data };
      });
      let pj = project.project;
      if (pj.start_scene === oldName) pj = { ...pj, start_scene: effective };
      scenes.forEach((r, i) => {
        if (r !== project.scenes[i]) persistScene(project.rootPath, r.fileId, r.data);
      });
      if (pj !== project.project) persistProject(project.rootPath, pj);
      set({ project: { ...project, project: pj, scenes } });
      void syncSceneFile(sceneId);
    },

    renameSceneFolder: (from, to) => {
      const { project } = get();
      if (!project) return;
      const prefix = `${from}/`;
      for (const rec of project.scenes) {
        const name = sceneName(rec);
        if (!name.startsWith(prefix)) continue;
        const rest = name.slice(prefix.length);
        get().renameScene(rec.fileId, to ? `${to}/${rest}` : rest);
      }
    },

    addScene: async (name, background) => {
      const { project } = get();
      if (!project) return;
      const result = await window.api.createScene({
        rootPath: project.rootPath,
        fileId: name,
        scene: { name, background: background ?? "", player_start: { x: 0, y: 0 } },
      });
      if (!result.ok) {
        set({ saveError: result.error });
        return;
      }
      const { fileId, scene } = result.value;
      const cur = get().project!;
      // Creating/deleting a scene file isn't undoable (it's a file
      // operation, not an edit), so it starts a fresh undo history rather
      // than leaving snapshots that reference a different scene set.
      set({
        project: { ...cur, scenes: [...cur.scenes, { fileId, data: scene }] },
        activeSceneId: fileId,
        selection: { kind: "scene", sceneId: fileId },
        tilePick: null,
        past: [],
        future: [],
      });
    },

    removeScene: async (sceneId) => {
      const { project, activeSceneId } = get();
      if (!project) return;
      await cancelWrites(sceneKey(project.rootPath, sceneId));
      writeErrors.delete(sceneKey(project.rootPath, sceneId));
      const result = await window.api.deleteScene({ rootPath: project.rootPath, fileId: sceneId });
      if (!result.ok) {
        set({ saveError: result.error });
        return;
      }
      const cur = get().project!;
      const nextScenes = cur.scenes.filter((s) => s.fileId !== sceneId);
      const nextActive = activeSceneId === sceneId ? (nextScenes[0]?.fileId ?? null) : activeSceneId;
      set({
        project: { ...cur, scenes: nextScenes },
        activeSceneId: nextActive,
        selection: nextActive ? { kind: "scene", sceneId: nextActive } : { kind: "none" },
        tilePick: null,
        past: [],
        future: [],
      });
    },

    addNpc: (sceneId, x, y) => {
      const npc: NpcJSON = { sprite: "player", x, y, direction: "down", movement: "static", dialogue: "Hello!" };
      let index = 0;
      get().updateScene(sceneId, (s) => {
        const npcs = [...(s.npcs ?? []), npc];
        index = npcs.length - 1;
        return { ...s, npcs };
      });
      set({ selection: { kind: "npc", sceneId, index }, tool: "select" });
    },

    addDoor: (sceneId, door) => {
      let index = 0;
      get().updateScene(sceneId, (s) => {
        const doors = [...(s.doors ?? []), door];
        index = doors.length - 1;
        return { ...s, doors };
      });
      set({ selection: { kind: "door", sceneId, index }, tool: "select" });
    },

    placePrefab: (sceneId, prefabId, x, y) => {
      const { project } = get();
      if (!project) return;
      const prefab = (project.project.prefabs ?? []).find((p) => p.id === prefabId);
      if (!prefab) return;

      if (prefab.kind === "npc") {
        const t = prefab.template as Partial<NpcJSON>;
        const npc: NpcJSON = { sprite: "player", direction: "down", movement: "static", ...t, x, y };
        let index = 0;
        get().updateScene(sceneId, (s) => {
          const npcs = [...(s.npcs ?? []), npc];
          index = npcs.length - 1;
          return { ...s, npcs };
        });
        set({ selection: { kind: "npc", sceneId, index } });
      } else {
        const t = prefab.template as Partial<DoorJSON>;
        const door: DoorJSON = { width: 1, height: 1, ...t, x, y };
        let index = 0;
        get().updateScene(sceneId, (s) => {
          const doors = [...(s.doors ?? []), door];
          index = doors.length - 1;
          return { ...s, doors };
        });
        set({ selection: { kind: "door", sceneId, index } });
      }
      set({ placingPrefabId: null, tool: "select" });
    },

    deleteSelected: () => {
      const { selection } = get();
      if (selection.kind === "door") {
        get().updateScene(selection.sceneId, (s) => ({
          ...s,
          doors: (s.doors ?? []).filter((_, i) => i !== selection.index),
        }));
        set({ selection: { kind: "scene", sceneId: selection.sceneId } });
      } else if (selection.kind === "npc") {
        get().deleteIndexed(selection.sceneId, "actor", selection.index);
        set({ selection: { kind: "scene", sceneId: selection.sceneId } });
      } else if (selection.kind === "note") {
        get().updateScene(selection.sceneId, (s) => ({ ...s, notes: (s.notes ?? []).filter((_, i) => i !== selection.index) }));
        set({ selection: { kind: "scene", sceneId: selection.sceneId } });
      }
      set({ tilePick: null });
    },

    undo: () => {
      const { past, future, project } = get();
      if (!project || past.length === 0) return;
      const prev = past[past.length - 1];
      const cur: Snapshot = { project: project.project, scenes: project.scenes };
      set({ past: past.slice(0, -1), future: [cur, ...future].slice(0, HISTORY_LIMIT), tilePick: null });
      restore(prev);
    },

    redo: () => {
      const { past, future, project } = get();
      if (!project || future.length === 0) return;
      const next = future[0];
      const cur: Snapshot = { project: project.project, scenes: project.scenes };
      set({ future: future.slice(1), past: [...past, cur].slice(-HISTORY_LIMIT), tilePick: null });
      restore(next);
    },

    refreshAssets: async () => {
      const { project } = get();
      if (!project) return;
      const result = await window.api.listAssets(project.rootPath);
      if (result.ok) set({ assets: result.value });
      else set({ saveError: result.error });
    },

    addConstant: (name, value) => {
      get().updateProject((p) => ({ ...p, constants: [...(p.constants ?? []), { name, value }] }));
    },
    renameConstant: (name, next) => {
      get().updateProject((p) => ({
        ...p,
        constants: (p.constants ?? []).map((c) => (c.name === name ? { ...c, name: next } : c)),
      }));
    },
    setConstantValue: (name, value) => {
      get().updateProject(
        (p) => ({ ...p, constants: (p.constants ?? []).map((c) => (c.name === name ? { ...c, value } : c)) }),
        `constant:${name}`,
      );
    },
    removeConstant: (name) => {
      get().updateProject((p) => ({ ...p, constants: (p.constants ?? []).filter((c) => c.name !== name) }));
    },

    addCustomScript: (name) => {
      const id = `script_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      get().updateProject((p) => ({ ...p, customScripts: [...(p.customScripts ?? []), { id, name, script: [] }] }));
      set({ selection: { kind: "customScript", id }, section: "world", tilePick: null });
    },
    renameCustomScript: (id, name) => {
      get().updateProject((p) => ({
        ...p,
        customScripts: (p.customScripts ?? []).map((s) => (s.id === id ? { ...s, name } : s)),
      }));
    },
    removeCustomScript: (id) => {
      const { project } = get();
      if (!project) return;
      recordHistory();

      const scenes = project.scenes.map((rec) => {
        const data = markDeletedCustomScript(rec.data, id);
        return data === rec.data ? rec : { ...rec, data };
      });

      const remaining = (project.project.customScripts ?? []).filter((s) => s.id !== id);
      const customScripts = remaining.map((s) => {
        const script = markDeletedCustomScriptInScript(s.script, id);
        return script === s.script ? s : { ...s, script };
      });
      const pj = { ...project.project, customScripts };

      scenes.forEach((rec, i) => {
        if (rec !== project.scenes[i]) persistScene(project.rootPath, rec.fileId, rec.data);
      });
      persistProject(project.rootPath, pj);
      set({ project: { ...project, project: pj, scenes } });

      const sel = get().selection;
      if (sel.kind === "customScript" && sel.id === id) set({ selection: { kind: "none" } });
    },
    updateCustomScript: (id, updater, coalesceKey) => {
      get().updateProject((p) => {
        const list = p.customScripts ?? [];
        const idx = list.findIndex((s) => s.id === id);
        if (idx === -1) return p;
        const nextScript = updater(list[idx].script);
        if (nextScript === list[idx].script) return p;
        const next = list.slice();
        next[idx] = { ...next[idx], script: nextScript };
        return { ...p, customScripts: next };
      }, coalesceKey ? `customScript:${id}:${coalesceKey}` : `customScript:${id}`);
    },

    addPalette: (name) => {
      const id = `pal_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      get().updateProject((p) => ({
        ...p,
        palettes: [...(p.palettes ?? []), { id, name, colors: ["#e0f8d0", "#88c070", "#346856", "#081820"] }],
      }));
      set({ selection: { kind: "palette", id }, section: "world" });
    },
    renamePalette: (id, name) => {
      get().updateProject((p) => ({
        ...p,
        palettes: (p.palettes ?? []).map((pl) => (pl.id === id ? { ...pl, name } : pl)),
      }));
    },
    setPaletteColors: (id, colors) => {
      get().updateProject(
        (p) => ({ ...p, palettes: (p.palettes ?? []).map((pl) => (pl.id === id ? { ...pl, colors } : pl)) }),
        `palette:${id}`,
      );
    },
    removePalette: (id) => {
      const { project } = get();
      if (!project) return;
      recordHistory();

      // Cells painted with this palette fall back to auto-assignment
      // (null), the same as a tile that was never painted.
      const scenes = project.scenes.map((rec) => {
        if (!rec.data.palette_map) return rec;
        const map = rec.data.palette_map.map((row) => row.map((cell) => (cell === id ? null : cell)));
        return { ...rec, data: { ...rec.data, palette_map: map } };
      });
      const pj = { ...project.project, palettes: (project.project.palettes ?? []).filter((pl) => pl.id !== id) };

      scenes.forEach((rec, i) => {
        if (rec !== project.scenes[i]) persistScene(project.rootPath, rec.fileId, rec.data);
      });
      persistProject(project.rootPath, pj);
      set({ project: { ...project, project: pj, scenes } });

      const sel = get().selection;
      if (sel.kind === "palette" && sel.id === id) set({ selection: { kind: "none" } });
      if (get().paletteBrush === id) set({ paletteBrush: null });
    },

    addPrefab: (kind, name) => {
      const id = `prefab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const template: Partial<NpcJSON> | Partial<DoorJSON> =
        kind === "npc" ? { sprite: "player", direction: "down", movement: "static", dialogue: "Hello!" } : { width: 2, height: 2 };
      get().updateProject((p) => ({ ...p, prefabs: [...(p.prefabs ?? []), { id, kind, name, template }] }));
      set({ selection: { kind: "prefab", id }, section: "world" });
    },
    renamePrefab: (id, name) => {
      get().updateProject((p) => ({
        ...p,
        prefabs: (p.prefabs ?? []).map((pf) => (pf.id === id ? { ...pf, name } : pf)),
      }));
    },
    updatePrefabTemplate: (id, template) => {
      get().updateProject(
        (p) => ({ ...p, prefabs: (p.prefabs ?? []).map((pf) => (pf.id === id ? { ...pf, template } : pf)) }),
        `prefab:${id}`,
      );
    },
    removePrefab: (id) => {
      get().updateProject((p) => ({ ...p, prefabs: (p.prefabs ?? []).filter((pf) => pf.id !== id) }));
      const sel = get().selection;
      if (sel.kind === "prefab" && sel.id === id) set({ selection: { kind: "none" } });
      if (get().placingPrefabId === id) set({ placingPrefabId: null, tool: "select" });
    },
  };
});

/** Scene display name, the way the compiler identifies a scene:
 * its "name", or its file stem when unnamed. */
export function sceneName(rec: SceneRecord): string {
  return rec.data.name || rec.fileId;
}
