import { useMemo, useState } from "react";

import type { Direction, EventScript, ScriptEventJSON } from "../../shared/eventTypes";
import type {
  BgLayerJSON,
  TileAnimationJSON,
  DoorJSON,
  NpcJSON,
  PlayerJSON,
  NpcMovement,
  ParallaxLayerJSON,
  SceneJSON,
  SceneRecord,
  SceneType,
  ScriptParam,
  TimerJSON,
} from "../../shared/projectTypes";
import ScriptEditor, { type ScriptUpdater } from "../script/ScriptEditor";
import type { ScriptEnv } from "../script/ScriptFields";
import { countRefs } from "../script/scriptRefs";
import { sceneName, useProjectStore } from "../state/projectStore";
import { BackgroundSelect, backgroundRefFor, MusicSelect, SpriteSelect } from "./common/AssetSelect";
import CommitInput from "./common/CommitInput";
import NumberInput from "./common/NumberInput";
import FieldRow from "./inspector/FieldRow";
import { UsedInList } from "./UsedIn";
import { EngineFields } from "../engine/EngineSettingsCard";
import { type EngineValue, modeLabel, settingsForMode, settingValue } from "../engine/engineSettings";
import "./PropertiesPanel.css";
import Icon from "./common/Icon";
import { RC_TEX_CHARS, sceneTextures } from "../world/paint";
import { RC_DEFAULT_CEILING, RC_DEFAULT_WALL, RC_MAX_FLATS, RC_SKY, tilesText } from "../world/raycastView";
import Chevron from "./common/Chevron";

const DIRECTIONS: Direction[] = ["down", "up", "left", "right"];
const MOVEMENTS: NpcMovement[] = ["static", "wander"];
const MAX_TIMERS = 8;
/** Mirrors compiler/build_project.py's COLORS_PER_BANK - one shared
 * backdrop slot plus up to this many real colors per palette bank. */
const COLORS_PER_BANK = 15;

export default function PropertiesPanel() {
  const project = useProjectStore((s) => s.project);
  const selection = useProjectStore((s) => s.selection);

  if (!project || selection.kind === "none") {
    return (
      <div className="properties-panel properties-panel-empty">
        <p>Select a scene, door, or NPC to edit its properties.</p>
      </div>
    );
  }

  if (selection.kind === "customScript") {
    return (
      <div className="properties-panel">
        <CustomScriptProps id={selection.id} />
      </div>
    );
  }

  if (selection.kind === "palette") {
    return (
      <div className="properties-panel">
        <PaletteProps id={selection.id} />
      </div>
    );
  }

  if (selection.kind === "prefab") {
    return (
      <div className="properties-panel">
        <PrefabProps id={selection.id} scenes={project.scenes} />
      </div>
    );
  }

  const scene = project.scenes.find((s) => s.fileId === selection.sceneId);
  if (!scene) {
    return (
      <div className="properties-panel properties-panel-empty">
        <p>Scene not found.</p>
      </div>
    );
  }

  return (
    <div
      className="properties-panel"
      onDragOver={(e) => {
        // Scroll while dragging an event near the panel's top/bottom edge,
        // so a block can be dragged to anywhere in a long script.
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const edge = 48;
        if (e.clientY < r.top + edge) el.scrollTop -= Math.ceil((r.top + edge - e.clientY) / 3);
        else if (e.clientY > r.bottom - edge) el.scrollTop += Math.ceil((e.clientY - (r.bottom - edge)) / 3);
      }}
    >
      {selection.kind === "scene" && <SceneProps scene={scene} scenes={project.scenes} />}
      {selection.kind === "player" && <PlayerProps scene={scene} scenes={project.scenes} />}
      {selection.kind === "door" && <DoorProps scene={scene} scenes={project.scenes} index={selection.index} />}
      {selection.kind === "npc" && <NpcProps scene={scene} scenes={project.scenes} index={selection.index} />}
      {selection.kind === "note" && <NoteProps scene={scene} index={selection.index} />}
    </div>
  );
}

