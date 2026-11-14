import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import "./PopoverMenu.css";

export interface SearchOption {
  value: string;
  label: string;
  /** Options with the same group are listed under its name. */
  group?: string;
  /** Extra words the search matches (not shown). */
  keywords?: string;
}

interface Props {
  value: string;
  options: SearchOption[];
  onChange: (value: string) => void;
  /** Shown on the button when the value isn't one of the options. */
  missingLabel?: string;
  /** A picture beside each option (and the current one), e.g. a sprite. */
  renderIcon?: (option: SearchOption) => ReactNode;
  title?: string;
  placeholder?: string;
}

/**
 * A dropdown you can type into: long lists (actors, sprites, animation
 * states) filter as you type; arrow keys and Enter pick.
 */
export default function SearchSelect({ value, options, onChange, missingLabel, renderIcon, title, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const current = options.find((o) => o.value === value);
  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className={`search-select-btn${current ? "" : " select-invalid"}`}
        onClick={() => setOpen((v) => !v)}
        title={title}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current && renderIcon && <span className="search-select-icon">{renderIcon(current)}</span>}
        <span className="search-select-label">{current ? current.label : (missingLabel ?? value)}</span>
      </button>
      {open && btnRef.current && (
        <SearchPopover
          anchor={btnRef.current}
          options={options}
          value={value}
          renderIcon={renderIcon}
          placeholder={placeholder}
          onPick={(v) => {
            setOpen(false);
            if (v !== value) onChange(v);
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function SearchPopover({
  anchor,
  options,
  value,
  renderIcon,
  placeholder,
  onPick,
  onClose,
}: {
  anchor: HTMLElement;
  options: SearchOption[];
  value: string;
  renderIcon?: (o: SearchOption) => ReactNode;
  placeholder?: string;
  onPick: (v: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ left: 0, top: 0, width: 240 });

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => `${o.label} ${o.group ?? ""} ${o.keywords ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  useEffect(() => setActive(0), [query]);

  useLayoutEffect(() => {
    const r = anchor.getBoundingClientRect();
    const width = Math.max(r.width, 240);
    const h = ref.current?.offsetHeight ?? 320;
    let top = r.bottom + 3;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 3);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({ left, top, width });
  }, [anchor, shown.length]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [anchor, onClose]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(shown.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (shown[active]) onPick(shown[active].value);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  let lastGroup: string | undefined;
  return createPortal(
    <div ref={ref} className="popover-menu search-select-pop" style={{ left: pos.left, top: pos.top, width: pos.width }} role="listbox">
      <input
        className="search-select-input"
        autoFocus
        value={query}
        placeholder={placeholder ?? "Type to search…"}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKey}
      />
      <div ref={listRef} className="search-select-list">
        {shown.length === 0 && <div className="search-select-empty">Nothing matches</div>}
        {shown.map((o, i) => {
          const head = o.group && o.group !== lastGroup ? o.group : null;
          lastGroup = o.group;
          return (
            <div key={`${o.group ?? ""}/${o.value}/${i}`}>
              {head && <div className="search-select-group">{head}</div>}
              <button
                type="button"
                data-idx={i}
                role="option"
                aria-selected={o.value === value}
                className={`search-select-item${i === active ? " search-select-item-active" : ""}${o.value === value ? " search-select-item-on" : ""}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => onPick(o.value)}
              >
                {renderIcon && <span className="search-select-icon">{renderIcon(o)}</span>}
                <span className="search-select-label">{o.label}</span>
              </button>
            </div>
          );
        })}
      </div>
    </div>,
    document.body,
  );
}
