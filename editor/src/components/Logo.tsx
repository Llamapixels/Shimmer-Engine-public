import logoUrl from "../assets/logo.png";

/** The Shimmer Engine cat. Pixel art, so it's never smoothed when scaled. */
export default function Logo({ size, className }: { size: number; className?: string }) {
  return (
    <img
      src={logoUrl}
      alt="Shimmer Engine"
      className={className}
      width={size}
      height={Math.round((size * 111) / 130)}
      style={{ imageRendering: "pixelated", display: "block" }}
      draggable={false}
    />
  );
}
