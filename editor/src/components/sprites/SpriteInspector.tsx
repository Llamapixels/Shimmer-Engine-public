import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import type { SpriteAnimationType, SpriteSheetJSON, SpriteStateJSON, SpriteTileJSON } from "../../../shared/projectTypes";
import { editFrame, editSheet, useSpriteEditor } from "../../sprites/editorStore";
import { gbaRgb, regionEmpty, rgbCss, type SpriteImage } from "../../sprites/image";
import {
  ANIMATION_TYPE_GROUPS,
  animationFor,
  animationName,
  canvasAnchor,
  defaultSheet,
  MAX_CANVAS,
  MAX_COLORS,
  MAX_OBJS,
  playerSpriteName,
  SLICE_LAYOUTS,
  sliceIntoState,
  stateLabel,
  tileSize,
  visibleAnimations,
  type Facing,
  type SliceLayout,
} from "../../sprites/model";
import { frameCost } from "../../sprites/pack";
import { drawActor } from "../../sprites/render";
import { useProjectStore } from "../../state/projectStore";
import CommitInput from "../common/CommitInput";
import NumberInput from "../common/NumberInput";
import FieldRow from "../inspector/FieldRow";
import { useCurrentSprite } from "./useCurrentSprite";

function GroupRow({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field-row">
      <span className="field-row-label">{label}</span>
      {children}
      {hint && <span className="field-row-hint">{hint}</span>}
    </div>
  );
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="spr-insp-section">
      <div className="spr-insp-title">
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  );
}