function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="panel-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === value}
          className={`panel-tab${t.id === value ? " panel-tab-active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function useEnv(rootId: string, scene: SceneRecord, scenes: SceneRecord[], allowSelf: boolean): ScriptEnv {
  return useMemo(
    () => ({ rootId, sceneId: scene.fileId, scene: scene.data, scenes, allowSelf }),
    [rootId, scene, scenes, allowSelf],
  );
}

/** Apply a script edit to obj[key], returning obj itself when nothing
 * changed - so an edit that found nothing to do (e.g. a delayed tile
 * pick whose event is gone) never writes a new, empty script. */
function withScript<T extends object, K extends keyof T & string>(
  obj: T,
  key: K,
  fn: (s: EventScript) => EventScript,
): T {
  const cur = obj[key] as unknown as EventScript | undefined;
  const base = cur ?? [];
  const next = fn(base);
  return next === base ? obj : { ...obj, [key]: next };
}

function PickButton({ label, onPick }: { label: string; onPick: (x: number, y: number) => void }) {
  const setTilePick = useProjectStore((s) => s.setTilePick);
  return (
    <button className="btn btn-small" title="Click a tile on the canvas" onClick={() => setTilePick({ label, onPick })}>
      <Icon name="pick" /> Pick
    </button>
  );
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function SceneProps({ scene, scenes }: { scene: SceneRecord; scenes: SceneRecord[] }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const renameScene = useProjectStore((s) => s.renameScene);
  const playerSprite = useProjectStore((s) => s.project?.project.playerSprite) || "player";
  const [tab, setTab] = useState<"init" | "hit" | "timers">("init");
  const [hitGroup, setHitGroup] = useState<"1" | "2" | "3">("1");
  const [showEngine, setShowEngine] = useState(false);
  const data = scene.data;
  const id = scene.fileId;
  const env = useEnv(`${id}:on_init`, scene, scenes, false);
  const hitEnv = useEnv(`${id}:on_player_hit:${hitGroup}`, scene, scenes, false);
  const patch = (p: Partial<SceneJSON>, key?: string) => updateScene(id, (s) => ({ ...s, ...p }), key);

  const onInit: ScriptUpdater = (fn, key) =>
    updateScene(id, (s) => withScript(s, "on_init", fn), key ? `on_init:${key}` : undefined);
  const onHit: ScriptUpdater = (fn, key) =>
    updateScene(
      id,
      (s) => {
        const hits = s.on_player_hit ?? {};
        const next = withScript(hits, hitGroup, fn);
        return next === hits ? s : { ...s, on_player_hit: next };
      },
      key ? `hit${hitGroup}:${key}` : undefined,
    );

  return (
    <>
      <div className="properties-header">Scene</div>
      <div className="properties-body">
        <FieldRow label="Name" hint="Doors and Change Scene events refer to scenes by this name">
          <CommitInput
            value={data.name ?? ""}
            placeholder={id}
            onCommit={(v) => {
              const n = v.trim() || id;
              if (scenes.some((s) => s.fileId !== id && sceneName(s) === n)) return `Another scene is already called "${n}".`;
              renameScene(id, v);
            }}
          />
        </FieldRow>

        <FieldRow label="Type" hint={SCENE_TYPES.find((t) => t.id === (data.type ?? "topdown"))?.hint}>
          <div className="type-row">
            <select
              value={data.type ?? "topdown"}
              onChange={(e) => {
                const type = e.target.value === "topdown" ? undefined : (e.target.value as SceneType);
                // A new 3D scene: ground a tile up (room for pits), walls two tiles high.
                if (type === "raycast" && !data.raycast) patch({ type, raycast: { floor_height: 8, ceiling_height: 24 } });
                else patch({ type });
              }}
            >
              {SCENE_TYPES.filter((t) => t.id !== "adventure" || data.type === "adventure").map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <button
              className={`btn btn-small${showEngine ? " pin-btn-on" : ""}`}
              title="This scene's own engine settings"
              onClick={(e) => {
                e.preventDefault();
                setShowEngine((v) => !v);
              }}
            >
              Engine{data.engine && Object.keys(data.engine).length ? ` (${Object.keys(data.engine).length})` : ""}
            </button>
          </div>
        </FieldRow>
        {data.type === "adventure" && <AdventureConvert scene={scene} />}
        {data.type === "raycast" && <RaycastLookEditor scene={scene} />}
        {showEngine && <SceneEngineOverrides scene={scene} />}

        <FieldRow
          label="Background"
          hint={data.type === "raycast" ? "In First Person 3D it only sets the map's size (8 px a tile) and what you paint over." : undefined}
        >
          <BackgroundSelect value={data.background} onChange={(ref) => patch({ background: ref })} />
        </FieldRow>

        <FieldRow label="Music">
          <MusicSelect value={data.music} onChange={(m) => patch({ music: m })} />
        </FieldRow>

        {data.type !== "raycast" && <LayersEditor scene={scene} />}
        {data.type !== "raycast" && <TileAnimationsEditor scene={scene} />}

        {data.type !== "raycast" && <ParallaxEditor scene={scene} />}

        <FieldRow label="Player sprite">
          <PlayerSpriteSelect value={data.player_sprite} projectDefault={playerSprite} onChange={(v) => patch({ player_sprite: v })} />
        </FieldRow>

        <FieldRow label="Start position (tile)">
          <div className="xy-row">
            <NumberInput
              value={data.player_start?.x ?? 0}
              min={0}
              onChange={(x) => updateScene(id, (s) => ({ ...s, player_start: { x, y: s.player_start?.y ?? 0 } }), "start")}
            />
            <NumberInput
              value={data.player_start?.y ?? 0}
              min={0}
              onChange={(y) => updateScene(id, (s) => ({ ...s, player_start: { x: s.player_start?.x ?? 0, y } }), "start")}
            />
            <PickButton label="Player start" onPick={(x, y) => patch({ player_start: { x, y } })} />
          </div>
        </FieldRow>

        <FieldRow label="Direction" hint="Which way the player faces when the game starts in this scene.">
          <DirectionPicker value={data.player_start_direction ?? "down"} onChange={(d) => patch({ player_start_direction: d })} />
        </FieldRow>
      </div>

      <Tabs
        tabs={[
          { id: "init", label: "On Init" },
          { id: "hit", label: "On Player Hit" },
          { id: "timers", label: `Timers (${data.timers?.length ?? 0})` },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="properties-body properties-script">
        {tab === "init" && (
          <ScriptEditor
            value={data.on_init}
            onChange={onInit}
            env={env}
            emptyHint="Runs every time this scene loads - e.g. an intro cutscene, or hiding an NPC once a flag is set."
          />
        )}
        {tab === "hit" && (
          <>
            <div className="seg seg-wide script-subtabs">
              {(["1", "2", "3"] as const).map((g) => (
                <button key={g} className={hitGroup === g ? "seg-on" : ""} onClick={() => setHitGroup(g)}>
                  Group {g}
                  {data.on_player_hit?.[g]?.length ? ` (${data.on_player_hit[g]!.length})` : ""}
                </button>
              ))}
            </div>
            <ScriptEditor
              key={hitGroup}
              value={data.on_player_hit?.[hitGroup]}
              onChange={onHit}
              env={hitEnv}
              emptyHint={`Runs when the player touches an actor in collision group ${hitGroup} (unless that actor has its own On Hit script).`}
            />
          </>
        )}
        {tab === "timers" && <TimersEditor scene={scene} scenes={scenes} />}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Player (clicked on the canvas): its start, sprite and own scripts, like an NPC

function PlayerProps({ scene, scenes }: { scene: SceneRecord; scenes: SceneRecord[] }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const playerSprite = useProjectStore((s) => s.project?.project.playerSprite) || "player";
  const [tab, setTab] = useState<"init" | "update" | "hit">("init");
  const [hitGroup, setHitGroup] = useState<"1" | "2" | "3">("1");
  const data = scene.data;
  const id = scene.fileId;
  const player: PlayerJSON = data.player ?? {};
  const env = useEnv(`${id}:player:${tab}`, scene, scenes, false);
  const hitEnv = useEnv(`${id}:on_player_hit:${hitGroup}`, scene, scenes, false);

  const setPlayer = (fn: (p: PlayerJSON) => PlayerJSON, key?: string) =>
    updateScene(
      id,
      (s) => {
        const cur = s.player ?? {};
        const next = fn(cur);
        if (next === cur) return s;
        const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined)) as PlayerJSON;
        const { player: _drop, ...rest } = s;
        return Object.keys(clean).length ? { ...rest, player: clean } : rest;
      },
      key ? `player:${key}` : undefined,
    );
  const patchPlayer = (p: Partial<PlayerJSON>, key?: string) => setPlayer((cur) => ({ ...cur, ...p }), key);
  const onScript: ScriptUpdater = (fn, key) => {
    if (tab === "hit") return;
    const k = tab === "init" ? "on_init" : "on_update";
    setPlayer((p) => withScript(p, k, fn), key ? `${k}:${key}` : undefined);
  };
  const onHit: ScriptUpdater = (fn, key) =>
    updateScene(
      id,
      (s) => {
        const hits = s.on_player_hit ?? {};
        const next = withScript(hits, hitGroup, fn);
        return next === hits ? s : { ...s, on_player_hit: next };
      },
      key ? `hit${hitGroup}:${key}` : undefined,
    );
  const count = (s: EventScript | undefined) => (s?.length ? ` (${s.length})` : "");
  const hitCount = (["1", "2", "3"] as const).reduce((n, g) => n + (data.on_player_hit?.[g]?.length ?? 0), 0);

  return (
    <>
      <div className="properties-header">Player</div>
      <div className="properties-body">
        <FieldRow label="Start position (tile)">
          <div className="xy-row">
            <NumberInput
              value={data.player_start?.x ?? 0}
              min={0}
              onChange={(x) => updateScene(id, (s) => ({ ...s, player_start: { x, y: s.player_start?.y ?? 0 } }), "start")}
            />
            <NumberInput
              value={data.player_start?.y ?? 0}
              min={0}
              onChange={(y) => updateScene(id, (s) => ({ ...s, player_start: { x: s.player_start?.x ?? 0, y } }), "start")}
            />
            <PickButton label="Player start" onPick={(x, y) => updateScene(id, (s) => ({ ...s, player_start: { x, y } }))} />
          </div>
        </FieldRow>

        <FieldRow label="Direction" hint="Which way the player faces when the game starts in this scene.">
          <DirectionPicker
            value={data.player_start_direction ?? "down"}
            onChange={(d) => updateScene(id, (s) => ({ ...s, player_start_direction: d }))}
          />
        </FieldRow>

        <FieldRow label="Sprite sheet">
          <PlayerSpriteSelect
            value={data.player_sprite}
            projectDefault={playerSprite}
            onChange={(v) => updateScene(id, (s) => ({ ...s, player_sprite: v }))}
          />
        </FieldRow>

        <div className="field-row-pair">
          <FieldRow label="Animation speed">
            <select value={player.anim_speed ?? 0} onChange={(e) => patchPlayer({ anim_speed: Number(e.target.value) || undefined })}>
              {ANIM_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "Sprite's own" : `${v} frames`}
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Collisions" hint={player.collisions === false ? "Walks through solid tiles and actors." : undefined}>
            <label className="script-field-bool">
              <input
                type="checkbox"
                checked={player.collisions !== false}
                onChange={(e) => patchPlayer({ collisions: e.target.checked ? undefined : false })}
              />
              {player.collisions === false ? "Off" : "On"}
            </label>
          </FieldRow>
        </div>
      </div>

      <Tabs
        tabs={[
          { id: "init", label: `On Init${count(player.on_init)}` },
          { id: "update", label: `On Update${count(player.on_update)}` },
          { id: "hit", label: `On Hit${hitCount ? ` (${hitCount})` : ""}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="properties-body properties-script">
        {tab === "hit" ? (
          <>
            <div className="seg seg-wide script-subtabs">
              {(["1", "2", "3"] as const).map((g) => (
                <button key={g} className={hitGroup === g ? "seg-on" : ""} onClick={() => setHitGroup(g)}>
                  Group {g}
                  {count(data.on_player_hit?.[g])}
                </button>
              ))}
            </div>
            <ScriptEditor
              key={hitGroup}
              value={data.on_player_hit?.[hitGroup]}
              onChange={onHit}
              env={hitEnv}
              emptyHint={`Runs when the player touches an actor in collision group ${hitGroup} (unless that actor has its own On Hit script). Same as the scene's On Player Hit.`}
            />
          </>
        ) : (
          <ScriptEditor
            key={tab}
            value={tab === "init" ? player.on_init : player.on_update}
            onChange={onScript}
            env={env}
            emptyHint={
              tab === "init"
                ? "Runs when the scene starts, before the actors' and the scene's own On Init."
                : "Runs over and over in the background while the scene is on screen (at most once a frame)."
            }
          />
        )}
      </div>
    </>
  );
}

const SCENE_TYPES: { id: SceneType; label: string; hint: string }[] = [
  {
    id: "topdown",
    label: "Top Down 2D",
    hint:
      "Walk in 4 or 8 directions, freely or tile by tile on a grid (turn-based with On step), talk to actors with A. " +
      "Engine settings add acceleration, running, dashing, pushing and knockback.",
  },
  { id: "platform", label: "Platformer", hint: "Side view with gravity: run, jump, ladders, one-way platforms, wall jumps, dashes." },
  { id: "adventure", label: "Adventure (old)", hint: "Now part of Top Down 2D: convert this scene below." },
  { id: "shmup", label: "Shoot Em' Up", hint: "The screen scrolls the way the player faces at the start. Fire with Launch Projectile on a button." },
  { id: "pointnclick", label: "Point and Click", hint: "The player is a cursor: move it over actors and triggers and press A." },
  { id: "logo", label: "Logo", hint: "No player: a still screen for logos and title cards, run by the scene's scripts." },
  {
    id: "raycast",
    label: "First Person 3D",
    hint:
      "A first person view of the map, like the old shooters: Up / Down walk, Left / Right turn, L / R strafe. Solid tiles are walls; " +
      "paint floor and ceiling heights (stairs, ledges, windows, doors, lifts), wall textures and colours with the 3D tool (H). " +
      "The background only sets the map's size here.",
  },
]

