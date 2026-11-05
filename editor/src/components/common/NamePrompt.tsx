import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import "./PopoverMenu.css";

/**
 * A small "type a name" box at a screen point (Electron has no
 * window.prompt). Enter or OK confirms, Escape or clicking away cancels.
 */
export default function NamePrompt({
  at,
  title,
  initial = "",
  onDone,
  onClose,
}: {
  at: { x: number; y: number };
  title: string;
  initial?: string;
  onDone: (name: string) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", down);
    return () => window.removeEventListener("mousedown", down);
  }, [onClose]);
  const ok = () => {
    const n = name.trim();
    if (!n) return;
    onDone(n);
    onClose();
  };
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 248));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - 90));
  return createPortal(
    <div ref={ref} className="name-prompt" style={{ left, top }}>
      <div className="name-prompt-title">{title}</div>
      <div className="name-prompt-row">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ok();
            else if (e.key === "Escape") onClose();
          }}
        />
        <button className="btn btn-small btn-primary" onClick={ok} disabled={!name.trim()}>
          OK
        </button>
      </div>
    </div>,
    document.body,
  );
}
