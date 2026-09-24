import { useEffect, useState } from "react";

import { useSpriteEditor } from "../../sprites/editorStore";
import { MAX_OBJS } from "../../sprites/model";
import { frameCost } from "../../sprites/pack";
import { useProjectStore } from "../../state/projectStore";
import FrameTimeline from "../sprites/FrameTimeline";
import MetaspriteCanvas from "../sprites/MetaspriteCanvas";
import SpriteInspector from "../sprites/SpriteInspector";
import SpriteNavigator from "../sprites/SpriteNavigator";
import TilePalette from "../sprites/TilePalette";
import { useCurrentSprite } from "../sprites/useCurrentSprite";
import "../sprites/Sprites.css";

/** The Sprites section, laid out like GB Studio's: sprites + animations
 * on the left, the frame canvas with its tiles and frames below it in the
 * middle, settings on the right. */
export default function SpritesView() {
  const sprites = useProjectStore((s) => s.assets?.sprites);
  const project = useProjectStore((s) => s.project?.project);
  const refreshAssets = useProjectStore((s) => s.refreshAssets);
  const selected = useSpriteEditor((s) => s.sprite);
  const selectSprite = useSpriteEditor((s) => s.selectSprite);
  const [error, setError] = useState<string | null>(null);

  // Start on the player's sprite; drop a selection whose file went away.
  useEffect(() => {
    if (!sprites) return;
    if (!selected || !sprites.some((a) => a.name === selected)) {
      const player = project?.playerSprite || "player";
      selectSprite(sprites.find((a) => a.name === player)?.name ?? sprites[0]?.name ?? null);
    }
  }, [sprites, selected, project?.playerSprite, selectSprite]);

  // Pick up PNGs edited in another program when the window comes back.
  useEffect(() => {
    const onFocus = () => void refreshAssets();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshAssets]);

  return (
    <div className="spr-view" data-testid="sprites-view">
      <SpriteNavigator onError={setError} />
      <div className="spr-center">
        {error && (
          <div className="spr-error">
            <span>{error}</span>
            <button className="btn btn-small" onClick={() => setError(null)}>
              Dismiss
            </button>
          </div>
        )}
        <CanvasToolbar />
        <MetaspriteCanvas />
        <TilePalette />
        <FrameTimeline />
      </div>
      <SpriteInspector onError={setError} />
    </div>
  );
}

function CanvasToolbar() {
  const ed = useSpriteEditor();
  const { img, sheet, frame, frames, frameIndex } = useCurrentSprite();
  const cost = img && frame && sheet ? frameCost(img, frame.tiles, sheet.spriteMode) : null;
  const toggle = (key: "showGrid" | "showBounds" | "onionSkin" | "showObjs" | "snap8", label: string, title: string) => (
    <button className={`spr-tool${ed[key] ? " spr-tool-on" : ""}`} onClick={() => ed.set({ [key]: !ed[key] })} title={title}>
      {label}
    </button>
  );
  return (
    <div className="spr-toolbar">
      <button
        className={`spr-tool${ed.playing ? " spr-tool-on" : ""}`}
        onClick={() => ed.set({ playing: !ed.playing, tileIds: [] })}
        disabled={frames.length < 2}
        title="Play the animation (Space)"
        data-testid="sprite-play"
      >
        {ed.playing ? "❚❚ Pause" : "▶ Play"}
      </button>
      <span className="spr-toolbar-sep" />
      {toggle("showGrid", "Grid", "Show the 8px grid")}
      {toggle("showBounds", "Bounds", "Show the actor's 16x16 tile and collision box")}
      {toggle("onionSkin", "Onion skin", "Show the previous frame faintly")}
      {toggle("showObjs", "Hardware", "Outline the GBA hardware sprites this frame becomes")}
      {toggle("snap8", "Snap 8px", "Place and drag tiles on the 8px grid (hold Alt to snap while dragging)")}
      <span className="spr-spacer" />
      {cost && (
        <span
          className={`spr-cost${cost.objs.length > MAX_OBJS ? " spr-over" : ""}`}
          title="GBA hardware this frame needs. A frame may use up to 32 hardware sprites; the GBA has 128 on screen in total."
          data-testid="frame-cost"
        >
          Frame {frameIndex + 1}/{frames.length} · {cost.objs.length} OBJ · {cost.vramTiles} tiles
        </span>
      )}
      <span className="spr-toolbar-sep" />
      <button className="spr-tool" onClick={() => ed.set({ zoom: Math.max(1, (ed.zoom || ed.fitZoom) - 1) })} title="Zoom out (Ctrl+wheel)">
        −
      </button>
      <button className="spr-tool" onClick={() => ed.set({ zoom: 0 })} title="Fit">
        {ed.zoom ? `${ed.zoom}x` : "Fit"}
      </button>
      <button className="spr-tool" onClick={() => ed.set({ zoom: Math.min(32, (ed.zoom || ed.fitZoom) + 1) })} title="Zoom in (Ctrl+wheel)">
        +
      </button>
    </div>
  );
}
