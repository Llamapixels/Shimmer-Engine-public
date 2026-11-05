import { useProjectStore } from "../../state/projectStore";
import { useAssetUrl, useImageStats } from "../views/assetImages";
import { SCENE_MAX_TILES } from "../sceneColor";

/** Scene JSON's "background" is relative to scenes/<file>.json (see the
 * compiler's scene_file.parent / scene["background"]). */
export function backgroundRefFor(relPath: string): string {
  return `../${relPath}`;
}

interface BgProps {
  value: string;
  onChange: (ref: string) => void;
}

export function BackgroundSelect({ value, onChange }: BgProps) {
  const assets = useProjectStore((s) => s.assets);
  const setSection = useProjectStore((s) => s.setSection);
  const options = (assets?.backgrounds ?? []).map((a) => ({ ref: backgroundRefFor(a.relPath), label: a.fileName }));
  const known = options.some((o) => o.ref === value);

  return (
    <div className="asset-select">
      <select className={!value || !known ? "select-invalid" : undefined} value={value} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">Choose a background…</option>}
        {value && !known && <option value={value}>{value} (not in assets/backgrounds)</option>}
        {options.map((o) => (
          <option key={o.ref} value={o.ref}>
            {o.label}
          </option>
        ))}
      </select>
      <button className="btn btn-small" onClick={() => setSection("backgrounds")} title="Import or create backgrounds">
        Browse…
      </button>
    </div>
  );
}

/** The scene's background at a glance: a thumbnail, its size, tiles and colors. */
export function BackgroundCard({ value }: { value: string }) {
  const assets = useProjectStore((s) => s.assets);
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const asset = (assets?.backgrounds ?? []).find((a) => backgroundRefFor(a.relPath) === value) ?? null;
  const url = useAssetUrl(rootPath, asset);
  const stats = useImageStats(url);
  if (!asset) return null;
  const tw = stats ? Math.floor(stats.width / 8) : 0;
  const th = stats ? Math.floor(stats.height / 8) : 0;
  const over = stats ? stats.uniqueTiles > SCENE_MAX_TILES : false;
  return (
    <div className="bg-card">
      <div className="bg-card-thumb">{url && <img src={url} alt="" draggable={false} />}</div>
      <div className="bg-card-info">
        <div className="bg-card-name" title={asset.fileName}>
          {asset.fileName.replace(/\.png$/i, "")}
        </div>
        {stats ? (
          <>
            <div>
              Size: {tw}×{th} tiles <span className="bg-card-dim">({stats.width}×{stats.height} px)</span>
            </div>
            <div className={over ? "bg-card-over" : undefined} title="Different 8x8 tiles (flipped copies count once when building)">
              Tiles: {stats.uniqueTiles} / {SCENE_MAX_TILES}
            </div>
            <div title="Different colors in the image (each 8x8 tile can use up to 15 plus the backdrop)">Colors: {stats.colors}</div>
          </>
        ) : (
          <div className="bg-card-dim">Reading…</div>
        )}
      </div>
    </div>
  );
}

interface NameProps {
  value: string | undefined;
  onChange: (name: string | undefined) => void;
}

export function SpriteSelect({ value, onChange }: NameProps) {
  const assets = useProjectStore((s) => s.assets);
  const setSection = useProjectStore((s) => s.setSection);
  const cur = value ?? "player";
  const names = ["player", ...(assets?.sprites ?? []).map((a) => a.name)];
  const known = names.includes(cur);
  return (
    <div className="asset-select">
      <select className={!known ? "select-invalid" : undefined} value={cur} onChange={(e) => onChange(e.target.value)}>
        {!known && <option value={cur}>{cur} (no assets/sprites/{cur}.png)</option>}
        {names.map((n) => (
          <option key={n} value={n}>
            {n === "player" ? "player (built-in)" : n}
          </option>
        ))}
      </select>
      <button className="btn btn-small" onClick={() => setSection("sprites")}>
        Browse…
      </button>
    </div>
  );
}

export function MusicSelect({ value, onChange }: NameProps) {
  const assets = useProjectStore((s) => s.assets);
  const setSection = useProjectStore((s) => s.setSection);
  const names = (assets?.music ?? []).map((a) => a.name);
  const cur = value ?? "";
  const known = !cur || names.includes(cur);
  return (
    <div className="asset-select">
      <select
        className={!known ? "select-invalid" : undefined}
        value={cur}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">(none — keep current music)</option>
        {!known && <option value={cur}>{cur} (not in assets/music)</option>}
        {names.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      <button className="btn btn-small" onClick={() => setSection("music")}>
        Browse…
      </button>
    </div>
  );
}
