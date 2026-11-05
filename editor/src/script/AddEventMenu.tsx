import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CATEGORY_COLOR, CATEGORY_ORDER, EVENT_DEFS, type EventCategory, type EventDef } from "./eventCatalog";
import type { ScriptEventJSON } from "../../shared/eventTypes";
import type { SnippetJSON } from "../../shared/projectTypes";
import { useProjectStore } from "../state/projectStore";
import { cloneEvent } from "./scriptTree";
import { EVENT_TEMPLATES, type EventTemplate } from "./eventTemplates";
import { sceneName } from "../state/projectStore";

interface Props {
  /** The button the menu hangs off - used for positioning. */
  anchor: HTMLElement;
  onPick: (def: EventDef) => void;
  /** A snippet was picked: its events (fresh copies) to insert. */
  onPickEvents?: (events: ScriptEventJSON[]) => void;
  onClose: () => void;
}

const WIDTH = 300;
const MAX_HEIGHT = 420;

/** GB Studio-style "Add Event" popover: type to search, or pick a
 * category and then an event (arrows + Enter, Left / Backspace goes back).
 * Rendered in a portal so the properties panel's scroll area doesn't
 * clip it. */

type Row =
  | { kind: "cat"; cat: EventCategory | typeof SNIPPETS | typeof TEMPLATES; count: number }
  | { kind: "back" }
  | { kind: "event"; def: EventDef }
  | { kind: "snippet"; snippet: SnippetJSON }
  | { kind: "template"; template: EventTemplate };

/** The pseudo-categories: the project's saved snippets, and ready-made menus. */
const SNIPPETS = "Snippets";
const TEMPLATES = "Templates (menus)";

/** The category the menu was last left in, so adding several events
 * of one kind in a row doesn't mean clicking through each time. */
