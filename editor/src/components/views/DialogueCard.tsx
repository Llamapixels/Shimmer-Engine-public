import { useEffect, useRef, useState } from "react";

import type { AssetInfo, AssetKind } from "../../../shared/ipc";
import type { UiSettingsJSON } from "../../../shared/projectTypes";
import { useProjectStore } from "../../state/projectStore";
import NumberInput from "../common/NumberInput";
import { useAssetUrl } from "./assetImages";

/** The built-in font/frame (engine/data/ui), shown as "default". */
const BUILT_IN: Record<"font" | "frame", AssetInfo> = {
  font: { name: "default", fileName: "font.png", relPath: "engine/data/ui/font.png", base: "engine", bytes: 0, mtimeMs: 0 },
  frame: { name: "default", fileName: "frame.png", relPath: "engine/data/ui/frame.png", base: "engine", bytes: 0, mtimeMs: 0 },
};

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
  const withDefault = (list: AssetInfo[], builtIn: AssetInfo) => [
    list.find((a) => a.name === "default") ?? builtIn,
    ...list.filter((a) => a.name !== "default"),
  ];
  const fonts = withDefault(assets?.fonts ?? [], BUILT_IN.font);
  const frames = withDefault(assets?.frames ?? [], BUILT_IN.frame);
  // Same fallback as the compiler: the first one in the folder, else the built-in one.
  const fontName = ui.font || (fonts[1] ?? fonts[0]).name;
  const frameName = ui.frame || (frames[1] ?? frames[0]).name;
  const speed = ui.textSpeed ?? 1;

  const font = fonts.find((f) => f.name === fontName) ?? null;
  const frame = frames.find((f) => f.name === frameName) ?? null;
  const fontUrl = useAssetUrl(project.rootPath, font);
  const frameUrl = useAssetUrl(project.rootPath, frame);

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
                {f === BUILT_IN.font ? "default (built in)" : f.name === "default" ? "default (project copy)" : f.name}
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
      <DialoguePreview fontUrl={fontUrl} frameUrl={frameUrl} />
      <p style={{ marginTop: 8 }}>
        In text: <code>!F:name!</code> switches font, <code>!S2!</code> sets the speed. The Set Font, Set Dialogue Frame and Set Text
        Speed events change them for the rest of the game.
      </p>
    </div>
  );
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

function pixels(img: HTMLImageElement): ImageData {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, img.width, img.height);
}

/** A 2-line dialogue box drawn the way the engine draws it (ui.c). */
function DialoguePreview({ fontUrl, frameUrl }: { fontUrl: string | null; frameUrl: string | null }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!fontUrl || !frameUrl) return;
    let cancelled = false;
    Promise.all([loadImage(fontUrl), loadImage(frameUrl)]).then(([fontImg, frameImg]) => {
      const canvas = ref.current;
      if (cancelled || !canvas) return;
      const g = canvas.getContext("2d")!;
      const W = 240;
      const H = 32;
      const out = g.createImageData(W, H);
      const put = (x: number, y: number, d: Uint8ClampedArray, i: number) => {
        if (x < 0 || y < 0 || x >= W || y >= H) return;
        const o = (y * W + x) * 4;
        out.data[o] = d[i];
        out.data[o + 1] = d[i + 1];
        out.data[o + 2] = d[i + 2];
        out.data[o + 3] = 255;
      };

      // Frame: 9-slice over 30x4 tiles.
      const fr = pixels(frameImg);
      if (fr.width === 24 && fr.height === 24) {
        for (let ty = 0; ty < 4; ty++)
          for (let tx = 0; tx < 30; tx++) {
            const sx = tx === 0 ? 0 : tx === 29 ? 2 : 1;
            const sy = ty === 0 ? 0 : ty === 3 ? 2 : 1;
            for (let y = 0; y < 8; y++)
              for (let x = 0; x < 8; x++) {
                const i = ((sy * 8 + y) * 24 + sx * 8 + x) * 4;
                if (fr.data[i + 3] >= 128) put(tx * 8 + x, ty * 8 + y, fr.data, i);
              }
          }
      }

      // Font: same rules as compiler/ui.py's load_font().
      const f = pixels(fontImg);
      const cols = Math.floor(f.width / 8);
      const rows = Math.floor(f.height / 8);
      if (cols < 1 || rows < 1) return;
      const first = cols * rows <= 224 ? 32 : 0;
      const at = (x: number, y: number) => (y * f.width + x) * 4;
      const trim = (i: number) => f.data[i + 3] < 128 || (f.data[i] > 249 && f.data[i + 2] > 249 && f.data[i + 1] < 10);
      const counts = new Map<string, number>();
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          const i = at(x, y);
          if (trim(i)) continue;
          const k = `${f.data[i]},${f.data[i + 1]},${f.data[i + 2]}`;
          counts.set(k, (counts.get(k) ?? 0) + 1);
        }
      const bg = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const cell = (code: number) => {
        const n = code - first;
        if (n < 0 || n >= cols * rows) return null;
        const cx = (n % cols) * 8;
        const cy = Math.floor(n / cols) * 8;
        const used: number[] = [];
        for (let x = 0; x < 8; x++) {
          let any = false;
          for (let y = 0; y < 8; y++) if (!trim(at(cx + x, cy + y))) any = true;
          if (any) used.push(x);
        }
        return { cx, cy, used };
      };
      let variable = false;
      for (let c = first; c < first + cols * rows && !variable; c++) {
        const u = cell(c)?.used ?? [];
        if (u.length && (u[0] > 0 || u[u.length - 1] < 7)) variable = true;
      }

      let x = 8;
      let line = 0;
      for (const word of SAMPLE.split(" ")) {
        const glyphs = [...word, " "].map((ch) => cell(ch.charCodeAt(0)) ?? cell(63));
        const width = (gl: ReturnType<typeof cell>) =>
          !variable ? 8 : !gl ? 0 : gl.used.length ? gl.used[gl.used.length - 1] - gl.used[0] + 1 : 3;
        const w = glyphs.slice(0, -1).reduce((s, gl) => s + width(gl), 0);
        if (x > 8 && x + w > 232) {
          line++;
          x = 8;
        }
        if (line > 1) break;
        for (const gl of glyphs) {
          if (!gl) continue;
          const left = variable && gl.used.length ? gl.used[0] : 0;
          for (let y = 0; y < 8; y++)
            for (let px = left; px < 8; px++) {
              const i = at(gl.cx + px, gl.cy + y);
              if (trim(i) || `${f.data[i]},${f.data[i + 1]},${f.data[i + 2]}` === bg) continue;
              if (x + px - left < 232) put(x + px - left, 8 + line * 8 + y, f.data, i);
            }
          x += width(gl);
        }
      }
      g.putImageData(out, 0, 0);
    });
    return () => {
      cancelled = true;
    };
  }, [fontUrl, frameUrl]);

  return (
    <canvas
      ref={ref}
      width={240}
      height={32}
      style={{ width: "100%", maxWidth: 480, imageRendering: "pixelated", display: "block", background: "var(--bg-0)" }}
    />
  );
}
