import { useEffect, useRef, useState } from "react";

import { activeLayer, flattenDoc, frameRects, useArtStore } from "./artStore";
import type { Bitmap, Rect } from "./pixels";

/** Draw a bitmap (or a cell of it) into a canvas element, scaled to fit. */
function useBitmapCanvas(ref: React.RefObject<HTMLCanvasElement>, bmp: Bitmap | null, cell: Rect | null, size: number, deps: unknown[]) {
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !bmp) return;
    const src = cell ?? { x: 0, y: 0, w: bmp.width, h: bmp.height };
    const scale = Math.max(1, Math.floor(Math.min(size / src.w, size / src.h))) || 1;
    const fit = Math.min(size / src.w, size / src.h);
    const s = src.w * scale <= size && src.h * scale <= size ? scale : fit;
    cv.width = Math.max(1, Math.round(src.w * s));
    cv.height = Math.max(1, Math.round(src.h * s));
    const tmp = document.createElement("canvas");
    tmp.width = bmp.width;
    tmp.height = bmp.height;
    tmp.getContext("2d")!.putImageData(new ImageData(bmp.data, bmp.width, bmp.height), 0, 0);
    const g = cv.getContext("2d")!;
    g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, cv.width, cv.height);
    g.drawImage(tmp, src.x, src.y, src.w, src.h, 0, 0, cv.width, cv.height);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function LayerThumb({ bmp, version }: { bmp: Bitmap; version: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useBitmapCanvas(ref, bmp, null, 32, [bmp, version]);
  return <canvas ref={ref} className="art-thumb-canvas" />;
}

/** Layers, top layer first like every paint program. */
export function LayersPanel() {
  const doc = useArtStore((s) => s.doc);
  const st = useArtStore.getState();
  const [renaming, setRenaming] = useState<number | null>(null);
  if (!doc) return null;
  const order = doc.layers.map((l, i) => ({ l, i })).reverse();
  const active = activeLayer(doc);
  return (
    <div className="art-panel">
      <div className="art-panel-head">
        Layers
        <span className="art-panel-actions">
          <button className="icon-btn" title="New layer" onClick={() => st.addLayer()}>
            +
          </button>
          <button className="icon-btn" title="Duplicate layer" onClick={() => st.duplicateLayer()}>
            ⧉
          </button>
          <button className="icon-btn" title="Move layer up" disabled={doc.active >= doc.layers.length - 1} onClick={() => st.moveLayer(1)}>
            ↑
          </button>
          <button className="icon-btn" title="Move layer down" disabled={doc.active === 0} onClick={() => st.moveLayer(-1)}>
            ↓
          </button>
          <button className="icon-btn" title="Merge down" disabled={doc.active === 0} onClick={() => st.mergeDown()}>
            ⤓
          </button>
          <button className="icon-btn" title="Delete layer" disabled={doc.layers.length < 2} onClick={() => st.removeLayer()}>
            ×
          </button>
        </span>
      </div>
      <div className="art-layers">
        {order.map(({ l, i }) => (
          <div
            key={l.id}
            className={`art-layer${i === doc.active ? " art-layer-active" : ""}`}
            onClick={() => st.setActiveLayer(i)}
            onDoubleClick={() => setRenaming(i)}
          >
            <button
              className="art-layer-toggle"
              title={l.visible ? "Hide layer" : "Show layer"}
              onClick={(e) => {
                e.stopPropagation();
                st.updateLayer(i, { visible: !l.visible });
              }}
            >
              {l.visible ? "◉" : "○"}
            </button>
            <button
              className="art-layer-toggle"
              title={l.locked ? "Unlock layer" : "Lock layer (no drawing on it)"}
              onClick={(e) => {
                e.stopPropagation();
                st.updateLayer(i, { locked: !l.locked });
              }}
            >
              {l.locked ? "🔒" : "🔓"}
            </button>
            <LayerThumb bmp={l.image} version={doc.version} />
            {renaming === i ? (
              <input
                className="art-layer-rename"
                autoFocus
                defaultValue={l.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  st.updateLayer(i, { name: e.target.value.trim() || l.name });
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setRenaming(null);
                }}
              />
            ) : (
              <span className="art-layer-name" title="Double-click to rename">
                {l.name}
              </span>
            )}
          </div>
        ))}
      </div>
      <label className="art-opt art-layer-opacity" title="Opacity of the selected layer">
        Opacity
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(active.opacity * 100)}
          onChange={(e) => {
            // Live, one undo step per drag isn't worth the complexity here.
            const layers = doc.layers.map((l, k) => (k === doc.active ? { ...l, opacity: Number(e.target.value) / 100 } : l));
            st.set({ doc: { ...doc, layers, version: doc.version + 1 }, dirty: true });
          }}
        />
        <span className="art-opt-value">{Math.round(active.opacity * 100)}%</span>
      </label>
      {doc.layers.length > 1 && <p className="art-panel-note">Saving writes all visible layers merged into the PNG; the layers are kept for next time.</p>}
    </div>
  );
}

