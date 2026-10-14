/*
 * The scene canvas's 3D tool (First Person 3D scenes): which layer it
 * paints and with what - a shape (floor and ceiling together, a wall,
 * open sky), a wall texture, a floor / ceiling colour - plus the wall
 * textures' images.
 */

import { useEffect, useMemo, useState } from "react";

import type { AssetListing } from "../../shared/ipc";
import type { SceneJSON } from "../../shared/projectTypes";
import { useProjectStore, type RcBrush, type RcLayer } from "../state/projectStore";
import { RC_LAYERS, rcDefaults, sceneTextures } from "../world/paint";
import { bricksCanvas, RC_LAYER_LABEL, RC_SKY, tilesText } from "../world/raycastView";
import NumberInput from "./common/NumberInput";

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

  return useMemo(() => {
    if (!bricks) {
      const canvas = bricksCanvas();
      bricks = { canvas, url: canvas.toDataURL() };
    }
    const names = key ? key.split("|").map((k) => k.slice(0, k.lastIndexOf(":"))) : [];
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
  }, [key, loaded]);
}

/** Layer buttons for the brush bar. */
export function RcLayerButtons({ layer, onPick }: { layer: RcLayer; onPick: (l: RcLayer) => void }) {
  return (
    <>
      {RC_LAYERS.map((l) => (
        <button
          key={l}
          className={`brush-btn${layer === l ? " brush-btn-active" : ""}`}
          onClick={() => onPick(l)}
          data-testid={`rc-${l}`}
          title={LAYER_HINT[l]}
        >
          {RC_LAYER_LABEL[l]}
        </button>
      ))}
    </>
  );
}

const LAYER_HINT: Record<RcLayer, string> = {
  shape: "Walls, floors, steps, ledges, pits, windows, doors and open sky: floor and ceiling together",
  walltex: "Which texture a tile's sides show (walls, steps, ledges)",
  floor_flat: "Floor colours: carpet, lava, water...",
  ceil_flat: "Ceiling colours: lights, panels...",
  floor_h: "Change only the floor height, leaving the ceiling",
  ceil_h: "Change only the ceiling height, leaving the floor",
};

/** The body the engine settings give the player, in eighths of a tile. */
export interface RcBody {
  eye: number;
  step: number;
}

type Shape = { name: string; hint: string; wall?: boolean; floor: (g: number, c: number) => number; ceil: (g: number, c: number) => number };

/** Ready-made shapes, from the scene's ground (g) and ceiling (c). */
function shapes(body: RcBody): Shape[] {
  const room = body.eye + 1;
  const low = (g: number, c: number, h: number) => (c >= RC_SKY ? g + h : Math.min(c, g + h));
  return [
    { name: "Floor", hint: "Open floor at the ground, the scene's own ceiling", floor: (g) => g, ceil: (_g, c) => c },
    { name: "Wall", hint: "A solid wall (a solid collision tile): actors can't pass either", wall: true, floor: (g) => g, ceil: (g) => g },
    { name: "Step", hint: `A step up the player can walk onto (${body.step} or less)`, floor: (g) => g + Math.min(2, body.step), ceil: (_g, c) => c },
    { name: "Ledge", hint: "Too high to step onto: needs stairs or a jump", floor: (g) => g + body.step + 3, ceil: (_g, c) => c },
    { name: "Pit", hint: "A lower floor to fall into (stairs or a lift get back up)", floor: (g) => Math.max(0, g - 8), ceil: (_g, c) => c },
    { name: "Window", hint: "A raised sill and a lowered top: see and shoot through, can't walk through", floor: (g) => g + 3, ceil: (g, c) => low(g, c, 3 + room - 2) },
    { name: "Low ceiling", hint: "Just enough room to walk under", floor: (g) => g, ceil: (g) => g + room },
    { name: "Door", hint: "Closed: a ceiling down at the floor. Open it with Set 3D Heights (Move: Ceiling) on a trigger", floor: (g) => g, ceil: (g) => g },
    { name: "Open sky", hint: "No ceiling: the sky shows (set it in the scene's 3D settings)", floor: (g) => g, ceil: () => RC_SKY },
  ];
}

