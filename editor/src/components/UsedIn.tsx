/*
 * "Used in": every place a variable, flag, item or custom script is used,
 * each a link that selects it (GB Studio's variable uses list).
 */
import { useMemo, useState } from "react";

import { findRefs, type RefKind, type RefPlace } from "../script/scriptRefs";
import { useProjectStore } from "../state/projectStore";
import "./UsedIn.css";

export function useRefPlaces(kind: RefKind | "customScript", name: string) {
  const project = useProjectStore((s) => s.project);
  return useMemo(
    () => (project ? findRefs(project.scenes, project.project.customScripts ?? [], kind, name) : []),
    [project, kind, name],
  );
}

/** Select the scene, actor, trigger or custom script a place names. */
export function useJumpTo() {
  const setSection = useProjectStore((s) => s.setSection);
  const setWorldMap = useProjectStore((s) => s.setWorldMap);
  const setActiveScene = useProjectStore((s) => s.setActiveScene);
  const setSelection = useProjectStore((s) => s.setSelection);
  return (p: Pick<RefPlace, "sceneId" | "target">) => {
    setSection("world");
    setWorldMap(false);
    if (p.target.kind === "customScript") {
      setSelection({ kind: "customScript", id: p.target.id });
      return;
    }
    if (!p.sceneId) return;
    setActiveScene(p.sceneId);
    if (p.target.kind === "npc") setSelection({ kind: "npc", sceneId: p.sceneId, index: p.target.index });
    else if (p.target.kind === "door") setSelection({ kind: "door", sceneId: p.sceneId, index: p.target.index });
  };
}

/** The list itself. */
export function UsedInList({ kind, name }: { kind: RefKind | "customScript"; name: string }) {
  const places = useRefPlaces(kind, name);
  const jumpTo = useJumpTo();
  if (!places.length) return <div className="used-in-empty">Not used anywhere yet.</div>;
  return (
    <ul className="used-in-list">
      {places.map((p, i) => (
        <li key={i}>
          <button className="link-btn" onClick={() => jumpTo(p)}>
            {p.label}
          </button>
          {p.count > 1 && <span className="used-in-count">×{p.count}</span>}
        </li>
      ))}
    </ul>
  );
}

/** A small "N uses" toggle with the list under it. */
export default function UsedIn({ kind, name }: { kind: RefKind | "customScript"; name: string }) {
  const places = useRefPlaces(kind, name);
  const [open, setOpen] = useState(false);
  const total = places.reduce((n, p) => n + p.count, 0);
  return (
    <div className="used-in">
      <button className="link-btn used-in-toggle" onClick={() => setOpen(!open)} title="Where it's used">
        {total === 0 ? "unused" : `${total} use${total === 1 ? "" : "s"}`} {open ? "▴" : "▾"}
      </button>
      {open && <UsedInList kind={kind} name={name} />}
    </div>
  );
}
