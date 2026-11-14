import SoundPreviewButton from "../common/SoundPreview";
import { useEffect, useState } from "react";

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
        can be used as they are. All fonts, frames and the cursor share 15 colors.
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
      <label className="settings-field">
        Boxes open and close with
        <select
          value={ui.boxTransition ?? "none"}
          onChange={(e) => setUi({ boxTransition: e.target.value as NonNullable<UiSettingsJSON["boxTransition"]> })}
        >
          <option value="none">Nothing (they just appear)</option>
          <option value="fade">A fade</option>
          <option value="swipe_left">A swipe from the left</option>
          <option value="swipe_right">A swipe from the right</option>
          <option value="swipe_up">A swipe up from the bottom</option>
          <option value="swipe_down">A swipe down from the top</option>
          <option value="tv">An old TV turning on and off</option>
          <option value="book">A book page turning</option>
        </select>
      </label>
      {(ui.boxTransition ?? "none") !== "none" && (
        <label className="settings-field">
          Taking (frames, 60 = a second)
          <NumberInput
            value={ui.boxTransitionFrames ?? 12}
            min={1}
            max={60}
            onChange={(n) => setUi({ boxTransitionFrames: n })}
          />
        </label>
      )}
      <div className="settings-field">
        Menu cursor (choices, menus, save slots)
        <CursorChoice value={ui.cursor ?? "custom"} onChange={(v) => setUi({ cursor: v })} />
      </div>
      <label className="settings-field">
        Sound when a text box opens
        <SoundChoice value={ui.textSound ?? "blip"} onChange={(v) => setUi({ textSound: v })} />
      </label>
      <label className="settings-field">
        When a scene change switches music
        <select value={ui.musicFade ?? 0} onChange={(e) => setUi({ musicFade: Number(e.target.value) || undefined })}>
          <option value={0}>Cut straight to the new music</option>
          {[15, 30, 45, 60, 90].map((f) => (
            <option key={f} value={f}>
              Fade out and in over {+(f / 60).toFixed(2)} s
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        Sound simple door triggers play (each trigger can choose its own)
        <SoundChoice value={ui.doorSound ?? "door"} onChange={(v) => setUi({ doorSound: v })} />
      </label>
      <label className="settings-field settings-check">
        <input type="checkbox" checked={ui.hudSeeThrough !== false} onChange={(e) => setUi({ hudSeeThrough: e.target.checked })} />
        HUD boxes and Draw Text turn see-through while the player is behind them
      </label>
      <label className="settings-field settings-check">
        <input type="checkbox" checked={ui.skipWithB !== false} onChange={(e) => setUi({ skipWithB: e.target.checked })} />
        Hold B to skip through text (shows each page at once and turns it after a moment)
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

/** None, a built-in sound or a WAV from assets/sounds. */
const CURSOR_STYLES = [
  { value: "default", label: "Arrow (built in)" },
  { value: "triangle", label: "Triangle" },
  { value: "big_arrow", label: "Big arrow" },
  { value: "dot", label: "Dot" },
  { value: "bar", label: "Bar" },
  { value: "heart", label: "Heart" },
  { value: "star", label: "Star" },
  { value: "custom", label: "My own (assets/ui/cursor.png)" },
];

/** The menu cursor: a built-in style or the project's own 8x8 PNG, with a
 * big preview of it. */
function CursorChoice({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    const tryRead = async () => {
      // The project's own cursor (also what "custom" falls back from).
      if (value === "custom") {
        const own = await window.api.readAsset({ rootPath, relPath: "assets/ui/cursor.png", base: "project" });
        if (own.ok) return { url: own.value.dataUrl, missing: false };
      }
      const rel = value === "default" || value === "custom" ? "engine/data/ui/cursor.png" : `engine/data/ui/cursors/${value}.png`;
      const r = await window.api.readAsset({ rootPath, relPath: rel, base: "engine" });
      return { url: r.ok ? r.value.dataUrl : null, missing: value === "custom" };
    };
    void tryRead().then((r) => {
      if (cancelled) return;
      setUrl(r.url);
      setMissing(r.missing);
    });
    return () => {
      cancelled = true;
    };
  }, [rootPath, value]);
  return (
    <div className="cursor-choice">
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {CURSOR_STYLES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <span className="cursor-preview" title="How it looks (8x8, shown 4x)">
        {url && <img src={url} alt="" />}
      </span>
      {missing && (
        <span className="cursor-hint">No assets/ui/cursor.png yet (using the arrow): draw an 8x8 one in the Art Editor and save it there.</span>
      )}
    </div>
  );
}

export function SoundChoice({ value, onChange, extra }: { value: string; onChange: (v: string) => void; extra?: { value: string; label: string } }) {
  const wavs = useProjectStore((s) => s.assets?.sounds ?? []);
  return (
    <div className="sound-choice">
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {extra && <option value={extra.value}>{extra.label}</option>}
      <option value="none">None (silent)</option>
      <optgroup label="Built in">
        {["blip", "door", "save", "item"].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </optgroup>
      {wavs.length > 0 && (
        <optgroup label="WAV (assets/sounds)">
          {wavs.map((w) => (
            <option key={w.name} value={w.name}>
              {w.name}
            </option>
          ))}
        </optgroup>
      )}
    </select>
    <SoundPreviewButton name={value} />
    </div>
  );
}