/** A side view of what the shape brush makes, next to the player. */
function ShapeDiagram({ floor, ceil, wall, ground, body }: { floor: number; ceil: number; wall: boolean; ground: number; body: RcBody }) {
  const sky = ceil >= RC_SKY;
  const top = Math.max(ground + 24, (sky ? 0 : ceil) + 4, floor + 8, ground + body.eye + 6);
  const bottom = Math.min(ground, floor) - 4;
  const H = 120;
  const y = (v: number) => H - ((v - bottom) / (top - bottom)) * H;
  const px = (v: number) => Math.round(y(v));
  const solid = wall || (!sky && ceil <= floor);
  return (
    <svg className="rc-diagram" viewBox={`0 0 220 ${H}`} width={220} height={H} aria-label="Side view">
      <rect x={0} y={0} width={220} height={H} className="rc-diagram-sky" />
      {/* the ground the player stands on, and one-tile marks */}
      {Array.from({ length: Math.ceil((top - bottom) / 8) + 1 }, (_, i) => {
        const v = Math.ceil(bottom / 8) * 8 + i * 8;
        return <line key={v} x1={0} x2={220} y1={px(v) + 0.5} y2={px(v) + 0.5} className="rc-diagram-grid" />;
      })}
      <rect x={0} y={px(ground)} width={110} height={H - px(ground)} className="rc-diagram-floor" />
      {/* the player: eye height + 1 tall */}
      <rect x={40} y={px(ground + body.eye + 1)} width={14} height={px(ground) - px(ground + body.eye + 1)} rx={4} className="rc-diagram-player" />
      <circle cx={51} cy={px(ground + body.eye)} r={2} className="rc-diagram-eye" />
      {/* the shape */}
      {solid ? (
        <rect x={110} y={0} width={110} height={H} className="rc-diagram-wall" />
      ) : (
        <>
          <rect x={110} y={px(floor)} width={110} height={H - px(floor)} className="rc-diagram-floor" />
          {!sky && <rect x={110} y={0} width={110} height={px(ceil)} className="rc-diagram-ceil" />}
          {sky && <text x={160} y={14} className="rc-diagram-text">sky</text>}
        </>
      )}
      <line x1={0} x2={110} y1={px(ground + body.step) + 0.5} y2={px(ground + body.step) + 0.5} className="rc-diagram-step" />
    </svg>
  );
}

/** What the "Shape" brush makes, in words: what the player can do there. */
function shapeWarnings(floor: number, ceil: number, wall: boolean, ground: number, body: RcBody): string[] {
  if (wall) return ["A solid wall. Under open sky it stands as tall as the Wall height (3D settings) and what's behind shows over it."];
  const sky = ceil >= RC_SKY;
  if (!sky && ceil <= floor) return ["Closed: the ceiling is at (or below) the floor, so it's solid, like a wall. A door raises its ceiling to open."];
  const out: string[] = [];
  const up = floor - ground;
  if (up > body.step) out.push(`${tilesText(up)} up from the ground: too high to step onto (${body.step} is the most), needs stairs or a jump.`);
  else if (up > 0) out.push(`${tilesText(up)} up: the player steps onto it.`);
  else if (up < 0) out.push(`${tilesText(-up)} down: the player drops into it.`);
  if (!sky && ceil - floor < body.eye + 1) out.push(`Only ${ceil - floor} above its floor: too low to walk under (needs ${body.eye + 1}), but you can see and shoot through.`);
  return out;
}

/** The scene the shape brush was last set up for. */
let brushScene: string | null = null;

export interface StairsRequest {
  dir: "right" | "left" | "down" | "up";
  from: number;
  rise: number;
}

