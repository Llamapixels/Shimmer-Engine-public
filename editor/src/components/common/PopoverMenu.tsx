import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./PopoverMenu.css";

export type MenuItem =
  | { label: string; onClick: () => void; disabled?: boolean; danger?: boolean; shortcut?: string }
  | "separator";

interface Props {
  /** Either an element to hang the menu under, or a point (right-click). */
  anchor: HTMLElement | { x: number; y: number };
  items: MenuItem[];
  onClose: () => void;
}

const WIDTH = 210;

export default function PopoverMenu({ anchor, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    const h = el ? el.offsetHeight : 200;
    let left: number;
    let top: number;
    if (anchor instanceof HTMLElement) {
      const r = anchor.getBoundingClientRect();
      left = r.right - WIDTH;
      top = r.bottom + 4;
    } else {
      left = anchor.x;
      top = anchor.y;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - WIDTH - 8));
    if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - h - 8);
    setPos({ left, top });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div ref={ref} className="popover-menu" style={{ left: pos.left, top: pos.top, width: WIDTH }} role="menu">
      {items.map((item, i) =>
        item === "separator" ? (
          <div key={i} className="popover-sep" />
        ) : (
          <button
            key={i}
            role="menuitem"
            className={`popover-item${item.danger ? " popover-item-danger" : ""}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            <span>{item.label}</span>
            {item.shortcut && <span className="popover-shortcut">{item.shortcut}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}
