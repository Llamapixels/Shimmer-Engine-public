import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CATEGORY_COLOR, CATEGORY_ORDER, EVENT_DEFS, type EventDef } from "./eventCatalog";

interface Props {
  /** The button the menu hangs off - used for positioning. */
  anchor: HTMLElement;
  onPick: (def: EventDef) => void;
  onClose: () => void;
}

const WIDTH = 300;
const MAX_HEIGHT = 420;

/** GB Studio-style "Add Event" popover: type to search, arrows + Enter
 * to pick, or browse by category. Rendered in a portal so the
 * properties panel's scroll area doesn't clip it. */
export default function AddEventMenu({ anchor, onPick, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight: number }>({ left: 0, top: 0, maxHeight: MAX_HEIGHT });
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CATEGORY_ORDER.flatMap((cat) => EVENT_DEFS.filter((d) => d.category === cat));
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
      .map((x) => x.d);
  }, [query]);

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

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastCat = "";
  const grouped = !query.trim();

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
          setActive((a) => Math.min(results.length - 1, a + 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setActive((a) => Math.max(0, a - 1));
        } else if (e.key === "Enter") {
          e.preventDefault();
          if (results[active]) onPick(results[active]);
        }
      }}
    >
      <input
        autoFocus
        className="add-event-search"
        placeholder="Search events…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="add-event-list" ref={listRef}>
        {results.length === 0 && <div className="add-event-empty">No events match "{query}".</div>}
        {results.map((d, i) => {
          const header = grouped && d.category !== lastCat ? d.category : null;
          lastCat = d.category;
          return (
            <div key={d.type}>
              {header && <div className="add-event-cat">{header}</div>}
              <button
                data-idx={i}
                className={`add-event-item${i === active ? " add-event-item-active" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(d)}
                title={d.description}
              >
                <span className="add-event-dot" style={{ background: CATEGORY_COLOR[d.category] }} />
                <span className="add-event-label">{d.label}</span>
              </button>
            </div>
          );
        })}
      </div>
      {results[active] && <div className="add-event-desc">{results[active].description}</div>}
    </div>,
    document.body,
  );
}