/** First Person 3D: the scene's colours, default ceiling and wall textures. */
function RaycastLookEditor({ scene }: { scene: SceneRecord }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const assets = useProjectStore((s) => s.assets);
  const setRcLayer = useProjectStore((s) => s.setRcLayer);
  const look = scene.data.raycast ?? {};
  const flats = look.flats ?? [];
  const used = sceneTextures(scene.data);
  const all = Array.from(new Set([...(assets?.textures ?? []).map((t) => t.name), "bricks"]));
  const set = (p: Partial<NonNullable<SceneJSON["raycast"]>>, key?: string) =>
    updateScene(scene.fileId, (s) => ({ ...s, raycast: { ...(s.raycast ?? {}), ...p } }), key ? `rc:${key}` : undefined);
  const hex = (c: string | undefined, d: string) => (c && /^#[0-9a-fA-F]{6}$/.test(c) ? c : d);

  /** Drop texture i: its walls take the first texture, later ones move up. */
  const removeTexture = (i: number) =>
    updateScene(scene.fileId, (s) => {
      const list = sceneTextures(s).filter((_, j) => j !== i);
      const rows = s.wall_textures?.map((r) =>
        r
          .split("")
          .map((ch) => {
            const k = ch === "." ? 0 : RC_TEX_CHARS.indexOf(ch.toLowerCase());
            if (k <= 0 || k === i) return ".";
            return k > i ? (k - 1 === 0 ? "." : RC_TEX_CHARS[k - 1]) : ch;
          })
          .join(""),
      );
      return { ...s, raycast: { ...(s.raycast ?? {}), textures: list }, wall_textures: rows };
    });
  /** Drop colour i: its tiles take the scene's own, later ones move down. */
  const removeFlat = (i: number) =>
    updateScene(scene.fileId, (s) => {
      const fix = (rows?: string[]) =>
        rows?.map((r) =>
          r
            .split("")
            .map((ch) => {
              const k = Number(ch);
              if (!(k >= 1 && k <= 5)) return ch;
              return k === i + 1 ? "." : k > i + 1 ? String(k - 1) : ch;
            })
            .join(""),
        );
      return {
        ...s,
        raycast: { ...(s.raycast ?? {}), flats: (s.raycast?.flats ?? []).filter((_, j) => j !== i) },
        floor_flats: fix(s.floor_flats),
        ceiling_flats: fix(s.ceiling_flats),
      };
    });

  const ground = look.floor_height ?? 0;
  const ceiling = look.ceiling_height ?? RC_DEFAULT_CEILING;
  const outdoors = ceiling >= RC_SKY;
  const skies = (assets?.backgrounds ?? []).map((a) => ({ ref: backgroundRefFor(a.relPath), label: a.fileName }));
  const sprites = (assets?.sprites ?? []).map((a) => a.name);

  return (
    <div className="rc-look">
      <FieldRow
        label="3D ground and ceiling"
        hint="Every tile you haven't painted a shape on. Heights are in eighths of a tile: 8 is one tile, one texture high."
      >
        <div className="rc-look-grid">
          <span>Ground</span>
          <NumberInput value={ground} min={0} max={254} onChange={(n) => set({ floor_height: n })} title="Floor height of unpainted tiles" />
          <span className="field-hint-inline">{ground ? "pits can go below it" : "pits need a ground above 0"}</span>
          <span>Ceiling</span>
          {outdoors ? (
            <span className="field-hint-inline">open sky</span>
          ) : (
            <NumberInput value={ceiling} min={1} max={254} onChange={(n) => set({ ceiling_height: n })} title="Ceiling height of unpainted tiles" />
          )}
          <label className="rc-look-check">
            <input
              type="checkbox"
              checked={outdoors}
              onChange={(e) => set({ ceiling_height: e.target.checked ? RC_SKY : ground + 16 })}
            />
            Outdoors (sky)
          </label>
          {!outdoors && (
            <>
              <span />
              <span className="field-hint-inline" style={{ gridColumn: "span 2" }}>
                {tilesText(ceiling - ground)} of room
              </span>
            </>
          )}
          <span>Wall height</span>
          <NumberInput
            value={look.wall_height ?? RC_DEFAULT_WALL}
            min={1}
            max={255}
            onChange={(n) => set({ wall_height: n })}
            title="Under open sky, solid tiles stand this tall above their floor (indoors they reach the ceiling)"
          />
          <span className="field-hint-inline">walls under the sky</span>
        </div>
      </FieldRow>
      <FieldRow label="3D colours" hint="Floors and ceilings with no colour painted, and the sky when there's no sky picture.">
        <div className="type-row">
          <label className="rc-look-swatch" title="Floor">
            <input type="color" value={hex(look.floor, "#3c3a36")} onChange={(e) => set({ floor: e.target.value }, "floor")} />
            Floor
          </label>
          <label className="rc-look-swatch" title="Ceiling">
            <input type="color" value={hex(look.ceiling, "#22242c")} onChange={(e) => set({ ceiling: e.target.value }, "ceiling")} />
            Ceiling
          </label>
          <label className="rc-look-swatch" title="Sky">
            <input type="color" value={hex(look.sky_color, "#6c94d0")} onChange={(e) => set({ sky_color: e.target.value }, "sky_color")} />
            Sky
          </label>
        </div>
      </FieldRow>
      <FieldRow
        label="Sky picture"
        hint="Shown wherever there's open sky (Outdoors, or the Open sky shape). A PNG from Backgrounds, up to 80 px tall (the 3D view is 120×80, doubled on screen); it repeats sideways and turns with the view - 160, 320 or 640 px wide fit a full turn exactly. Its colours share the 59 with the wall textures."
      >
        <select value={look.sky ?? ""} onChange={(e) => set({ sky: e.target.value || undefined })}>
          <option value="">None (the sky colour)</option>
          {look.sky && !skies.some((o) => o.ref === look.sky) && <option value={look.sky}>{look.sky} (missing)</option>}
          {skies.map((o) => (
            <option key={o.ref} value={o.ref}>
              {o.label}
            </option>
          ))}
        </select>
      </FieldRow>
      <FieldRow
        label="Weapon"
        hint="A sprite held at the bottom of the screen. Make it a First Person Weapon sprite: Idle, Walking, Fire and Alt Fire animations. The fire buttons are in this scene type's engine settings."
      >
        <div className="rc-look-grid">
          <span>Sprite</span>
          <select value={look.weapon ?? ""} onChange={(e) => set({ weapon: e.target.value || undefined })} style={{ gridColumn: "span 2" }}>
            <option value="">None</option>
            {look.weapon && !sprites.includes(look.weapon) && <option value={look.weapon}>{look.weapon} (missing)</option>}
            {sprites.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          {look.weapon && (
            <>
              <span>Offset</span>
              <div className="type-row" style={{ gridColumn: "span 2" }}>
                <NumberInput value={look.weapon_x ?? 0} min={-120} max={120} onChange={(n) => set({ weapon_x: n || undefined })} title="Right (px)" />
                <NumberInput value={look.weapon_y ?? 0} min={-120} max={120} onChange={(n) => set({ weapon_y: n || undefined })} title="Down (px)" />
                <span className="field-hint-inline">px from bottom centre</span>
              </div>
            </>
          )}
        </div>
      </FieldRow>
      <FieldRow label={`More colours (${flats.length}/${RC_MAX_FLATS})`} hint="Paint them on floors and ceilings with the 3D tool: lava, water, carpet, lights.">
        <div className="palette-swatch-list">
          {flats.map((c, i) => (
            <div key={i} className="palette-swatch-row">
              <span className="field-hint-inline">{i + 1}</span>
              <input
                type="color"
                value={hex(c, "#000000")}
                onChange={(e) => set({ flats: flats.map((f, j) => (j === i ? e.target.value : f)) }, `flat${i}`)}
              />
              <button className="icon-btn" title="Remove colour" onClick={() => removeFlat(i)}>
                ×
              </button>
            </div>
          ))}
          <button className="btn btn-small" disabled={flats.length >= RC_MAX_FLATS} onClick={() => set({ flats: [...flats, "#806040"] })}>
            + Add colour
          </button>
        </div>
      </FieldRow>
      <FieldRow label="Wall textures" hint="The textures this scene's walls use (32×32 PNGs in assets/textures). The first is on every wall you haven't painted.">
        <div className="palette-swatch-list">
          {used.map((t, i) => (
            <div key={`${t}${i}`} className="palette-swatch-row">
              <span>
                {i === 0 ? "★ " : ""}
                {t}
                {all.includes(t) ? "" : " (missing)"}
              </span>
              <button className="icon-btn" title="Remove: its walls take the first texture" disabled={used.length <= 1} onClick={() => removeTexture(i)}>
                ×
              </button>
            </div>
          ))}
          <div className="type-row">
            <button className="btn btn-small" onClick={() => setRcLayer("walltex")}>
              Paint textures
            </button>
            <button className="btn btn-small" onClick={() => setRcLayer("shape")}>
              Paint shapes
            </button>
          </div>
        </div>
      </FieldRow>
    </div>
  );
}

/** Adventure's settings -> the Top Down settings that do the same. */
const ADVENTURE_TO_TOPDOWN: [string, string][] = [
  ["ad_eight_way", "td_diagonal"],
  ["ad_face_horizontal", "td_face_horizontal"],
  ["ad_walk_vel", "td_speed"],
  ["ad_walk_acc", "td_acc"],
  ["ad_dec", "td_dec"],
  ["ad_run", "td_run"],
  ["ad_run_button", "td_run_button"],
  ["ad_run_vel", "td_run_speed"],
  ["ad_state_run", "td_state_run"],
  ["ad_dash", "td_dash"],
  ["ad_dash_input", "td_dash_input"],
  ["ad_dash_dist", "td_dash_dist"],
  ["ad_dash_frames", "td_dash_frames"],
  ["ad_dash_ready", "td_dash_ready"],
  ["ad_state_dash", "td_state_dash"],
  ["ad_on_dash", "td_on_dash"],
  ["ad_push", "td_push"],
  ["ad_push_delay", "td_push_delay"],
  ["ad_state_push", "td_state_push"],
  ["ad_knockback", "td_knockback"],
  ["ad_kb_vel", "td_kb_vel"],
  ["ad_kb_frames", "td_kb_frames"],
  ["ad_state_knockback", "td_state_knockback"],
  ["ad_on_knockback", "td_on_knockback"],
  ["ad_interact", "td_interact"],
];

/** Adventure is part of Top Down now: one click moves a scene over,
 * carrying its Adventure settings into this scene's Top Down ones. */
function AdventureConvert({ scene }: { scene: SceneRecord }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const projectEngine = useProjectStore((s) => s.project?.project.engine);
  const convert = () =>
    updateScene(scene.fileId, (s) => {
      const engine: Record<string, EngineValue> = {};
      for (const [k, v] of Object.entries(s.engine ?? {})) if (!k.startsWith("ad_")) engine[k] = v;
      for (const [from, to] of ADVENTURE_TO_TOPDOWN) {
        const v = settingValue(from, projectEngine, s.engine);
        if (v !== settingValue(to, projectEngine)) engine[to] = v;
      }
      engine.td_grid = 0;
      const next = { ...s, type: undefined, engine: Object.keys(engine).length ? engine : undefined };
      return next;
    });
  return (
    <div className="view-note">
      Adventure is now part of Top Down 2D, with the same momentum, running, dashing, pushing and knockback as options.
      This scene still runs as before.{" "}
      <button className="btn btn-small" onClick={convert}>
        Convert to Top Down
      </button>
    </div>
  );
}

/** A scene's own engine settings, over the project's (Settings > Engine). */
function SceneEngineOverrides({ scene }: { scene: SceneRecord }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const projectEngine = useProjectStore((s) => s.project?.project.engine);
  const mode = scene.data.type ?? "topdown";
  const values = scene.data.engine ?? {};
  const set = (key: string, value: EngineValue | undefined) =>
    updateScene(
      scene.fileId,
      (s) => {
        const next = { ...(s.engine ?? {}) };
        if (value === undefined) delete next[key];
        else next[key] = value;
        return { ...s, engine: Object.keys(next).length ? next : undefined };
      },
      `engine:${key}`,
    );
  return (
    <div className="scene-engine">
      <p className="properties-note">
        {modeLabel(mode)} settings for this scene only. Changed ones win over Settings &gt; Engine; Reset goes back to the project's.
      </p>
      <EngineFields defs={settingsForMode(mode)} values={values} base={projectEngine} onChange={set} />
    </div>
  );
}

/** Parallax speeds, as GB Studio lists them. 0 scrolls with the camera. */
const PARALLAX_SPEEDS: { value: number | "fixed"; label: string }[] = [
  { value: "fixed", label: "Fixed" },
  { value: 0, label: "Speed 1" },
  { value: 1, label: "Speed ½" },
  { value: 2, label: "Speed ¼" },
  { value: 3, label: "Speed ⅛" },
  { value: 4, label: "Speed 1/16" },
  { value: 5, label: "Speed 1/32" },
  { value: 6, label: "Speed 1/64" },
  { value: 7, label: "Speed 1/128" },
  { value: 8, label: "Speed 1/256" },
];

function ParallaxEditor({ scene }: { scene: SceneRecord }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const layers = scene.data.parallax ?? [];
  const set = (next: ParallaxLayerJSON[] | undefined, key?: string) =>
    updateScene(scene.fileId, (s) => ({ ...s, parallax: next }), key);

  const setCount = (n: number) => {
    if (n === 0) return set(undefined);
    const defaults: ParallaxLayerJSON[] = [
      { rows: 4, speed: 2 },
      { rows: 4, speed: 1 },
      { speed: 0 },
    ];
    const next = Array.from({ length: n }, (_, i) => {
      if (i === n - 1) return { speed: layers[i]?.speed ?? 0 };
      return layers[i]?.rows ? layers[i] : defaults[i];
    });
    set(next);
  };

  let used = 0;
  return (
    <FieldRow
      label="Parallax strips (GB Studio style)"
      hint={layers.length ? "Horizontal strips of the screen, top to bottom, each scrolling the map at its own speed. The last strip fills the rest of the screen." : undefined}
    >
      <select value={layers.length} onChange={(e) => setCount(Number(e.target.value))}>
        <option value={0}>None</option>
        <option value={1}>1 Layer</option>
        <option value={2}>2 Layers</option>
        <option value={3}>3 Layers</option>
      </select>
      {layers.map((layer, i) => {
        const last = i === layers.length - 1;
        const top = used;
        if (!last) used += layer.rows ?? 1;
        return (
          <div key={i} className="parallax-row">
            <span className="parallax-index">{i + 1}</span>
            {last ? (
              <span className="parallax-rest" title="Rows to the bottom of the screen">
                H {Math.max(0, 20 - top)}
              </span>
            ) : (
              <NumberInput
                value={layer.rows ?? 1}
                min={1}
                max={19}
                ariaLabel={`Layer ${i + 1} height in tiles`}
                onChange={(rows) => set(layers.map((l, j) => (j === i ? { ...l, rows } : l)), `plx${i}`)}
              />
            )}
            <select
              value={String(layer.speed)}
              onChange={(e) => {
                const v = e.target.value === "fixed" ? "fixed" : Number(e.target.value);
                set(layers.map((l, j) => (j === i ? { ...l, speed: v } : l)));
              }}
            >
              {PARALLAX_SPEEDS.map((sp) => (
                <option key={String(sp.value)} value={String(sp.value)}>
                  {sp.label}
                </option>
              ))}
            </select>
          </div>
        );
      })}
    </FieldRow>
  );
}

/** Layer scroll speeds (a multiple of the camera's). */
const LAYER_SPEEDS = [0, 0.125, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];

function speedLabel(v: number) {
  if (v === 0) return "Fixed";
  if (v === 1) return "With the map";
  const frac: Record<number, string> = { 0.125: "⅛", 0.25: "¼", 0.5: "½", 0.75: "¾", 1.25: "1¼", 1.5: "1½", 2: "2" };
  return `${frac[v] ?? v}× speed`;
}

/** GBA background layers (BG2/BG3): full images behind or over the map. */
function LayersEditor({ scene }: { scene: SceneRecord }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const assets = useProjectStore((s) => s.assets);
  const layers = scene.data.layers ?? [];
  const set = (next: BgLayerJSON[], key?: string) =>
    updateScene(scene.fileId, (s) => ({ ...s, layers: next.length ? next : undefined }), key);
  const patch = (i: number, p: Partial<BgLayerJSON>, key?: string) =>
    set(
      layers.map((l, j) => (j === i ? { ...l, ...p } : l)),
      key ? `layer${i}:${key}` : undefined,
    );
  const firstOther = (assets?.backgrounds ?? []).map((a) => backgroundRefFor(a.relPath)).find((r) => r !== scene.data.background);

  return (
    <FieldRow
      label={`Background layers (${layers.length}/2)`}
      hint="Full images scrolling behind (or over) the map at their own speed - the GBA's own parallax. Up to 512×256 or 256×512 px; they repeat. They line up with the map as shown here when the camera is at the player's start, and parallax moves them from there. The map's transparent pixels show the layers behind it. Layer 1 is drawn over layer 2."
    >
      {layers.map((layer, i) => (
        <div key={i} className="layer-card">
          <div className="layer-card-head">
            <span className="parallax-index">{i + 1}</span>
            <div className="seg">
              {(
                [
                  [undefined, "Behind map", "Behind the map: shows through its transparent pixels"],
                  [true, "Over map", "Over the map, under the player and actors"],
                  ["actors", "Over all", "Over the map, the player and actors (fog, foreground leaves)"],
                ] as const
              ).map(([value, label, title]) => (
                <button
                  key={label}
                  title={title}
                  className={(layer.front ?? undefined) === value || (!layer.front && value === undefined) ? "seg-on" : ""}
                  onClick={(e) => {
                    e.preventDefault();
                    patch(i, { front: value });
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              className="link-btn link-btn-danger"
              onClick={(e) => {
                e.preventDefault();
                set(layers.filter((_, j) => j !== i));
              }}
            >
              Remove
            </button>
          </div>
          <BackgroundSelect value={layer.image} onChange={(image) => patch(i, { image })} />
          <div className="layer-grid">
            <span>Speed X</span>
            <select value={layer.speed_x ?? 0.5} onChange={(e) => patch(i, { speed_x: Number(e.target.value) })}>
              {LAYER_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {speedLabel(v)}
                </option>
              ))}
            </select>
            <span>Speed Y</span>
            <select value={layer.speed_y ?? 0.5} onChange={(e) => patch(i, { speed_y: Number(e.target.value) })}>
              {LAYER_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {speedLabel(v)}
                </option>
              ))}
            </select>
            <span title="Pixels per frame it moves on its own, e.g. drifting clouds">Drift X</span>
            <DriftInput value={layer.auto_x ?? 0} onChange={(auto_x) => patch(i, { auto_x: auto_x || undefined }, "ax")} />
            <span title="Pixels per frame it moves on its own">Drift Y</span>
            <DriftInput value={layer.auto_y ?? 0} onChange={(auto_y) => patch(i, { auto_y: auto_y || undefined }, "ay")} />
          </div>
        </div>
      ))}
      {layers.length < 2 && (
        <button
          className="btn btn-small"
          onClick={(e) => {
            e.preventDefault();
            set([...layers, { image: firstOther ?? "", speed_x: 0.5, speed_y: 0.5 }]);
          }}
        >
          + Add layer
        </button>
      )}
    </FieldRow>
  );
}

const TILE_ANIM_SPEEDS = [2, 4, 6, 8, 10, 12, 16, 20, 30, 45, 60];

/** Animated tiles: map areas whose tiles cycle through frames from an image. */
function TileAnimationsEditor({ scene }: { scene: SceneRecord }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const anims = scene.data.tile_animations ?? [];
  const set = (next: TileAnimationJSON[], key?: string) =>
    updateScene(scene.fileId, (s) => ({ ...s, tile_animations: next.length ? next : undefined }), key);
  const patch = (i: number, p: Partial<TileAnimationJSON>, key?: string) =>
    set(
      anims.map((a, j) => (j === i ? { ...a, ...p } : a)),
      key ? `anim${i}:${key}` : undefined,
    );
  return (
    <FieldRow
      label={`Animated tiles (${anims.length})`}
      hint="Make tiles cycle through frames, like water or flowers. Pick the top-left tile of the area on the map, its size, and an image with the frames side by side (each frame the size of the area). Every copy of those tiles anywhere on the map animates. Frames can only use the colours those tiles already use."
    >
      {anims.map((a, i) => (
        <div key={i} className="layer-card">
          <div className="layer-card-head">
            <span className="parallax-index">{i + 1}</span>
            <span>
              Tile {a.x}, {a.y}
            </span>
            <PickButton label="animated tiles" onPick={(x, y) => patch(i, { x, y })} />
            <button
              className="link-btn link-btn-danger"
              onClick={(e) => {
                e.preventDefault();
                set(anims.filter((_, j) => j !== i));
              }}
            >
              Remove
            </button>
          </div>
          <BackgroundSelect value={a.image} onChange={(image) => patch(i, { image })} />
          <div className="layer-grid">
            <span>Width (tiles)</span>
            <NumberInput value={a.width ?? 1} min={1} max={8} onChange={(width) => patch(i, { width }, "w")} />
            <span>Height (tiles)</span>
            <NumberInput value={a.height ?? 1} min={1} max={8} onChange={(height) => patch(i, { height }, "h")} />
            <span title="How many frames (1/60 s) each animation frame is shown">Speed</span>
            <select value={a.speed ?? 8} onChange={(e) => patch(i, { speed: Number(e.target.value) })}>
              {TILE_ANIM_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v} frames
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
      <button
        className="btn btn-small"
        onClick={(e) => {
          e.preventDefault();
          set([...anims, { x: 0, y: 0, width: 1, height: 1, image: "", speed: 8 }]);
        }}
      >
        + Add animated tiles
      </button>
    </FieldRow>
  );
}

/** Drift in px/frame, typed as a decimal (-8..8). */
function DriftInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <CommitInput
      value={String(value)}
      onCommit={(v) => {
        const n = Number(v.trim() || 0);
        if (!Number.isFinite(n) || n < -8 || n > 8) return "A number from -8 to 8 (pixels per frame).";
        onChange(Math.round(n * 256) / 256);
      }}
    />
  );
}

function PlayerSpriteSelect({
  value,
  projectDefault,
  onChange,
}: {
  value: string | undefined;
  projectDefault: string;
  onChange: (v: string | undefined) => void;
}) {
  const assets = useProjectStore((s) => s.assets);
  const names = ["player", ...(assets?.sprites ?? []).map((a) => a.name).filter((n) => n !== "player")];
  const known = !value || names.includes(value);
  return (
    <select
      className={!known ? "select-invalid" : undefined}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">Project default ({projectDefault})</option>
      {!known && <option value={value}>{value} (missing)</option>}
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

/** Four arrow buttons, GB Studio style. */
function DirectionPicker({ value, onChange }: { value: Direction; onChange: (d: Direction) => void }) {
  const dirs: { d: Direction; icon: "arrowLeft" | "arrowUp" | "arrowDown" | "arrowRight" }[] = [
    { d: "left", icon: "arrowLeft" },
    { d: "up", icon: "arrowUp" },
    { d: "down", icon: "arrowDown" },
    { d: "right", icon: "arrowRight" },
  ];
  return (
    <div className="seg seg-wide" role="radiogroup">
      {dirs.map(({ d, icon }) => (
        <button
          key={d}
          role="radio"
          aria-checked={value === d}
          title={d}
          className={value === d ? "seg-on" : ""}
          onClick={(e) => {
            e.preventDefault();
            onChange(d);
          }}
        >
          <Icon name={icon} />
        </button>
      ))}
    </div>
  );
}

function TimersEditor({ scene, scenes }: { scene: SceneRecord; scenes: SceneRecord[] }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const renameInScene = useProjectStore((s) => s.renameInScene);
  const deleteIndexed = useProjectStore((s) => s.deleteIndexed);
  const timers = scene.data.timers ?? [];
  const id = scene.fileId;
  const [open, setOpen] = useState<number | null>(timers.length ? 0 : null);

  const patchTimer = (i: number, patch: Partial<TimerJSON>, key?: string) =>
    updateScene(
      id,
      (s) => {
        const t = (s.timers ?? []).slice();
        t[i] = { ...t[i], ...patch };
        return { ...s, timers: t };
      },
      key,
    );

  return (
    <div className="timers">
      <p className="properties-note">
        A timer runs its script in the background, a set number of frames after a <b>Start Timer</b> event starts it. (60
        frames = 1 second. If a script or dialogue is already running at that moment, that firing is skipped.)
      </p>
      {timers.map((t, i) => (
        <div key={i} className="timer-card">
          <div className="timer-head">
            <button className="event-caret" onClick={() => setOpen(open === i ? null : i)}>
              <Chevron open={open === i} />
            </button>
            <CommitInput
              className="timer-name"
              value={t.name ?? ""}
              placeholder={`Timer #${i} (unnamed)`}
              onCommit={(v) => {
                const n = v.trim();
                if (n && timers.some((o, j) => j !== i && o.name === n)) return `Another timer is called "${n}".`;
                renameInScene(id, "timer", t.name ?? "", n, i, (s) => {
                  const list = (s.timers ?? []).slice();
                  list[i] = { ...list[i], name: n || undefined };
                  return { ...s, timers: list };
                });
              }}
            />
            <NumberInput
              className="timer-frames"
              value={t.frames}
              min={1}
              max={32767}
              title="Frames (60 = 1 second)"
              onChange={(frames) => patchTimer(i, { frames }, `timer${i}:frames`)}
            />
            <span className="timer-secs">{(t.frames / 60).toFixed(1)}s</span>
            <button
              className="icon-btn"
              title="Delete timer"
              onClick={() => {
                const refs = t.name ? countRefs([scene.data], "timer", t.name) : 0;
                const msg = refs
                  ? `Delete timer "${t.name}"? ${refs} Start Timer event(s) still point at it.`
                  : "Delete this timer and its script?";
                if (!window.confirm(msg)) return;
                deleteIndexed(id, "timer", i);
                setOpen(null);
              }}
            >
              ×
            </button>
          </div>
          {open === i && (
            <TimerScript scene={scene} scenes={scenes} index={i} />
          )}
        </div>
      ))}
      <button
        className="btn btn-small"
        disabled={timers.length >= MAX_TIMERS}
        onClick={() => {
          updateScene(id, (s) => {
            const taken = new Set((s.timers ?? []).map((t) => t.name));
            let n = 1;
            while (taken.has(`timer${n}`)) n += 1;
            return { ...s, timers: [...(s.timers ?? []), { name: `timer${n}`, frames: 60, script: [] }] };
          });
          setOpen(timers.length);
        }}
      >
        + Add timer {timers.length >= MAX_TIMERS ? "(max 8 per scene)" : ""}
      </button>
    </div>
  );
}

function TimerScript({ scene, scenes, index }: { scene: SceneRecord; scenes: SceneRecord[]; index: number }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const env = useEnv(`${scene.fileId}:timer:${index}`, scene, scenes, false);
  const onChange: ScriptUpdater = (fn, key) =>
    updateScene(
      scene.fileId,
      (s) => {
        const t = (s.timers ?? []).slice();
        if (!t[index]) return s;
        const next = withScript(t[index], "script", fn);
        if (next === t[index]) return s;
        t[index] = next;
        return { ...s, timers: t };
      },
      key ? `timer${index}:${key}` : undefined,
    );
  return (
    <div className="timer-script">
      <ScriptEditor value={scene.data.timers?.[index]?.script} onChange={onChange} env={env} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Door
// ---------------------------------------------------------------------------

function warpToScript(door: DoorJSON): EventScript {
  return [
    { type: "play_sound", sound: "door" },
    { type: "switch_scene", scene: door.target_scene ?? "", x: door.target_x ?? 0, y: door.target_y ?? 0 },
  ];
}

/** If a custom script is exactly what the warp shorthand compiles to,
 * it can go back to the shorthand without losing anything. */
function scriptAsWarp(events: EventScript | undefined): Pick<DoorJSON, "target_scene" | "target_x" | "target_y"> | null {
  if (!events || events.length !== 2) return null;
  const [a, b] = events as ScriptEventJSON[];
  if (a.type !== "play_sound" || a.sound !== "door" || b.type !== "switch_scene") return null;
  return { target_scene: b.scene, target_x: b.x ?? 0, target_y: b.y ?? 0 };
}

function DoorProps({ scene, scenes, index }: { scene: SceneRecord; scenes: SceneRecord[]; index: number }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const id = scene.fileId;
  const [tab, setTab] = useState<"enter" | "leave">("enter");
  const env = useEnv(`${id}:door:${index}`, scene, scenes, false);
  const leaveEnv = useEnv(`${id}:door:${index}:leave`, scene, scenes, false);
  const door = scene.data.doors?.[index];
  if (!door) return <div className="properties-panel-empty">Door not found.</div>;

  const setDoor = (fn: (d: DoorJSON) => DoorJSON, key?: string) =>
    updateScene(
      id,
      (s) => {
        const doors = (s.doors ?? []).slice();
        if (!doors[index]) return s;
        const next = fn(doors[index]);
        if (next === doors[index]) return s;
        doors[index] = next;
        return { ...s, doors };
      },
      key ? `door${index}:${key}` : undefined,
    );
  const patchDoor = (patch: Partial<DoorJSON>, key?: string) => setDoor((d) => ({ ...d, ...patch }), key);

  const isWarp = door.events === undefined;
  const names = scenes.map(sceneName);

  const toScript = () =>
    setDoor((d) => {
      const { target_scene: _a, target_x: _b, target_y: _c, ...rest } = d;
      void _a;
      void _b;
      void _c;
      return { ...rest, events: warpToScript(d) };
    });

  const toWarp = () => {
    const warp = scriptAsWarp(door.events);
    const n = door.events?.length ?? 0;
    if (!warp && n > 0 && !window.confirm(`Switch to a simple warp? This door's ${n}-event script will be removed.`)) return;
    setDoor((d) => {
      const { events: _e, ...rest } = d;
      void _e;
      return { ...rest, ...(warp ?? { target_scene: names.find((x) => x !== sceneName(scene)) ?? names[0], target_x: 0, target_y: 0 }) };
    });
  };

  const onLeave: ScriptUpdater = (fn, key) => setDoor((d) => withScript(d, "on_leave", fn), key ? `leave:${key}` : undefined);

  // A warp door has no script; never let a late script edit add one.
  const onScript: ScriptUpdater = (fn, key) =>
    setDoor((d) => (d.events === undefined ? d : withScript(d, "events", fn)), key ? `events:${key}` : undefined);

  return (
    <>
      <div className="properties-header properties-header-row">
        <span>Door / Trigger</span>
        <button className="link-btn link-btn-danger" onClick={deleteSelected}>
          Delete
        </button>
      </div>
      <div className="properties-body">
        <FieldRow label="Position (tile)">
          <div className="field-row-pair">
            <NumberInput value={door.x} min={0} onChange={(x) => patchDoor({ x }, "x")} />
            <NumberInput value={door.y} min={0} onChange={(y) => patchDoor({ y }, "y")} />
          </div>
        </FieldRow>
        <FieldRow label="Size (tiles)" hint={(door.height ?? 1) < 2 ? "Tip: the player triggers doors with its center, so 1-tile-tall doors can be unreachable. Use height 2." : undefined}>
          <div className="field-row-pair">
            <NumberInput value={door.width ?? 1} min={1} max={255} onChange={(width) => patchDoor({ width }, "w")} />
            <NumberInput value={door.height ?? 1} min={1} max={255} onChange={(height) => patchDoor({ height }, "h")} />
          </div>
        </FieldRow>

        <FieldRow label="When the player steps on it">
          <div className="seg seg-wide">
            <button className={isWarp ? "seg-on" : ""} onClick={() => !isWarp && toWarp()}>
              Warp to scene
            </button>
            <button className={!isWarp ? "seg-on" : ""} onClick={() => isWarp && toScript()}>
              Run script
            </button>
          </div>
        </FieldRow>

        {isWarp && (
          <>
            <FieldRow label="Target scene">
              <select
                className={!names.includes(door.target_scene ?? "") ? "select-invalid" : undefined}
                value={door.target_scene ?? ""}
                onChange={(e) => patchDoor({ target_scene: e.target.value })}
              >
                {!names.includes(door.target_scene ?? "") && <option value={door.target_scene ?? ""}>{door.target_scene || "Choose…"} (missing)</option>}
                {names.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </FieldRow>
            <FieldRow label="Arrive at tile">
              <div className="field-row-pair">
                <NumberInput value={door.target_x ?? 0} min={0} onChange={(v) => patchDoor({ target_x: v }, "tx")} />
                <NumberInput value={door.target_y ?? 0} min={0} onChange={(v) => patchDoor({ target_y: v }, "ty")} />
              </div>
            </FieldRow>
          </>
        )}
      </div>
      <Tabs
        tabs={[
          { id: "enter", label: "On Enter" },
          { id: "leave", label: `On Leave${door.on_leave?.length ? ` (${door.on_leave.length})` : ""}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="properties-body properties-script">
        {tab === "enter" &&
          (isWarp ? (
            <p className="properties-note">Warps to {door.target_scene || "(no scene)"}. Switch to “Run script” above for anything else.</p>
          ) : (
            <ScriptEditor
              value={door.events}
              onChange={onScript}
              env={env}
              emptyHint="Runs when the player walks onto this trigger - e.g. check for a key, then Change Scene."
            />
          ))}
        {tab === "leave" && (
          <ScriptEditor
            value={door.on_leave}
            onChange={onLeave}
            env={leaveEnv}
            emptyHint="Runs when the player steps back off this trigger."
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// NPC
// ---------------------------------------------------------------------------

const MOVE_SPEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const ANIM_SPEEDS = [0, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32];

type ActorTab = "interact" | "init" | "update" | "hit";

function NpcProps({ scene, scenes, index }: { scene: SceneRecord; scenes: SceneRecord[]; index: number }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const renameInScene = useProjectStore((s) => s.renameInScene);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const [tab, setTab] = useState<ActorTab>("interact");
  const id = scene.fileId;
  const env = useEnv(`${id}:npc:${index}:${tab}`, scene, scenes, true);
  const npc = scene.data.npcs?.[index];
  if (!npc) return <div className="properties-panel-empty">NPC not found.</div>;

  const setNpc = (fn: (n: NpcJSON) => NpcJSON, key?: string) =>
    updateScene(
      id,
      (s: SceneJSON) => {
        const npcs = (s.npcs ?? []).slice();
        if (!npcs[index]) return s;
        const next = fn(npcs[index]);
        if (next === npcs[index]) return s;
        npcs[index] = next;
        return { ...s, npcs };
      },
      key ? `npc${index}:${key}` : undefined,
    );
  const patchNpc = (patch: Partial<NpcJSON>, key?: string) => setNpc((n) => ({ ...n, ...patch }), key);

  const hasScript = npc.on_interact !== undefined;

  const toScript = () =>
    setNpc((n) => {
      const { dialogue, ...rest } = n;
      return { ...rest, on_interact: dialogue ? [{ type: "text", text: dialogue }] : [] };
    });

  const toDialogue = () => {
    const ev = npc.on_interact ?? [];
    const simple = ev.length === 0 || (ev.length === 1 && ev[0].type === "text");
    if (!simple && !window.confirm(`Switch to plain dialogue? This NPC's ${ev.length}-event script will be removed.`)) return;
    setNpc((n) => {
      const { on_interact, ...rest } = n;
      const first = on_interact?.[0];
      return { ...rest, dialogue: first && first.type === "text" && on_interact?.length === 1 ? first.text : "" };
    });
  };

  // A plain-dialogue NPC has no script; never let a late script edit add one.
  const onInteract: ScriptUpdater = (fn, key) =>
    setNpc((n) => (n.on_interact === undefined ? n : withScript(n, "on_interact", fn)), key ? `script:${key}` : undefined);
  const scriptKey = { init: "on_init", update: "on_update", hit: "on_hit" } as const;
  const onOther: ScriptUpdater = (fn, key) => {
    if (tab === "interact") return;
    const k = scriptKey[tab];
    setNpc((n) => withScript(n, k, fn), key ? `${k}:${key}` : undefined);
  };

  const count = (s: EventScript | undefined) => (s?.length ? ` (${s.length})` : "");
  const group = npc.collision_group ?? 0;

  return (
    <>
      <div className="properties-header properties-header-row">
        <span>{npc.name || `NPC #${index}`}</span>
        <button className="link-btn link-btn-danger" onClick={deleteSelected}>
          Delete
        </button>
      </div>
      <div className="properties-body">
        <FieldRow label="Name" hint="Optional - lets events target this actor by name">
          <CommitInput
            value={npc.name ?? ""}
            placeholder="(unnamed)"
            onCommit={(v) => {
              const n = v.trim();
              if (n === "self") return `"self" is reserved.`;
              if (n && (scene.data.npcs ?? []).some((o, j) => j !== index && o.name === n)) return `Another NPC here is called "${n}".`;
              renameInScene(id, "actor", npc.name ?? "", n, index, (s) => {
                const list = (s.npcs ?? []).slice();
                list[index] = { ...list[index], name: n || undefined };
                return { ...s, npcs: list };
              });
            }}
          />
        </FieldRow>

        <FieldRow
          label={npc.pinned ? "Position (screen tile)" : "Position (tile)"}
          hint={npc.pinned ? "Pinned: stays at this spot on the screen whatever the camera does (for HUDs). Pinned actors don't collide and can't be talked to." : undefined}
        >
          <div className="xy-row xy-row-pin">
            <NumberInput value={npc.x} min={0} onChange={(x) => patchNpc({ x }, "x")} />
            <NumberInput value={npc.y} min={0} onChange={(y) => patchNpc({ y }, "y")} />
            <button
              className={`btn btn-small pin-btn${npc.pinned ? " pin-btn-on" : ""}`}
              title={npc.pinned ? "Unpin from the screen" : "Pin to the screen"}
              aria-pressed={!!npc.pinned}
              onClick={(e) => {
                e.preventDefault();
                patchNpc({ pinned: npc.pinned ? undefined : true });
              }}
            >
              <Icon name="pin" />
            </button>
            {!npc.pinned && <PickButton label="NPC position" onPick={(x, y) => patchNpc({ x, y })} />}
          </div>
        </FieldRow>

        <FieldRow label="Direction">
          <DirectionPicker value={npc.direction ?? "down"} onChange={(direction) => patchNpc({ direction })} />
        </FieldRow>

        <FieldRow label="Sprite sheet">
          <SpriteSelect value={npc.sprite} onChange={(sprite) => patchNpc({ sprite })} />
        </FieldRow>

        <div className="field-row-pair">
          <FieldRow label="Movement speed">
            <select value={npc.move_speed ?? 1} onChange={(e) => patchNpc({ move_speed: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}>
              {MOVE_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v} px/frame
                </option>
              ))}
            </select>
          </FieldRow>
          <FieldRow label="Animation speed">
            <select value={npc.anim_speed ?? 0} onChange={(e) => patchNpc({ anim_speed: Number(e.target.value) || undefined })}>
              {ANIM_SPEEDS.map((v) => (
                <option key={v} value={v}>
                  {v === 0 ? "Sprite's own" : `${v} frames`}
                </option>
              ))}
            </select>
          </FieldRow>
        </div>

        <FieldRow label="Movement">
          <select value={npc.movement ?? "static"} onChange={(e) => patchNpc({ movement: e.target.value as NpcMovement })}>
            {MOVEMENTS.map((m) => (
              <option key={m} value={m}>
                {m === "static" ? "Stands still" : "Wanders around"}
              </option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Draw above player" hint="The player is normally drawn on top of every actor. Turn this on to draw this actor over the player instead.">
          <label className="script-field-bool">
            <input type="checkbox" checked={!!npc.above_player} onChange={(e) => patchNpc({ above_player: e.target.checked || undefined })} />
            {npc.above_player ? "On" : "Off"}
          </label>
        </FieldRow>

        <FieldRow
          label="Lock facing direction"
          hint="Keeps facing the same way while it moves (walking backwards, strafing). Set Actor Direction still turns it; Lock Actor Direction switches this on or off."
        >
          <label className="script-field-bool">
            <input type="checkbox" checked={!!npc.lock_direction} onChange={(e) => patchNpc({ lock_direction: e.target.checked || undefined })} />
            {npc.lock_direction ? "On" : "Off"}
          </label>
        </FieldRow>

        <FieldRow
          label="Pushes the player"
          hint="When this actor moves into the player, it shoves the player along (walls stop it). Off: it walks over the player, who can step out of the way. To let the player walk through it, turn its collisions off with Set Actor Collisions."
        >
          <label className="script-field-bool">
            <input type="checkbox" checked={!!npc.push_player} onChange={(e) => patchNpc({ push_player: e.target.checked || undefined })} />
            {npc.push_player ? "On" : "Off"}
          </label>
        </FieldRow>

        {scene.data.type === "platform" && (
          <FieldRow label="Gravity" hint={GRAVITY_HINT}>
            <label className="script-field-bool">
              <input type="checkbox" checked={!!npc.gravity} onChange={(e) => patchNpc({ gravity: e.target.checked || undefined })} />
              {npc.gravity ? "Falls" : "Off"}
            </label>
          </FieldRow>
        )}

        {scene.data.type === "platform" && (
          <FieldRow label="Platform" hint="The player can stand on it (it only blocks from above) and rides along when it moves.">
            <label className="script-field-bool">
              <input type="checkbox" checked={!!npc.platform} onChange={(e) => patchNpc({ platform: e.target.checked || undefined })} />
              {npc.platform ? "Stand on it" : "Off"}
            </label>
          </FieldRow>
        )}

        <FieldRow
          label="Collision group"
          hint={group ? `Touching the player runs this actor's On Hit script, or else the scene's On Player Hit for group ${group}.` : undefined}
        >
          <div className="seg seg-wide">
            {[0, 1, 2, 3].map((g) => (
              <button
                key={g}
                className={group === g ? "seg-on" : ""}
                onClick={(e) => {
                  e.preventDefault();
                  patchNpc({ collision_group: g || undefined });
                }}
              >
                {g === 0 ? "None" : g}
              </button>
            ))}
          </div>
        </FieldRow>
      </div>

      <Tabs
        tabs={[
          { id: "interact", label: `On Interact${count(npc.on_interact)}` },
          { id: "init", label: `On Init${count(npc.on_init)}` },
          { id: "update", label: `On Update${count(npc.on_update)}` },
          { id: "hit", label: `On Hit${count(npc.on_hit)}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="properties-body properties-script">
        {tab === "interact" && (
          <>
            <div className="seg seg-wide script-subtabs">
              <button className={!hasScript ? "seg-on" : ""} onClick={() => hasScript && toDialogue()}>
                Say text
              </button>
              <button className={hasScript ? "seg-on" : ""} onClick={() => !hasScript && toScript()}>
                Run script
              </button>
            </div>
            {hasScript ? (
              <ScriptEditor
                value={npc.on_interact}
                onChange={onInteract}
                env={env}
                emptyHint="Runs when the player talks to this actor. Events can target it as “Self”."
              />
            ) : (
              <FieldRow label="Dialogue" hint="New line = new page. {varname} shows a variable.">
                <textarea
                  rows={3}
                  value={npc.dialogue ?? ""}
                  onChange={(e) => patchNpc({ dialogue: e.target.value || undefined }, "dialogue")}
                />
              </FieldRow>
            )}
          </>
        )}
        {tab !== "interact" && (
          <ScriptEditor
            key={tab}
            value={npc[scriptKey[tab]]}
            onChange={onOther}
            env={env}
            emptyHint={
              tab === "init"
                ? "Runs as this actor when the scene starts, before the scene's own On Init."
                : tab === "update"
                  ? "Runs over and over in the background while the scene is on screen (at most once a frame) - e.g. patrol back and forth."
                  : "Runs when the player touches this actor. Needs a collision group (above)."
            }
          />
        )}
      </div>
    </>
  );
}

/** A custom/reusable script isn't scoped to any scene, so it gets its own
 * ScriptEnv with an empty stand-in scene (no NPCs/timers to reference by
 * index, no "self"). Editing it reuses the exact same ScriptEditor as
 * every other script list. Other scripts call it with the "Call Script"
 * event, which the compiler inline-expands at compile time. */
function CustomScriptProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const updateCustomScript = useProjectStore((s) => s.updateCustomScript);
  const renameCustomScript = useProjectStore((s) => s.renameCustomScript);
  const removeCustomScript = useProjectStore((s) => s.removeCustomScript);
  const setSelection = useProjectStore((s) => s.setSelection);
  const entry = (project.project.customScripts ?? []).find((s) => s.id === id);

  const env: ScriptEnv = useMemo(
    () => ({
      rootId: `customScript:${id}`,
      sceneId: "__customScript__",
      scene: { background: "" },
      scenes: project.scenes,
      allowSelf: false,
      params: entry?.params,
    }),
    [id, project.scenes, entry?.params],
  );

  if (!entry) {
    return (
      <div className="properties-panel-empty">
        <p>This script was deleted.</p>
      </div>
    );
  }

  const onScript: ScriptUpdater = (fn, key) => updateCustomScript(id, fn, key);

  return (
    <>
      <div className="properties-header properties-header-row">
        <span>Custom Script</span>
        <button
          className="link-btn link-btn-danger"
          onClick={() => {
            if (window.confirm(`Delete script "${entry.name}"? This can't be undone.`)) {
              removeCustomScript(id);
              setSelection({ kind: "none" });
            }
          }}
        >
          Delete
        </button>
      </div>
      <div className="properties-body">
        <FieldRow label="Name">
          <CommitInput
            value={entry.name}
            onCommit={(v) => {
              if (!v.trim()) return "Name can't be empty.";
              renameCustomScript(id, v.trim());
            }}
          />
        </FieldRow>
        <p className="view-note">
          Call this from any script with the "Call Script" event (in the Scripts category). It's inlined at compile
          time, so editing it here updates every place that calls it - but a script that calls itself, directly or
          through another script, is a compile error.
        </p>
      </div>
      <div className="panel-section-title">Inputs</div>
      <div className="properties-body">
        <ScriptParamsEditor id={id} params={entry.params ?? []} />
      </div>
      <div className="panel-section-title">Used in</div>
      <div className="properties-body">
        <UsedInList kind="customScript" name={id} />
      </div>
      <div className="panel-section-title">Events</div>
      <div className="properties-body properties-script">
        <ScriptEditor
          value={entry.script}
          onChange={onScript}
          env={env}
          emptyHint="Build a reusable sequence of events here."
        />
      </div>
    </>
  );
}

const PARAM_KINDS: { kind: ScriptParam["kind"]; label: string }[] = [
  { kind: "actor", label: "Actor" },
  { kind: "variable", label: "Variable" },
  { kind: "number", label: "Number" },
];

/** A custom script's inputs: each is picked as "@name" inside the script
 * (actor and variable lists), and filled in by every Call Script. */
function ScriptParamsEditor({ id, params }: { id: string; params: ScriptParam[] }) {
  const setParams = useProjectStore((s) => s.setCustomScriptParams);
  const add = () => {
    let n = params.length + 1;
    while (params.some((p) => p.name === `input${n}`)) n += 1;
    setParams(id, [...params, { name: `input${n}`, kind: "actor" }]);
  };
  return (
    <>
      {params.length === 0 && (
        <p className="view-note">
          Inputs let one script work on different actors or variables: pick "@input" in its events, and each Call
          Script chooses what it stands for.
        </p>
      )}
      {params.map((p, i) => (
        <div key={p.name} className="script-param-row">
          <span className="script-param-at">@</span>
          <CommitInput
            value={p.name}
            onCommit={(v) => {
              const name = v.trim();
              if (name === p.name) return;
              if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return "Letters, digits and _ only (not starting with a digit).";
              if (params.some((q) => q.name === name)) return `There's already an input called "${name}".`;
              setParams(
                id,
                params.map((q, j) => (j === i ? { ...q, name } : q)),
                { rename: { from: p.name, to: name } },
              );
            }}
          />
          <select
            value={p.kind}
            onChange={(e) =>
              setParams(
                id,
                params.map((q, j) => (j === i ? { ...q, kind: e.target.value as ScriptParam["kind"] } : q)),
                { drop: p.name },
              )
            }
          >
            {PARAM_KINDS.map((k) => (
              <option key={k.kind} value={k.kind}>
                {k.label}
              </option>
            ))}
          </select>
          <button
            className="link-btn link-btn-danger"
            title="Remove this input"
            onClick={() => setParams(id, params.filter((_, j) => j !== i), { drop: p.name })}
          >
            Remove
          </button>
        </div>
      ))}
      <button className="btn btn-small" onClick={add}>
        + Add input
      </button>
    </>
  );
}

// ---------------------------------------------------------------------------
// Palette (BG palette bank the palette-paint tool assigns to tiles)
// ---------------------------------------------------------------------------

function PaletteProps({ id }: { id: string }) {
  const project = useProjectStore((s) => s.project)!;
  const renamePalette = useProjectStore((s) => s.renamePalette);
  const setPaletteColors = useProjectStore((s) => s.setPaletteColors);
  const removePalette = useProjectStore((s) => s.removePalette);
  const setPaletteBrush = useProjectStore((s) => s.setPaletteBrush);
  const setSelection = useProjectStore((s) => s.setSelection);
  const tool = useProjectStore((s) => s.tool);
  const paletteBrush = useProjectStore((s) => s.paletteBrush);
  const palette = (project.project.palettes ?? []).find((p) => p.id === id);

  if (!palette) {
    return (
      <div className="properties-panel-empty">
        <p>This palette was deleted.</p>
      </div>
    );
  }

  const setColor = (i: number, hex: string) => {
    const colors = palette.colors.slice();
    colors[i] = hex;
    setPaletteColors(id, colors);
  };
  const addColor = () => {
    if (palette.colors.length >= COLORS_PER_BANK) return;
    setPaletteColors(id, [...palette.colors, "#ffffff"]);
  };
  const removeColor = (i: number) => {
    setPaletteColors(id, palette.colors.filter((_, j) => j !== i));
  };
  const painting = tool === "palette" && paletteBrush === id;

  return (
    <>
      <div className="properties-header properties-header-row">
        <span>Palette</span>
        <button
          className="link-btn link-btn-danger"
          onClick={() => {
            if (window.confirm(`Delete palette "${palette.name}"? Tiles painted with it revert to auto-assigned.`)) {
              removePalette(id);
              setSelection({ kind: "none" });
            }
          }}
        >
          Delete
        </button>
      </div>
      <div className="properties-body">
        <FieldRow label="Name">
          <CommitInput
            value={palette.name}
            onCommit={(v) => {
              if (!v.trim()) return "Name can't be empty.";
              renamePalette(id, v.trim());
            }}
          />
        </FieldRow>
        <FieldRow label="Colors" hint={`Lightest to darkest. Up to ${COLORS_PER_BANK} (1 more slot is the shared backdrop).`}>
          <div className="palette-swatch-list">
            {palette.colors.map((c, i) => (
              <div key={i} className="palette-swatch-row">
                <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#000000"} onChange={(e) => setColor(i, e.target.value)} />
                <input className="palette-swatch-hex" value={c} onChange={(e) => setColor(i, e.target.value)} />
                <button className="icon-btn" title="Remove color" onClick={() => removeColor(i)}>
                  ×
                </button>
              </div>
            ))}
            <button className="btn btn-small" disabled={palette.colors.length >= COLORS_PER_BANK} onClick={addColor}>
              + Add color
            </button>
          </div>
        </FieldRow>
        <button
          className={`btn${painting ? " btn-primary" : ""}`}
          onClick={() => setPaletteBrush(painting ? null : id)}
        >
          {painting ? "Painting on canvas (click again to stop)" : "Paint this palette"}
        </button>
        <p className="view-note">
          Paint this over a scene's background tiles (Palette tool on the World canvas). Every tile sharing a palette
          is packed into one bank at compile time; unpainted tiles keep the compiler's automatic assignment.
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Prefab (reusable NPC/door template - a one-time copy on placement, not a
// live-linked instance, matching GB Studio's own prefabs)
// ---------------------------------------------------------------------------

function PrefabProps({ id, scenes }: { id: string; scenes: SceneRecord[] }) {
  const project = useProjectStore((s) => s.project)!;
  const renamePrefab = useProjectStore((s) => s.renamePrefab);
  const updatePrefabTemplate = useProjectStore((s) => s.updatePrefabTemplate);
  const removePrefab = useProjectStore((s) => s.removePrefab);
  const setSelection = useProjectStore((s) => s.setSelection);
  const setPlacingPrefab = useProjectStore((s) => s.setPlacingPrefab);
  const tool = useProjectStore((s) => s.tool);
  const placingPrefabId = useProjectStore((s) => s.placingPrefabId);
  const prefab = (project.project.prefabs ?? []).find((p) => p.id === id);

  if (!prefab) {
    return (
      <div className="properties-panel-empty">
        <p>This prefab was deleted.</p>
      </div>
    );
  }

  const patch = (t: Partial<NpcJSON> | Partial<DoorJSON>) => updatePrefabTemplate(id, { ...prefab.template, ...t });
  const placing = tool === "placePrefab" && placingPrefabId === id;
  const names = scenes.map(sceneName);

  return (
    <>
      <div className="properties-header properties-header-row">
        <span>Prefab ({prefab.kind === "npc" ? "NPC" : "Door"})</span>
        <button
          className="link-btn link-btn-danger"
          onClick={() => {
            if (window.confirm(`Delete prefab "${prefab.name}"? NPCs/doors already placed from it are unaffected.`)) {
              removePrefab(id);
              setSelection({ kind: "none" });
            }
          }}
        >
          Delete
        </button>
      </div>
      <div className="properties-body">
        <FieldRow label="Name">
          <CommitInput
            value={prefab.name}
            onCommit={(v) => {
              if (!v.trim()) return "Name can't be empty.";
              renamePrefab(id, v.trim());
            }}
          />
        </FieldRow>

        {prefab.kind === "npc" ? (
          <NpcPrefabFields id={id} template={prefab.template as Partial<NpcJSON>} patch={patch} scenes={scenes} />
        ) : (
          <DoorPrefabFields template={prefab.template as Partial<DoorJSON>} patch={patch} names={names} />
        )}

        <button className={`btn${placing ? " btn-primary" : ""}`} onClick={() => setPlacingPrefab(placing ? null : id)}>
          {placing ? "Click a tile on the canvas (or click again to cancel)" : `Place ${prefab.kind === "npc" ? "NPC" : "door"}`}
        </button>
        <p className="view-note">
          Placing copies these defaults into a brand-new {prefab.kind === "npc" ? "NPC" : "door"} on the active scene -
          it's a starting point, not a live link, so editing the prefab afterwards never changes ones already placed.
          {prefab.kind === "npc" &&
            " Actor prefabs can also appear while the game runs, with the Spawn Prefab event: those always use the prefab as it is now."}
        </p>
      </div>
    </>
  );
}

function NpcPrefabFields({
  id,
  template,
  patch,
  scenes,
}: {
  id: string;
  template: Partial<NpcJSON>;
  patch: (t: Partial<NpcJSON>) => void;
  scenes: SceneRecord[];
}) {
  const updatePrefabTemplate = useProjectStore((s) => s.updatePrefabTemplate);
  const [tab, setTab] = useState<ActorTab>("interact");
  const env: ScriptEnv = useMemo(
    () => ({ rootId: `prefab:${id}:${tab}`, sceneId: "__prefab__", scene: { background: "" }, scenes, allowSelf: true }),
    [id, tab, scenes],
  );
  const scriptKey = { interact: "on_interact", init: "on_init", update: "on_update", hit: "on_hit" } as const;
  // Script edits apply to the prefab as it is in the store right now.
  const onScript: ScriptUpdater = (fn) => {
    const cur = (useProjectStore.getState().project?.project.prefabs ?? []).find((p) => p.id === id);
    if (!cur) return;
    const next = withScript(cur.template as Partial<NpcJSON>, scriptKey[tab], fn);
    if (next !== cur.template) updatePrefabTemplate(id, next);
  };
  const count = (s: EventScript | undefined) => (s?.length ? ` (${s.length})` : "");
  const group = template.collision_group ?? 0;
  const flag = (key: "above_player" | "lock_direction" | "push_player" | "gravity" | "platform", label: string, hint: string) => (
    <FieldRow label={label} hint={hint}>
      <label className="script-field-bool">
        <input type="checkbox" checked={!!template[key]} onChange={(e) => patch({ [key]: e.target.checked || undefined })} />
        {template[key] ? "On" : "Off"}
      </label>
    </FieldRow>
  );
  return (
    <>
      <FieldRow label="Sprite">
        <SpriteSelect value={template.sprite} onChange={(sprite) => patch({ sprite })} />
      </FieldRow>
      <div className="field-row-pair">
        <FieldRow label="Facing">
          <select value={template.direction ?? "down"} onChange={(e) => patch({ direction: e.target.value as Direction })}>
            {DIRECTIONS.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Movement">
          <select value={template.movement ?? "static"} onChange={(e) => patch({ movement: e.target.value as NpcMovement })}>
            {MOVEMENTS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </FieldRow>
      </div>
      <div className="field-row-pair">
        <FieldRow label="Movement speed">
          <select
            value={template.move_speed ?? 1}
            onChange={(e) => patch({ move_speed: Number(e.target.value) === 1 ? undefined : Number(e.target.value) })}
          >
            {MOVE_SPEEDS.map((v) => (
              <option key={v} value={v}>
                {v} px/frame
              </option>
            ))}
          </select>
        </FieldRow>
        <FieldRow label="Animation speed">
          <select value={template.anim_speed ?? 0} onChange={(e) => patch({ anim_speed: Number(e.target.value) || undefined })}>
            {ANIM_SPEEDS.map((v) => (
              <option key={v} value={v}>
                {v === 0 ? "Sprite's own" : `${v} frames`}
              </option>
            ))}
          </select>
        </FieldRow>
      </div>
      {flag("gravity", "Gravity", GRAVITY_HINT)}
      {flag("platform", "Platform", "Platformer: the player can stand on it (it only blocks from above) and rides along when it moves.")}
      {flag("above_player", "Draw above player", "Draw this actor over the player instead of under it.")}
      {flag("lock_direction", "Lock facing direction", "Keeps facing the same way while it moves.")}
      {flag("push_player", "Pushes the player", "When it moves into the player, it shoves the player along.")}
      <FieldRow
        label="Collision group"
        hint={group ? `Touching the player runs its On Hit, or else the scene's On Player Hit for group ${group}.` : undefined}
      >
        <div className="seg seg-wide">
          {[0, 1, 2, 3].map((g) => (
            <button
              key={g}
              className={group === g ? "seg-on" : ""}
              onClick={(e) => {
                e.preventDefault();
                patch({ collision_group: g || undefined });
              }}
            >
              {g === 0 ? "None" : g}
            </button>
          ))}
        </div>
      </FieldRow>
      {template.on_interact === undefined && (
        <FieldRow label="Dialogue" hint="A simple On Interact text. Add events in the On Interact tab below for a full script instead.">
          <textarea
            rows={2}
            value={template.dialogue ?? ""}
            onChange={(e) => patch({ dialogue: e.target.value || undefined })}
            placeholder="Hello!"
          />
        </FieldRow>
      )}
      <Tabs
        tabs={[
          { id: "interact", label: `On Interact${count(template.on_interact)}` },
          { id: "init", label: `On Init${count(template.on_init)}` },
          { id: "update", label: `On Update${count(template.on_update)}` },
          { id: "hit", label: `On Hit${count(template.on_hit)}` },
        ]}
        value={tab}
        onChange={setTab}
      />
      <div className="properties-script">
        <ScriptEditor
          key={tab}
          value={template[scriptKey[tab]]}
          onChange={onScript}
          env={env}
          emptyHint={
            tab === "interact"
              ? "Runs when the player talks to it (replaces the Dialogue above). Events can target it as “Self”."
              : tab === "init"
                ? "Runs as this actor when its scene starts - or, for a spawned copy, the moment it's spawned."
                : tab === "update"
                  ? "Runs over and over in the background while it's in the scene (from its spawn, for spawned copies)."
                  : "Runs when the player touches it. Needs a collision group (above)."
          }
        />
      </div>
    </>
  );
}

const GRAVITY_HINT =
  "Falls and lands on solid ground and one-way platforms, using the scene's platformer Gravity settings. " +
  "It only walks left and right (wandering and Move events), and can jump with Actor Jump.";

function DoorPrefabFields({
  template,
  patch,
  names,
}: {
  template: Partial<DoorJSON>;
  patch: (t: Partial<DoorJSON>) => void;
  names: string[];
}) {
  return (
    <>
      <FieldRow label="Size (tiles)">
        <div className="field-row-pair">
          <NumberInput value={template.width ?? 2} min={1} max={255} onChange={(width) => patch({ width })} />
          <NumberInput value={template.height ?? 2} min={1} max={255} onChange={(height) => patch({ height })} />
        </div>
      </FieldRow>
      <FieldRow label="Target scene" hint="Left blank, the placed door gets a script-only door instead of a warp.">
        <select value={template.target_scene ?? ""} onChange={(e) => patch({ target_scene: e.target.value || undefined })}>
          <option value="">(none - script door)</option>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </FieldRow>
    </>
  );
}

function NoteProps({ scene, index }: { scene: SceneRecord; index: number }) {
  const updateScene = useProjectStore((s) => s.updateScene);
  const deleteSelected = useProjectStore((s) => s.deleteSelected);
  const note = scene.data.notes?.[index];
  if (!note) return <div className="properties-panel-empty">Note not found.</div>;
  const patch = (p: Partial<typeof note>, key?: string) =>
    updateScene(
      scene.fileId,
      (s) => ({ ...s, notes: (s.notes ?? []).map((n, i) => (i === index ? { ...n, ...p } : n)) }),
      key ? `note${index}:${key}` : undefined,
    );
  return (
    <div className="panel-section">
      <FieldRow label="Note" hint="Only for you - notes aren't part of the game.">
        <textarea
          className="note-text"
          rows={8}
          value={note.text}
          autoFocus={!note.text}
          placeholder="Write a note…"
          onChange={(e) => patch({ text: e.target.value }, "text")}
          data-testid="note-text"
        />
      </FieldRow>
      <div className="field-row-pair">
        <FieldRow label="X">
          <NumberInput value={note.x} min={0} max={1024} onChange={(x) => patch({ x }, "x")} />
        </FieldRow>
        <FieldRow label="Y">
          <NumberInput value={note.y} min={0} max={1024} onChange={(y) => patch({ y }, "y")} />
        </FieldRow>
      </div>
      <button className="btn btn-small btn-danger" onClick={deleteSelected}>
        Delete note
      </button>
    </div>
  );
}
