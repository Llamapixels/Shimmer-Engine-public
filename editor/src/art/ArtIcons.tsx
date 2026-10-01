import type { ArtTool } from "./artStore";

/** Tool icons for the Art Editor: 20x20 line drawings in currentColor. */
const PATHS: Record<ArtTool | "swap" | "clear", string> = {
  pencil: "M4 16l1-4 8-8 3 3-8 8-4 1z M11 6l3 3",
  eraser: "M3 13l7-7 6 6-5 5H6z M7 17h10 M8 9l5 5",
  fill: "M4 9l6-6 6 6-6 6z M16 12c1 2 2 3 2 4a2 2 0 0 1-4 0c0-1 1-2 2-4z M4 9h12",
  line: "M4 16L16 4",
  rect: "M4 5h12v10H4z",
  ellipse: "M10 4c4 0 7 2.7 7 6s-3 6-7 6-7-2.7-7-6 3-6 7-6z",
  gradient: "M3 4h14v12H3z M6 4v12 M9.5 4v12 M13 4v12",
  shade: "M10 3a7 7 0 1 0 0 14z M10 3a7 7 0 0 1 0 14",
  stamp: "M7 3h6v5l-1 2h3v3H5v-3h3L7 8z M4 16h12",
  picker: "M13 3l4 4-2 2-4-4z M11 5l-7 7v3h3l7-7 M4 15l-1 2",
  select: "M3 3h3 M8 3h4 M14 3h3v3 M17 8v4 M17 14v3h-3 M12 17H8 M6 17H3v-3 M3 12V8 M3 6V3",
  move: "M10 2v16 M2 10h16 M10 2l-2.5 2.5 M10 2l2.5 2.5 M10 18l-2.5-2.5 M10 18l2.5-2.5 M2 10l2.5-2.5 M2 10l2.5 2.5 M18 10l-2.5-2.5 M18 10l-2.5 2.5",
  pan: "M7 10V5a1.3 1.3 0 0 1 2.6 0v4 M9.6 9V3.8a1.3 1.3 0 0 1 2.6 0V9 M12.2 9V5a1.3 1.3 0 0 1 2.6 0v6c0 4-2 6-5 6s-4.5-1.5-6-4l-1.3-2.3a1.2 1.2 0 0 1 2-1.3L7 12",
  swap: "M5 7h10l-3-3 M15 13H5l3 3",
  clear: "M4 4h12v12H4z M4 16L16 4",
};

export default function ArtIcon({ name, size = 20 }: { name: keyof typeof PATHS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden style={{ display: "block", margin: "auto" }}>
      <path d={PATHS[name]} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
