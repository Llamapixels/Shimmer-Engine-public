import type { ArrayVarMathOp, ButtonName, CompareOp, Direction, FadeColor, MathOp, ScriptEventJSON, SoundEffect } from "../../shared/eventTypes";
import type { SceneJSON, SceneRecord } from "../../shared/projectTypes";
import NamedListSelect from "../components/common/NamedListSelect";
import NumberInput from "../components/common/NumberInput";
import { sceneName, useProjectStore } from "../state/projectStore";
import type { FieldDef } from "./eventCatalog";

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
  const spriteSheets = useProjectStore((s) => s.project?.project.spriteSheets ?? []);
  const musicTracks = useProjectStore((s) => s.assets?.music ?? []);

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

    case "sound":
      return (
        <select value={String(value)} onChange={(e) => patch({ [field.key]: e.target.value })}>
          {SOUNDS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      );

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
          {cur && !known && <option value={cur}>{cur} (not in engine/music)</option>}
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
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
      const x = typeof rec.x === "number" ? rec.x : 0;
      const y = typeof rec.y === "number" ? rec.y : 0;
      return (
        <div className="script-field-pos">
          <span className="pos-label">X</span>
          <NumberInput value={x} min={0} max={255} onChange={(n) => patch({ x: n }, true)} />
          <span className="pos-label">Y</span>
          <NumberInput value={y} min={0} max={255} onChange={(n) => patch({ y: n }, true)} />
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
                onPick: (px, py) => patch({ x: px, y: py }),
              })
            }
          >
            ⌖ Pick
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
      let spriteName: string | undefined;
      if (actorRef !== "self") {
        const npc =
          typeof actorRef === "number"
            ? npcs[actorRef]
            : npcs.find((n) => n.name === actorRef);
        spriteName = npc?.sprite ?? "player";
      }
      const sheet = spriteName ? spriteSheets.find((s) => s.name === spriteName) : undefined;
      const states = sheet?.states ?? [];
      if (actorRef === "self" || states.length === 0) {
        return (
          <input
            value={String(value ?? "")}
            placeholder={states.length === 0 ? "(sprite has no authored states)" : "state name"}
            onChange={(e) => patch({ [field.key]: e.target.value }, true)}
          />
        );
      }
      const cur = String(value ?? "");
      const found = states.some((st) => st.name === cur);
      return (
        <select
          className={!found ? "select-invalid" : undefined}
          value={cur}
          onChange={(e) => patch({ [field.key]: e.target.value })}
        >
          {!found && <option value={cur}>{cur ? `${cur} (missing!)` : "Choose a state…"}</option>}
          {states.map((st) => (
            <option key={st.name} value={st.name}>
              {st.name}
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
