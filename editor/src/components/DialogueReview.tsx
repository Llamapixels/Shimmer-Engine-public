/*
 * Game World > Dialogue: every line of text in the project in one list,
 * to read through, jump to, and export / import as CSV for translation.
 */
import { useMemo, useRef, useState } from "react";

import type { RefKind } from "../script/scriptRefs";
import { sceneName } from "../state/projectStore";

import { collectDialogue, csvToTranslations, dialogueToCsv } from "../script/dialogueText";
import { useProjectStore } from "../state/projectStore";
import { useJumpTo } from "./UsedIn";
import "./DialogueReview.css";

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export default function DialogueReview() {
  const project = useProjectStore((s) => s.project)!;
  const setDialogueView = useProjectStore((s) => s.setDialogueView);
  const applyTranslations = useProjectStore((s) => s.applyDialogueTranslations);
  const showNotice = useProjectStore((s) => s.showNotice);
  const jumpTo = useJumpTo();
  const [query, setQuery] = useState("");
  const [replaceWith, setReplaceWith] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceRefs = useProjectStore((s) => s.replaceRefs);
  const [refKind, setRefKind] = useState<"variable" | "flag" | "item" | "actor">("variable");
  const [refScene, setRefScene] = useState(project.scenes[0]?.fileId ?? "");
  const [refFrom, setRefFrom] = useState("");
  const [refTo, setRefTo] = useState("");
  const refNames =
    refKind === "actor"
      ? (project.scenes.find((s) => s.fileId === refScene)?.data.npcs ?? []).map((n) => n.name ?? "").filter(Boolean)
      : (refKind === "variable" ? project.project.variables : refKind === "flag" ? project.project.flags : project.project.items) ?? [];

  const lines = useMemo(
    () => collectDialogue(project.scenes, project.project.customScripts ?? [], project.project.prefabs ?? []),
    [project.scenes, project.project.customScripts, project.project.prefabs],
  );
  const q = query.trim().toLowerCase();
  const shown = q ? lines.filter((l) => l.text.toLowerCase().includes(q) || l.place.label.toLowerCase().includes(q)) : lines;
  const totalWords = lines.reduce((n, l) => n + words(l.text), 0);

  const exportCsv = () => {
    const blob = new Blob([dialogueToCsv(lines)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${project.project.name || "dialogue"} dialogue.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /** Replace the search text (exactly as typed) in every line it's in. */
  const replaceText = () => {
    const find = query;
    if (!find) return;
    const rows = lines
      .filter((l) => l.text.includes(find))
      .map((l) => ({ container: l.container, original: l.text, text: l.text.split(find).join(replaceWith) }));
    if (!rows.length) {
      showNotice(`"${find}" isn't in any line (Replace matches capitals exactly).`);
      return;
    }
    const { applied } = applyTranslations(rows);
    showNotice(`Replaced "${find}" in ${applied} line${applied === 1 ? "" : "s"} (Edit > Undo puts them back).`);
  };

  const replaceUses = () => {
    if (!refFrom || !refTo || refFrom === refTo) return;
    const n = replaceRefs(refKind as RefKind, refFrom, refTo, refKind === "actor" ? refScene : undefined);
    showNotice(
      n ? `Every use of ${refFrom} now uses ${refTo} (${n} script group${n === 1 ? "" : "s"} changed; Edit > Undo puts them back).`
        : `Nothing uses ${refFrom}${refKind === "actor" ? " in that scene" : ""}.`,
    );
  };

  const importCsv = async (file: File) => {
    const rows = csvToTranslations(await file.text());
    if (typeof rows === "string") {
      window.alert(rows);
      return;
    }
    if (!rows.length) {
      window.alert('No translations found: fill in the "translation" column, then import it again.');
      return;
    }
    const { applied, unmatched } = applyTranslations(rows);
    showNotice(
      `Replaced ${applied} line${applied === 1 ? "" : "s"}` +
        (unmatched ? `; ${unmatched} didn't match (their original text changed since the export)` : ""),
    );
  };

  return (
    <div className="dialogue-review">
      <div className="world-map-bar">
        <button className="btn btn-small" onClick={() => setDialogueView(false)} title="Back to editing the selected scene">
          ← Scene view
        </button>
        <input
          className="dialogue-search"
          placeholder="Search text or place…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <input
          className="dialogue-search dialogue-replace"
          placeholder="Replace with…"
          value={replaceWith}
          onChange={(e) => setReplaceWith(e.target.value)}
        />
        <button className="btn btn-small" disabled={!query} onClick={replaceText} title="Replace the search text in every line it's in (capitals must match)">
          Replace all
        </button>
        <span className="dialogue-count">
          {q ? `${shown.length} of ${lines.length}` : lines.length} lines · {totalWords} words
        </span>
        <span className="dialogue-spacer" />
        <button
          className="btn btn-small"
          onClick={exportCsv}
          disabled={!lines.length}
          title='A spreadsheet of every line with an empty "translation" column to fill in'
        >
          Export CSV
        </button>
        <button
          className="btn btn-small"
          onClick={() => fileRef.current?.click()}
          title='Replace each line with its "translation" column (Edit > Undo puts them back)'
        >
          Import CSV
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void importCsv(f);
          }}
        />
      </div>
      <div className="world-map-bar dialogue-refs">
        <span className="dialogue-kind">Replace uses of</span>
        <select value={refKind} onChange={(e) => { setRefKind(e.target.value as typeof refKind); setRefFrom(""); setRefTo(""); }}>
          <option value="variable">Variable</option>
          <option value="flag">Flag</option>
          <option value="item">Item</option>
          <option value="actor">Actor (named, in a scene)</option>
        </select>
        {refKind === "actor" && (
          <select value={refScene} onChange={(e) => { setRefScene(e.target.value); setRefFrom(""); setRefTo(""); }}>
            {project.scenes.map((s) => (
              <option key={s.fileId} value={s.fileId}>
                {sceneName(s)}
              </option>
            ))}
          </select>
        )}
        <select value={refFrom} onChange={(e) => setRefFrom(e.target.value)}>
          <option value="">Choose…</option>
          {refNames.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <span className="dialogue-kind">with</span>
        <select value={refTo} onChange={(e) => setRefTo(e.target.value)}>
          <option value="">Choose…</option>
          {refNames.filter((n) => n !== refFrom).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button className="btn btn-small" disabled={!refFrom || !refTo} onClick={replaceUses} title="Every event that uses the first one will use the second instead">
          Replace
        </button>
      </div>
      <div className="dialogue-list">
        {lines.length === 0 && <p className="dialogue-empty">No text yet. Display Text, choices and menus show up here.</p>}
        {shown.map((l, i) => (
          <div key={i} className="dialogue-row">
            <div className="dialogue-where">
              <button className="link-btn" onClick={() => jumpTo(l.place)} title="Go there">
                {l.place.label}
              </button>
              <span className="dialogue-kind">{l.kind}</span>
            </div>
            <div className="dialogue-text">{l.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
