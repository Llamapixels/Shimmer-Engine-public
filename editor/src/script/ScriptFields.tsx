import EngineValueInput from "../engine/EngineValueInput";
import { ENGINE_MODES, ENGINE_SETTINGS, type EngineValue, SETTING_BY_KEY } from "../engine/engineSettings";
import { SpriteSelect } from "../components/common/AssetSelect";
import type {
  ActorRelation,
  ArrayVarMathOp,
  ButtonName,
  CompareOp,
  Direction,
  FadeColor,
  MathOp,
  PaletteTarget,
  PositionUnits,
  ScriptEventJSON,
  SoundEffect,
} from "../../shared/eventTypes";
import type { SceneJSON, SceneRecord } from "../../shared/projectTypes";
import CommitInput from "../components/common/CommitInput";
import NamedListSelect from "../components/common/NamedListSelect";
import NumberInput from "../components/common/NumberInput";
import { playerSpriteName } from "../sprites/model";
import { sceneName, useProjectStore } from "../state/projectStore";
import type { FieldDef } from "./eventCatalog";
import Icon from "../components/common/Icon";

/** What a script's fields need to know about where the script lives. */
export interface ScriptEnv {
  /** Identifies this script for drag-and-drop (drops stay within it). */
  rootId: string;
  sceneId: string;
  scene: SceneJSON;
  scenes: SceneRecord[];
  /** Only an NPC's own on_interact may use "self". */
  allowSelf: boolean;
}

const DIRECTIONS: Direction[] = ["down", "up", "left", "right"];
const SOUNDS: SoundEffect[] = ["blip", "door", "save", "item"];
const OPS: { op: CompareOp; label: string }[] = [
  { op: "==", label: "= equal to" },
  { op: "!=", label: "≠ not equal to" },
  { op: "<", label: "< less than" },
  { op: "<=", label: "≤ at most" },
  { op: ">", label: "> greater than" },
  { op: ">=", label: "≥ at least" },
];
const BUTTONS: ButtonName[] = ["a", "b", "l", "r", "start", "select", "up", "down", "left", "right"];
const MATH_OPS: { op: MathOp; label: string }[] = [
  { op: "add", label: "+ add" },
  { op: "sub", label: "− subtract" },
  { op: "mul", label: "× multiply" },
  { op: "div", label: "÷ divide" },
  { op: "mod", label: "% modulo" },
];
const ARRAY_OPS: { op: ArrayVarMathOp; label: string }[] = [
  { op: "get", label: "Get (read into Output)" },
  { op: "set", label: "Set (write Value)" },
  { op: "add", label: "+ add Value" },
  { op: "sub", label: "− subtract Value" },
  { op: "mul", label: "× multiply by Value" },
  { op: "div", label: "÷ divide by Value" },
  { op: "mod", label: "% modulo Value" },
];
const FADE_COLORS: { color: FadeColor; label: string }[] = [
  { color: "black", label: "Black" },
  { color: "white", label: "White" },
];

const UNITS: { units: PositionUnits; label: string }[] = [
  { units: "tiles", label: "Tiles" },
  { units: "pixels", label: "Pixels" },
];
const RELATIONS: { relation: ActorRelation; label: string }[] = [
  { relation: "up", label: "above" },
  { relation: "down", label: "below" },
  { relation: "left", label: "left of" },
  { relation: "right", label: "right of" },
];
const PALETTE_TARGETS: { target: PaletteTarget; label: string }[] = [
  { target: "background", label: "Background" },
  { target: "sprite", label: "Sprite" },
];
const BITS = Array.from({ length: 16 }, (_, i) => i);

interface Props {
  field: FieldDef;
  ev: ScriptEventJSON;
  env: ScriptEnv;
  /** Merge these keys into the event. coalesce=true for typing, so a run
   * of keystrokes becomes one undo step. */
  patch: (changes: Record<string, unknown>, coalesce?: boolean) => void;
}

