import { useEffect, useRef, useState } from "react";
import "./Tooltips.css";

/** Delay before a tooltip shows, like the system one. */
const SHOW_DELAY_MS = 450;
/** Gap between the cursor and the tooltip's bottom edge. */
const CURSOR_GAP = 14;
const EDGE = 6;

/**
 * App-wide hover tooltips, drawn just above the mouse cursor in the
 * editor's theme instead of the system tooltip (which appears below the
 * cursor and can't be moved). Works with plain `title` attributes: the
 * first hover moves an element's title into data-tip, so the system one
 * never shows, and every existing title in the app is picked up as-is.
 */
export default function Tooltips() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let mouse = { x: 0, y: 0 };

    const hide = () => {
      clearTimeout(timer);
      target = null;
      setTip(null);
    };

    const tipOf = (el: HTMLElement): string => {
      const title = el.getAttribute("title");
      if (title !== null) {
        if (title) el.dataset.tip = title;
        else delete el.dataset.tip;
        el.removeAttribute("title");
      }
      return el.dataset.tip ?? "";
    };

    const onOver = (e: MouseEvent) => {
      const el = (e.target as Element | null)?.closest?.("[title], [data-tip]") as HTMLElement | null;
      if (el === target) return;
      hide();
      if (!el) return;
      const text = tipOf(el);
      if (!text) return;
      target = el;
      timer = setTimeout(() => {
        if (target === el && el.isConnected) setTip({ text, ...mouse });
      }, SHOW_DELAY_MS);
    };

    const onMove = (e: MouseEvent) => {
      mouse = { x: e.clientX, y: e.clientY };
      setTip((t) => (t ? { ...t, ...mouse } : t));
    };

    window.addEventListener("mouseover", onOver, true);
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mousedown", hide, true);
    window.addEventListener("keydown", hide, true);
    window.addEventListener("wheel", hide, true);
    window.addEventListener("blur", hide);
    document.addEventListener("mouseleave", hide);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("mouseover", onOver, true);
      window.removeEventListener("mousemove", onMove, true);
      window.removeEventListener("mousedown", hide, true);
      window.removeEventListener("keydown", hide, true);
      window.removeEventListener("wheel", hide, true);
      window.removeEventListener("blur", hide);
      document.removeEventListener("mouseleave", hide);
    };
  }, []);

  // Centered above the cursor, kept inside the window (flipped below the
  // cursor only when there's no room above).
  useEffect(() => {
    const box = boxRef.current;
    if (!tip || !box) {
      setPos(null);
      return;
    }
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let left = tip.x - w / 2;
    left = Math.max(EDGE, Math.min(window.innerWidth - w - EDGE, left));
    let top = tip.y - CURSOR_GAP - h;
    if (top < EDGE) top = tip.y + CURSOR_GAP + 8;
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={boxRef}
      className="app-tooltip"
      role="tooltip"
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
    >
      {tip.text}
    </div>
  );
}
