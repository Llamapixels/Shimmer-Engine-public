import { useEffect, useRef, useState } from "react";

import type { AssetInfo } from "../../../shared/ipc";
import { useProjectStore } from "../../state/projectStore";
import { loadAssetUrl } from "../views/assetImages";
import { BOX_W, boxHeight, drawPage, fontsIn, layoutPages, loadImage, parseFont, parseFrame, type UiFont } from "./dialogueRender";

/** The built-in font/frame (engine/data/ui), shown as "default". */
export const BUILT_IN_UI: Record<"font" | "frame", AssetInfo> = {
  font: { name: "default", fileName: "font.png", relPath: "engine/data/ui/font.png", base: "engine", bytes: 0, mtimeMs: 0 },
  frame: { name: "default", fileName: "frame.png", relPath: "engine/data/ui/frame.png", base: "engine", bytes: 0, mtimeMs: 0 },
};

/** Project fonts/frames plus the built-in "default" (a project file called
 * "default" replaces it, as in compiler/ui.py), then the app's other
 * built-in fonts that no project font replaces. */
export function uiAssetList(list: AssetInfo[], builtIn: AssetInfo, extra: AssetInfo[] = []): AssetInfo[] {
  const own = list.filter((a) => a.name !== "default");
  return [
    list.find((a) => a.name === "default") ?? builtIn,
    ...own,
    ...extra.filter((b) => b.name !== "default" && !own.some((a) => a.name === b.name)),
  ];
}

/** What the game starts with when the setting is empty - same as the
 * compiler: the first one in the project's folder, else the built-in one. */
export function startName(setting: string | undefined, projectList: AssetInfo[]): string {
  return setting || projectList.find((a) => a.name !== "default")?.name || "default";
}

/** Is this a font/frame that ships with the app rather than the project? */
export function isBuiltIn(asset: AssetInfo): boolean {
  return asset.base === "engine";
}

/** The font and frame the game starts with. */
export function useStartUi(): { fonts: AssetInfo[]; frames: AssetInfo[]; fontName: string; frameName: string } {
  const project = useProjectStore((s) => s.project);
  const assets = useProjectStore((s) => s.assets);
  const ui = project?.project.ui ?? {};
  const fonts = uiAssetList(assets?.fonts ?? [], BUILT_IN_UI.font, assets?.builtinFonts ?? []);
  const frames = uiAssetList(assets?.frames ?? [], BUILT_IN_UI.frame);
  return {
    fonts,
    frames,
    fontName: startName(ui.font, assets?.fonts ?? []),
    frameName: startName(ui.frame, assets?.frames ?? []),
  };
}

const fontCache = new Map<string, Promise<UiFont | null>>();
const frameCache = new Map<string, Promise<ImageData | null>>();

function loadParsed<T>(cache: Map<string, Promise<T | null>>, rootPath: string, asset: AssetInfo, parse: (img: HTMLImageElement) => T | null) {
  const key = `${rootPath}|${asset.base}|${asset.relPath}|${asset.mtimeMs}`;
  let p = cache.get(key);
  if (!p) {
    p = loadAssetUrl(rootPath, asset)
      .then((url) => (url ? loadImage(url) : null))
      .then((img) => (img ? parse(img) : null))
      .catch(() => null);
    cache.set(key, p);
  }
  return p;
}

/**
 * Dialogue text drawn as the game will show it: the box with its frame,
 * the font(s), word wrap and pages (a new line = a new page; text that
 * doesn't fit carries on to the next one).
 */
export default function DialogueBoxPreview({
  text,
  fontName,
  frameName,
  maxPages = 8,
  lines = 2,
  framed = true,
}: {
  text: string;
  /** Defaults to the font/frame the game starts with. */
  fontName?: string;
  frameName?: string;
  maxPages?: number;
  /** Display Text's "rows" and "frame" options. */
  lines?: number;
  framed?: boolean;
}) {
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const start = useStartUi();
  const font = fontName ?? start.fontName;
  const frame = frameName ?? start.frameName;
  const [pages, setPages] = useState<ImageData[]>([]);

  const wanted = [font, ...fontsIn(text)];
  const fontAssets = start.fonts.filter((f) => wanted.includes(f.name));
  const frameAsset = start.frames.find((f) => f.name === frame) ?? null;
  const assetKey = [...fontAssets.map((f) => `${f.relPath}|${f.mtimeMs}`), frameAsset ? `${frameAsset.relPath}|${frameAsset.mtimeMs}` : ""].join(";");

  useEffect(() => {
    if (!rootPath) return;
    let cancelled = false;
    Promise.all([
      Promise.all(fontAssets.map((a) => loadParsed(fontCache, rootPath, a, parseFont).then((f) => [a.name, f] as const))),
      frameAsset ? loadParsed(frameCache, rootPath, frameAsset, parseFrame) : Promise.resolve(null),
    ]).then(([loaded, frameData]) => {
      if (cancelled) return;
      const fonts: Record<string, UiFont> = {};
      for (const [name, f] of loaded) if (f) fonts[name] = f;
      setPages(layoutPages(text, fonts, font, lines).map((p) => drawPage(p, fonts, frameData, lines, framed)));
    });
    return () => {
      cancelled = true;
    };
    // fontAssets/frameAsset are covered by assetKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rootPath, text, font, assetKey, lines, framed]);

  const shown = pages.slice(0, maxPages);
  return (
    <div className="dialogue-preview">
      {shown.map((img, i) => (
        <div key={i} className="dialogue-preview-page">
          {pages.length > 1 && (
            <span className="dialogue-preview-label">
              Page {i + 1}/{pages.length}
            </span>
          )}
          <PageCanvas image={img} />
        </div>
      ))}
      {pages.length > shown.length && <span className="dialogue-preview-label">…and {pages.length - shown.length} more</span>}
    </div>
  );
}

function PageCanvas({ image }: { image: ImageData }) {
  const height = image.height || boxHeight();
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    ref.current?.getContext("2d")?.putImageData(image, 0, 0);
  }, [image]);
  return (
    <canvas
      ref={ref}
      width={BOX_W}
      height={height}
      style={{ width: "100%", maxWidth: 480, imageRendering: "pixelated", display: "block", background: "var(--bg-0)" }}
    />
  );
}