/** What the 3D tool paints with, for the current layer. */
export function RcValuePanel({
  scene,
  sceneId,
  layer,
  brush,
  textures,
  rootPath,
  body,
  canStairs,
  onStairs,
}: {
  scene: SceneJSON;
  sceneId: string;
  layer: RcLayer;
  brush: RcBrush;
  textures: TextureImages;
  rootPath: string;
  body: RcBody;
  /** An area is selected (Select brush): stairs can go in it. */
  canStairs: boolean;
  onStairs: (r: StairsRequest) => void;
}) {
  const setRcBrush = useProjectStore((s) => s.setRcBrush);
  const [error, setError] = useState<string | null>(null);
  const d = rcDefaults(scene);

  // Another scene: the shape brush starts at its ground and ceiling (coming
  // back to the tool in the same scene keeps what was picked).
  useEffect(() => {
    if (brushScene === sceneId) return;
    brushScene = sceneId;
    setRcBrush({ shape_floor: d.floor, shape_ceil: d.ceil, shape_wall: false, floor_h: d.floor, ceil_h: d.ceil });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneId]);

  if (layer === "shape") {
    const all = shapes(body);
    const f = brush.shape_floor;
    const c = brush.shape_ceil;
    const sky = c >= RC_SKY;
    const isPreset = (p: Shape) => (p.wall ? brush.shape_wall : !brush.shape_wall && p.floor(d.floor, d.ceil) === f && p.ceil(d.floor, d.ceil) === c);
    return (
      <div className="rc-panel">
        <div className="rc-panel-row">
          {all.map((p) => (
            <button
              key={p.name}
              className={`brush-btn${isPreset(p) ? " brush-btn-active" : ""}`}
              title={p.hint}
              onClick={() => setRcBrush({ shape_wall: !!p.wall, shape_floor: p.floor(d.floor, d.ceil), shape_ceil: p.ceil(d.floor, d.ceil) })}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="rc-shape">
          <ShapeDiagram floor={f} ceil={c} wall={brush.shape_wall} ground={d.floor} body={body} />
          <div className="rc-shape-fields">
            {!brush.shape_wall && (
              <>
                <label className="rc-field">
                  <span>Floor</span>
                  <button className="btn btn-small" onClick={() => setRcBrush({ shape_floor: Math.max(0, f - 1) })} title="Lower">
                    −
                  </button>
                  <NumberInput className="rc-num" value={f} min={0} max={254} onChange={(n) => setRcBrush({ shape_floor: n })} />
                  <button className="btn btn-small" onClick={() => setRcBrush({ shape_floor: Math.min(254, f + 1) })} title="Raise">
                    +
                  </button>
                  <span className="rc-field-note">{f === d.floor ? "the ground" : `${f > d.floor ? "+" : "−"}${tilesText(Math.abs(f - d.floor))}`}</span>
                </label>
                <label className="rc-field">
                  <span>Ceiling</span>
                  {sky ? (
                    <span className="rc-field-note rc-field-sky">Open sky</span>
                  ) : (
                    <>
                      <button className="btn btn-small" onClick={() => setRcBrush({ shape_ceil: Math.max(0, c - 1) })} title="Lower">
                        −
                      </button>
                      <NumberInput className="rc-num" value={c} min={0} max={254} onChange={(n) => setRcBrush({ shape_ceil: n })} />
                      <button className="btn btn-small" onClick={() => setRcBrush({ shape_ceil: Math.min(254, c + 1) })} title="Raise">
                        +
                      </button>
                      <span className="rc-field-note">{tilesText(c - f)} of room</span>
                    </>
                  )}
                </label>
                <label className="rc-check">
                  <input
                    type="checkbox"
                    checked={sky}
                    onChange={(e) => setRcBrush({ shape_ceil: e.target.checked ? RC_SKY : d.ceil >= RC_SKY ? f + 16 : d.ceil })}
                  />
                  No ceiling (open sky)
                </label>
              </>
            )}
            {shapeWarnings(f, c, brush.shape_wall, d.floor, body).map((w) => (
              <div key={w} className="rc-panel-note">
                {w}
              </div>
            ))}
            {canStairs && !brush.shape_wall ? (
              <div className="rc-panel-row">
                <span>Stairs in the selection, rising</span>
                {(["right", "left", "down", "up"] as const).map((dir) => (
                  <button
                    key={dir}
                    className="btn btn-small"
                    title={`From floor ${f}, ${Math.min(2, body.step)} higher each tile going ${dir}`}
                    onClick={() => onStairs({ dir, from: f, rise: Math.max(1, Math.min(2, body.step)) })}
                  >
                    {{ right: "→", left: "←", down: "↓", up: "↑" }[dir]}
                  </button>
                ))}
              </div>
            ) : (
              <div className="rc-panel-hint">Heights are in eighths of a tile (8 = one tile, one texture high). Stairs: select an area with the Select brush.</div>
            )}
          </div>
        </div>
      </div>
    );
  }

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
          <NumberInput className="rc-num" value={v} min={0} max={255} onChange={set} />
          <button className="btn btn-small" onClick={() => set(v + 1)} title="Raise (])">
            +
          </button>
          <span className="rc-field-note">{layer === "ceil_h" && v >= RC_SKY ? "open sky" : tilesText(v)}</span>
        </div>
        <div className="rc-panel-hint">
          Changes only the {layer === "floor_h" ? "floor" : "ceiling"}, leaving the {layer === "floor_h" ? "ceiling" : "floor"} as it is. In eighths of
          a tile; a ceiling at or below the floor is solid; ceiling 255 is open sky. Shape does both at once.
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
          Paint walls, and the steps and ledges of tiles (a tile's texture is on its own sides). 32×32 PNGs in assets/textures; up to 59
          colours across all of them and the sky.
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
          <button key={i} className={`brush-btn${v === i + 1 ? " brush-btn-active" : ""}`} onClick={() => setRcBrush({ [layer]: i + 1 })}>
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
