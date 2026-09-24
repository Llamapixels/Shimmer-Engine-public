import { useState } from "react";

import type { AssetInfo } from "../../../shared/ipc";
import { sceneName, useProjectStore } from "../../state/projectStore";
import { backgroundRefFor } from "../common/AssetSelect";
import { formatBytes, useAssetUrl, useImageStats } from "./assetImages";
import "./views.css";
import Icon from "../common/Icon";

const MAX_TILE_COLORS = 16;
const MAX_UNIQUE_TILES = 1024;
const MAX_PX = 2048;

export default function BackgroundsView() {
  const project = useProjectStore((s) => s.project)!;
  const assets = useProjectStore((s) => s.assets);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const list = assets?.backgrounds ?? [];
  const current = list.find((a) => a.relPath === selected) ?? null;

  const usedBy = (a: AssetInfo) => project.scenes.filter((s) => s.data.background === backgroundRefFor(a.relPath));

  const doImport = async () => {
    setError(null);
    const r = await window.api.importAssets({ rootPath: project.rootPath, kind: "backgrounds" });
    if (!r.ok) setError(r.error);
    else if (r.value) useProjectStore.setState({ assets: r.value });
  };

  return (
    <div className="view">
      <div className="view-main">
        <div className="view-head">
          <div className="view-title">
            Backgrounds <span className="view-sub">assets/backgrounds · {list.length}</span>
          </div>
          <button className="btn" onClick={() => setCreating((c) => !c)}>
            New blank…
          </button>
          <button className="btn btn-primary" onClick={doImport}>
            Import PNG…
          </button>
        </div>
        <div className="view-scroll">
          <p className="view-note">
            Scene backgrounds are PNGs whose width and height are multiples of 8, up to {MAX_PX}×{MAX_PX}. Each 8×8 tile may use at
            most 16 colors, and a map may have at most {MAX_UNIQUE_TILES} unique tiles (flipped copies are free). The checks on the
            right are a quick estimate; the compiler has the final say.
          </p>
          {creating && (
            <NewBackgroundForm
              onDone={(a) => {
                setCreating(false);
                if (a) setSelected(a.relPath);
              }}
            />
          )}
          {error && <p className="field-error">{error}</p>}
          {list.length === 0 ? (
            <div className="view-empty">No backgrounds yet — import a PNG or create a blank one.</div>
          ) : (
            <div className="asset-grid">
              {list.map((a) => (
                <BgCard
                  key={a.relPath}
                  asset={a}
                  uses={usedBy(a).length}
                  selected={a.relPath === selected}
                  onClick={() => setSelected(a.relPath)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="side-panel">
        {current ? (
          <BgDetail asset={current} usedBy={usedBy(current).map(sceneName)} />
        ) : (
          <p className="view-note">Select a background to see its details and GBA limit checks.</p>
        )}
      </div>
    </div>
  );
}

function BgCard({ asset, uses, selected, onClick }: { asset: AssetInfo; uses: number; selected: boolean; onClick: () => void }) {
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const url = useAssetUrl(rootPath, asset);
  return (
    <button className={`asset-card${selected ? " asset-card-selected" : ""}`} onClick={onClick}>
      <div className="asset-thumb">{url && <img src={url} alt="" />}</div>
      <div className="asset-meta">
        <span className="asset-name">{asset.fileName}</span>
        <span className="asset-detail">
          {uses ? `used by ${uses} scene${uses === 1 ? "" : "s"}` : "unused"} · {formatBytes(asset.bytes)}
        </span>
      </div>
    </button>
  );
}

function BgDetail({ asset, usedBy }: { asset: AssetInfo; usedBy: string[] }) {
  const project = useProjectStore((s) => s.project)!;
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const updateScene = useProjectStore((s) => s.updateScene);
  const addScene = useProjectStore((s) => s.addScene);
  const setSection = useProjectStore((s) => s.setSection);
  const url = useAssetUrl(project.rootPath, asset);
  const stats = useImageStats(url);
  const active = project.scenes.find((s) => s.fileId === activeSceneId);

  const checks: { ok: boolean; text: string }[] = [];
  if (stats) {
    const mult8 = stats.width % 8 === 0 && stats.height % 8 === 0;
    checks.push({ ok: mult8, text: `${stats.width}×${stats.height} px${mult8 ? ` = ${stats.width / 8}×${stats.height / 8} tiles` : " — must be multiples of 8"}` });
    checks.push({ ok: stats.width <= MAX_PX && stats.height <= MAX_PX, text: `Within ${MAX_PX}×${MAX_PX} max` });
    checks.push({ ok: stats.maxTileColors <= MAX_TILE_COLORS, text: `Busiest 8×8 tile uses ${stats.maxTileColors} colors (max ${MAX_TILE_COLORS})` });
    checks.push({
      ok: stats.uniqueTiles <= MAX_UNIQUE_TILES,
      text: `${stats.uniqueTiles} unique tiles${stats.uniqueTiles > MAX_UNIQUE_TILES ? " before flip-matching — may exceed" : ""} (max ${MAX_UNIQUE_TILES})`,
    });
    checks.push({ ok: true, text: `${stats.colors} colors total` });
  }

  return (
    <>
      <div className="side-title">{asset.fileName}</div>
      <div className="side-preview">{url && <img src={url} alt={asset.fileName} />}</div>
      <div className="check-list">
        {!stats && <span className="asset-detail">Checking…</span>}
        {checks.map((c, i) => (
          <span key={i} className={c.ok ? "check-ok" : "check-bad"}>
            {c.ok ? "✓" : <Icon name="warning" />} {c.text}
          </span>
        ))}
      </div>
      <div>
        <div className="asset-detail">Used by</div>
        {usedBy.length ? (
          <ul className="usage-list">
            {usedBy.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : (
          <div className="asset-detail">No scenes yet.</div>
        )}
      </div>
      <div className="side-actions">
        <button
          className="btn btn-primary btn-small"
          disabled={!active}
          onClick={() => {
            if (!active) return;
            updateScene(active.fileId, (s) => ({ ...s, background: backgroundRefFor(asset.relPath) }));
            setSection("world");
          }}
        >
          Use in {active ? `"${sceneName(active)}"` : "current scene"}
        </button>
        <button
          className="btn btn-small"
          onClick={async () => {
            await addScene(asset.name, backgroundRefFor(asset.relPath));
            setSection("world");
          }}
        >
          New scene from this
        </button>
        <button className="btn btn-small" onClick={() => window.api.revealInFolder({ rootPath: project.rootPath, relPath: asset.relPath })}>
          Show in folder
        </button>
      </div>
    </>
  );
}

function NewBackgroundForm({ onDone }: { onDone: (a: AssetInfo | null) => void }) {
  const rootPath = useProjectStore((s) => s.project!.rootPath);
  const refreshAssets = useProjectStore((s) => s.refreshAssets);
  const [name, setName] = useState("room");
  const [tw, setTw] = useState(30);
  const [th, setTh] = useState(20);
  const [color, setColor] = useState("#5a9e5a");
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    const r = await window.api.createBackground({ rootPath, name, width: tw * 8, height: th * 8, color });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    await refreshAssets();
    onDone(r.value);
  };

  return (
    <div className="inline-form">
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Width (tiles)
        <input type="number" min={1} max={256} value={tw} onChange={(e) => setTw(Math.max(1, Math.min(256, Number(e.target.value) || 1)))} />
      </label>
      <label>
        Height (tiles)
        <input type="number" min={1} max={256} value={th} onChange={(e) => setTh(Math.max(1, Math.min(256, Number(e.target.value) || 1)))} />
      </label>
      <label>
        Color
        <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
      </label>
      <span className="asset-detail">
        {tw * 8}×{th * 8} px · one GBA screen is 30×20 tiles
      </span>
      <button className="btn btn-primary" onClick={create}>
        Create
      </button>
      <button className="btn" onClick={() => onDone(null)}>
        Cancel
      </button>
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
