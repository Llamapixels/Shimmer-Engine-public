import { useMemo } from "react";

import CommitInput from "../components/common/CommitInput";
import SearchSelect from "../components/common/SearchSelect";
import NumberInput from "../components/common/NumberInput";
import { playerSpriteName } from "../sprites/model";
import { useProjectStore } from "../state/projectStore";
import { ENGINE_BUTTONS, type EngineSettingDef, type EngineValue } from "./engineSettings";

const BUTTON_LABELS: Record<string, string> = {
  a: "A",
  b: "B",
  l: "L",
  r: "R",
  up: "Up",
  down: "Down",
  select: "Select",
};

/** A WAV from assets/sounds, or none. */
function SoundSelect({ value, onChange }: { value: string; onChange: (v: EngineValue) => void }) {
  const sounds = useProjectStore((s) => s.assets?.sounds ?? []);
  const names = sounds.map((a) => a.name);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">(none)</option>
      {value && !names.includes(value) && <option value={value}>{value} (missing)</option>}
      {names.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
    </select>
  );
}

/** One of the (project's default) player sprite's animation states, or
 * Auto: the state named after the ability. */
/** Every sprite the player can be: the project's, each scene's Player
 * sprite, and any Set Player Sprite event's. */
function usePlayerSprites(): string[] {
  const project = useProjectStore((s) => s.project?.project);
  const scenes = useProjectStore((s) => s.project?.scenes);
  return useMemo(() => {
    const names = new Set<string>();
    if (project) names.add(playerSpriteName(project));
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (o.type === "player_set_sprite" && typeof o.sprite === "string" && o.sprite) names.add(o.sprite);
        for (const x of Object.values(o)) if (x && typeof x === "object") walk(x);
      }
    };
    for (const sc of scenes ?? []) {
      if (sc.data.player_sprite) names.add(sc.data.player_sprite);
      walk(sc.data);
    }
    walk(project?.customScripts);
    walk(project?.prefabs);
    return [...names];
  }, [project, scenes]);
}

function StateSelect({ anim, value, onChange }: { anim: string; value: string; onChange: (v: EngineValue) => void }) {
  const project = useProjectStore((s) => s.project?.project);
  const sprites = usePlayerSprites();
  // States are matched by name on whichever sprite the player has then.
  const groups = sprites.map((sprite) => {
    const sheet = project?.spriteSheets?.find((s) => s.name === sprite);
    return { sprite, names: (sheet?.states ?? [{ name: "" }]).map((st) => st.name || "Default") };
  });
  const options = [
    { value: "", label: `Auto (${anim})` },
    ...groups.flatMap((g) => g.names.map((n) => ({ value: n, label: n, group: groups.length > 1 ? g.sprite : undefined }))),
  ];
  // Matched by name, any case: show the listed spelling as current.
  const shown = options.find((o) => o.value.toLowerCase() === value.toLowerCase())?.value ?? value;
  return (
    <SearchSelect
      value={shown}
      options={options}
      onChange={(v) => onChange(v)}
      missingLabel={`${value} (missing)`}
      title="States of every sprite the player can be (matched by name)"
      placeholder="Search states…"
    />
  );
}

/** A custom script from the Scripts list, or none. */
function ScriptSelect({ value, onChange }: { value: string; onChange: (v: EngineValue) => void }) {
  const scripts = useProjectStore((s) => s.project?.project.customScripts ?? []);
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">(none)</option>
      {value && !scripts.some((s) => s.id === value) && <option value={value}>(missing script)</option>}
      {scripts.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name || s.id}
        </option>
      ))}
    </select>
  );
}

/** The input for one engine setting, by its unit. */
export default function EngineValueInput({
  def,
  value,
  onChange,
}: {
  def: EngineSettingDef;
  value: EngineValue;
  onChange: (v: EngineValue) => void;
}) {
  switch (def.unit) {
    case "sound":
      return <SoundSelect value={String(value || "")} onChange={onChange} />;
    case "state":
      return <StateSelect anim={def.anim ?? ""} value={String(value || "")} onChange={onChange} />;
    case "script":
      return <ScriptSelect value={String(value || "")} onChange={onChange} />;
    case "bool":
      return (
        <label className="engine-bool">
          <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />
          {value ? "On" : "Off"}
        </label>
      );
    case "button":
      return (
        <select value={String(value)} onChange={(e) => onChange(e.target.value)}>
          {ENGINE_BUTTONS.map((b) => (
            <option key={b} value={b}>
              {BUTTON_LABELS[b] ?? b}
            </option>
          ))}
        </select>
      );
    case "choice":
      return (
        <select value={Number(value)} onChange={(e) => onChange(Number(e.target.value))}>
          {(def.options ?? []).map((o, i) => (
            <option key={o} value={i}>
              {o}
            </option>
          ))}
        </select>
      );
    case "speed":
    case "accel":
      return (
        <span className="engine-number">
          <CommitInput
            value={String(value)}
            onCommit={(v) => {
              const n = Number(v.trim());
              const lo = def.min ?? 0;
              const hi = def.max ?? 100;
              if (!v.trim() || !Number.isFinite(n) || n < lo || n > hi) return `A number from ${lo} to ${hi}.`;
              // What the engine can store: 1/256 px.
              onChange(Math.round(n * 256) / 256);
            }}
          />
          <span className="engine-unit">{def.unit === "speed" ? "px/frame" : "px/frame²"}</span>
        </span>
      );
    default:
      return (
        <span className="engine-number">
          <NumberInput value={Number(value)} min={def.min} max={def.max} onChange={onChange} />
          <span className="engine-unit">{def.unit === "frames" ? "frames" : def.unit === "pixels" ? "px" : ""}</span>
        </span>
      );
  }
}
