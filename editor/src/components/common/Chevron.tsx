/**
 * A clear expand/collapse arrow, drawn as a stroked SVG so it stays bold
 * and readable at any font size (the ▾/▸ text glyphs render tiny).
 * Points right when closed, down when open. Uses currentColor.
 */
export default function Chevron({ open, size = 12, className }: { open: boolean; size?: number; className?: string }) {
  return (
    <svg
      className={`chevron${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 12 12"
      aria-hidden
      style={{ transform: open ? "rotate(90deg)" : undefined, transition: "transform 0.1s ease", flex: "none" }}
    >
      <path d="M4 1.5 8.5 6 4 10.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
