/*
 * Game World > Dialogue: every line of text in the project in one list,
 * to read through, jump to, and export / import as CSV for translation.
 */
import { useMemo, useRef, useState } from "react";

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
  const fileRef = useRef<HTMLInputElement>(null);

  const lines = useMemo(
    () => collectDialogue(project.scenes, project.project.customScripts ?? []),
    [project.scenes, project.project.customScripts],
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
