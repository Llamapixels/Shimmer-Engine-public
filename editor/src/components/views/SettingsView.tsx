import { useState } from "react";

import { countRefs, type RefKind } from "../../script/scriptRefs";
import { sceneName, useProjectStore } from "../../state/projectStore";
import CommitInput from "../common/CommitInput";
import DialogueCard from "./DialogueCard";
import EngineSettingsCard from "../../engine/EngineSettingsCard";
import { NAMED_LIST_LIMIT, validateName, type NamedListKind } from "../common/NamedListSelect";
import "./views.css";

const LISTS: { kind: NamedListKind; refKind: RefKind; title: string; blurb: string }[] = [
  {
    kind: "flags",
    refKind: "flag",
    title: "Flags",
    blurb: "On/off switches saved with the game - e.g. met_elder, door_unlocked. Use Set Flag / If Flag events.",
  },
  {
    kind: "items",
    refKind: "item",
    title: "Items",
    blurb: "Things the player can hold - Give Item / If Has Item events. Names can have spaces.",
  },
  {
    kind: "variables",
    refKind: "variable",
    title: "Variables",
    blurb: "Whole numbers (-32768..32767) saved with the game - scores, counters. Show one in text with {name}.",
  },
];

export default function SettingsView() {
  const project = useProjectStore((s) => s.project)!;
  const updateProject = useProjectStore((s) => s.updateProject);
  const names = project.scenes.map(sceneName);

  return (
    <div className="view view-single">
      <div className="view-main">
        <div className="view-head">
          <div className="view-title">Settings</div>
        </div>
        <div className="view-scroll">
          <div className="settings-grid">
            <div className="settings-card">
              <h3>Project</h3>
              <label className="settings-field">
                Name
                <CommitInput
                  value={project.project.name}
                  onCommit={(v) => {
                    if (!v.trim()) return "Name can't be empty.";
                    updateProject((p) => ({ ...p, name: v.trim() }));
                  }}
                />
              </label>
              <label className="settings-field">
                Starting scene
                <select
                  className={!names.includes(project.project.start_scene) ? "select-invalid" : undefined}
                  value={project.project.start_scene}
                  onChange={(e) => updateProject((p) => ({ ...p, start_scene: e.target.value }))}
                >
                  {!names.includes(project.project.start_scene) && (
                    <option value={project.project.start_scene}>{project.project.start_scene || "Choose…"} (missing)</option>
                  )}
                  {names.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <p>
                Folder: <span style={{ userSelect: "text" }}>{project.rootPath}</span>
                <br />
                Build it from WSL with <code>./build.sh {relativeHint(project.rootPath)}</code>
              </p>
            </div>
            <DialogueCard />
            <EngineSettingsCard />
            {LISTS.map((l) => (
              <NameListCard key={l.kind} {...l} />
            ))}
            <NamesCard />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Names the player types (Enter Name): up to 4, saved with the game. */
function NamesCard() {
  const list = useProjectStore((s) => s.project?.project.names) ?? [];
  const updateProject = useProjectStore((s) => s.updateProject);
  const [draft, setDraft] = useState("");
  const ok = (n: string, others: string[]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n) && !others.includes(n);
  const add = () => {
    const n = draft.trim();
    if (!ok(n, list) || list.length >= 4) return;
    updateProject((p) => ({ ...p, names: [...(p.names ?? []), n] }));
    setDraft("");
  };
  return (
    <div className="settings-card">
      <h3>
        Names
        <span>{list.length} / 4</span>
      </h3>
      <p>
        Names the player types with the Enter Name event (the hero, a pet...), saved with the game. Show one in any text with{" "}
        <code>!N:name!</code> (Display Text's Insert &gt; Name).
      </p>
      {list.map((name, i) => (
        <div key={name} className="name-row">
          <CommitInput
            value={name}
            onCommit={(v) => {
              const n = v.trim();
              if (!ok(n, list.filter((x) => x !== name))) return "Letters, numbers and _ only, and not used twice.";
              updateProject((p) => ({ ...p, names: (p.names ?? []).map((x, j) => (j === i ? n : x)) }));
            }}
          />
          <button className="icon-btn" title="Remove" onClick={() => updateProject((p) => ({ ...p, names: (p.names ?? []).filter((x) => x !== name) }))}>
            ×
          </button>
        </div>
      ))}
      {list.length < 4 && (
        <div className="name-row">
          <input placeholder="New name… (e.g. hero)" value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} />
          <button className="btn btn-small" onClick={add} disabled={!ok(draft.trim(), list)}>
            Add
          </button>
        </div>
      )}
    </div>
  );
}

function relativeHint(rootPath: string): string {
  const norm = rootPath.replace(/\\/g, "/");
  const i = norm.lastIndexOf("/examples/");
  return i >= 0 ? norm.slice(i + 1) : "path/to/project";
}

function NameListCard({ kind, refKind, title, blurb }: (typeof LISTS)[number]) {
  const project = useProjectStore((s) => s.project)!;
  const updateProject = useProjectStore((s) => s.updateProject);
  const renameRef = useProjectStore((s) => s.renameRef);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = project.project[kind] ?? [];
  const sceneData = project.scenes.map((s) => s.data);

  const add = () => {
    const err = validateName(kind, draft, list);
    if (err) {
      setError(err);
      return;
    }
    updateProject((p) => ({ ...p, [kind]: [...(p[kind] ?? []), draft.trim()] }));
    setDraft("");
    setError(null);
  };

  return (
    <div className="settings-card">
      <h3>
        {title}
        <span>
          {list.length} / {NAMED_LIST_LIMIT[kind]}
        </span>
      </h3>
      <p>{blurb}</p>
      {list.map((name) => {
        const uses = countRefs(sceneData, refKind, name);
        return (
          <div key={name} className="name-row">
            <CommitInput
              value={name}
              onCommit={(v) => {
                const err = validateName(kind, v, list.filter((n) => n !== name));
                if (err) return err;
                renameRef(refKind, name, v.trim());
              }}
            />
            <span className="name-uses" title="Events that refer to it (renaming updates them all)">
              {uses} use{uses === 1 ? "" : "s"}
            </span>
            <button
              className="icon-btn"
              title="Remove"
              onClick={() => {
                if (uses && !window.confirm(`"${name}" is used by ${uses} event(s). Remove it anyway? Those events will stop building until fixed.`)) return;
                updateProject((p) => ({ ...p, [kind]: (p[kind] ?? []).filter((n) => n !== name) }));
              }}
            >
              ×
            </button>
          </div>
        );
      })}
      <div className="name-row">
        <input
          placeholder={`New ${refKind}…`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="btn btn-small" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
        {error && <span className="field-error">{error}</span>}
      </div>
    </div>
  );
}
