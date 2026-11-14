import { useEffect, useRef } from "react";

import { useAssetUrl } from "../components/views/assetImages";
import { useSpriteImage } from "../sprites/image";
import { drawActor, sheetFor } from "../sprites/render";
import { animationFor } from "../sprites/model";
import { useProjectStore } from "../state/projectStore";

/**
 * Set Actor Frame: the actor's frames (its first state's animation facing
 * down) side by side, the chosen one outlined; click one to pick it.
 */
export default function FramePreview({
  sprite,
  frame,
  onPick,
}: {
  sprite: string | undefined;
  /** The frame picked, or null when it comes from a variable. */
  frame: number | null;
  onPick: (frame: number) => void;
}) {
  const project = useProjectStore((s) => s.project?.project);
  const assets = useProjectStore((s) => s.assets);
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const asset = (assets?.sprites ?? []).find((a) => a.name === sprite) ?? null;
  const url = useAssetUrl(rootPath, asset);
  const img = useSpriteImage(url);
  const sheet = project && img && sprite ? sheetFor(project, sprite, img) : null;
  const state = sheet?.states[0];
  const count = state ? Math.max(1, animationFor(state, "down", false).anim?.frames.length ?? 1) : 0;
  const cell = sheet ? Math.max(sheet.canvasWidth, sheet.canvasHeight, 16) : 16;
  const scale = cell <= 32 ? 2 : 1;
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c || !img || !sheet) return;
    const size = cell * scale;
    c.width = Math.max(1, count) * (size + 4);
    c.height = size + 4;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < count; i++) {
      const ox = i * (size + 4) + 2;
      // drawActor places the 16x16 footprint; centre the whole canvas in the cell.
      const fx = ox + (size - 16 * scale) / 2 - ((sheet.canvasWidth - 16) / 2) * 0;
      const fy = 2 + size - 16 * scale;
      drawActor(ctx, img, sheet, "down", fx, fy, scale, { frame: i });
      if (frame === i) {
        ctx.strokeStyle = "#ffd23f";
        ctx.lineWidth = 2;
        ctx.strokeRect(ox - 1, 1, size + 2, size + 2);
      }
    }
  }, [img, sheet, count, cell, scale, frame]);

  if (!sprite) return null;
  if (!img || !sheet) return <span className="frame-preview-empty">Loading {sprite}…</span>;
  return (
    <div className="frame-preview" title="The actor's frames (first state, facing down). Click one to pick it.">
      <canvas
        ref={ref}
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.floor((e.clientX - r.left) / (cell * scale + 4));
          if (i >= 0 && i < count) onPick(i);
        }}
      />
      {frame !== null && frame >= count && <span className="frame-preview-empty">Frame {frame} is past the last one ({count - 1}).</span>}
    </div>
  );
}
