import { useState } from "react";

import type { AssetKind } from "../../../shared/ipc";
import type { UiSettingsJSON } from "../../../shared/projectTypes";
import { useProjectStore } from "../../state/projectStore";
import DialogueBoxPreview, { BUILT_IN_UI as BUILT_IN, isBuiltIn, startName, uiAssetList } from "../common/DialogueBoxPreview";
import NumberInput from "../common/NumberInput";

const SAMPLE = "Hello there! The quick brown fox jumps over the lazy dog. 0123456789";

/** Dialogue look: which font/frame the game starts with, text speed, and
 * importing more of them. Mirrors compiler/ui.py. */
export default function DialogueCard() {
  const project = useProjectStore((s) => s.project)!;
  const assets = useProjectStore((s) => s.assets);
  const updateProject = useProjectStore((s) => s.updateProject);
  const [error, setError] = useState<string | null>(null);

  const [note, setNote] = useState<string | null>(null);

  const ui = project.project.ui ?? {};
  // A project file called "default" replaces the built-in one (compiler/ui.py).
  const fonts = uiAssetList(assets?.fonts ?? [], BUILT_IN.font, assets?.builtinFonts ?? []);
  const frames = uiAssetList(assets?.frames ?? [], BUILT_IN.frame);
  // Same fallback as the compiler: the first one in the folder, else the built-in one.
  const fontName = startName(ui.font, assets?.fonts ?? []);
  const frameName = startName(ui.frame, assets?.frames ?? []);
  const speed = ui.textSpeed ?? 1;

  const font = fonts.find((f) => f.name === fontName) ?? null;
  const frame = frames.find((f) => f.name === frameName) ?? null;

  const setUi = (patch: Partial<UiSettingsJSON>) =>
    updateProject((p) => ({ ...p, ui: { ...(p.ui ?? {}), ...patch } }));

  const doImport = async (kind: AssetKind) => {
    setError(null);
    const r = await window.api.importAssets({ rootPath: project.rootPath, kind });
    if (!r.ok) setError(r.error);
    else if (r.value) useProjectStore.setState({ assets: r.value });
  };

  const exportDefaults = async () => {
    setError(null);
    setNote(null);
    const r = await window.api.exportDefaultUi({ rootPath: project.rootPath });
    if (!r.ok) return setError(r.error);
    useProjectStore.setState({ assets: r.value.assets });
    const parts = [];
    if (r.value.written.length) parts.push(`Copied ${r.value.written.join(", ")}.`);
    if (r.value.skipped.length) parts.push(`Already there, left alone: ${r.value.skipped.join(", ")}.`);
    setNote(`${parts.join(" ")} Edit them in any image editor, then Asset Reload.`);
  };

  return (
    <div className="settings-card">
      <h3>Dialogue</h3>
      <p>
        Fonts are PNGs in assets/fonts: 8×8 characters, 16 per row, starting at the space. Magenta or transparent columns are trimmed,
        which makes the font variable width. Frames are 24×24 PNGs in assets/frames, cut into 3×3 tiles. GB Studio fonts and frames
        can be used as they are. All fonts, frames and the cursor share 15 colours.
      </p>
      <label className="settings-field">
        Font
        <div className="name-row">
          <select
            className={!font ? "select-invalid" : undefined}
            value={fontName}
            onChange={(e) => setUi({ font: e.target.value })}
          >
            {!font && <option value={fontName}>{fontName} (missing)</option>}
            {fonts.map((f) => (
              <option key={f.name} value={f.name}>
                {f === BUILT_IN.font
                  ? "default (built in)"
                  : f.name === "default"
                    ? "default (project copy)"
                    : isBuiltIn(f)
                      ? `${f.name} (built in)`
                      : f.name}
              </option>
            ))}
          </select>
          <button className="btn btn-small" onClick={() => doImport("fonts")}>
            Import…
          </button>
        </div>
      </label>
      <label className="settings-field">
        Frame
        <div className="name-row">
          <select
            className={!frame ? "select-invalid" : undefined}
            value={frameName}
            onChange={(e) => setUi({ frame: e.target.value })}
          >
            {!frame && <option value={frameName}>{frameName} (missing)</option>}
            {frames.map((f) => (
              <option key={f.relPath} value={f.name}>
                {f === BUILT_IN.frame ? "default (built in)" : f.name === "default" ? "default (project copy)" : f.name}
              </option>
            ))}
          </select>
          <button className="btn btn-small" onClick={() => doImport("frames")}>
            Import…
          </button>
        </div>
      </label>
      <label className="settings-field">
        Text speed (frames per letter, 0 = instant)
        <NumberInput value={speed} min={0} max={30} onChange={(n) => setUi({ textSpeed: n })} />
      </label>
      <div className="name-row" style={{ marginBottom: 10 }}>
        <button className="btn btn-small" onClick={exportDefaults} title="Copy the built-in font, frame and cursor into this project to edit them">
          Copy built-in font and frame to project
        </button>
        <button className="btn btn-small" onClick={() => void window.api.openProjectFolder({ rootPath: project.rootPath })}>
          Open project folder
        </button>
      </div>
      {note && <p>{note}</p>}
      {error && <p className="field-error">{error}</p>}
      <DialogueBoxPreview text={SAMPLE} fontName={fontName} frameName={frameName} maxPages={1} />
      <p style={{ marginTop: 8 }}>
        In text: <code>!F:name!</code> switches font, <code>!S2!</code> sets the speed. The Set Font, Set Dialogue Frame and Set Text
        Speed events change them for the rest of the game.
      </p>
    </div>
  );
}
