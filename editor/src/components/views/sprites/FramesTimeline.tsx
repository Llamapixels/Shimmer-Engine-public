/**
 * The FRAMES strip for tile-composed states - GB Studio's
 * SpriteAnimationTimeline / SpriteAnimationTimelineFrame (MIT): each frame
 * is a square card that renders the actual composed frame (MetaspriteCanvas
 * equivalent), the selected one highlighted, click selects, drag reorders,
 * + adds an empty frame after the current one, the clone button duplicates
 * the current frame, and each card has its own delete button.
 */
import { useEffect, useRef, useState } from "react";

import { tileHeightFor, type SpriteMode, type Tile } from "./metasprite";
import "./Metasprite.css";

/** Loads `url` into an HTMLImageElement (null until decoded). */
export function useLoadedImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    setImg(null);
    if (!url) return;
    let cancelled = false;
    const el = new Image();
    el.onload = () => {
      if (!cancelled) setImg(el);
    };
    el.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);
  return img;
}

/** Draws a composed frame's tiles into a cw x ch <canvas> (1 canvas px = 1
 * sprite px), scaled up with CSS to fit `box` px. */
export function MetaspriteThumb({
  img,
  tiles,
  cw,
  ch,
  mode,
  box,
}: {
  img: HTMLImageElement | null;
  tiles: Tile[];
  cw: number;
  ch: number;
  mode: SpriteMode;
  box: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const th = tileHeightFor(mode);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!img) return;
    ctx.imageSmoothingEnabled = false;
    for (const t of tiles) {
      const sx = t.sheetX * 8;
      const sy = t.sheetY * 8;
      const sh = Math.max(0, Math.min(th, img.height - sy));
      if (sh <= 0 || sx + 8 > img.width) continue;
      ctx.save();
      ctx.translate(t.x + (t.flipX ? 8 : 0), t.y + (t.flipY ? th : 0));
      ctx.scale(t.flipX ? -1 : 1, t.flipY ? -1 : 1);
      ctx.drawImage(img, sx, sy, 8, sh, 0, 0, 8, sh);
      ctx.restore();
    }
  }, [img, tiles, cw, ch, th]);
  const scale = Math.min(box / cw, box / ch);
  return (
    <canvas
      ref={ref}
      width={cw}
      height={ch}
      className="ms-thumb-canvas"
      style={{ width: cw * scale, height: ch * scale }}
    />
  );
}

export interface TimelineFrame {
  /** The frameRef (SpriteFrameJSON.id). */
  ref: string;
  tiles: Tile[];
}

export default function FramesTimeline({
  frames,
  img,
  cw,
  ch,
  mode,
  selected,
  readOnly,
  onSelect,
  onAdd,
  onClone,
  onDelete,
  onReorder,
}: {
  frames: TimelineFrame[];
  img: HTMLImageElement | null;
  cw: number;
  ch: number;
  mode: SpriteMode;
  selected: number;
  readOnly: boolean;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onClone: () => void;
  onDelete: (i: number) => void;
  onReorder: (from: number, to: number) => void;
}) {
  const dragIdx = useRef<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  return (
    <div className="sprites-frame-strip" data-testid="ms-frames">
      {frames.map((f, i) => (
        <div
          key={`${f.ref}:${i}`}
          className={`ms-frame-card${i === selected ? " ms-frame-card-selected" : ""}${dropIdx === i ? " ms-frame-card-drop" : ""}`}
          data-testid="ms-frame"
          title={f.ref}
          draggable={!readOnly}
          onDragStart={(e) => {
            dragIdx.current = i;
            e.dataTransfer.effectAllowed = "move";
          }}
          onDragOver={(e) => {
            if (dragIdx.current === null) return;
            e.preventDefault();
            setDropIdx(i);
          }}
          onDragLeave={() => setDropIdx((d) => (d === i ? null : d))}
          onDrop={(e) => {
            e.preventDefault();
            if (dragIdx.current !== null && dragIdx.current !== i) onReorder(dragIdx.current, i);
            dragIdx.current = null;
            setDropIdx(null);
          }}
          onDragEnd={() => {
            dragIdx.current = null;
            setDropIdx(null);
          }}
          onClick={() => onSelect(i)}
        >
          <MetaspriteThumb img={img} tiles={f.tiles} cw={cw} ch={ch} mode={mode} box={44} />
          <span className="ms-frame-index">{i}</span>
          {!readOnly && frames.length > 1 && (
            <button
              className="sprites-frame-delete-btn ms-frame-delete"
              title="Delete frame"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(i);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <>
          <button className="sprites-frame-add-btn" title="Add frame" data-testid="ms-add-frame" onClick={onAdd}>
            +
          </button>
          <button className="sprites-frame-add-btn ms-clone-btn" title="Clone current frame" data-testid="ms-clone-frame" onClick={onClone}>
            ⧉
          </button>
        </>
      )}
    </div>
  );
}
