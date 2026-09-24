import { useState } from "react";

import { useProjectStore } from "../state/projectStore";
import EngineValueInput from "./EngineValueInput";
import { ENGINE_MODES, type EngineValue, settingsForMode, settingValue, settingVisible } from "./engineSettings";
import "./engine.css";

/** Settings > Engine: every scene type's settings, like GB Studio's. */
export default function EngineSettingsCard() {
  const project = useProjectStore((s) => s.project)!;
  const updateProject = useProjectStore((s) => s.updateProject);
  const [mode, setMode] = useState("platform");
  const engine = project.project.engine ?? {};
  const used = new Set<string>(project.scenes.map((s) => s.data.type || "topdown"));

  const set = (key: string, value: EngineValue | undefined) =>
    updateProject(
      (p) => {
        const next = { ...(p.engine ?? {}) };
        if (value === undefined) delete next[key];
        else next[key] = value;
        return { ...p, engine: Object.keys(next).length ? next : undefined };
      },
      `engine:${key}`,
    );

  const defs = settingsForMode(mode);
  const changed = defs.filter((d) => engine[d.key] !== undefined).length;

  return (
    <div className="settings-card settings-card-wide">
      <h3>
        Engine
        <span>{changed ? `${changed} changed from default` : "all defaults"}</span>
      </h3>
      <p>
        How the player moves in each type of scene (pick a scene's type in its properties). A scene can also override any of these for
        itself. Settings marked GBA are extras Shimmer Engine adds.
      </p>
      <div className="seg engine-mode-tabs">
        {ENGINE_MODES.filter((m) => settingsForMode(m.id).some((d) => d.mode === m.id)).map((m) => (
          <button key={m.id} className={mode === m.id ? "seg-on" : ""} onClick={() => setMode(m.id)}>
            {m.label}
            {used.has(m.id) ? " •" : ""}
          </button>
        ))}
      </div>
      <EngineFields defs={defs} values={engine} onChange={set} />
    </div>
  );
}

/** Settings grouped as in engine_settings.json, hiding ones whose switch is off. */
export function EngineFields({
  defs,
  values,
  base,
  onChange,
}: {
  defs: ReturnType<typeof settingsForMode>;
  values: Record<string, EngineValue>;
  /** Values underneath these (the project's, when editing a scene's). */
  base?: Record<string, EngineValue>;
  onChange: (key: string, value: EngineValue | undefined) => void;
}) {
  const groups: string[] = [];
  for (const d of defs) if (!groups.includes(d.group)) groups.push(d.group);
  return (
    <div className="engine-groups">
      {groups.map((g) => (
        <div key={g} className="engine-group">
          <div className="engine-group-title">{g}</div>
          {defs
            .filter((d) => d.group === g && settingVisible(d, base, values))
            .map((d) => {
              const own = values[d.key] !== undefined;
              return (
                <div key={d.key} className="engine-row" title={d.desc}>
                  <span className="engine-label">
                    {d.label}
                    {d.extra && <span className="engine-badge">GBA</span>}
                  </span>
                  <EngineValueInput def={d} value={settingValue(d.key, base, values)} onChange={(v) => onChange(d.key, v)} />
                  <button
                    className="link-btn engine-reset"
                    style={{ visibility: own ? "visible" : "hidden" }}
                    title={base ? "Use the project's value" : "Back to the default"}
                    onClick={() => onChange(d.key, undefined)}
                  >
                    Reset
                  </button>
                  {d.desc && <span className="engine-desc">{d.desc}</span>}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}
