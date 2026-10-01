import { useEffect, useRef, useState } from "react";

import type { AssetInfo } from "../../../shared/ipc";
import { editSheet, useSpriteEditor } from "../../sprites/editorStore";
import { useSpriteImage, type SpriteImage } from "../../sprites/image";
import { newState, playerSpriteName, stateLabel, visibleAnimations } from "../../sprites/model";
import { drawActor, sheetFor } from "../../sprites/render";
import { useProjectStore } from "../../state/projectStore";
import FolderTree from "../common/FolderTree";
import { useAssetUrl } from "../views/assetImages";
import { useCurrentSprite } from "./useCurrentSprite";
import Chevron from "../common/Chevron";

/** Left column: the project's sprites, then the selected sprite's
 * animation states and their animations (GB Studio's layout). */
export default function SpriteNavigator({ onError }: { onError: (e: string | null) => void }) {
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const project = useProjectStore((s) => s.project?.project);
  const assets = useProjectStore((s) => s.assets?.sprites);
  const selected = useSpriteEditor((s) => s.sprite);
  const selectSprite = useSpriteEditor((s) => s.selectSprite);
  const [search, setSearch] = useState("");

  const list = assets ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list;
  const player = project ? playerSpriteName(project) : "player";

  const doImport = async () => {
    if (!rootPath) return;
    onError(null);
    const before = new Set(list.map((a) => a.name));
    const r = await window.api.importAssets({ rootPath, kind: "sprites" });
    if (!r.ok) onError(r.error);
    else if (r.value) {
      useProjectStore.setState({ assets: r.value });
      const added = r.value.sprites.find((a) => !before.has(a.name));
      if (added) selectSprite(added.name);
    }
  };

  return (
    <div className="spr-nav">
      <div className="spr-nav-section spr-nav-sprites">
        <div className="spr-nav-head">
          <span>Sprites</span>
          <button className="spr-icon-btn" title="Import PNG sprites…" onClick={doImport} data-testid="sprite-import">
            +
          </button>
        </div>
        <input className="spr-nav-search" placeholder="Search sprites…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="spr-nav-list">
          <FolderTree
            items={filtered}
            getName={(a) => a.name}
            storageKey="sprites"
            isActive={(a) => a.name === selected}
            renderItem={(a, leaf) => (
              <SpriteRow
                asset={a}
                label={leaf}
                selected={a.name === selected}
                isPlayer={a.name === player}
                onClick={() => selectSprite(a.name)}
              />
            )}
          />
          {list.length === 0 && <div className="spr-nav-empty">No sprites yet. Import a PNG with +.</div>}
          {list.length > 0 && filtered.length === 0 && <div className="spr-nav-empty">No sprites match.</div>}
        </div>
      </div>
      <AnimationTree />
    </div>
  );
}

function SpriteRow({
  asset,
  label,
  selected,
  isPlayer,
  onClick,
}: {
  asset: AssetInfo;
  /** The name without its folders. */
  label: string;
  selected: boolean;
  isPlayer: boolean;
  onClick: () => void;
}) {
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const url = useAssetUrl(rootPath, asset);
  const img = useSpriteImage(url);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div
      ref={ref}
      className={`spr-nav-item${selected ? " spr-nav-item-on" : ""}`}
      onClick={onClick}
      data-testid={`sprite-row-${asset.name}`}
    >
      <SpriteThumb img={img} name={asset.name} />
      <span className="spr-nav-name" title={asset.name}>
        {label}
      </span>
      {isPlayer && (
        <span className="spr-badge" title="The player uses this sprite">
          player
        </span>
      )}
    </div>
  );
}

/** Small picture of a sprite: its default idle frame facing down. */
export function SpriteThumb({ img, name, size = 24 }: { img: SpriteImage | null; name: string; size?: number }) {
  const project = useProjectStore((s) => s.project?.project);
  const ref = useRef<HTMLCanvasElement>(null);
  const sheet = project && img ? sheetFor(project, name, img) : null;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    if (!img || !sheet) return;
    const w = sheet.canvasWidth;
    const h = sheet.canvasHeight;
    const scale = Math.max(1, Math.floor(size / Math.max(w, h))) || 1;
    const fit = Math.min(size / w, size / h, scale);
    // drawActor anchors at the 16x16 footprint; undo that so the canvas fills the thumb.
    const ax = Math.floor((16 - w) / 2) + sheet.canvasOriginX;
    const ay = 16 - h + sheet.canvasOriginY;
    const ox = (size - w * fit) / 2 - ax * fit;
    const oy = (size - h * fit) / 2 - ay * fit;
    drawActor(ctx, img, sheet, "down", ox, oy, fit);
  }, [img, sheet, size]);
  return <canvas ref={ref} className="spr-thumb" width={size} height={size} style={{ width: size, height: size }} />;
}

function AnimationTree() {
  const { sheet, state: current, animIndex } = useCurrentSprite();
  const selectAnimation = useSpriteEditor((s) => s.selectAnimation);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const addState = () => {
    if (!sheet) return;
    const names = new Set(sheet.states.map((s) => s.name));
    let n = 1;
    while (names.has(`state${n}`)) n++;
    const st = newState(`state${n}`, sheet.states[0]?.animationType ?? "multi_movement");
    editSheet(sheet, (s) => ({ ...s, states: [...s.states, st] }));
    selectAnimation(st.id, 0);
  };

  return (
    <div className="spr-nav-section spr-nav-anims">
      <div className="spr-nav-head">
        <span>Animations</span>
        <button className="spr-icon-btn" title="Add animation state" onClick={addState} disabled={!sheet} data-testid="sprite-add-state">
          +
        </button>
      </div>
      <div className="spr-nav-list">
        {!sheet && <div className="spr-nav-empty">Select a sprite.</div>}
        {sheet?.states.map((st) => {
          const open = !collapsed[st.id];
          return (
            <div key={st.id}>
              <div
                className={`spr-nav-item spr-nav-state${current?.id === st.id ? " spr-nav-state-on" : ""}`}
                onClick={() => {
                  if (current?.id !== st.id) selectAnimation(st.id, visibleAnimations(st.animationType, st.flipLeft)[0]?.index ?? 0);
                  else setCollapsed((c) => ({ ...c, [st.id]: open }));
                }}
              >
                <span className="spr-chevron"><Chevron open={open} /></span>
                <span className="spr-nav-name">{stateLabel(st)}</span>
              </div>
              {open &&
                visibleAnimations(st.animationType, st.flipLeft).map(({ index, name }) => {
                  const frames = st.animations[index]?.frames ?? [];
                  const on = current?.id === st.id && animIndex === index;
                  return (
                    <div
                      key={index}
                      className={`spr-nav-item spr-nav-anim${on ? " spr-nav-item-on" : ""}`}
                      onClick={() => selectAnimation(st.id, index)}
                      data-testid={`sprite-anim-${st.name || "default"}-${index}`}
                    >
                      <span className="spr-nav-name">{name}</span>
                      <span className="spr-nav-count">{frames.length}</span>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