function FrameThumb({ flat, cell, version, active, index, onClick }: { flat: Bitmap; cell: Rect; version: number; active: boolean; index: number; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useBitmapCanvas(ref, flat, cell, 40, [flat, cell.x, cell.y, cell.w, cell.h, version]);
  return (
    <button className={`art-frame${active ? " art-frame-active" : ""}`} onClick={onClick} title={`Frame ${index + 1}`}>
      <canvas ref={ref} className="art-thumb-canvas" />
      <span className="art-frame-num">{index + 1}</span>
    </button>
  );
}

/** Frames: cut the sheet into cells, pick one, onion skin, play it back. */
export function FramesPanel() {
  const doc = useArtStore((s) => s.doc);
  const frame = useArtStore((s) => s.frame);
  const onion = useArtStore((s) => s.onion);
  const fps = useArtStore((s) => s.fps);
  const playing = useArtStore((s) => s.playing);
  const st = useArtStore.getState();
  const [fw, setFw] = useState(0);
  const [fh, setFh] = useState(0);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (doc) {
      setFw(doc.frameW || 16);
      setFh(doc.frameH || 16);
    }
  }, [doc?.asset.relPath, doc?.frameW, doc?.frameH]); // eslint-disable-line react-hooks/exhaustive-deps

  const frames = doc ? frameRects(doc) : [];
  const flat = doc && frames.length ? flattenDoc(doc) : null;

  // Playback.
  useEffect(() => {
    if (!playing || frames.length < 2) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000 / Math.max(1, fps));
    return () => clearInterval(t);
  }, [playing, fps, frames.length]);
  const shown = playing && frames.length ? tick % frames.length : Math.min(frame, frames.length - 1);
  useBitmapCanvas(previewRef, flat, frames[shown] ?? null, 96, [flat, shown, doc?.version]);

  if (!doc) return null;
  const valid = fw > 0 && fh > 0 && doc.width % fw === 0 && doc.height % fh === 0;
  return (
    <div className="art-panel">
      <div className="art-panel-head">Frames</div>
      <div className="art-frame-size">
        <label>
          W <input type="number" min={1} max={doc.width} value={fw} onChange={(e) => setFw(Number(e.target.value))} />
        </label>
        <label>
          H <input type="number" min={1} max={doc.height} value={fh} onChange={(e) => setFh(Number(e.target.value))} />
        </label>
        {doc.frameW ? (
          <>
            <button className="btn btn-small" disabled={!valid || (fw === doc.frameW && fh === doc.frameH)} onClick={() => st.setFrames(fw, fh)}>
              Apply
            </button>
            <button className="btn btn-small" onClick={() => st.setFrames(0, 0)} title="Treat the image as one picture">
              Off
            </button>
          </>
        ) : (
          <button className="btn btn-small" disabled={!valid} onClick={() => st.setFrames(fw, fh)} title="Cut the image into frames of this size">
            Use frames
          </button>
        )}
      </div>
      {!valid && <p className="art-panel-note">The image ({doc.width}×{doc.height}) must divide evenly into frames.</p>}
      {frames.length > 0 && flat && (
        <>
          <div className="art-preview">
            <canvas ref={previewRef} className="art-preview-canvas" />
            <div className="art-preview-controls">
              <button className="btn btn-small" onClick={() => st.set({ playing: !playing })}>
                {playing ? "❚❚ Pause" : "▶ Play"}
              </button>
              <label className="art-opt" title="Frames per second">
                <input type="number" min={1} max={60} value={fps} onChange={(e) => st.set({ fps: Math.max(1, Math.min(60, Number(e.target.value))) })} />
                fps
              </label>
              <label className="art-opt" title="Show the previous (red) and next (blue) frames faintly while drawing">
                <input type="checkbox" checked={onion} onChange={(e) => st.set({ onion: e.target.checked })} />
                Onion skin
              </label>
            </div>
          </div>
          <div className="art-frames">
            {frames.map((f, i) => (
              <FrameThumb key={i} flat={flat} cell={f} version={doc.version} index={i} active={i === frame} onClick={() => st.set({ frame: i, playing: false })} />
            ))}
          </div>
          <p className="art-panel-note">
            {frames.length} frames. Mirror drawing works inside the selected frame. , and . step through frames.
          </p>
        </>
      )}
    </div>
  );
}
