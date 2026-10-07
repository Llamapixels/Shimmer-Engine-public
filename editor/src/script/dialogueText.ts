/**
 * Every piece of player-facing text in the project (Display Text, choices,
 * menus, screen text), for the Dialogue view: proofreading, and CSV export
 * / import for translation. Import matches each row on its original text
 * within the same scene or custom script, so it still lands right after
 * events have been moved around.
 */

import type { EventScript, ScriptEventJSON } from "../../shared/eventTypes";
import type { CustomScriptJSON, SceneRecord } from "../../shared/projectTypes";
import { labeledScripts, mapAllSceneEvents, type RefPlace } from "./scriptRefs";
import { mapEvents, walkEvents } from "./scriptTree";

export interface DialogueLine {
  /** "scene:<fileId>" or "script:<id>" - where import looks for it. */
  container: string;
  place: Omit<RefPlace, "count">;
  kind: string;
  text: string;
}

/** The texts one event shows, in order. */
function textSlots(ev: ScriptEventJSON): { kind: string; text: string }[] {
  if (ev.type === "text") return [{ kind: "Text", text: ev.text }];
  if (ev.type === "choice")
    return [{ kind: "Choice", text: ev.prompt }, ...ev.options.map((o) => ({ kind: "Choice option", text: o }))];
  if (ev.type === "menu") return ev.options.map((o) => ({ kind: "Menu option", text: o.label }));
  if (ev.type === "text_draw") return [{ kind: "Screen text", text: ev.text }];
  return [];
}

/** The same event with each text passed through fn. */
function mapTextSlots(ev: ScriptEventJSON, fn: (text: string) => string): ScriptEventJSON {
  if (ev.type === "text" || ev.type === "text_draw") {
    const t = fn(ev.text);
    return t === ev.text ? ev : { ...ev, text: t };
  }
  if (ev.type === "choice") {
    const prompt = fn(ev.prompt);
    const options = ev.options.map(fn) as [string, string];
    return prompt === ev.prompt && options.every((o, i) => o === ev.options[i]) ? ev : { ...ev, prompt, options };
  }
  if (ev.type === "menu") {
    const options = ev.options.map((o) => {
      const label = fn(o.label);
      return label === o.label ? o : { ...o, label };
    });
    return options.every((o, i) => o === ev.options[i]) ? ev : { ...ev, options };
  }
  return ev;
}

export function collectDialogue(scenes: SceneRecord[], customScripts: CustomScriptJSON[]): DialogueLine[] {
  const out: DialogueLine[] = [];
  const add = (container: string, place: DialogueLine["place"], script: EventScript | undefined) =>
    walkEvents(script, (ev) => {
      for (const s of textSlots(ev)) if (s.text.trim()) out.push({ container, place, ...s });
    });
  for (const rec of scenes) {
    const sceneLabel = rec.data.name || rec.fileId;
    for (const s of labeledScripts(rec.data))
      add(`scene:${rec.fileId}`, { label: `${sceneLabel} › ${s.label}`, sceneId: rec.fileId, target: s.target }, s.script);
  }
  for (const cs of customScripts)
    add(`script:${cs.id}`, { label: `Script "${cs.name}"`, sceneId: null, target: { kind: "customScript", id: cs.id } }, cs.script);
  return out;
}

export interface Translation {
  container: string;
  original: string;
  text: string;
}

/** Replace texts per `rows` (each used once, matched on container and
 * original text). Returns what changed and how many rows found no match. */
export function applyTranslations(
  scenes: SceneRecord[],
  customScripts: CustomScriptJSON[],
  rows: Translation[],
): { scenes: SceneRecord[]; customScripts: CustomScriptJSON[]; applied: number; unmatched: number } {
  const pending = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    if (r.text === r.original) continue;
    const byText = pending.get(r.container) ?? new Map<string, string[]>();
    pending.set(r.container, byText);
    byText.set(r.original, [...(byText.get(r.original) ?? []), r.text]);
  }
  let applied = 0;
  const swapIn = (container: string) => (ev: ScriptEventJSON) => {
    const byText = pending.get(container);
    if (!byText) return ev;
    return mapTextSlots(ev, (t) => {
      const q = byText.get(t);
      if (!q?.length) return t;
      applied += 1;
      return q.shift()!;
    });
  };
  const nextScenes = scenes.map((rec) => {
    const data = mapAllSceneEvents(rec.data, swapIn(`scene:${rec.fileId}`));
    return data === rec.data ? rec : { ...rec, data };
  });
  const nextScripts = customScripts.map((cs) => {
    const script = mapEvents(cs.script, swapIn(`script:${cs.id}`)) ?? cs.script;
    return script === cs.script ? cs : { ...cs, script };
  });
  let unmatched = 0;
  for (const byText of pending.values()) for (const q of byText.values()) unmatched += q.length;
  return { scenes: nextScenes, customScripts: nextScripts, applied, unmatched };
}

// ---------------------------------------------------------------------------
// CSV (RFC 4180: quoted fields, "" for a quote, new lines allowed inside)

const CSV_HEADER = ["id", "where", "type", "original", "translation"];

export function dialogueToCsv(lines: DialogueLine[]): string {
  const cell = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [CSV_HEADER, ...lines.map((l) => [l.container, l.place.label, l.kind, l.text, ""])];
  // The BOM makes Excel read it as UTF-8.
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function parseCsv(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = src.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** The translated rows of an exported CSV, or an error message. */
export function csvToTranslations(src: string): Translation[] | string {
  const rows = parseCsv(src);
  const head = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: string) => head.indexOf(name);
  const [id, orig, tr] = [col("id"), col("original"), col("translation")];
  if (id < 0 || orig < 0 || tr < 0)
    return 'This doesn\'t look like an exported dialogue file: it needs "id", "original" and "translation" columns.';
  return rows
    .slice(1)
    .filter((r) => (r[tr] ?? "") !== "")
    .map((r) => ({ container: r[id] ?? "", original: (r[orig] ?? "").replace(/\r\n/g, "\n"), text: r[tr].replace(/\r\n/g, "\n") }));
}