let lastCategory: EventCategory | typeof SNIPPETS | typeof TEMPLATES | null = null;
export default function AddEventMenu({ anchor, onPick, onPickEvents, onClose }: Props) {
  const snippets = useProjectStore((s) => s.project?.project.snippets) ?? [];
  const updateProject = useProjectStore((s) => s.updateProject);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EventCategory | typeof SNIPPETS | typeof TEMPLATES | null>(lastCategory === SNIPPETS && !snippets.length ? null : lastCategory);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number }>({ left: 0, top: 0, maxHeight: MAX_HEIGHT });
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const openCategory = (cat: EventCategory | typeof SNIPPETS | typeof TEMPLATES | null) => {
    lastCategory = cat;
    setCategory(cat);
  };

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      if (!category)
        return [
          ...(snippets.length && onPickEvents ? [{ kind: "cat", cat: SNIPPETS, count: snippets.length } as Row] : []),
          ...(onPickEvents ? [{ kind: "cat", cat: TEMPLATES, count: EVENT_TEMPLATES.length } as Row] : []),
          ...CATEGORY_ORDER.map((cat): Row => ({ kind: "cat", cat, count: EVENT_DEFS.filter((d) => d.category === cat).length })).filter(
            (r) => r.kind === "cat" && r.count > 0,
          ),
        ];
      if (category === SNIPPETS) return [{ kind: "back" }, ...snippets.map((snippet): Row => ({ kind: "snippet", snippet }))];
      if (category === TEMPLATES) return [{ kind: "back" }, ...EVENT_TEMPLATES.map((template): Row => ({ kind: "template", template }))];
      return [{ kind: "back" }, ...EVENT_DEFS.filter((d) => d.category === category).map((def): Row => ({ kind: "event", def }))];
    }
    const words = q.split(/\s+/);
    // Rank: every word in the label > label contains the phrase > type/
    // category > description-only. Best matches first (so Enter picks
    // what you typed), no category grouping while searching.
    const score = (d: EventDef) => {
      const label = d.label.toLowerCase();
      if (label === q) return 5;
      if (label.startsWith(q)) return 4;
      if (words.every((w) => label.includes(w))) return 3;
      if (d.type.includes(q.replace(/\s+/g, "_")) || d.category.toLowerCase().includes(q)) return 2;
      if (d.description.toLowerCase().includes(q)) return 1;
      return 0;
    };
    return EVENT_DEFS.map((d, i) => ({ d, s: score(d), i }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.i - b.i)
      .map((x): Row => ({ kind: "event", def: x.d }));
  }, [query, category, snippets, onPickEvents]);

  // Opening a category starts on its first event, not the Back row.
  useEffect(() => setActive(category && !query.trim() ? 1 : 0), [query, category]);

  const choose = (r: Row | undefined) => {
    if (!r) return;
    if (r.kind === "cat") openCategory(r.cat);
    else if (r.kind === "back") openCategory(null);
    else if (r.kind === "snippet") onPickEvents?.(r.snippet.events.map(cloneEvent));
    else if (r.kind === "template") {
      // Its variables first, so the events point at real ones.
      const want = r.template.variables;
      updateProject((p) => {
        const have = p.variables ?? [];
        const missing = want.filter((v) => !have.includes(v));
        return missing.length ? { ...p, variables: [...have, ...missing] } : p;
      });
      const scenes = useProjectStore.getState().project?.scenes ?? [];
      onPickEvents?.(r.template.build(scenes[0] ? sceneName(scenes[0]) : ""));
    }
    else onPick(r.def);
  };
  const activeRow = rows[active];

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom - 8;
    const spaceAbove = r.top - 8;
    const below = spaceBelow >= 240 || spaceBelow >= spaceAbove;
    const maxHeight = Math.min(MAX_HEIGHT, below ? spaceBelow : spaceAbove);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8));
    const top = below ? r.bottom + 4 : r.top - 4 - maxHeight;
    setPos({ left, top, maxHeight });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return createPortal(
    <div
      ref={rootRef}
      className="add-event-menu"
      style={{ left: pos.left, top: pos.top, width: WIDTH, maxHeight: pos.maxHeight }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        } else if (e.key === "ArrowDown") {
          e.preventDefault();
          setActive((a) => Math.min(rows.length - 1, a + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => Math.max(0, a - 1));
        } else if (e.key === "Enter" || (e.key === "ArrowRight" && activeRow?.kind === "cat")) {
          e.preventDefault();
          choose(activeRow);
        } else if ((e.key === "ArrowLeft" || (e.key === "Backspace" && !query)) && category && !query.trim()) {
          e.preventDefault();
          openCategory(null);
        }
      }}
    >
      <input
        autoFocus
        className="add-event-search"
        placeholder="Search all events…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="add-event-list" ref={listRef}>
        {rows.length === 0 && <div className="add-event-empty">No events match "{query}".</div>}
        {rows.map((r, i) => {
          const on = i === active ? " add-event-item-active" : "";
          if (r.kind === "back")
            return (
              <button key="back" data-idx={i} className={`add-event-item add-event-back${on}`} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                <span className="add-event-arrow">‹</span>
                <span className="add-event-label">{category}</span>
              </button>
            );
          if (r.kind === "template")
            return (
              <button
                key={r.template.id}
                data-idx={i}
                className={`add-event-item${on}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                title={r.template.description}
              >
                <span className="add-event-dot" style={{ background: "var(--accent)" }} />
                <span className="add-event-label">{r.template.name}</span>
              </button>
            );
          if (r.kind === "snippet")
            return (
              <button key={r.snippet.id} data-idx={i} className={`add-event-item${on}`} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                <span className="add-event-dot" style={{ background: "var(--accent)" }} />
                <span className="add-event-label">{r.snippet.name}</span>
                <span className="add-event-count">{r.snippet.events.length} event{r.snippet.events.length === 1 ? "" : "s"}</span>
                <span
                  className="add-event-remove"
                  title="Delete this snippet"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete the snippet "${r.snippet.name}"?`))
                      updateProject((p) => ({ ...p, snippets: (p.snippets ?? []).filter((s) => s.id !== r.snippet.id) }));
                  }}
                >
                  ×
                </span>
              </button>
            );
          if (r.kind === "cat")
            return (
              <button key={r.cat} data-idx={i} className={`add-event-item${on}`} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                <span className="add-event-dot" style={{ background: r.cat === SNIPPETS || r.cat === TEMPLATES ? "var(--accent)" : CATEGORY_COLOR[r.cat] }} />
                <span className="add-event-label">{r.cat}</span>
                <span className="add-event-count">{r.count}</span>
                <span className="add-event-arrow">›</span>
              </button>
            );
          return (
            <button
              key={r.def.type}
              data-idx={i}
              className={`add-event-item${on}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(r)}
              title={r.def.description}
            >
              <span className="add-event-dot" style={{ background: CATEGORY_COLOR[r.def.category] }} />
              <span className="add-event-label">{r.def.label}</span>
              {query.trim() && <span className="add-event-count">{r.def.category}</span>}
            </button>
          );
        })}
      </div>
      {activeRow?.kind === "event" && <div className="add-event-desc">{activeRow.def.description}</div>}
      {activeRow?.kind === "template" && <div className="add-event-desc">{activeRow.template.description}</div>}
    </div>,
    document.body,
  );
}