export function FieldControl({ field, ev, env, patch }: Props) {
  const rec = ev as unknown as Record<string, unknown>;
  const value = rec[field.key];
  const setTilePick = useProjectStore((s) => s.setTilePick);
  const customScripts = useProjectStore((s) => s.project?.project.customScripts ?? []);
  const constants = useProjectStore((s) => s.project?.project.constants ?? []);
  const project = useProjectStore((s) => s.project?.project);
  const spriteSheets = project?.spriteSheets ?? [];
  const musicTracks = useProjectStore((s) => s.assets?.music ?? []);
  const wavs = useProjectStore((s) => s.assets?.sounds ?? []);
  const fonts = useProjectStore((s) => s.assets?.fonts ?? []);
  const frames = useProjectStore((s) => s.assets?.frames ?? []);
  const variables = useProjectStore((s) => s.project?.project.variables) ?? [];

  switch (field.kind) {
    case "text":
      return (
        <input
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => patch({ [field.key]: e.target.value }, true)}
        />
      );

    case "multiline":
      return (
        <textarea
          rows={Math.min(6, Math.max(2, String(value ?? "").split("\n").length))}
          value={String(value ?? "")}
          placeholder="Text… (new line = new page)"
          onChange={(e) => patch({ [field.key]: e.target.value }, true)}
        />
      );

    case "int":
      return (
        <NumberInput
          value={typeof value === "number" ? value : 0}
          min={field.min}
          max={field.max}
          onChange={(n) => patch({ [field.key]: n }, true)}
        />
      );

    case "flag":
    case "item":
    case "variable":
      return (
        <NamedListSelect
          kind={field.kind === "flag" ? "flags" : field.kind === "item" ? "items" : "variables"}
          value={String(value ?? "")}
          onChange={(name) => patch({ [field.key]: name })}
        />
      );

    case "varOrLiteral": {
      const isVar = !!value && typeof value === "object";
      return (
        <div className="script-field-combo">
          <div className="seg" role="group" aria-label="Number or variable">
            <button className={!isVar ? "seg-on" : ""} onClick={() => isVar && patch({ [field.key]: 0 })}>
              123
            </button>
            <button
              className={isVar ? "seg-on" : ""}
              onClick={() => {
                if (isVar) return;
                const first = useProjectStore.getState().project?.project.variables?.[0] ?? "";
                patch({ [field.key]: { var: first } });
              }}
            >
              $var
            </button>
          </div>
          {isVar ? (
            <NamedListSelect
              kind="variables"
              value={(value as { var: string }).var}
              onChange={(name) => patch({ [field.key]: { var: name } })}
            />
          ) : (
            <>
              <NumberInput
                value={typeof value === "number" ? value : 0}
                min={field.min}
                max={field.max}
                onChange={(n) => patch({ [field.key]: n }, true)}
              />
              {constants.length > 0 && (
                <select
                  className="script-field-constant-pick"
                  title="Fill in a constant's current value. This writes a plain number - it won't update later if the constant's value changes."
                  value=""
                  onChange={(e) => {
                    const c = constants.find((c) => c.name === e.target.value);
                    if (c) patch({ [field.key]: c.value });
                  }}
                >
                  <option value="">Constant…</option>
                  {constants.map((c) => (
                    <option key={c.name} value={c.name}>
                      {c.name} = {c.value}
                    </option>
                  ))}
                </select>
              )}
            </>
          )}
        </div>
      );
    }

    case "actor": {
      const npcs = env.scene.npcs ?? [];
      const encode = (v: unknown) => JSON.stringify(v ?? null);
      const choices: { value: string | number; label: string }[] = [{ value: "player", label: "Player" }];
      if (env.allowSelf) choices.push({ value: "self", label: "Self (this NPC)" });
      npcs.forEach((n, i) => {
        choices.push({
          value: n.name ? n.name : i,
          label: n.name ? `${n.name}  (#${i})` : `NPC #${i} (unnamed, ${n.sprite ?? "player"})`,
        });
      });
      const found = choices.some((c) => encode(c.value) === encode(value));
      return (
        <select
          className={!found ? "select-invalid" : undefined}
          value={encode(value)}
          onChange={(e) => patch({ [field.key]: JSON.parse(e.target.value) })}
        >
          {!found && (
            <option value={encode(value)}>
              {value === "self" ? "Self (only works in an NPC's script!)" : `${String(value)} (not in this scene!)`}
            </option>
          )}
          {choices.map((c) => (
            <option key={encode(c.value)} value={encode(c.value)}>
              {c.label}
            </option>
          ))}
        </select>
      );
    }

    case "timer": {
      const timers = env.scene.timers ?? [];
      const choices = timers.map((t, i) => ({ value: t.name ? t.name : i, label: t.name ? t.name : `Timer #${i}` }));
      const found = choices.some((c) => c.value === value);
      return (
        <select
          className={!found ? "select-invalid" : undefined}
          value={JSON.stringify(value ?? null)}
          onChange={(e) => patch({ [field.key]: JSON.parse(e.target.value) })}
        >
          {!found && (
            <option value={JSON.stringify(value ?? null)}>
              {timers.length === 0 ? "No timers in this scene — add one in the scene's Timers tab" : `${String(value)} (missing)`}
            </option>
          )}
          {choices.map((c) => (
            <option key={JSON.stringify(c.value)} value={JSON.stringify(c.value)}>
              {c.label}
            </option>
          ))}
        </select>
      );
    }

    case "scene": {
      const names = env.scenes.map(sceneName);
      const cur = String(value ?? "");
      return (
        <select
          className={!names.includes(cur) ? "select-invalid" : undefined}
          value={cur}
          onChange={(e) => patch({ [field.key]: e.target.value })}
        >
          {!names.includes(cur) && <option value={cur}>{cur ? `${cur} (missing!)` : "Choose a scene…"}</option>}
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      );
    }

    case "customScript": {
      const scripts = customScripts;
      const cur = String(value ?? "");
      const found = scripts.some((s) => s.id === cur);
      return (
        <select
          className={!found ? "select-invalid" : undefined}
          value={cur}
          onChange={(e) => patch({ [field.key]: e.target.value })}
        >
          {!found && (
            <option value={cur}>
              {scripts.length === 0 ? "No custom scripts yet — add one in the Scripts sidebar" : cur ? `${cur} (missing!)` : "Choose a script…"}
            </option>
          )}
          {scripts.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      );
    }

    case "sound": {
      const cur = String(value ?? "blip");
      const known = SOUNDS.includes(cur as SoundEffect) || wavs.some((w) => w.name === cur);
      return (
        <select className={!known ? "select-invalid" : undefined} value={cur} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {!known && <option value={cur}>{cur} (not in assets/sounds)</option>}
          {wavs.length > 0 && (
            <optgroup label="WAV (assets/sounds)">
              {wavs.map((w) => (
                <option key={w.name} value={w.name}>
                  {w.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Built in">
            {SOUNDS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </optgroup>
        </select>
      );
    }

    case "music": {
      const names = musicTracks.map((t) => t.name);
      const cur = String(value ?? "");
      const known = cur !== "" && names.includes(cur);
      return (
        <select
          className={cur && !known ? "select-invalid" : undefined}
          value={cur}
          onChange={(e) => patch({ [field.key]: e.target.value })}
        >
          {!cur && <option value="">Choose a track…</option>}
          {cur && !known && <option value={cur}>{cur} (not in assets/music)</option>}
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      );
    }

    case "font":
    case "frame": {
      const folder = field.kind === "font" ? "assets/fonts" : "assets/frames";
      const names = ["default", ...(field.kind === "font" ? fonts : frames).map((a) => a.name).filter((n) => n !== "default")];
      const cur = String(value ?? "");
      const known = names.includes(cur);
      return (
        <select
          className={!known ? "select-invalid" : undefined}
          value={cur}
          onChange={(e) => patch({ [field.key]: e.target.value })}
        >
          {!known && <option value={cur}>{cur ? `${cur} (not in ${folder})` : "Choose…"}</option>}
          {names.map((n) => (
            <option key={n} value={n}>
              {n === "default" ? "default (built in)" : n}
            </option>
          ))}
        </select>
      );
    }

    case "sprite":
      return <SpriteSelect value={String(value ?? "player")} onChange={(v) => patch({ [field.key]: v ?? "player" })} />;

    case "select":
      return (
        <select value={String(value ?? field.options?.[0]?.value ?? "")} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case "checks": {
      // A plain string is an older single choice; "actors" = every group.
      const raw = Array.isArray(value) ? (value as string[]) : typeof value === "string" ? [value] : [];
      const selected = new Set(raw.flatMap((v) => (v === "actors" ? ["group1", "group2", "group3"] : [v])));
      const options = field.options ?? [];
      return (
        <div className="chips">
          {options.map((o) => (
            <label key={o.value} className="script-field-bool">
              <input
                type="checkbox"
                checked={selected.has(o.value)}
                onChange={(e) => {
                  const next = new Set(selected);
                  if (e.target.checked) next.add(o.value);
                  else next.delete(o.value);
                  patch({ [field.key]: options.map((x) => x.value).filter((v) => next.has(v)) });
                }}
              />
              {o.label}
            </label>
          ))}
        </div>
      );
    }

    case "float":
      return (
        <CommitInput
          value={String(typeof value === "number" ? value : 0)}
          onCommit={(v: string) => {
            const n = Number(v.trim());
            const lo = field.min ?? -1e9;
            const hi = field.max ?? 1e9;
            if (!v.trim() || !Number.isFinite(n) || n < lo || n > hi) return `A number from ${lo} to ${hi}.`;
            patch({ [field.key]: Math.round(n * 256) / 256 });
          }}
        />
      );

    case "engineSetting": {
      const cur = String(value ?? "");
      return (
        <select
          value={cur}
          onChange={(e) => {
            const d = SETTING_BY_KEY[e.target.value];
            patch({ [field.key]: e.target.value, value: d ? d.default : 0 });
          }}
        >
          {!SETTING_BY_KEY[cur] && <option value={cur}>{cur || "Choose…"}</option>}
          {ENGINE_MODES.map((m) => {
            const defs = ENGINE_SETTINGS.filter((d) => d.mode === m.id || (m.id === "topdown" && d.mode === "all"));
            if (!defs.length) return null;
            return (
              <optgroup key={m.id} label={m.label}>
                {defs.map((d) => (
                  <option key={d.key} value={d.key}>
                    {d.mode === "all" ? `Any: ${d.label}` : d.label}
                  </option>
                ))}
              </optgroup>
            );
          })}
        </select>
      );
    }

    case "engineValue": {
      const d = SETTING_BY_KEY[String(rec.setting ?? "")];
      if (!d) return <span className="properties-note">Pick a setting first.</span>;
      return (
        <EngineValueInput
          def={d}
          value={(value as EngineValue | undefined) ?? d.default}
          onChange={(v) => patch({ [field.key]: v })}
        />
      );
    }

    case "direction":
      return (
        <select value={String(value ?? "down")} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {DIRECTIONS.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      );

    case "compareOp":
      return (
        <select value={String(value ?? "==")} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {OPS.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case "mathOp":
      return (
        <select value={String(value ?? "add")} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {MATH_OPS.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case "arrayOp":
      return (
        <select value={String(value ?? "get")} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {ARRAY_OPS.map((o) => (
            <option key={o.op} value={o.op}>
              {o.label}
            </option>
          ))}
        </select>
      );

    case "fadeColor":
      return (
        <select value={String(value ?? "black")} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {FADE_COLORS.map((c) => (
            <option key={c.color} value={c.color}>
              {c.label}
            </option>
          ))}
        </select>
      );

    case "buttons": {
      const selected = new Set(Array.isArray(value) ? (value as string[]) : value ? [String(value)] : []);
      const toggle = (b: ButtonName) => {
        const next = new Set(selected);
        if (next.has(b)) next.delete(b);
        else next.add(b);
        if (next.size === 0) return; // at least one button
        const ordered = BUTTONS.filter((x) => next.has(x));
        patch({ [field.key]: ordered.length === 1 ? ordered[0] : ordered });
      };
      return (
        <div className="chips">
          {BUTTONS.map((b) => (
            <button key={b} className={`chip${selected.has(b) ? " chip-on" : ""}`} onClick={() => toggle(b)}>
              {b.toUpperCase()}
            </button>
          ))}
        </div>
      );
    }

    case "tilePos": {
      const xKey = field.xKey ?? "x";
      const yKey = field.yKey ?? "y";
      const x = typeof rec[xKey] === "number" ? (rec[xKey] as number) : 0;
      const y = typeof rec[yKey] === "number" ? (rec[yKey] as number) : 0;
      // A pixel position can be up to the map's pixel size; the pick
      // button always fills in tiles.
      const max = rec.units === "pixels" ? 2047 : 255;
      return (
        <div className="script-field-pos">
          <span className="pos-label">X</span>
          <NumberInput value={x} min={0} max={max} onChange={(n) => patch({ [xKey]: n }, true)} />
          <span className="pos-label">Y</span>
          <NumberInput value={y} min={0} max={max} onChange={(n) => patch({ [yKey]: n }, true)} />
          <button
            className="btn btn-small"
            title={
              ev.type === "switch_scene"
                ? "Pick the tile on the target scene's map isn't possible from here - type it, or open that scene to look"
                : "Click a tile on the scene canvas"
            }
            disabled={ev.type === "switch_scene"}
            onClick={() =>
              setTilePick({
                label: field.label,
                onPick: (px, py) => patch(rec.units === "pixels" ? { [xKey]: px * 8, [yKey]: py * 8 } : { [xKey]: px, [yKey]: py }),
                screenOutline: ev.type === "camera_move_to" || ev.type === "camera_lock_point",
              })
            }
          >
            <Icon name="pick" /> Pick
          </button>
        </div>
      );
    }

    case "state": {
      // "self" can't be resolved to a sprite without knowing which NPC's
      // own script is being edited (ScriptEnv doesn't carry that) - fall
      // back to a plain text field for it, validated (against every
      // sprite's states) is a compile-time-only check either way.
      const actorRef = rec.actor;
      const npcs = env.scene.npcs ?? [];
      const playerSprite = project ? playerSpriteName(project) : "player";
      let spriteName: string | undefined;
      if (actorRef === "player") spriteName = playerSprite;
      else if (actorRef !== "self") {
        const npc = typeof actorRef === "number" ? npcs[actorRef] : npcs.find((n) => n.name === actorRef);
        spriteName = npc?.sprite || playerSprite;
      }
      // A sprite with no entry has just the default state.
      const stateNames = spriteName
        ? (spriteSheets.find((s) => s.name === spriteName)?.states ?? [{ name: "" }]).map((st) => st.name || "Default")
        : [];
      if (actorRef === "self" || stateNames.length === 0) {
        return (
          <input
            value={String(value ?? "")}
            placeholder="state name"
            onChange={(e) => patch({ [field.key]: e.target.value }, true)}
          />
        );
      }
      const cur = String(value ?? "");
      const found = stateNames.includes(cur) || (cur.toLowerCase() === "default" && stateNames.includes("Default"));
      return (
        <select
          className={!found ? "select-invalid" : undefined}
          value={found && cur.toLowerCase() === "default" ? "Default" : cur}
          onChange={(e) => patch({ [field.key]: e.target.value })}
        >
          {!found && <option value={cur}>{cur ? `${cur} (missing!)` : "Choose a state…"}</option>}
          {stateNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      );
    }

    case "bool":
      return (
        <label className="script-field-bool">
          <input type="checkbox" checked={!!value} onChange={(e) => patch({ [field.key]: e.target.checked })} />
          {value ? "On" : "Off"}
        </label>
      );

    case "collisionBox": {
      const x = typeof rec.x === "number" ? rec.x : 0;
      const y = typeof rec.y === "number" ? rec.y : 0;
      const width = typeof rec.width === "number" ? rec.width : 16;
      const height = typeof rec.height === "number" ? rec.height : 16;
      return (
        <div className="script-field-pos script-field-box">
          <span className="pos-label">X</span>
          <NumberInput value={x} min={-128} max={127} onChange={(n) => patch({ x: n }, true)} />
          <span className="pos-label">Y</span>
          <NumberInput value={y} min={-128} max={127} onChange={(n) => patch({ y: n }, true)} />
          <span className="pos-label">W</span>
          <NumberInput value={width} min={1} max={255} onChange={(n) => patch({ width: n }, true)} />
          <span className="pos-label">H</span>
          <NumberInput value={height} min={1} max={255} onChange={(n) => patch({ height: n }, true)} />
        </div>
      );
    }

    case "offset": {
      const x = typeof rec.x === "number" ? rec.x : 0;
      const y = typeof rec.y === "number" ? rec.y : 0;
      const lim = rec.units === "pixels" ? 2047 : 255;
      return (
        <div className="script-field-pos script-field-offset">
          <span className="pos-label">X</span>
          <NumberInput value={x} min={-lim} max={lim} onChange={(n) => patch({ x: n }, true)} />
          <span className="pos-label">Y</span>
          <NumberInput value={y} min={-lim} max={lim} onChange={(n) => patch({ y: n }, true)} />
        </div>
      );
    }

    case "expression":
      return (
        <input
          className="script-field-expression"
          spellCheck={false}
          value={String(value ?? "")}
          placeholder="e.g. score >= 10 && held(a)"
          onChange={(e) => patch({ [field.key]: e.target.value }, true)}
        />
      );

    case "units":
      return (
        <select value={String(value ?? "tiles")} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {UNITS.map((u) => (
            <option key={u.units} value={u.units}>
              {u.label}
            </option>
          ))}
        </select>
      );

    case "relation":
      return (
        <select value={String(value ?? "up")} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {RELATIONS.map((r) => (
            <option key={r.relation} value={r.relation}>
              {r.label}
            </option>
          ))}
        </select>
      );

    case "paletteTarget":
      return (
        <select value={String(value ?? "background")} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {PALETTE_TARGETS.map((t) => (
            <option key={t.target} value={t.target}>
              {t.label}
            </option>
          ))}
        </select>
      );

    case "color": {
      // Hand-written palette_set JSON may use a "colors" list instead;
      // show its first entry, and replace the list on edit.
      const list = Array.isArray(rec.colors) ? (rec.colors as unknown[]) : [];
      const raw = value ?? list[0];
      const cur = typeof raw === "string" && /^#?[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.replace("#", "").toLowerCase()}` : "#000000";
      return (
        <div className="script-field-color">
          <input type="color" value={cur} onChange={(e) => patch({ [field.key]: e.target.value, colors: undefined }, true)} />
          <span className="script-field-color-hex">
            {cur}
            {list.length > 1 ? ` (+${list.length - 1} more in JSON, replaced on edit)` : ""}
          </span>
        </div>
      );
    }

    case "bits": {
      const selected = new Set(Array.isArray(value) ? (value as number[]) : []);
      const toggle = (b: number) => {
        const next = new Set(selected);
        if (next.has(b)) next.delete(b);
        else next.add(b);
        patch({ [field.key]: BITS.filter((x) => next.has(x)) });
      };
      return (
        <div className="chips">
          {BITS.map((b) => (
            <button key={b} className={`chip${selected.has(b) ? " chip-on" : ""}`} onClick={() => toggle(b)}>
              {b}
            </button>
          ))}
        </div>
      );
    }

    case "optionalVariable": {
      const cur = String(value ?? "");
      const missing = cur !== "" && !variables.includes(cur);
      return (
        <select
          className={missing ? "select-invalid" : undefined}
          value={cur}
          onChange={(e) => patch({ [field.key]: e.target.value })}
        >
          <option value="">(don't store)</option>
          {missing && <option value={cur}>{cur} (not in project!)</option>}
          {variables.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      );
    }

    case "choiceOptions": {
      const opts = (Array.isArray(value) ? value : ["Yes", "No"]) as [string, string];
      return (
        <div className="field-row-pair">
          <input value={opts[0]} onChange={(e) => patch({ options: [e.target.value, opts[1]] }, true)} />
          <input value={opts[1]} onChange={(e) => patch({ options: [opts[0], e.target.value] }, true)} />
        </div>
      );
    }
  }
}
