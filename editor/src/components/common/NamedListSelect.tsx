import { useState } from "react";

import { useProjectStore } from "../../state/projectStore";

export type NamedListKind = "flags" | "items" | "variables";

/** Flags and items are each packed as one bit in a uint32_t (SaveData.flags /
 * SaveData.inventory in engine/include/save.h) - that bitfield is a real,
 * fixed 32-slot ceiling, not a made-up number.
 *
 * Variables are a plain int16_t[] (SaveData.variables), so there's no
 * bitfield limit - GBA's 32KB battery-backed SRAM save has room for far
 * more than even this. The real ceiling comes from dialogue text
 * interpolation ("{name}" in a text event), which encodes a variable
 * reference as a 0x02 marker byte followed by one index byte
 * (dialogue.c's expand_marker()) - that byte addresses at most 256
 * variables. 256 is used here to match that, with margin to spare
 * before it'd ever bite. Keep in sync with MAX_VARIABLES in
 * engine/include/state.h and compiler/build_project.py. */
export const NAMED_LIST_LIMIT: Record<NamedListKind, number> = {
  flags: 32,
  items: 32,
  variables: 256,
};

const NOUN: Record<NamedListKind, string> = { flags: "flag", items: "item", variables: "variable" };

/** Variables can appear inside text as "{name}", so they're limited to
 * identifier characters (the compiler's {varname} regex). Flags/items
 * are only ever picked from a list, so any non-empty name works. */
export function validateName(kind: NamedListKind, name: string, existing: string[]): string | null {
  const n = name.trim();
  if (!n) return "Name can't be empty.";
  if (kind === "variables" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(n)) {
    return "Variable names can only use letters, digits and _ (and can't start with a digit).";
  }
  if (existing.includes(n)) return `There's already a ${NOUN[kind]} called "${n}".`;
  const limit = NAMED_LIST_LIMIT[kind];
  if (existing.length >= limit) return `The engine allows at most ${limit} ${kind}.`;
  return null;
}

interface Props {
  kind: NamedListKind;
  value: string;
  onChange: (name: string) => void;
  /** A custom script's inputs ("@name"), offered first. */
  extra?: string[];
}

const NEW = "\u0000new";

/** Pick a project-wide flag/item/variable, or create a new one inline
 * (it's added to project.json straight away, like GB Studio's own
 * "add variable" from inside an event). */
export default function NamedListSelect({ kind, value, onChange, extra = [] }: Props) {
  const list = useProjectStore((s) => s.project?.project[kind]) ?? [];
  const updateProject = useProjectStore((s) => s.updateProject);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const missing = value !== "" && !list.includes(value) && !extra.includes(value);

  const create = () => {
    const err = validateName(kind, draft, list);
    if (err) {
      setError(err);
      return;
    }
    const name = draft.trim();
    updateProject((p) => ({ ...p, [kind]: [...(p[kind] ?? []), name] }));
    onChange(name);
    setCreating(false);
    setDraft("");
    setError(null);
  };

  if (creating) {
    return (
      <div className="named-new">
        <div className="named-new-row">
          <input
            autoFocus
            placeholder={`New ${NOUN[kind]} name`}
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
              if (e.key === "Escape") {
                setCreating(false);
                setError(null);
              }
            }}
          />
          <button className="btn btn-primary btn-small" onClick={create}>
            Add
          </button>
          <button className="btn btn-small" onClick={() => setCreating(false)}>
            Cancel
          </button>
        </div>
        {error && <div className="field-error">{error}</div>}
      </div>
    );
  }

  return (
    <select
      className={missing || value === "" ? "select-invalid" : undefined}
      value={value}
      onChange={(e) => {
        if (e.target.value === NEW) {
          setCreating(true);
          return;
        }
        onChange(e.target.value);
      }}
    >
      {value === "" && <option value="">Choose a {NOUN[kind]}…</option>}
      {missing && <option value={value}>{value} (not in project!)</option>}
      {extra.map((n) => (
        <option key={n} value={n}>
          {n} (input)
        </option>
      ))}
      {list.map((n) => (
        <option key={n} value={n}>
          {n}
        </option>
      ))}
      <option value={NEW}>+ New {NOUN[kind]}…</option>
    </select>
  );
}
