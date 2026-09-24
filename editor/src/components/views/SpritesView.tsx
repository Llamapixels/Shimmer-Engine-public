import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AssetInfo } from "../../../shared/ipc";
import {
  SPRITE_ANIMATION_SLOTS,
  SPRITE_LEFT_SLOT_TO_RIGHT,
  type PlacedTileJSON,
  type ProjectJSON,
  type SpriteAnimationType,
  type SpriteFrameJSON,
  type SpriteSheetJSON,
  type SpriteStateJSON,
} from "../../../shared/projectTypes";
import NumberInput from "../../components/common/NumberInput";
import { useProjectStore } from "../../state/projectStore";
import { useAssetUrl, useImageStats } from "./assetImages";
import FramesTimeline, { useLoadedImage, type TimelineFrame } from "./sprites/FramesTimeline";
import MetaspriteEditor, { EDITOR_MARGIN, editorExtents } from "./sprites/MetaspriteEditor";
import {
  AUTO_DETECT_SLOTS,
  flipTilesX,
  flipTilesY,
  gcFrames,
  mirrorTilesForLeft,
  newId,
  normalizeTileIds,
  removeTilesOutsideCanvas,
  spriteModeOf,
  tileHeightFor,
  tilesForClassicFrame,
  uniqueId,
  type PaletteSelection,
  type SpriteMode,
  type Tile,
} from "./sprites/metasprite";
import SpriteTilePalette from "./sprites/SpriteTilePalette";
import "./views.css";
import "./SpritesView.css";

const ANIMATION_TYPE_LABELS: Record<SpriteAnimationType, string> = {
  fixed: "Fixed Direction",
  fixed_movement: "Fixed Direction + Movement",
  horizontal: "Horizontal Directions",
  horizontal_movement: "Horizontal Directions + Movement",
  multi: "Four Directions",
  multi_movement: "Four Directions + Movement",
  platform_player: "Platformer Player",
  cursor: "Cursor",
};

/** Grouped "Animation Type" dropdown, matching real GB Studio's own
 * grouping (see this file's header comment / the screenshots this
 * feature was pinned down from): FIXED DIRECTION / HORIZONTAL
 * DIRECTIONS / FOUR DIRECTIONS / PLATFORMER / POINT AND CLICK. */
const ANIMATION_TYPE_GROUPS: { label: string; types: SpriteAnimationType[] }[] = [
  { label: "FIXED DIRECTION", types: ["fixed", "fixed_movement"] },
  { label: "HORIZONTAL DIRECTIONS", types: ["horizontal", "horizontal_movement"] },
  { label: "FOUR DIRECTIONS", types: ["multi", "multi_movement"] },
  { label: "PLATFORMER", types: ["platform_player"] },
  { label: "POINT AND CLICK", types: ["cursor"] },
];

/** Whether `slot` is one this sheet's `flipLeft` (default true) can
 * derive from a "*Right" sibling - see SPRITE_LEFT_SLOT_TO_RIGHT and
 * SpriteStateJSON.slot's doc comment. */
function isLeftSlot(slot: string | undefined): slot is keyof typeof SPRITE_LEFT_SLOT_TO_RIGHT {
  return !!slot && slot in SPRITE_LEFT_SLOT_TO_RIGHT;
}

/** Whether `flipLeft` is in effect for this sheet (default true - see
 * SpriteSheetJSON.flipLeft's doc comment). */
function flipLeftOn(sheet: SpriteSheetJSON): boolean {
  return sheet.flipLeft !== false;
}

/** A reasonable starting frame for a freshly-created default state, based
 * on its slot's direction - matches the engine's compiled 8-frame set
 * (0,1=down 2,3=up 4,5=right 6,7=left, see FRAME_LABELS above). Purely a
 * nicer-than-blank starting point; the user can change it immediately. */
function defaultFrameForSlot(slot: string): number {
  if (/Down$/.test(slot)) return 0;
  if (/Up$/.test(slot)) return 2;
  if (/Right$/.test(slot)) return 4;
  if (/Left$/.test(slot)) return 6;
  if (slot === "climbing") return 0;
  if (slot === "hover") return 1;
  return 0;
}

/** Look up the sibling "*Right" state a "*Left" state mirrors (matched by
 * `slot`, not by name - the user is free to rename either). */
function rightSiblingFor(states: SpriteStateJSON[], leftSlot: string): SpriteStateJSON | null {
  const rightSlot = SPRITE_LEFT_SLOT_TO_RIGHT[leftSlot];
  if (!rightSlot) return null;
  return states.find((s) => s.slot === rightSlot) ?? null;
}

/** The frames/flips/speed a derived Left state actually shows/compiles
 * with (see SpriteStateJSON.slot's doc comment) - a mirror of its Right
 * sibling, reusing the same per-frame flip-bake mechanism (inverted, so
 * whatever Right shows ends up horizontally mirrored). Mirrors
 * build_project.py's identical derivation for the real compiled output. */
function derivedLeftFrames(right: SpriteStateJSON): { frames: number[]; flips: boolean[]; speed: number } {
  const rightFlips = right.flips ?? right.frames.map(() => false);
  return { frames: [...right.frames], flips: rightFlips.map((f) => !f), speed: right.speed ?? 8 };
}

/** Applies a new Animation Type to a sheet: adds a default state for any
 * of the new type's slots that isn't already filled by an existing
 * state, and removes only states whose slot belonged to the OLD type's
 * default set but not the new one's - anything else (including every
 * custom, non-slot state from before this feature existed) is left
 * completely alone, per the "keep data over losing it" rule.
 *
 * Every newly-added default state starts tile-composed (an empty
 * SpriteFrameJSON pushed onto the sheet's `frames`, referenced via
 * `frameRefs`) rather than the legacy fixed-frame path - same rationale
 * as `SpritesSidebar`'s `addState()` above. This loop only ever APPENDS
 * to `states`/`frames` for a slot that has no existing state yet
 * (`existingSlots.has(slot)` skips it otherwise) - an existing state is
 * never entered into this branch, so it's never rewritten, and the
 * filter above it only ever removes whole states, never mutates one. */
function applyAnimationType(sheet: SpriteSheetJSON, newType: SpriteAnimationType): SpriteSheetJSON {
  const newSlots = SPRITE_ANIMATION_SLOTS[newType];
  const newSlotNames = new Set(newSlots.map((s) => s.slot));
  const oldSlotNames = new Set(sheet.animationType ? SPRITE_ANIMATION_SLOTS[sheet.animationType].map((s) => s.slot) : []);

  let states = (sheet.states ?? []).filter((st) => !(st.slot && oldSlotNames.has(st.slot) && !newSlotNames.has(st.slot)));
  let frames = sheet.frames ?? [];

  const existingSlots = new Set(states.map((st) => st.slot).filter((s): s is string => !!s));
  const usedNames = new Set(states.map((st) => st.name));
  for (const { slot, label } of newSlots) {
    if (existingSlots.has(slot)) continue;
    let name = label;
    let i = 2;
    while (usedNames.has(name)) name = `${label} ${i++}`;
    usedNames.add(name);
    const frameId = `${name}_f1`;
    frames = [...frames, { id: frameId, tiles: [] }];
    states = [...states, { name, slot, frames: [defaultFrameForSlot(slot)], frameRefs: [frameId], speed: 8 }];
  }

  return { ...sheet, animationType: newType, states, frames };
}

/** The engine's fixed frame numbering (entity.h/EntityAnimState), also
 * what authored "frames" indices in project.json's spriteSheets refer
 * to. Frames 6/7 (left) aren't in the source PNG - the compiler
 * generates them by mirroring frames 5/4 (right) - so the editor mirrors
 * them the same way for previewing. */
const FRAME_LABELS = ["down 1", "down 2", "up 1", "up 2", "right 1", "right 2", "left 1", "left 2"];
const FRAME_COUNT = 8;
/** Source column (0-5) + whether to mirror, for each of the 8 logical
 * frames above. */