export default function SpriteInspector({ onError }: { onError: (e: string | null) => void }) {
  const cur = useCurrentSprite();
  const tileIds = useSpriteEditor((s) => s.tileIds);
  if (!cur.sheet || !cur.asset) return <div className="spr-inspector" />;
  const selTiles = (cur.frame?.tiles ?? []).filter((t) => tileIds.includes(t.id));
  return (
    <div className="spr-inspector" data-testid="sprite-inspector">
      {selTiles.length > 0 && <TileSection tiles={selTiles} />}
      <PreviewSection />
      {cur.state && <StateSection sheet={cur.sheet} state={cur.state} img={cur.img} />}
      <SpriteSection onError={onError} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------

function TileSection({ tiles }: { tiles: SpriteTileJSON[] }) {
  const { sheet, state, animIndex, frameIndex } = useCurrentSprite();
  const setEd = useSpriteEditor((s) => s.set);
  if (!sheet || !state) return null;
  const ids = new Set(tiles.map((t) => t.id));
  const edit = (u: (t: SpriteTileJSON) => SpriteTileJSON, key?: string) =>
    editFrame(sheet, state.id, animIndex, frameIndex, (f) => ({ ...f, tiles: f.tiles.map((t) => (ids.has(t.id) ? u(t) : t)) }), key);
  const reorder = (front: boolean) =>
    editFrame(sheet, state.id, animIndex, frameIndex, (f) => {
      const sel = f.tiles.filter((t) => ids.has(t.id));
      const rest = f.tiles.filter((t) => !ids.has(t.id));
      return { ...f, tiles: front ? [...rest, ...sel] : [...sel, ...rest] };
    });
  const one = tiles.length === 1 ? tiles[0] : null;
  const size = one ? tileSize(one, sheet.spriteMode) : null;
  const all = (k: "flipX" | "flipY" | "priority") => tiles.every((t) => !!t[k]);
  return (
    <Section
      title={one ? "Tile" : `${tiles.length} tiles`}
      actions={
        <button
          className="btn btn-small btn-danger"
          onClick={() => {
            editFrame(sheet, state.id, animIndex, frameIndex, (f) => ({ ...f, tiles: f.tiles.filter((t) => !ids.has(t.id)) }));
            setEd({ tileIds: [] });
          }}
        >
          Delete
        </button>
      }
    >
      {one && size && (
        <>
          <GroupRow label="Position on canvas">
            <div className="field-row-pair">
              <NumberInput value={one.x} min={-512} max={512} onChange={(x) => edit((t) => ({ ...t, x }), "tile-x")} ariaLabel="Tile X" />
              <NumberInput value={one.y} min={-512} max={512} onChange={(y) => edit((t) => ({ ...t, y }), "tile-y")} ariaLabel="Tile Y" />
            </div>
          </GroupRow>
          <GroupRow label="Cut from image (x, y, width, height)">
            <div className="spr-quad">
              <NumberInput
                value={one.sliceX}
                min={0}
                max={4096}
                onChange={(sliceX) => edit((t) => ({ ...t, sliceX }), "slice")}
                ariaLabel="Slice X"
              />
              <NumberInput
                value={one.sliceY}
                min={0}
                max={4096}
                onChange={(sliceY) => edit((t) => ({ ...t, sliceY }), "slice")}
                ariaLabel="Slice Y"
              />
              <NumberInput
                value={size.w}
                min={1}
                max={MAX_CANVAS}
                onChange={(width) => edit((t) => ({ ...t, width }), "slice")}
                ariaLabel="Width"
              />
              <NumberInput
                value={size.h}
                min={1}
                max={MAX_CANVAS}
                onChange={(height) => edit((t) => ({ ...t, height }), "slice")}
                ariaLabel="Height"
              />
            </div>
          </GroupRow>
        </>
      )}
      <GroupRow label="Flip / layer">
        <div className="spr-btn-row">
          <button
            className={`spr-toggle${all("flipX") ? " spr-toggle-on" : ""}`}
            onClick={() => edit((t) => ({ ...t, flipX: !all("flipX") }))}
          >
            ⇆ Flip H
          </button>
          <button
            className={`spr-toggle${all("flipY") ? " spr-toggle-on" : ""}`}
            onClick={() => edit((t) => ({ ...t, flipY: !all("flipY") }))}
          >
            ⇅ Flip V
          </button>
          <button className="spr-toggle" onClick={() => reorder(true)} title="Draw on top of the other tiles">
            To front
          </button>
          <button className="spr-toggle" onClick={() => reorder(false)} title="Draw under the other tiles">
            To back
          </button>
        </div>
      </GroupRow>
      <label className="spr-check">
        <input type="checkbox" checked={all("priority")} onChange={(e) => edit((t) => ({ ...t, priority: e.target.checked }))} />
        Draw behind the background
      </label>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Preview (an extra over GB Studio: the whole state, any direction, walking)
// ---------------------------------------------------------------------------

function PreviewSection() {
  const { img, sheet, state } = useCurrentSprite();
  const facing = useSpriteEditor((s) => s.previewFacing);
  const moving = useSpriteEditor((s) => s.previewMoving);
  const setEd = useSpriteEditor((s) => s.set);
  const ref = useRef<HTMLCanvasElement>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const step = (now: number) => {
      acc += now - last;
      last = now;
      const n = Math.floor(acc / (1000 / 60));
      if (n > 0) {
        acc -= n * (1000 / 60);
        setTick((t) => t + n);
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  const W = 200;
  const H = 120;
  const { anim } = state ? animationFor(state, facing, moving) : { anim: undefined };
  const speed = anim?.speed ?? sheet?.animSpeed ?? 8;
  const frameNo = anim?.frames.length ? Math.floor(tick / speed) % anim.frames.length : 0;
  const stateIndex = sheet && state ? sheet.states.indexOf(state) : 0;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#1c1c1c";
    ctx.fillRect(0, 0, W, H);
    if (!img || !sheet) return;
    const a = canvasAnchor(sheet);
    const spanW = Math.max(sheet.canvasWidth, 16);
    const spanH = Math.max(sheet.canvasHeight, 16) + 4;
    const z = Math.max(1, Math.min(6, Math.floor(Math.min((W - 16) / spanW, (H - 16) / spanH))));
    const x = Math.round(W / 2 - 8 * z);
    const y = Math.round(H - 12 - 16 * z);
    // Ground shadow under the footprint.
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(x, y + 16 * z - 2 * z, 16 * z, 2 * z);
    void a;
    drawActor(ctx, img, sheet, facing, x, y, z, { stateIndex, moving, frame: frameNo });
  }, [img, sheet, facing, moving, frameNo, stateIndex]);

  const pad = (f: Facing, label: string) => (
    <button
      className={`spr-dpad-btn${facing === f ? " spr-toggle-on" : ""}`}
      onClick={() => setEd({ previewFacing: f })}
      title={`Face ${f}`}
    >
      {label}
    </button>
  );

  return (
    <Section title="Preview">
      <div className="spr-preview">
        <canvas ref={ref} width={W} height={H} className="spr-preview-canvas" data-testid="sprite-preview" />
        <div className="spr-preview-controls">
          <div className="spr-dpad">
            <span />
            {pad("up", "▲")}
            <span />
            {pad("left", "◀")}
            <span />
            {pad("right", "▶")}
            <span />
            {pad("down", "▼")}
            <span />
          </div>
          <label className="spr-check">
            <input type="checkbox" checked={moving} onChange={(e) => setEd({ previewMoving: e.target.checked })} />
            Walking
          </label>
        </div>
      </div>
      <p className="spr-note">How the actor looks in game in this state, as it turns and walks.</p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// State + animation
// ---------------------------------------------------------------------------

function StateSection({ sheet, state, img }: { sheet: SpriteSheetJSON; state: SpriteStateJSON; img: SpriteImage | null }) {
  const animIndex = useSpriteEditor((s) => s.animIndex);
  const setEd = useSpriteEditor((s) => s.set);
  const selectAnimation = useSpriteEditor((s) => s.selectAnimation);
  const [slicing, setSlicing] = useState(false);
  const isDefault = sheet.states[0]?.id === state.id;
  const editState = (u: (s: SpriteStateJSON) => SpriteStateJSON, key?: string) =>
    editSheet(sheet, (s) => ({ ...s, states: s.states.map((st) => (st.id === state.id ? u(st) : st)) }), key);
  const anim = state.animations[animIndex];

  const setType = (animationType: SpriteAnimationType) => {
    editState((s) => ({ ...s, animationType }));
    const vis = visibleAnimations(animationType, state.flipLeft);
    if (!vis.some((v) => v.index === animIndex)) selectAnimation(state.id, vis[0]?.index ?? 0);
  };

  return (
    <Section
      title={`Animation settings: ${stateLabel(state)}`}
      actions={
        !isDefault && (
          <button
            className="btn btn-small btn-danger"
            onClick={() => {
              if (!confirm(`Delete the animation state "${stateLabel(state)}"?`)) return;
              editSheet(sheet, (s) => ({ ...s, states: s.states.filter((st) => st.id !== state.id) }));
              selectAnimation(sheet.states[0].id, 0);
            }}
          >
            Delete state
          </button>
        )
      }
    >
      <FieldRow
        label="State name"
        hint={isDefault ? "The first state is the one actors start in." : 'Used by "Set Actor Animation State".'}
      >
        {isDefault ? (
          <input value="Default" disabled />
        ) : (
          <CommitInput
            value={state.name}
            onCommit={(v) => {
              const name = v.trim();
              if (!name) return "A state needs a name.";
              if (name.toLowerCase() === "default") return '"Default" is the first state\'s name.';
              if (sheet.states.some((s) => s.id !== state.id && s.name === name)) return "Another state has that name.";
              editState((s) => ({ ...s, name }));
            }}
          />
        )}
      </FieldRow>
      <FieldRow label="Animation type">
        <select value={state.animationType} onChange={(e) => setType(e.target.value as SpriteAnimationType)} data-testid="animation-type">
          {ANIMATION_TYPE_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.types.map((t) => (
                <option key={t.type} value={t.type}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </FieldRow>
      {!["fixed", "fixed_movement", "cursor"].includes(state.animationType) && (
        <label className="spr-check">
          <input
            type="checkbox"
            checked={state.flipLeft}
            onChange={(e) => {
              const flipLeft = e.target.checked;
              editState((s) => ({ ...s, flipLeft }));
              const vis = visibleAnimations(state.animationType, flipLeft);
              if (!vis.some((v) => v.index === animIndex)) selectAnimation(state.id, vis[0]?.index ?? 0);
            }}
          />
          Flip "Right" to make "Left"
        </label>
      )}
      <div className="spr-btn-row">
        <button className="btn btn-small" onClick={() => setSlicing((v) => !v)} data-testid="slice-open">
          Slice sheet…
        </button>
        <button
          className="btn btn-small"
          title="GB Studio's automatic layout: 3 or 6 square frames in a row"
          onClick={() => {
            if (!img) return;
            const auto = defaultSheet(sheet.name, img.width, img.height).states[0];
            editState((s) => ({ ...s, animationType: auto.animationType, flipLeft: auto.flipLeft, animations: auto.animations }));
            if (isDefault) {
              const d = defaultSheet(sheet.name, img.width, img.height);
              editSheet(sheet, (s) => ({ ...s, canvasWidth: d.canvasWidth, canvasHeight: d.canvasHeight }));
            }
            setEd({ frameIndex: 0, tileIds: [] });
          }}
        >
          Auto-detect
        </button>
      </div>
      {slicing && img && (
        <SliceForm
          sheet={sheet}
          state={state}
          img={img}
          onDone={() => {
            setSlicing(false);
            setEd({ frameIndex: 0, tileIds: [] });
          }}
        />
      )}

      {anim && (
        <>
          <div className="spr-insp-subtitle">{animationName(state.animationType, state.flipLeft, animIndex)}</div>
          <GroupRow label="Speed" hint={`VBlanks per frame (60 = one second). ${anim.speed ? "" : "Using the sprite's default."}`}>
            <div className="spr-inline">
              <label className="spr-check">
                <input
                  type="checkbox"
                  checked={anim.speed !== undefined}
                  onChange={(e) =>
                    editState((s) => ({
                      ...s,
                      animations: s.animations.map((a, i) =>
                        i !== animIndex ? a : e.target.checked ? { ...a, speed: sheet.animSpeed } : { id: a.id, frames: a.frames },
                      ),
                    }))
                  }
                />
                Own speed
              </label>
              <NumberInput
                value={anim.speed ?? sheet.animSpeed}
                min={1}
                max={255}
                disabled={anim.speed === undefined}
                ariaLabel="Animation speed"
                onChange={(speed) =>
                  editState((s) => ({ ...s, animations: s.animations.map((a, i) => (i === animIndex ? { ...a, speed } : a)) }), "speed")
                }
              />
            </div>
          </GroupRow>
        </>
      )}
    </Section>
  );
}

/** "Slice sheet": frames from a grid over the image (an extra over GB
 * Studio, which only auto-detects its classic 16x16 layouts). */
function SliceForm({
  sheet,
  state,
  img,
  onDone,
}: {
  sheet: SpriteSheetJSON;
  state: SpriteStateJSON;
  img: SpriteImage;
  onDone: () => void;
}) {
  const animIndex = useSpriteEditor((s) => s.animIndex);
  const [fw, setFw] = useState(Math.min(img.height, img.width, MAX_CANVAS));
  const [fh, setFh] = useState(Math.min(img.height, MAX_CANVAS));
  const [layout, setLayout] = useState<SliceLayout>("classic");
  const [error, setError] = useState<string | null>(null);
  const cols = Math.floor(img.width / Math.max(1, fw));
  const rows = Math.floor(img.height / Math.max(1, fh));
  const apply = () => {
    const r = sliceIntoState(state, animIndex, img.width, img.height, fw, fh, layout, (x, y, w, h) => regionEmpty(img, x, y, w, h));
    if ("error" in r) {
      setError(r.error);
      return;
    }
    editSheet(sheet, (s) => ({
      ...s,
      canvasWidth: Math.max(s.canvasWidth, fw),
      canvasHeight: Math.max(s.canvasHeight, fh),
      states: s.states.map((st) => (st.id === state.id ? r.state : st)),
    }));
    onDone();
  };
  return (
    <div className="spr-slice" data-testid="slice-form">
      <GroupRow label="Frame size (px)" hint={`${cols} x ${rows} frames in the ${img.width}x${img.height} image`}>
        <div className="field-row-pair">
          <NumberInput value={fw} min={1} max={MAX_CANVAS} onChange={setFw} ariaLabel="Frame width" />
          <NumberInput value={fh} min={1} max={MAX_CANVAS} onChange={setFh} ariaLabel="Frame height" />
        </div>
      </GroupRow>
      <FieldRow label="Layout" hint={SLICE_LAYOUTS.find((l) => l.value === layout)?.hint}>
        <select value={layout} onChange={(e) => setLayout(e.target.value as SliceLayout)} data-testid="slice-layout">
          {SLICE_LAYOUTS.map((l) => (
            <option key={l.value} value={l.value}>
              {l.label}
            </option>
          ))}
        </select>
      </FieldRow>
      {error && <p className="field-error">{error}</p>}
      <div className="spr-btn-row">
        <button className="btn btn-small btn-primary" onClick={apply} data-testid="slice-apply">
          Slice
        </button>
        <button className="btn btn-small" onClick={onDone}>
          Cancel
        </button>
      </div>
      <p className="spr-note">Replaces this state's animations. The canvas grows to fit a frame if needed.</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sprite
// ---------------------------------------------------------------------------

function SpriteSection({ onError }: { onError: (e: string | null) => void }) {
  const { asset, img, sheet } = useCurrentSprite();
  const project = useProjectStore((s) => s.project);
  const updateProject = useProjectStore((s) => s.updateProject);
  const renameSpriteRefs = useProjectStore((s) => s.renameSpriteRefs);
  const refreshAssets = useProjectStore((s) => s.refreshAssets);
  const selectSprite = useSpriteEditor((s) => s.selectSprite);

  const usage = useMemo(() => {
    if (!project || !asset) return { npcs: 0, scenes: 0 };
    const player = playerSpriteName(project.project);
    let npcs = 0;
    let scenes = 0;
    for (const rec of project.scenes) {
      const n = (rec.data.npcs ?? []).filter((npc) => (npc.sprite || player) === asset.name).length;
      npcs += n;
      if (n) scenes++;
    }
    return { npcs, scenes };
  }, [project, asset]);

  const hw = useMemo(() => {
    if (!img || !sheet) return null;
    let objs = 0;
    let vram = 0;
    let over = 0;
    for (const st of sheet.states)
      for (const a of st.animations)
        for (const f of a.frames) {
          const c = frameCost(img, f.tiles, sheet.spriteMode);
          objs = Math.max(objs, c.objs.length);
          vram = Math.max(vram, c.vramTiles);
          if (c.objs.length > MAX_OBJS) over++;
        }
    return { objs, vram, over };
  }, [img, sheet]);

  if (!asset || !sheet || !project) return null;
  const isPlayer = playerSpriteName(project.project) === asset.name;
  const edit = (u: (s: SpriteSheetJSON) => SpriteSheetJSON, key?: string) => editSheet(sheet, u, key);

  const rename = async (to: string): Promise<string | null> => {
    const r = await window.api.renameSprite({ rootPath: project.rootPath, from: asset.name, to });
    if (!r.ok) return r.error;
    renameSpriteRefs(asset.name, r.value);
    await refreshAssets();
    selectSprite(r.value);
    return null;
  };

  const remove = async () => {
    if (isPlayer) return onError("This is the player's sprite. Pick another player sprite before deleting it.");
    if (usage.npcs) return onError(`${usage.npcs} actor(s) use this sprite. Give them another sprite first.`);
    if (!confirm(`Delete ${asset.fileName} from the project? This can't be undone.`)) return;
    const r = await window.api.deleteSprite({ rootPath: project.rootPath, name: asset.name });
    if (!r.ok) return onError(r.error);
    updateProject((p) => ({ ...p, spriteSheets: (p.spriteSheets ?? []).filter((s) => s.name !== asset.name) }));
    await refreshAssets();
    selectSprite(null);
  };

  const replaceImage = async () => {
    onError(null);
    const r = await window.api.replaceSpriteImage({ rootPath: project.rootPath, name: asset.name });
    if (!r.ok) onError(r.error);
    else if (r.value) useProjectStore.setState({ assets: r.value });
  };

  const b = sheet.bounds;
  const colors = img?.colors ?? [];
  return (
    <Section title="Sprite">
      <FieldRow label="Name" hint={`assets/sprites/${asset.fileName}`}>
        <CommitInput
          value={asset.name}
          onCommit={(v) => {
            void rename(v).then((err) => err && onError(err));
          }}
        />
      </FieldRow>

      <GroupRow
        label={`Image${img ? ` · ${img.width}x${img.height}` : ""}`}
        hint={
          colors.length > MAX_COLORS ? (
            <span className="spr-warn">
              {colors.length} colors - a GBA sprite has {MAX_COLORS} plus transparency. Reduce its colors or the build fails.
            </span>
          ) : (
            `${colors.length} of ${MAX_COLORS} colors (swatches show the GBA's 15-bit color).`
          )
        }
      >
        <div className="spr-swatches" data-testid="sprite-colors">
          {colors.slice(0, 32).map((c, i) => (
            <span
              key={i}
              className="spr-swatch"
              style={{ background: rgbCss(gbaRgb(c)) }}
              title={`#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`}
            />
          ))}
        </div>
        <div className="spr-btn-row">
          <button className="btn btn-small" onClick={replaceImage} title="Swap in a new PNG, keeping the animations">
            Replace image…
          </button>
          <button
            className="btn btn-small"
            onClick={() => void window.api.revealInFolder({ rootPath: project.rootPath, relPath: asset.relPath })}
          >
            Show file
          </button>
          <button className="btn btn-small" onClick={() => void refreshAssets()} title="Reload the PNG after editing it in a paint program">
            Reload
          </button>
        </div>
      </GroupRow>

      <GroupRow label="Canvas size" hint="Any size up to 256x256. Its bottom-centre stands on the actor's 16x16 tile.">
        <div className="field-row-pair">
          <NumberInput
            value={sheet.canvasWidth}
            min={1}
            max={MAX_CANVAS}
            onChange={(canvasWidth) => edit((s) => ({ ...s, canvasWidth }), "cw")}
            ariaLabel="Canvas width"
          />
          <NumberInput
            value={sheet.canvasHeight}
            min={1}
            max={MAX_CANVAS}
            onChange={(canvasHeight) => edit((s) => ({ ...s, canvasHeight }), "ch")}
            ariaLabel="Canvas height"
          />
        </div>
      </GroupRow>
      <GroupRow label="Canvas origin" hint="Shifts where the canvas sits on the actor, px.">
        <div className="field-row-pair">
          <NumberInput
            value={sheet.canvasOriginX}
            min={-256}
            max={256}
            onChange={(canvasOriginX) => edit((s) => ({ ...s, canvasOriginX }), "ox")}
            ariaLabel="Origin X"
          />
          <NumberInput
            value={sheet.canvasOriginY}
            min={-256}
            max={256}
            onChange={(canvasOriginY) => edit((s) => ({ ...s, canvasOriginY }), "oy")}
            ariaLabel="Origin Y"
          />
        </div>
      </GroupRow>
      <GroupRow label="Collision bounding box" hint="x, y, width, height - relative to the actor's 16x16 tile (red box on the canvas).">
        <div className="spr-quad">
          <NumberInput
            value={b.x}
            min={-128}
            max={127}
            onChange={(x) => edit((s) => ({ ...s, bounds: { ...s.bounds, x } }), "bx")}
            ariaLabel="Bounds X"
          />
          <NumberInput
            value={b.y}
            min={-128}
            max={127}
            onChange={(y) => edit((s) => ({ ...s, bounds: { ...s.bounds, y } }), "by")}
            ariaLabel="Bounds Y"
          />
          <NumberInput
            value={b.width}
            min={0}
            max={255}
            onChange={(width) => edit((s) => ({ ...s, bounds: { ...s.bounds, width } }), "bw")}
            ariaLabel="Bounds width"
          />
          <NumberInput
            value={b.height}
            min={0}
            max={255}
            onChange={(height) => edit((s) => ({ ...s, bounds: { ...s.bounds, height } }), "bh")}
            ariaLabel="Bounds height"
          />
        </div>
      </GroupRow>
      <div className="field-row-pair">
        <FieldRow label="Tile size" hint="What a click in the palette picks.">
          <select value={sheet.spriteMode} onChange={(e) => edit((s) => ({ ...s, spriteMode: e.target.value as "8x8" | "8x16" }))}>
            <option value="8x16">8x16</option>
            <option value="8x8">8x8</option>
          </select>
        </FieldRow>
        <FieldRow label="Anim speed" hint="VBlanks per frame">
          <NumberInput
            value={sheet.animSpeed}
            min={1}
            max={255}
            onChange={(animSpeed) => edit((s) => ({ ...s, animSpeed }), "speed")}
            ariaLabel="Default animation speed"
          />
        </FieldRow>
      </div>

      {hw && (
        <GroupRow label="Hardware">
          <div className={`spr-hw${hw.over ? " spr-warn" : ""}`} data-testid="sprite-hw">
            Largest frame: {hw.objs} of {MAX_OBJS} hardware sprites, {hw.vram} VRAM tiles.
            {hw.over > 0 && ` ${hw.over} frame(s) need more than ${MAX_OBJS} - the build will fail.`}
          </div>
        </GroupRow>
      )}

      <GroupRow label="Used by" hint={isPlayer ? "The player uses this sprite." : undefined}>
        <div className="spr-inline">
          <span className="spr-usage">
            {usage.npcs} actor(s) in {usage.scenes} scene(s)
          </span>
          {!isPlayer && (
            <button
              className="btn btn-small"
              onClick={() => updateProject((p) => ({ ...p, playerSprite: asset.name }))}
              data-testid="use-as-player"
            >
              Use for player
            </button>
          )}
        </div>
      </GroupRow>

      <div className="spr-btn-row">
        <button className="btn btn-small btn-danger" onClick={() => void remove()}>
          Delete sprite
        </button>
      </div>
    </Section>
  );
}
