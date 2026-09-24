import { useProjectStore } from "../../state/projectStore";

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
        {!known && <option value={cur}>{cur} (not in engine/music)</option>}
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
