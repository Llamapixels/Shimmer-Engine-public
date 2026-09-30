import CommitInput from "../components/common/CommitInput";
import NumberInput from "../components/common/NumberInput";
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