const FRAME_SOURCE: { col: number; mirror: boolean }[] = [
  { col: 0, mirror: false },
  { col: 1, mirror: false },
  { col: 2, mirror: false },
  { col: 3, mirror: false },
  { col: 4, mirror: false },
  { col: 5, mirror: false },
  { col: 5, mirror: true },
  { col: 4, mirror: true },
];

export default function SpritesView() {
  const project = useProjectStore((s) => s.project)!;
  const assets = useProjectStore((s) => s.assets);
  const [selected, setSelected] = useState<string | null>("player");
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const list: AssetInfo[] = [...(assets?.playerSprite ? [assets.playerSprite] : []), ...(assets?.sprites ?? [])];
  const current = list.find((a) => a.name === selected) ?? null;

  const usedBy = (name: string) =>
    project.scenes.filter((s) => (s.data.npcs ?? []).some((n) => (n.sprite ?? "player") === name)).map((s) => s.fileId);

  const doImport = async () => {
    setError(null);
    const r = await window.api.importAssets({ rootPath: project.rootPath, kind: "sprites" });
    if (!r.ok) setError(r.error);
    else if (r.value) useProjectStore.setState({ assets: r.value });
  };

  const doReplacePlayer = async () => {
    setError(null);
    const r = await window.api.replacePlayerSprite({ rootPath: project.rootPath });
    if (!r.ok) setError(r.error);
    else if (r.value) useProjectStore.setState({ assets: r.value });
  };

  const selectSprite = (name: string) => {
    setSelected(name);
    setSelectedState(null);
  };

  return (
    <div className="sprites-editor">
      <SpritesSidebar
        list={list}
        selected={selected}
        onSelect={selectSprite}
        selectedState={selectedState}
        onSelectState={setSelectedState}
        onImport={doImport}
        error={error}
      />
      {current ? (
        <SpriteWorkspace
          key={current.name}
          asset={current}
          usedBy={usedBy(current.name)}
          onImport={doImport}
          onReplacePlayer={doReplacePlayer}
          selectedState={selectedState}
          onSelectState={setSelectedState}
        />
      ) : (
        <div className="sprites-empty">No sprites found. Import a PNG to get started.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Left sidebar: SPRITES list + ANIMATIONS list for the selected sprite.
// ---------------------------------------------------------------------------

function SpritesSidebar({
  list,
  selected,
  onSelect,
  selectedState,
  onSelectState,
  onImport,
  error,
}: {
  list: AssetInfo[];
  selected: string | null;
  onSelect: (name: string) => void;
  selectedState: string | null;
  onSelectState: (name: string | null) => void;
  onImport: () => void;
  error: string | null;
}) {
  const [search, setSearch] = useState("");
  const spriteSheets = useProjectStore((s) => s.project!.project.spriteSheets ?? []);
  const updateProject = useProjectStore((s) => s.updateProject);
  const filtered = search.trim() ? list.filter((a) => a.name.toLowerCase().includes(search.trim().toLowerCase())) : list;

  const current = list.find((a) => a.name === selected) ?? null;
  const states = current ? (spriteSheets.find((s) => s.name === current.name)?.states ?? []) : [];

  const addState = () => {
    if (!current) return;
    const name = `state${states.length + 1}`;
    // New states start tile-composed (an empty SpriteFrameJSON, referenced
    // via frameRefs) instead of the legacy fixed-16x16-frame path - see
    // this file's header comment on applyAnimationType for why: the
    // legacy PreviewCanvas has no way to pick individual pixels, which is
    // exactly the "it's a sprite and a piece" complaint this addresses.
    // `frames: [0]` is kept alongside purely as a defensive fallback (so
    // an old code path that still reads `frames` first never sees an
    // empty array); `frameRefs` being non-empty is what makes
    // `usingComposed` true and actually drives the UI.
    const frameId = `${name}_f1`;
    patchSheetFor(updateProject, current.name, (s) => ({
      ...s,
      frames: [...(s.frames ?? []), { id: frameId, tiles: [] }],
      states: [...(s.states ?? []), { name, frames: [0], frameRefs: [frameId], speed: 8 }],
    }));
    onSelectState(name);
  };

  return (
    <div className="sprites-sidebar">
      <div className="sprites-section">
        <div className="sprites-section-head">
          <span className="sprites-section-chevron">▾</span>
          <span className="sprites-section-title">SPRITES</span>
          <span className="sprites-section-search" title="Search sprites">
            🔍
          </span>
        </div>
        <input
          className="sprites-search-input"
          placeholder="Search sprites…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="sprites-section-body sprites-file-list">
          {filtered.map((a) => (
            <div
              key={`${a.base}:${a.relPath}`}
              className={`sprites-file-row${a.name === selected ? " sprites-file-row-selected" : ""}`}
              onClick={() => onSelect(a.name)}
            >
              <span className="sprites-file-icon" aria-hidden>
                🖼
              </span>
              <span className="sprites-file-name" title={a.name}>
                {a.name === "player" && a.base === "engine" ? "player.png (built-in)" : `${a.name}.png`}
              </span>
            </div>
          ))}
          {filtered.length === 0 && <div className="sprites-file-empty">No sprites match.</div>}
        </div>
        <button className="btn btn-small sprites-import-btn" onClick={onImport}>
          Import PNG…
        </button>
        {error && <p className="field-error">{error}</p>}
      </div>

      <div className="sprites-section">
        <div className="sprites-section-head">
          <span className="sprites-section-chevron">▾</span>
          <span className="sprites-section-title">ANIMATIONS</span>
          <button className="sprites-section-add" title="Add animation state" onClick={addState} disabled={!current}>
            +
          </button>
        </div>
        <div className="sprites-section-body">
          {!current ? (
            <div className="sprites-file-empty">Select a sprite.</div>
          ) : states.length === 0 ? (
            <div className="sprites-file-empty">No states yet.</div>
          ) : (
            states.map((st) => (
              <div
                key={st.name}
                className={`sprites-file-row${st.name === selectedState ? " sprites-file-row-selected" : ""}`}
                onClick={() => onSelectState(st.name)}
              >
                <span className="sprites-file-icon" aria-hidden>
                  ▶
                </span>
                <span className="sprites-file-name">{st.name}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function emptySheet(name: string): SpriteSheetJSON {
  return { name, states: [], collisionBox: { x: 0, y: 0, width: 16, height: 16 } };
}

/** Drops any authored frame entries past the first with a given id -
 * self-heals a project.json that ended up with a duplicate (the compiler
 * warns and works around it too, but this keeps new saves clean, and
 * fixes it for good the next time the sheet is touched here). Keeps the
 * FIRST entry, matching the `Array.prototype.find`/`.map` lookups the
 * rest of this view uses, so what's shown here never disagrees with
 * which entry the compiler picks. */
function dedupeFrameIds(sheet: SpriteSheetJSON): SpriteSheetJSON {
  const frames = sheet.frames ?? [];
  if (frames.length < 2) return sheet;
  const seen = new Set<string>();
  let sawDuplicate = false;
  const deduped = frames.filter((f) => {
    if (seen.has(f.id)) {
      sawDuplicate = true;
      return false;
    }
    seen.add(f.id);
    return true;
  });
  return sawDuplicate ? { ...sheet, frames: deduped } : sheet;
}

function patchSheetFor(
  updateProject: (updater: (p: ProjectJSON) => ProjectJSON, coalesceKey?: string) => void,
  name: string,
  updater: (sheet: SpriteSheetJSON) => SpriteSheetJSON,
  coalesceKey?: string,
) {
  updateProject((p) => {
    const existing = (p.spriteSheets ?? []).find((s) => s.name === name);
    const next = dedupeFrameIds(updater(existing ?? emptySheet(name)));
    if (existing && next === existing) return p;
    const sheets = p.spriteSheets ?? [];
    const idx = sheets.findIndex((s) => s.name === name);
    return { ...p, spriteSheets: idx >= 0 ? sheets.map((s, i) => (i === idx ? next : s)) : [...sheets, next] };
  }, coalesceKey);
}

// ---------------------------------------------------------------------------
// Center canvas + right properties panel + bottom strip.
// ---------------------------------------------------------------------------

/** Sets animationType "multi_movement" and (re)generates composed frames
 * for a classic 96x16 sheet (engine frame layout: 16x16 frames, cols 0,1 =
 * down walk; 2,3 = up walk; 4,5 = right walk; left = mirrored right via
 * flipLeft). GB Studio's "Auto Detect Animations". Left states get empty
 * frameRefs - with flipLeft on they are derived from their Right sibling. */
function autoDetectAnimations(sheet: SpriteSheetJSON, mode: SpriteMode): SpriteSheetJSON {
  const typed = applyAnimationType(sheet, "multi_movement");
  const states0 = typed.states ?? [];
  const frames0 = typed.frames ?? [];
  const overwritten = new Set<string>();
  for (const st of states0) {
    if (st.slot && (AUTO_DETECT_SLOTS.some((a) => a.slot === st.slot) || isLeftSlot(st.slot))) {
      (st.frameRefs ?? []).forEach((r) => overwritten.add(r));
    }
  }
  const stillReferenced = new Set(
    states0
      .filter((st) => !(st.slot && (AUTO_DETECT_SLOTS.some((a) => a.slot === st.slot) || isLeftSlot(st.slot))))
      .flatMap((st) => st.frameRefs ?? []),
  );
  const keptFrames = frames0.filter((f) => !overwritten.has(f.id) || stillReferenced.has(f.id));
  const taken = new Set<string>([...keptFrames.map((f) => f.id), ...stillReferenced]);
  const newFrames: SpriteFrameJSON[] = [];
  const states = states0.map((st) => {
    const spec = AUTO_DETECT_SLOTS.find((a) => a.slot === st.slot);
    if (spec) {
      const refs = spec.cols.map((col, i) => {
        const id = uniqueId(`${st.name}_f${i + 1}`, taken);
        newFrames.push({ id, tiles: tilesForClassicFrame(col, mode) });
        return id;
      });
      return { ...st, frames: [...spec.cols], flips: spec.cols.map(() => false), frameRefs: refs };
    }
    if (st.slot && isLeftSlot(st.slot)) return { ...st, frameRefs: [] };
    return st;
  });
  return { ...typed, flipLeft: true, states, frames: [...keptFrames, ...newFrames] };
}

/** Center-canvas zoom steps, in screen px per SPRITE PIXEL (100% = 1). */
const ZOOM_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48];
/** Default ("fit") zoom never goes above this: a 16x16 canvas -> 384px. */
const MAX_FIT_ZOOM = 24;

function fitZoom(spanX: number, spanY: number, areaW: number, areaH: number): number {
  if (!areaW || !areaH) return 16;
  let best = ZOOM_STEPS[0];
  for (const z of ZOOM_STEPS) {
    if (z > MAX_FIT_ZOOM) break;
    if (spanX * z + 2 * EDITOR_MARGIN <= areaW && spanY * z + 2 * EDITOR_MARGIN <= areaH) best = z;
  }
  return best;
}

function SpriteWorkspace({
  asset,
  usedBy,
  onImport,
  onReplacePlayer,
  selectedState: selectedStateName,
  onSelectState: setSelectedState,
}: {
  asset: AssetInfo;
  usedBy: string[];
  onImport: () => void;
  onReplacePlayer: () => void;
  selectedState: string | null;
  onSelectState: (name: string | null) => void;
}) {
  const rootPath = useProjectStore((s) => s.project!.rootPath);
  const url = useAssetUrl(rootPath, asset);
  const stats = useImageStats(url);
  const img = useLoadedImage(url);
  const spriteSheets = useProjectStore((s) => s.project!.project.spriteSheets ?? []);
  const updateProject = useProjectStore((s) => s.updateProject);

  const sheet = spriteSheets.find((s) => s.name === asset.name);
  const box = sheet?.collisionBox ?? { x: 0, y: 0, width: 16, height: 16 };
  const states = sheet?.states ?? [];
  const rawState = states.find((s) => s.name === selectedStateName) ?? states[0] ?? null;

  // A "*Left" state derived from its "*Right" sibling (see
  // derivedLeftFrames/rightSiblingFor above) shows/plays that sibling's
  // mirrored frames, not its own - same rule the compiler applies.
  const isDerivedLeft =
    !!rawState && !!sheet && isLeftSlot(rawState.slot) && flipLeftOn(sheet) && !!rightSiblingFor(states, rawState.slot!);
  const rightSibling = isDerivedLeft ? rightSiblingFor(states, rawState!.slot!) : null;
  const state: SpriteStateJSON | null =
    isDerivedLeft && rightSibling ? { ...rawState!, ...derivedLeftFrames(rightSibling) } : rawState;

  const cw = sheet?.canvasWidth ?? 16;
  const ch = sheet?.canvasHeight ?? 16;
  const originX = sheet?.canvasOriginX ?? 0;
  const originY = sheet?.canvasOriginY ?? 0;
  const mode = spriteModeOf(sheet);
  const th = tileHeightFor(mode);
  const sheetW = stats?.width ?? img?.width ?? 0;
  const sheetH = stats?.height ?? img?.height ?? 0;

  // ---- Which frames are shown: composed (frameRefs) or legacy -----------
  const derivedComposed = isDerivedLeft && !!rightSibling?.frameRefs?.length;
  const composedRefs: string[] = derivedComposed
    ? rightSibling!.frameRefs!
    : !isDerivedLeft && rawState?.frameRefs?.length
      ? rawState.frameRefs
      : [];
  const usingComposed = composedRefs.length > 0;
  const sheetFrames = sheet?.frames ?? [];
  const timelineFrames: TimelineFrame[] = useMemo(() => {
    const byId = new Map(sheetFrames.map((f) => [f.id, f]));
    return composedRefs.map((ref) => {
      const tiles = normalizeTileIds(byId.get(ref)?.tiles);
      return { ref, tiles: derivedComposed ? mirrorTilesForLeft(tiles, cw) : tiles };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheetFrames, composedRefs.join("\u0000"), derivedComposed, cw]);

  const legacyFrames = state?.frames?.length ? state.frames : [0];
  const frameCount = usingComposed ? composedRefs.length : legacyFrames.length;

  // ---- View state ------------------------------------------------------
  const [previewFrame, setPreviewFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [darkBg, setDarkBg] = useState(false);
  const [showBounds, setShowBounds] = useState(false);
  const [onionSkin, setOnionSkin] = useState(false);
  const [invert, setInvert] = useState(false);
  const [zoomOverride, setZoomOverride] = useState<number | null>(null);
  /** TILES palette selection (GB Studio's spriteTileSelection). */
  const [paletteSel, setPaletteSel] = useState<PaletteSelection | null>(null);
  /** Selected placed tiles in the current frame, by id. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [replaceMode, setReplaceMode] = useState(false);

  const curIdx = Math.max(0, Math.min(previewFrame, frameCount - 1));
  const current = usingComposed ? (timelineFrames[curIdx] ?? null) : null;
  const currentTiles = current?.tiles ?? [];
  const composedReadOnly = derivedComposed || playing;
  const liveSelectedIds = useMemo(
    () => selectedIds.filter((id) => currentTiles.some((t) => t.id === id)),
    [selectedIds, currentTiles],
  );
  const selectedTiles = currentTiles.filter((t) => liveSelectedIds.includes(t.id));

  useEffect(() => {
    setPreviewFrame(0);
    setSelectedIds([]);
    setReplaceMode(false);
    setPlaying(false);
  }, [state?.name]);

  useEffect(() => {
    setSelectedIds([]);
    setReplaceMode(false);
  }, [curIdx]);

  // Changing sprite mode invalidates the palette selection's row snapping.
  useEffect(() => setPaletteSel(null), [mode]);

  useEffect(() => {
    if (!playing || frameCount <= 1) return;
    const speed = Math.max(1, state?.speed ?? 8);
    const ms = (speed / 60) * 1000; // ~1 VBlank = 1/60s, an authoring approximation
    const id = setInterval(() => {
      setPreviewFrame((f) => {
        const next = f + 1;
        if (next >= frameCount) {
          if (!loop) {
            setPlaying(false);
            return f;
          }
          return 0;
        }
        return next;
      });
    }, ms);
    return () => clearInterval(id);
  }, [playing, loop, frameCount, state?.speed]);

  // ---- Zoom: fit the canvas area unless the user picked a zoom ---------
  const areaRef = useRef<HTMLDivElement>(null);
  const [areaSize, setAreaSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const measure = () => setAreaSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const ext = usingComposed ? editorExtents(cw, ch, originX, originY) : { spanX: 16, spanY: 16 };
  const autoZoom = fitZoom(ext.spanX, ext.spanY, areaSize.w, areaSize.h);
  const zoom = zoomOverride ?? autoZoom;

  // ---- Store writes ------------------------------------------------------
  const patchSheet = (updater: (sheet: SpriteSheetJSON) => SpriteSheetJSON, coalesceKey?: string) =>
    patchSheetFor(updateProject, asset.name, updater, coalesceKey);
  const setBox = (patch: Partial<{ x: number; y: number; width: number; height: number }>) =>
    patchSheet((s) => ({ ...s, collisionBox: { ...box, ...patch } }), "collision-box");
  const patchState = (name: string, updater: (st: SpriteStateJSON) => SpriteStateJSON) =>
    patchSheet((s) => ({ ...s, states: (s.states ?? []).map((st) => (st.name === name ? updater(st) : st)) }));
  const removeState = (name: string) => {
    patchSheet((s) => ({ ...s, states: (s.states ?? []).filter((st) => st.name !== name) }));
    if (selectedStateName === name) setSelectedState(null);
  };

  /** Rewrites one composed frame's tiles (ids normalized first, so tiles
   * from before ids existed get theirs persisted on first edit). */
  const editFrameTiles = (frameId: string, fn: (tiles: Tile[]) => PlacedTileJSON[], coalesceKey?: string) =>
    patchSheet((s) => {
      const fs = s.frames ?? [];
      const base = fs.some((f) => f.id === frameId) ? fs : [...fs, { id: frameId, tiles: [] }];
      return { ...s, frames: base.map((f) => (f.id === frameId ? { ...f, tiles: fn(normalizeTileIds(f.tiles)) } : f)) };
    }, coalesceKey);

  const canEditTiles = usingComposed && !composedReadOnly && !!current;
  const curRef = current?.ref ?? null;

  const onStamp = (newTiles: Tile[]) => {
    if (!canEditTiles || !curRef) return;
    const kept = removeTilesOutsideCanvas(newTiles, cw, ch, th);
    editFrameTiles(curRef, (ts) => removeTilesOutsideCanvas([...ts, ...newTiles], cw, ch, th));
    setSelectedIds(kept.map((t) => t.id));
  };
  /** Deletes one placed tile by id - the cursor-over-an-existing-tile case
   * while a palette selection is armed (see MetaspriteEditor). */
  const onDeleteTile = (tileId: string) => {
    if (!canEditTiles || !curRef) return;
    editFrameTiles(curRef, (ts) => ts.filter((t) => t.id !== tileId));
    setSelectedIds((ids) => ids.filter((id) => id !== tileId));
  };
  const onMoveCommit = (ids: string[], dx: number, dy: number) => {
    if (!canEditTiles || !curRef) return;
    editFrameTiles(curRef, (ts) =>
      removeTilesOutsideCanvas(
        ts.map((t) => (ids.includes(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)),
        cw,
        ch,
        th,
      ),
    );
  };
  const onNudge = (dx: number, dy: number) => {
    if (!canEditTiles || !curRef || !liveSelectedIds.length) return;
    const ids = liveSelectedIds;
    editFrameTiles(curRef, (ts) => ts.map((t) => (ids.includes(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t)), `nudge:${curRef}`);
  };
  const onFlipX = () => {
    if (!canEditTiles || !curRef || !liveSelectedIds.length) return;
    const ids = liveSelectedIds;
    editFrameTiles(curRef, (ts) => flipTilesX(ts, ids));
  };
  const onFlipY = () => {
    if (!canEditTiles || !curRef || !liveSelectedIds.length) return;
    const ids = liveSelectedIds;
    editFrameTiles(curRef, (ts) => flipTilesY(ts, ids, th));
  };
  const onRemoveSelected = () => {
    if (!canEditTiles || !curRef || !liveSelectedIds.length) return;
    const ids = liveSelectedIds;
    editFrameTiles(curRef, (ts) => ts.filter((t) => !ids.includes(t.id)));
    setSelectedIds([]);
  };
  const patchSelected = (patch: Partial<PlacedTileJSON>) => {
    if (!canEditTiles || !curRef || !liveSelectedIds.length) return;
    const ids = liveSelectedIds;
    editFrameTiles(curRef, (ts) =>
      ts.map((t) => {
        if (!ids.includes(t.id)) return t;
        const next: Tile = { ...t, ...patch };
        if (next.palette === undefined) delete next.palette;
        return next;
      }),
    );
  };
  const onReplaceTile = (sheetX: number, sheetY: number) => {
    setReplaceMode(false);
    if (!canEditTiles || !curRef || !liveSelectedIds.length) return;
    const id = liveSelectedIds[0];
    editFrameTiles(curRef, (ts) => ts.map((t) => (t.id === id ? { ...t, sheetX, sheetY } : t)));
  };

  // ---- Frame (timeline) operations - on the state's own frameRefs ------
  const editableState = !isDerivedLeft ? rawState : null;
  const takenFrameIds = (s: SpriteSheetJSON) =>
    new Set<string>([...(s.frames ?? []).map((f) => f.id), ...(s.states ?? []).flatMap((x) => x.frameRefs ?? [])]);
  const addFrame = (clone: boolean) => {
    if (!editableState) return;
    const stName = editableState.name;
    const insertAt = curIdx + 1;
    const srcTiles = clone ? currentTiles.map((t) => ({ ...t, id: newId("t") })) : [];
    patchSheet((s) => {
      const st = (s.states ?? []).find((x) => x.name === stName);
      if (!st) return s;
      const refs = st.frameRefs ?? [];
      const id = uniqueId(`${stName}_f${refs.length + 1}`, takenFrameIds(s));
      const nextRefs = [...refs.slice(0, insertAt), id, ...refs.slice(insertAt)];
      return {
        ...s,
        frames: [...(s.frames ?? []), { id, tiles: srcTiles }],
        states: (s.states ?? []).map((x) => (x.name === stName ? { ...x, frameRefs: nextRefs } : x)),
      };
    });
    setPlaying(false);
    setPreviewFrame(insertAt);
  };
  const deleteFrame = (i: number) => {
    if (!editableState || composedRefs.length <= 1) return;
    const stName = editableState.name;
    patchSheet((s) => {
      const st = (s.states ?? []).find((x) => x.name === stName);
      if (!st?.frameRefs || st.frameRefs.length <= 1) return s;
      const removed = st.frameRefs[i];
      const nextStates = (s.states ?? []).map((x) =>
        x.name === stName ? { ...x, frameRefs: (x.frameRefs ?? []).filter((_, j) => j !== i) } : x,
      );
      return { ...s, states: nextStates, frames: gcFrames(s.frames ?? [], nextStates, [removed]) };
    });
    setPreviewFrame((f) => (f > i ? f - 1 : Math.min(f, composedRefs.length - 2)));
  };
  const reorderFrames = (from: number, to: number) => {
    if (!editableState) return;
    const stName = editableState.name;
    patchState(stName, (x) => {
      const refs = [...(x.frameRefs ?? [])];
      const [moved] = refs.splice(from, 1);
      refs.splice(to, 0, moved);
      return { ...x, frameRefs: refs };
    });
    setPreviewFrame(to);
  };

  const toggleComposed = () => {
    if (!rawState) return;
    if (usingComposed) {
      patchState(rawState.name, (s) => ({ ...s, frameRefs: [] }));
    } else {
      const stName = rawState.name;
      patchSheet((s) => {
        const id = uniqueId(`${stName}_f1`, takenFrameIds(s));
        return {
          ...s,
          frames: [...(s.frames ?? []), { id, tiles: [] }],
          states: (s.states ?? []).map((x) => (x.name === stName ? { ...x, frameRefs: [id] } : x)),
        };
      });
    }
    setSelectedIds([]);
    setPreviewFrame(0);
  };

  const canAutoDetect = sheetW === 96 && sheetH === 16;
  const runAutoDetect = () => {
    if (!canAutoDetect) return;
    const touched = states.filter(
      (st) =>
        st.slot &&
        (AUTO_DETECT_SLOTS.some((a) => a.slot === st.slot) || isLeftSlot(st.slot)) &&
        (st.frameRefs ?? []).some((r) => (sheetFrames.find((f) => f.id === r)?.tiles.length ?? 0) > 0),
    );
    if (
      touched.length > 0 &&
      !window.confirm(
        `Auto Detect Animations will replace the composed frames of: ${touched.map((s) => s.name).join(", ")}. Continue?`,
      )
    )
      return;
    patchSheet((s) => autoDetectAnimations(s, spriteModeOf(s)));
    setSelectedIds([]);
    setPreviewFrame(0);
  };

  const onPaletteSelection = (sel: PaletteSelection) => {
    setPaletteSel(sel);
    setSelectedIds([]);
    setReplaceMode(false);
  };

  const onionTiles =
    onionSkin && usingComposed && composedRefs.length > 1 && !playing
      ? (timelineFrames[(curIdx - 1 + composedRefs.length) % composedRefs.length]?.tiles ?? null)
      : null;

  const hint = !usingComposed
    ? null
    : derivedComposed
      ? `Mirrored from "${rightSibling?.name}" (Flip Left from Right) - read-only`
      : playing
        ? "Playing - pause or click a frame to edit"
        : paletteSel
          ? "Click to stamp the selected tiles - keep clicking to stamp more - Esc to stop"
          : currentTiles.length === 0
            ? "Click-drag in TILES below to pick one or more tiles, then click the canvas to stamp them"
            : "Click a tile to select (shift adds) - drag to move - arrows nudge - X/Z flip - Delete removes";

  const legacyFrame = legacyFrames[curIdx] ?? legacyFrames[0] ?? 0;

  return (
    <div className="sprites-workspace">
      <div className="sprites-center">
        <CenterToolbar
          playing={playing}
          onTogglePlay={() => {
            setPlaying((p) => !p);
            setSelectedIds([]);
          }}
          onFirst={() => {
            setPlaying(false);
            setPreviewFrame(0);
          }}
          onLast={() => {
            setPlaying(false);
            setPreviewFrame(Math.max(0, frameCount - 1));
          }}
          loop={loop}
          onToggleLoop={() => setLoop((l) => !l)}
          composed={usingComposed}
          showGrid={showGrid}
          onToggleGrid={() => setShowGrid((g) => !g)}
          darkBg={darkBg}
          onToggleDarkBg={() => setDarkBg((d) => !d)}
          showBounds={showBounds}
          onToggleBounds={() => setShowBounds((b) => !b)}
          onionSkin={onionSkin}
          onToggleOnionSkin={() => setOnionSkin((o) => !o)}
          invert={invert}
          onToggleInvert={() => setInvert((i) => !i)}
          zoom={zoom}
          onZoom={setZoomOverride}
          onFit={() => setZoomOverride(null)}
          frameLabel={`${frameCount ? curIdx + 1 : 0} / ${frameCount}`}
        />
        <div className="sprites-canvas-area" ref={areaRef}>
          {usingComposed ? (
            <MetaspriteEditor
              url={url}
              sheetW={sheetW}
              sheetH={sheetH}
              cw={cw}
              ch={ch}
              originX={originX}
              originY={originY}
              mode={mode}
              zoom={zoom}
              showGrid={showGrid}
              darkBg={darkBg}
              showBoundingBox={showBounds}
              collisionBox={box}
              tiles={currentTiles}
              onionTiles={onionTiles}
              readOnly={composedReadOnly}
              paletteSel={paletteSel}
              selectedIds={liveSelectedIds}
              onSelectIds={(ids) => {
                setSelectedIds(ids);
                setReplaceMode(false);
              }}
              onStamp={onStamp}
              onDeleteTile={onDeleteTile}
              onMoveCommit={onMoveCommit}
              onClearPalette={() => {
                setPaletteSel(null);
                setReplaceMode(false);
              }}
              onNudge={onNudge}
              onFlipX={onFlipX}
              onFlipY={onFlipY}
              onRemove={onRemoveSelected}
              hint={hint}
            />
          ) : (
            <div className="sprites-legacy-center">
              <PreviewCanvas
                url={url}
                frame={legacyFrame}
                zoom={zoom}
                showGrid={showGrid}
                invert={invert}
                box={box}
                onBoxChange={setBox}
              />
            </div>
          )}
        </div>
      </div>

      <div className="sprites-right-panel" data-testid="sprites-right-panel">
        {usingComposed && !composedReadOnly && selectedTiles.length > 0 ? (
          <SpriteTilePanel
            tiles={selectedTiles}
            replaceMode={replaceMode}
            onFlipX={onFlipX}
            onFlipY={onFlipY}
            onPalette={(palette) => patchSelected({ palette })}
            onPriority={(priority) => patchSelected({ priority })}
            onReplace={() => {
              setPaletteSel(null);
              setReplaceMode((r) => !r);
            }}
            onRemove={onRemoveSelected}
            onBack={() => setSelectedIds([])}
          />
        ) : (
          <>
            <div className="side-title">{asset.name}</div>
            <div className="asset-detail">Imported sheet: {stats ? `${stats.width} × ${stats.height}` : "…"}</div>
            {asset.base === "engine" && asset.name === "player" && (
              <>
                <button className="btn btn-small" onClick={onReplacePlayer}>
                  Replace player.png…
                </button>
                <p className="view-note">
                  Must be exactly 96×16 px (six 16×16 frames: down×2, up×2, right×2 - left is mirrored
                  automatically). Takes effect on the next Build ROM, no other steps needed.
                </p>
              </>
            )}

            <div className="ms-field-label">Canvas Size</div>
            <div className="ms-field-row">
              <span className="pos-label">W</span>
              <NumberInput
                ariaLabel="Canvas width"
                value={cw}
                min={1}
                max={240}
                onChange={(w) => patchSheet((s) => ({ ...s, canvasWidth: w }), "canvas-size")}
              />
              <span className="pos-label">H</span>
              <NumberInput
                ariaLabel="Canvas height"
                value={ch}
                min={1}
                max={160}
                onChange={(h) => patchSheet((s) => ({ ...s, canvasHeight: h }), "canvas-size")}
              />
            </div>
            <div className="ms-field-label">Canvas Origin</div>
            <div className="ms-field-row">
              <span className="pos-label">X</span>
              <NumberInput
                ariaLabel="Canvas origin X"
                value={originX}
                min={-240}
                max={240}
                onChange={(x) => patchSheet((s) => ({ ...s, canvasOriginX: x }), "canvas-origin")}
              />
              <span className="pos-label">Y</span>
              <NumberInput
                ariaLabel="Canvas origin Y"
                value={originY}
                min={-160}
                max={160}
                onChange={(y) => patchSheet((s) => ({ ...s, canvasOriginY: y }), "canvas-origin")}
              />
            </div>
            <label className="ms-select-field">
              Sprite Mode
              <select
                aria-label="Sprite Mode"
                value={mode}
                onChange={(e) => patchSheet((s) => ({ ...s, spriteMode: e.target.value as SpriteMode }))}
              >
                <option value="8x16">8×16</option>
                <option value="8x8">8×8</option>
              </select>
            </label>

            <hr className="side-sep" />
            <div className="side-title">Collision Bounding Box</div>
            <div className="ms-field-row">
              <span className="pos-label">X</span>
              <NumberInput ariaLabel="Bounding box X" value={box.x ?? 0} min={-128} max={127} onChange={(x) => setBox({ x })} />
              <span className="pos-label">Y</span>
              <NumberInput ariaLabel="Bounding box Y" value={box.y ?? 0} min={-128} max={127} onChange={(y) => setBox({ y })} />
              <span className="pos-label">W</span>
              <NumberInput ariaLabel="Bounding box width" value={box.width} min={1} max={255} onChange={(width) => setBox({ width })} />
              <span className="pos-label">H</span>
              <NumberInput ariaLabel="Bounding box height" value={box.height} min={1} max={255} onChange={(height) => setBox({ height })} />
            </div>

            <hr className="side-sep" />
            <div className="side-title">Animation Settings</div>
            <label className="sprites-anim-type-field">
              Animation Type
              <select
                value={sheet?.animationType ?? ""}
                onChange={(e) => {
                  const v = e.target.value as SpriteAnimationType | "";
                  if (v) patchSheet((s) => applyAnimationType(s, v));
                }}
              >
                <option value="" disabled>
                  Choose…
                </option>
                {ANIMATION_TYPE_GROUPS.map((g) => (
                  <optgroup key={g.label} label={g.label}>
                    {g.types.map((t) => (
                      <option key={t} value={t}>
                        {ANIMATION_TYPE_LABELS[t]}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            {sheet?.animationType &&
              SPRITE_ANIMATION_SLOTS[sheet.animationType].some((s) => s.slot in SPRITE_LEFT_SLOT_TO_RIGHT) && (
                <label className="sprites-fliplLeft-field">
                  <input
                    type="checkbox"
                    checked={flipLeftOn(sheet)}
                    onChange={(e) => patchSheet((s) => ({ ...s, flipLeft: e.target.checked }))}
                  />
                  Flip Left from Right
                </label>
              )}
            <div className="ms-panel-btn-row">
              <button
                className="btn btn-small"
                disabled={!canAutoDetect}
                title={
                  canAutoDetect
                    ? "Generate Four Directions + Movement animations from this classic 96×16 sheet"
                    : "Only available for classic 96×16 sheets (six 16×16 frames)"
                }
                onClick={runAutoDetect}
              >
                Auto Detect Animations
              </button>
            </div>

            {state ? (
              <>
                <label className="sprites-anim-name-field">
                  Name
                  <input
                    value={rawState!.name}
                    disabled={isDerivedLeft}
                    onChange={(e) => patchState(rawState!.name, (s) => ({ ...s, name: e.target.value }))}
                  />
                </label>
                <label className="sprites-anim-speed-field">
                  Speed (VBlanks/frame)
                  <NumberInput
                    value={rawState!.speed ?? 8}
                    min={0}
                    max={255}
                    disabled={isDerivedLeft}
                    onChange={(speed) => patchState(rawState!.name, (s) => ({ ...s, speed }))}
                  />
                </label>
                {isDerivedLeft ? (
                  <p className="view-note">
                    Derived from "{rightSibling?.name}" (Flip Left from Right is on) - frames/speed are mirrored, not
                    independently editable. Turn the checkbox off above to author this state's own frames.
                  </p>
                ) : (
                  <label className="sprites-anim-composed-field">
                    <input type="checkbox" checked={usingComposed} onChange={toggleComposed} />
                    Use tile-composed frames
                  </label>
                )}
                <button className="btn btn-small" onClick={() => removeState(rawState!.name)}>
                  Remove animation
                </button>
              </>
            ) : (
              <p className="view-note">No animation selected. Use + next to ANIMATIONS to add one.</p>
            )}

            <hr className="side-sep" />
            <div className="asset-detail">Used in</div>
            {usedBy.length ? (
              <ul className="usage-list">
                {usedBy.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : (
              <div className="asset-detail">No NPCs use it yet.</div>
            )}
          </>
        )}
      </div>

      <BottomStrip
        url={url}
        asset={asset}
        state={state}
        previewFrame={curIdx}
        onPreviewFrame={(i) => {
          setPlaying(false);
          setPreviewFrame(i);
        }}
        onPatchState={rawState && !isDerivedLeft ? (updater) => patchState(rawState.name, updater) : undefined}
        onImport={onImport}
        usingComposed={usingComposed}
        sheetW={sheetW}
        sheetH={sheetH}
        mode={mode}
        paletteSel={paletteSel}
        onPaletteSelection={onPaletteSelection}
        onClearPalette={() => setPaletteSel(null)}
        replaceMode={replaceMode}
        onReplace={onReplaceTile}
        img={img}
        cw={cw}
        ch={ch}
        timelineFrames={timelineFrames}
        timelineReadOnly={derivedComposed}
        onAddFrame={() => addFrame(false)}
        onCloneFrame={() => addFrame(true)}
        onDeleteFrame={deleteFrame}
        onReorderFrames={reorderFrames}
      />
    </div>
  );
}

/** Right panel shown instead of the sprite-level properties while one or
 * more placed tiles are selected - GB Studio's "Sprite Tiles" panel: flip
 * H/V (applied to the whole selection as a group, like GB Studio), a
 * single GBA OBJ palette-bank selector (see PlacedTileJSON's doc comment
 * for why just one, not GB Studio's OBP0/OBP1 + color-palette pair),
 * "Display behind background layer" (draw priority), replace, remove. */
function SpriteTilePanel({
  tiles,
  replaceMode,
  onFlipX,
  onFlipY,
  onPalette,
  onPriority,
  onReplace,
  onRemove,
  onBack,
}: {
  tiles: Tile[];
  replaceMode: boolean;
  onFlipX: () => void;
  onFlipY: () => void;
  onPalette: (v: number | undefined) => void;
  onPriority: (v: boolean) => void;
  onReplace: () => void;
  onRemove: () => void;
  onBack: () => void;
}) {
  const palettes = new Set(tiles.map((t) => (t.palette === undefined ? "" : String(t.palette))));
  const paletteValue = palettes.size === 1 ? [...palettes][0] : "mixed";
  const allFlipX = tiles.every((t) => t.flipX);
  const allFlipY = tiles.every((t) => t.flipY);
  const allPriority = tiles.every((t) => t.priority);
  const somePriority = tiles.some((t) => t.priority);
  return (
    <>
      <button className="btn btn-small sprites-tile-back-btn" onClick={onBack}>
        ← Sprite
      </button>
      <div className="side-title">Sprite Tiles</div>
      <div className="ms-tile-count" data-testid="ms-tile-count">
        {tiles.length === 1
          ? `1 tile - x ${tiles[0].x}, y ${tiles[0].y} - sheet (${tiles[0].sheetX}, ${tiles[0].sheetY})`
          : `${tiles.length} tiles selected`}
      </div>
      <div className="sprites-tile-flip-row">
        <button className={`icon-btn${allFlipX ? " icon-btn-on" : ""}`} title="Flip horizontal (X)" onClick={onFlipX}>
          ⇋
        </button>
        <button className={`icon-btn${allFlipY ? " icon-btn-on" : ""}`} title="Flip vertical (Z)" onClick={onFlipY}>
          ⇵
        </button>
      </div>
      <label className="sprites-tile-palette-field">
        Palette
        <select
          value={paletteValue}
          onChange={(e) => {
            if (e.target.value === "mixed") return;
            onPalette(e.target.value === "" ? undefined : Number(e.target.value));
          }}
        >
          {paletteValue === "mixed" && <option value="mixed">Mixed</option>}
          <option value="">Sprite default</option>
          {Array.from({ length: 16 }, (_, i) => (
            <option key={i} value={i}>
              Palette {i}
            </option>
          ))}
        </select>
      </label>
      <label className="sprites-tile-priority-field">
        <input
          type="checkbox"
          checked={allPriority}
          ref={(el) => {
            if (el) el.indeterminate = somePriority && !allPriority;
          }}
          onChange={(e) => onPriority(e.target.checked)}
        />
        Display behind background layer
      </label>
      <hr className="side-sep" />
      <div className="ms-panel-btn-row">
        {tiles.length === 1 && (
          <button className={`btn btn-small${replaceMode ? " icon-btn-on" : ""}`} onClick={onReplace} title="Then click a tile in TILES">
            {replaceMode ? "Pick a tile in TILES…" : "Replace tile"}
          </button>
        )}
        <button className="btn btn-small" onClick={onRemove}>
          {tiles.length === 1 ? "Remove tile" : `Remove ${tiles.length} tiles`}
        </button>
      </div>
    </>
  );
}

function CenterToolbar({
  playing,
  onTogglePlay,
  onFirst,
  onLast,
  loop,
  onToggleLoop,
  composed,
  showGrid,
  onToggleGrid,
  darkBg,
  onToggleDarkBg,
  showBounds,
  onToggleBounds,
  onionSkin,
  onToggleOnionSkin,
  invert,
  onToggleInvert,
  zoom,
  onZoom,
  onFit,
  frameLabel,
}: {
  playing: boolean;
  onTogglePlay: () => void;
  onFirst: () => void;
  onLast: () => void;
  loop: boolean;
  onToggleLoop: () => void;
  composed: boolean;
  showGrid: boolean;
  onToggleGrid: () => void;
  darkBg: boolean;
  onToggleDarkBg: () => void;
  showBounds: boolean;
  onToggleBounds: () => void;
  onionSkin: boolean;
  onToggleOnionSkin: () => void;
  invert: boolean;
  onToggleInvert: () => void;
  zoom: number;
  onZoom: (z: number) => void;
  onFit: () => void;
  frameLabel: string;
}) {
  const lower = [...ZOOM_STEPS].reverse().find((z) => z < zoom) ?? ZOOM_STEPS[0];
  const higher = ZOOM_STEPS.find((z) => z > zoom) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
  return (
    <div className="sprites-toolbar">
      <button className="icon-btn" title="First frame" onClick={onFirst}>
        ⏮
      </button>
      <button className="icon-btn" title={playing ? "Pause" : "Play"} onClick={onTogglePlay}>
        {playing ? "⏸" : "▶"}
      </button>
      <button className="icon-btn" title="Last frame" onClick={onLast}>
        ⏭
      </button>
      <button className={`icon-btn${loop ? " icon-btn-on" : ""}`} title="Loop" onClick={onToggleLoop}>
        🔁
      </button>
      <span className="sprites-zoom-value" data-testid="frame-label">
        {frameLabel}
      </span>
      {composed && (
        <button className={`icon-btn${onionSkin ? " icon-btn-on" : ""}`} title="Onion skin" onClick={onToggleOnionSkin}>
          ◎
        </button>
      )}
      <button className={`icon-btn${showGrid ? " icon-btn-on" : ""}`} title="Show grid" onClick={onToggleGrid}>
        ▦
      </button>
      {composed ? (
        <>
          <button className={`icon-btn${darkBg ? " icon-btn-on" : ""}`} title="Dark background" onClick={onToggleDarkBg}>
            ◐
          </button>
          <button className={`icon-btn${showBounds ? " icon-btn-on" : ""}`} title="Show bounding box" onClick={onToggleBounds}>
            ▣
          </button>
        </>
      ) : (
        <button className={`icon-btn${invert ? " icon-btn-on" : ""}`} title="Invert preview" onClick={onToggleInvert}>
          ◐
        </button>
      )}
      <div className="sprites-toolbar-spacer" />
      <div className="sprites-zoom">
        <button className="icon-btn" title="Zoom out" onClick={() => onZoom(lower)}>
          −
        </button>
        <span className="sprites-zoom-value" data-testid="zoom-value">
          {zoom * 100}%
        </span>
        <button className="icon-btn" title="Zoom in" onClick={() => onZoom(higher)}>
          +
        </button>
        <button className="icon-btn" title="Fit canvas to view" onClick={onFit}>
          ⤢
        </button>
      </div>
    </div>
  );
}

/** Legacy (numbered-frame) preview: the current 16x16 frame of the classic
 * sheet at `zoom` (screen px per sprite pixel), with the collision box
 * drag/resize overlay. Only used by states that don't use composed frames. */
function PreviewCanvas({
  url,
  frame,
  zoom,
  showGrid,
  invert,
  box,
  onBoxChange,
}: {
  url: string | null;
  frame: number;
  zoom: number;
  showGrid: boolean;
  invert: boolean;
  box: { x?: number; y?: number; width: number; height: number };
  onBoxChange: (patch: Partial<{ x: number; y: number; width: number; height: number }>) => void;
}) {
  const SCALE = zoom; // screen px per sprite pixel
  const dragRef = useRef<null | { mode: "move" | "resize"; startX: number; startY: number; box: { x: number; y: number; width: number; height: number } }>(null);

  const x = box.x ?? 0;
  const y = box.y ?? 0;
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const src = FRAME_SOURCE[frame] ?? FRAME_SOURCE[0];

  const onPointerDown = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { mode, startX: e.clientX, startY: e.clientY, box: { x, y, width: box.width, height: box.height } };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = Math.round((e.clientX - drag.startX) / SCALE);
    const dy = Math.round((e.clientY - drag.startY) / SCALE);
    if (drag.mode === "move") {
      onBoxChange({ x: clamp(drag.box.x + dx, -16, 16), y: clamp(drag.box.y + dy, -16, 16) });
    } else {
      onBoxChange({ width: clamp(drag.box.width + dx, 1, 32), height: clamp(drag.box.height + dy, 1, 32) });
    }
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div className="sprites-canvas-checker" style={{ width: 16 * SCALE, height: 16 * SCALE }}>
      {url && (
        <div
          className={`sprites-canvas-frame${invert ? " sprites-canvas-invert" : ""}`}
          style={{
            width: 16 * SCALE,
            height: 16 * SCALE,
            backgroundImage: `url(${url})`,
            backgroundSize: `${96 * SCALE}px ${16 * SCALE}px`,
            backgroundPosition: `-${src.col * 16 * SCALE}px 0`,
            transform: src.mirror ? "scaleX(-1)" : undefined,
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {showGrid && <div className="sprites-canvas-grid" style={{ backgroundSize: `${SCALE}px ${SCALE}px` }} />}
          <div className="sprites-canvas-origin" title="Origin (top-left)" />
          <div
            className="sprite-box-overlay"
            style={{ left: x * SCALE, top: y * SCALE, width: box.width * SCALE, height: box.height * SCALE }}
            onPointerDown={onPointerDown("move")}
          >
            <div className="sprite-box-handle" onPointerDown={onPointerDown("resize")} />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom strip: TILES (palette) + FRAMES: <state name> (timeline).
// ---------------------------------------------------------------------------

function BottomStrip({
  url,
  asset,
  state,
  previewFrame,
  onPreviewFrame,
  onPatchState,
  onImport,
  usingComposed,
  sheetW,
  sheetH,
  mode,
  paletteSel,
  onPaletteSelection,
  onClearPalette,
  replaceMode,
  onReplace,
  img,
  cw,
  ch,
  timelineFrames,
  timelineReadOnly,
  onAddFrame,
  onCloneFrame,
  onDeleteFrame,
  onReorderFrames,
}: {
  url: string | null;
  asset: AssetInfo;
  state: SpriteStateJSON | null;
  previewFrame: number;
  onPreviewFrame: (i: number) => void;
  onPatchState?: (updater: (st: SpriteStateJSON) => SpriteStateJSON) => void;
  onImport: () => void;
  usingComposed: boolean;
  sheetW: number;
  sheetH: number;
  mode: SpriteMode;
  paletteSel: PaletteSelection | null;
  onPaletteSelection: (sel: PaletteSelection) => void;
  onClearPalette: () => void;
  replaceMode: boolean;
  onReplace: (sheetX: number, sheetY: number) => void;
  img: HTMLImageElement | null;
  cw: number;
  ch: number;
  timelineFrames: TimelineFrame[];
  timelineReadOnly: boolean;
  onAddFrame: () => void;
  onCloneFrame: () => void;
  onDeleteFrame: (i: number) => void;
  onReorderFrames: (from: number, to: number) => void;
}) {
  const [tilesZoom, setTilesZoom] = useState(4);

  return (
    <div className="sprites-bottom">
      <div className="sprites-bottom-section">
        <div className="sprites-bottom-head">
          <span className="sprites-bottom-title">
            TILES{" "}
            {usingComposed && paletteSel && (
              <span className="ms-palette-sel-info" data-testid="ms-palette-sel-info">
                {paletteSel.width}×{paletteSel.height} selected
              </span>
            )}
          </span>
          {usingComposed && paletteSel && (
            <button className="btn btn-small" title="Stop stamping (Esc)" onClick={onClearPalette}>
              Clear
            </button>
          )}
          <div className="sprites-zoom">
            <button className="icon-btn" onClick={() => setTilesZoom((z) => Math.max(1, z - 1))}>
              −
            </button>
            <span className="sprites-zoom-value">{tilesZoom * 100}%</span>
            <button className="icon-btn" onClick={() => setTilesZoom((z) => Math.min(8, z + 1))}>
              +
            </button>
          </div>
          <button className="btn btn-small" onClick={onImport}>
            Edit Image…
          </button>
        </div>
        {usingComposed ? (
          <SpriteTilePalette
            url={url}
            sheetW={sheetW}
            sheetH={sheetH}
            mode={mode}
            zoom={tilesZoom}
            selection={paletteSel}
            onSelection={onPaletteSelection}
            replaceMode={replaceMode}
            onReplace={onReplace}
          />
        ) : (
          <div className="sprites-tiles-strip">
            {url && (
              <img
                className="sprites-tiles-img"
                src={url}
                alt={asset.name}
                style={{ width: (sheetW || 96) * tilesZoom, height: (sheetH || 16) * tilesZoom, imageRendering: "pixelated" }}
              />
            )}
          </div>
        )}
      </div>

      <div className="sprites-bottom-section">
        <div className="sprites-bottom-head">
          <span className="sprites-bottom-title">FRAMES: {state?.name ?? "—"}</span>
        </div>
        {state && usingComposed ? (
          <FramesTimeline
            frames={timelineFrames}
            img={img}
            cw={cw}
            ch={ch}
            mode={mode}
            selected={previewFrame}
            readOnly={timelineReadOnly}
            onSelect={onPreviewFrame}
            onAdd={onAddFrame}
            onClone={onCloneFrame}
            onDelete={onDeleteFrame}
            onReorder={onReorderFrames}
          />
        ) : state && onPatchState ? (
          <FrameStrip url={url} state={state} selected={previewFrame} onSelect={onPreviewFrame} onPatch={onPatchState} />
        ) : state ? (
          <div className="sprites-file-empty">Derived from its Right sibling (Flip Left from Right).</div>
        ) : (
          <div className="sprites-file-empty">Select an animation to edit its frames.</div>
        )}
      </div>
    </div>
  );
}

function FrameStrip({
  url,
  state,
  selected,
  onSelect,
  onPatch,
}: {
  url: string | null;
  state: SpriteStateJSON;
  selected: number;
  onSelect: (i: number) => void;
  onPatch: (updater: (st: SpriteStateJSON) => SpriteStateJSON) => void;
}) {
  const flips = useMemo(() => state.flips ?? state.frames.map(() => false), [state.flips, state.frames]);
  const dragIdx = useRef<number | null>(null);

  const setFrames = (frames: number[], nextFlips: boolean[]) => onPatch((s) => ({ ...s, frames, flips: nextFlips }));
  const removeAt = (idx: number) => {
    const frames = state.frames.filter((_, i) => i !== idx);
    const nf = flips.filter((_, i) => i !== idx);
    setFrames(frames, nf);
    if (selected >= frames.length) onSelect(Math.max(0, frames.length - 1));
  };
  const toggleFlip = (idx: number) => {
    const nf = flips.map((f, i) => (i === idx ? !f : f));
    setFrames(state.frames, nf);
  };
  const addFrame = () => {
    setFrames([...state.frames, 0], [...flips, false]);
  };
  const reorder = (from: number, to: number) => {
    if (from === to) return;
    const frames = [...state.frames];
    const nf = [...flips];
    const [f] = frames.splice(from, 1);
    const [fl] = nf.splice(from, 1);
    frames.splice(to, 0, f);
    nf.splice(to, 0, fl);
    setFrames(frames, nf);
  };
  const pickFrame = (idx: number, logicalFrame: number) => {
    const frames = state.frames.map((f, i) => (i === idx ? logicalFrame : f));
    setFrames(frames, flips);
  };

  return (
    <div className="sprites-frame-strip">
      {state.frames.map((f, i) => (
        <div
          key={i}
          className={`sprites-frame-thumb${i === selected ? " sprites-frame-thumb-selected" : ""}`}
          draggable
          onDragStart={() => (dragIdx.current = i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIdx.current !== null) reorder(dragIdx.current, i);
            dragIdx.current = null;
          }}
          onClick={() => onSelect(i)}
        >
          {url && (
            <div
              className="sprites-frame-thumb-img"
              style={{
                backgroundImage: `url(${url})`,
                backgroundSize: `${96 * 3}px ${16 * 3}px`,
                backgroundPosition: `-${(FRAME_SOURCE[f] ?? FRAME_SOURCE[0]).col * 48}px 0`,
                transform: (FRAME_SOURCE[f] ?? FRAME_SOURCE[0]).mirror !== flips[i] ? "scaleX(-1)" : undefined,
              }}
              title={FRAME_LABELS[f] ?? `frame ${f}`}
            />
          )}
          <select
            className="sprites-frame-thumb-select"
            value={f}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => pickFrame(i, Number(e.target.value))}
          >
            {Array.from({ length: FRAME_COUNT }, (_, fi) => (
              <option key={fi} value={fi}>
                {fi}
              </option>
            ))}
          </select>
          <button
            className={`sprites-frame-flip-btn${flips[i] ? " sprites-frame-flip-btn-on" : ""}`}
            title="Flip frame horizontally"
            onClick={(e) => {
              e.stopPropagation();
              toggleFlip(i);
            }}
          >
            ⇋
          </button>
          <button
            className="sprites-frame-delete-btn"
            title="Remove frame"
            onClick={(e) => {
              e.stopPropagation();
              removeAt(i);
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button className="sprites-frame-add-btn" title="Add frame" onClick={addFrame}>
        +
      </button>
    </div>
  );
}
