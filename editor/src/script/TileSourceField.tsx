import { useEffect, useRef, useState } from "react";

import { backgroundRefFor } from "../components/common/AssetSelect";
import { useAssetUrl } from "../components/views/assetImages";
import { useProjectStore } from "../state/projectStore";

/**
 * Replace Tile's "Copy from": which background (this scene's or another)
 * and a small picture of it to click the tile on.
 */
export default function TileSourceField({
  sceneBackground,
  background,
  x,
  y,
  onChange,
}: {
  /** This scene's background ref (scene JSON "background"). */
  sceneBackground: string | undefined;
  /** The other background's ref, or undefined for this scene's. */
  background: string | undefined;
  x: number;
  y: number;
  onChange: (patch: { source_background?: string; sourceX?: number; sourceY?: number }) => void;
}) {
  const assets = useProjectStore((s) => s.assets);
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const list = assets?.backgrounds ?? [];
  const ref = background || sceneBackground;
  const asset = list.find((a) => backgroundRefFor(a.relPath) === ref) ?? null;
  const url = useAssetUrl(rootPath, asset);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setImg(null);
    if (!url) return;
    const im = new Image();
    im.onload = () => setImg(im);
    im.src = url;
  }, [url]);

  // Small maps shown twice the size; big ones as they are (it scrolls).
  const zoom = img && img.width <= 160 ? 2 : 1;
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !img) return;
    c.width = img.width * zoom;
    c.height = img.height * zoom;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(img, 0, 0, c.width, c.height);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.beginPath();
    for (let gx = 8; gx < img.width; gx += 8) {
      ctx.moveTo(gx * zoom + 0.5, 0);
      ctx.lineTo(gx * zoom + 0.5, c.height);
    }
    for (let gy = 8; gy < img.height; gy += 8) {
      ctx.moveTo(0, gy * zoom + 0.5);
      ctx.lineTo(c.width, gy * zoom + 0.5);
    }
    ctx.stroke();
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 2;
    ctx.strokeRect(x * 8 * zoom + 1, y * 8 * zoom + 1, 8 * zoom - 2, 8 * zoom - 2);
  }, [img, zoom, x, y]);

  // Keep the picked tile in view when it's picked from the number boxes.
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const b = boxRef.current;
    if (!b || !img) return;
    const px = x * 8 * zoom, py = y * 8 * zoom;
    if (px < b.scrollLeft || px > b.scrollLeft + b.clientWidth - 16) b.scrollLeft = px - b.clientWidth / 2;
    if (py < b.scrollTop || py > b.scrollTop + b.clientHeight - 16) b.scrollTop = py - b.clientHeight / 2;
  }, [img, zoom, x, y]);

  return (
    <div className="tile-source">
      <select
        value={background ?? ""}
        onChange={(e) => onChange({ source_background: e.target.value || undefined })}
        title="Copy the tile from this scene's background, or from another one (its tile is added to this scene's tiles)"
      >
        <option value="">This scene's background</option>
        {list
          .filter((a) => backgroundRefFor(a.relPath) !== sceneBackground)
          .map((a) => (
            <option key={a.relPath} value={backgroundRefFor(a.relPath)}>
              {a.fileName.replace(/\.png$/i, "")}
            </option>
          ))}
      </select>
      <div ref={boxRef} className="tile-source-pic" title="Click the tile to copy">
        {img ? (
          <canvas
            ref={canvasRef}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const tx = Math.floor((e.clientX - r.left) / (8 * zoom));
              const ty = Math.floor((e.clientY - r.top) / (8 * zoom));
              onChange({ sourceX: Math.max(0, tx), sourceY: Math.max(0, ty) });
            }}
          />
        ) : (
          <span className="tile-source-empty">{ref ? "Loading…" : "No background"}</span>
        )}
      </div>
    </div>
  );
}
