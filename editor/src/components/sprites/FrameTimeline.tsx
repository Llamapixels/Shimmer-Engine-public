import { useEffect, useRef, useState } from "react";

import type { SpriteFrameJSON, SpriteSheetJSON } from "../../../shared/projectTypes";
import { editFrames, useSpriteEditor } from "../../sprites/editorStore";
import { drawTiles, type SpriteImage } from "../../sprites/image";
import { animationName, cloneFrame, frame as newFrame, MAX_OBJS, mirrorTiles, tileSize } from "../../sprites/model";
import { frameCost } from "../../sprites/pack";
import { useCurrentSprite } from "./useCurrentSprite";

/** The selected animation's frames: select, add, duplicate, delete,
 * reorder (drag), copy/paste, mirror. */
export default function FrameTimeline() {
  const { img, sheet, state, animIndex, frames, frameIndex } = useCurrentSprite();
  const ed = useSpriteEditor();
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);

  if (!sheet || !state) return <div className="spr-pane spr-frames" />;
  const edit = (u: (f: SpriteFrameJSON[]) => SpriteFrameJSON[]) => editFrames(sheet, state.id, animIndex, u);
  const cur = frames[frameIndex];

  const add = () => {
    edit((f) => [...f.slice(0, frameIndex + 1), newFrame(), ...f.slice(frameIndex + 1)]);
    ed.set({ frameIndex: frames.length ? frameIndex + 1 : 0, tileIds: [] });
  };
  const duplicate = () => {
    if (!cur) return;
    edit((f) => [...f.slice(0, frameIndex + 1), cloneFrame(cur), ...f.slice(frameIndex + 1)]);
    ed.set({ frameIndex: frameIndex + 1, tileIds: [] });
  };
  const remove = () => {
    if (!cur) return;
    edit((f) => f.filter((_, i) => i !== frameIndex));
    ed.set({ frameIndex: Math.max(0, frameIndex - 1), tileIds: [] });
  };
  const mirror = () => {
    if (!cur) return;
    edit((f) => f.map((fr, i) => (i === frameIndex ? { ...fr, tiles: mirrorTiles(fr.tiles, sheet.canvasWidth, sheet.spriteMode) } : fr)));
  };
  const copy = () => cur && ed.set({ clipboard: { frames: [cloneFrame(cur)] } });
  const paste = () => {
    const src = ed.clipboard?.frames;
    if (!src?.length) return;
    edit((f) => [...f.slice(0, frameIndex + 1), ...src.map(cloneFrame), ...f.slice(frameIndex + 1)]);
    ed.set({ frameIndex: frames.length ? frameIndex + 1 : 0, tileIds: [] });
  };
  const move = (from: number, to: number) => {
    if (from === to || from + 1 === to) return;
    edit((f) => {
      const list = f.slice();
      const [item] = list.splice(from, 1);
      list.splice(to > from ? to - 1 : to, 0, item);
      return list;
    });
    ed.set({ frameIndex: to > from ? to - 1 : to, tileIds: [] });
  };

  return (
    <div className="spr-pane spr-frames">
      <div className="spr-pane-head">
        <span>Frames: {animationName(state.animationType, state.flipLeft, animIndex)}</span>
        <span className="spr-spacer" />
        <button className="spr-tool" onClick={add} title="Add an empty frame after this one" data-testid="frame-add">
          + Frame
        </button>
        <button className="spr-tool" onClick={duplicate} disabled={!cur} title="Duplicate this frame">
          Duplicate
        </button>
        <button className="spr-tool" onClick={mirror} disabled={!cur} title="Mirror this frame left-right">
          Mirror
        </button>
        <button className="spr-tool" onClick={copy} disabled={!cur} title="Copy this frame">
          Copy
        </button>
        <button className="spr-tool" onClick={paste} disabled={!ed.clipboard?.frames?.length} title="Paste frame(s) after this one">
          Paste
        </button>
        <button className="spr-tool spr-tool-danger" onClick={remove} disabled={!cur} title="Delete this frame">
          Delete
        </button>
      </div>
      <div className="spr-frames-strip" onDragOver={(e) => e.preventDefault()}>
        {frames.map((f, i) => (
          <div
            key={f.id}
            className={`spr-frame-cell${i === frameIndex ? " spr-frame-on" : ""}${dropAt === i && dragFrom !== null ? " spr-frame-drop" : ""}`}
            draggable
            onDragStart={(e) => {
              setDragFrom(i);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setDropAt(e.clientX < r.left + r.width / 2 ? i : i + 1);
            }}
            onDrop={(e) => {
              e.preventDefault();
              if (dragFrom !== null && dropAt !== null) move(dragFrom, dropAt);
              setDragFrom(null);
              setDropAt(null);
            }}
            onDragEnd={() => {
              setDragFrom(null);
              setDropAt(null);
            }}
            onClick={() => ed.set({ frameIndex: i, tileIds: [], playing: false })}
            data-testid={`frame-${i}`}
          >
            <FrameThumb img={img} sheet={sheet} frame={f} />
            <FrameBadge img={img} sheet={sheet} frame={f} index={i} />
          </div>
        ))}
        {dropAt === frames.length && dragFrom !== null && <div className="spr-frame-dropline" />}
        <button className="spr-frame-add" onClick={add} title="Add frame">
          +
        </button>
      </div>
    </div>
  );
}

function FrameThumb({ img, sheet, frame }: { img: SpriteImage | null; sheet: SpriteSheetJSON; frame: SpriteFrameJSON }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const size = 56;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, size, size);
    if (!img) return;
    // Fit the canvas plus any tiles hanging outside it.
    let x0 = 0;
    let y0 = 0;
    let x1 = sheet.canvasWidth;
    let y1 = sheet.canvasHeight;
    for (const t of frame.tiles) {
      const { w, h } = tileSize(t, sheet.spriteMode);
      x0 = Math.min(x0, t.x);
      y0 = Math.min(y0, t.y);
      x1 = Math.max(x1, t.x + w);
      y1 = Math.max(y1, t.y + h);
    }
    const s = Math.min((size - 4) / (x1 - x0), (size - 4) / (y1 - y0));
    const z = s >= 1 ? Math.floor(s) : s;
    const ox = (size - (x1 - x0) * z) / 2 - x0 * z;
    const oy = (size - (y1 - y0) * z) / 2 - y0 * z;
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.strokeRect(ox + 0.5, oy + 0.5, sheet.canvasWidth * z - 1, sheet.canvasHeight * z - 1);
    drawTiles(ctx, img, frame.tiles, sheet.spriteMode, ox, oy, z);
  }, [img, sheet, frame]);
  return <canvas ref={ref} width={size} height={size} className="spr-frame-thumb" />;
}

function FrameBadge({
  img,
  sheet,
  frame,
  index,
}: {
  img: SpriteImage | null;
  sheet: SpriteSheetJSON;
  frame: SpriteFrameJSON;
  index: number;
}) {
  const cost = img ? frameCost(img, frame.tiles, sheet.spriteMode) : null;
  const over = !!cost && cost.objs.length > MAX_OBJS;
  return (
    <div className="spr-frame-meta">
      <span>{index + 1}</span>
      {cost && (
        <span
          className={`spr-frame-cost${over ? " spr-over" : ""}`}
          title={`${cost.objs.length} hardware sprite(s), ${cost.vramTiles} VRAM tile(s)`}
        >
          {cost.objs.length} obj
        </span>
      )}
    </div>
  );
}
