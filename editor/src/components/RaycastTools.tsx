/*
 * The scene canvas's 3D tool (First Person 3D scenes): which layer it
 * paints and with what - a height, a wall texture, a floor / ceiling
 * colour - plus the wall textures' images.
 */

import { useEffect, useState } from "react";

import type { AssetListing } from "../../shared/ipc";
import type { SceneJSON } from "../../shared/projectTypes";
import { useProjectStore, type RcBrush, type RcLayer } from "../state/projectStore";
import { RC_LAYERS, sceneTextures } from "../world/paint";
import { bricksCanvas, RC_EYE, RC_HEADROOM, RC_LAYER_LABEL, RC_STEP } from "../world/raycastView";

export interface TextureImages {
  /** Every texture the project has: assets/textures, then the built-in
   * bricks (unless a file has that name). */
  names: string[];
  images: Record<string, CanvasImageSource>;
  urls: Record<string, string>;
}

let bricks: { canvas: HTMLCanvasElement; url: string } | null = null;

export function useTextureImages(rootPath: string | null, assets: AssetListing | null): TextureImages {
  const files = assets?.textures ?? [];
  const key = files.map((f) => `${f.name}:${f.mtimeMs}`).join("|");
  const [loaded, setLoaded] = useState<Record<string, { img: HTMLImageElement; url: string }>>({});
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    setLoaded({});
    for (const f of files)
      window.api
        .readAsset({ rootPath, relPath: f.relPath, base: "project" })
        .then((r) => {
          if (!r.ok || cancelled) return;
          const im = new Image();
          im.onload = () => !cancelled && setLoaded((s) => ({ ...s, [f.name]: { img: im, url: r.value.dataUrl } }));
          im.src = r.value.dataUrl;
        })
        .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, key]);

  if (!bricks) {
    const canvas = bricksCanvas();
    bricks = { canvas, url: canvas.toDataURL() };
  }
  const names = files.map((f) => f.name);
  const images: Record<string, CanvasImageSource> = {};
  const urls: Record<string, string> = {};
  for (const [name, v] of Object.entries(loaded)) {
    images[name] = v.img;
    urls[name] = v.url;
  }
  if (!names.includes("bricks")) {
    names.push("bricks");
    images.bricks = bricks.canvas;
    urls.bricks = bricks.url;
  }
  return { names, images, urls };
}

/** Layer buttons for the brush bar. */
export function RcLayerButtons({ layer, onPick }: { layer: RcLayer; onPick: (l: RcLayer) => void }) {
  return (
    <>
      {RC_LAYERS.map((l) => (
        <button key={l} className={`brush-btn${layer === l ? " brush-btn-active" : ""}`} onClick={() => onPick(l)} data-testid={`rc-${l}`}>
          {RC_LAYER_LABEL[l]}
        </button>
      ))}
    </>
  );
}

const HEIGHT_PRESETS = [0, 2, 4, 6, 8, 10, 12, 16, 24];

/** What the 3D tool paints with, for the current layer. */
export function RcValuePanel({
  scene,
  layer,
  brush,
  textures,
  rootPath,
}: {
  scene: SceneJSON;
  layer: RcLayer;
  brush: RcBrush;
  textures: TextureImages;
  rootPath: string;
}) {
  const setRcBrush = useProjectStore((s) => s.setRcBrush);
  const [error, setError] = useState<string | null>(null);

  if (layer === "floor_h" || layer === "ceil_h") {
    const v = brush[layer];
    const set = (n: number) => setRcBrush({ [layer]: Math.max(0, Math.min(255, Math.round(n))) });
    return (
      <div className="rc-panel">
        <div className="rc-panel-row">
          <b>{RC_LAYER_LABEL[layer]}</b>
          <button className="btn btn-small" onClick={() => set(v - 1)} title="Lower ([)">
            −
          </button>
          <input
            className="rc-height-input"
            type="number"
            min={0}
            max={255}
            value={v}
            onChange={(e) => set(Number(e.target.value) || 0)}
            data-testid="rc-height"
          />
          <button className="btn btn-small" onClick={() => set(v + 1)} title="Raise (])">
            +
          </button>
          {HEIGHT_PRESETS.map((p) => (
            <button key={p} className={`brush-btn${p === v ? " brush-btn-active" : ""}`} onClick={() => set(p)}>
              {p}
            </button>
          ))}
        </div>
        <div className="rc-panel-hint">
          In eighths of a tile: 8 is one tile (one texture) high. The eye is {RC_EYE} above the floor, the player steps up at most{" "}
          {RC_STEP} and needs {RC_HEADROOM} under a ceiling. A ceiling at or below the floor is a wall. Stairs: floors 1-{RC_STEP} apart.
          Windows: a raised floor and a lowered ceiling with a gap between.
        </div>
      </div>
    );
  }

  if (layer === "walltex") {
    const used = sceneTextures(scene);
    const doImport = async () => {
      setError(null);
      const r = await window.api.importAssets({ rootPath, kind: "textures" });
      if (!r.ok) setError(r.error);
      else if (r.value) useProjectStore.setState({ assets: r.value });
    };
    const current = brush.walltex || used[0] || textures.names[0];
    return (
      <div className="rc-panel">
        <div className="rc-panel-row rc-texture-row">
          {textures.names.map((n) => (
            <button
              key={n}
              className={`rc-texture${current === n ? " rc-texture-active" : ""}`}
              onClick={() => setRcBrush({ walltex: n })}
              title={n + (used.includes(n) ? "" : " (not used in this scene yet)")}
            >
              {textures.urls[n] ? <img src={textures.urls[n]} alt="" /> : <span className="rc-texture-missing" />}
              <span>{n}</span>
            </button>
          ))}
          <button className="btn btn-small" onClick={() => void doImport()}>
            Import…
          </button>
        </div>
        {error && <div className="rc-panel-error">{error}</div>}
        <div className="rc-panel-hint">
          Paint walls, and the steps and ledges of tiles (a tile's texture is on its own sides). 32×32 PNGs in assets/textures; up to 60
          colours across all of them.
        </div>
      </div>
    );
  }

  const flats = scene.raycast?.flats ?? [];
  const v = brush[layer];
  const base = layer === "floor_flat" ? scene.raycast?.floor ?? "#3c3a36" : scene.raycast?.ceiling ?? "#22242c";
  return (
    <div className="rc-panel">
      <div className="rc-panel-row">
        <button className={`brush-btn${v === 0 ? " brush-btn-active" : ""}`} onClick={() => setRcBrush({ [layer]: 0 })}>
          <span className="scene-canvas-swatch" style={{ background: base }} />
          Scene's own
        </button>
        {flats.map((c, i) => (
          <button
            key={i}
            className={`brush-btn${v === i + 1 ? " brush-btn-active" : ""}`}
            onClick={() => setRcBrush({ [layer]: i + 1 })}
          >
            <span className="scene-canvas-swatch" style={{ background: c }} />
            {i + 1}
          </button>
        ))}
      </div>
      <div className="rc-panel-hint">
        {flats.length ? "Colours for floors and ceilings: edit them in the scene's 3D settings." : "Add colours in the scene's 3D settings (Properties) first."}
      </div>
    </div>
  );
}
