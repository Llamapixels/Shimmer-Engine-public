/**
 * All filesystem access for a project lives here, isolated from
 * electron/main.ts's window/IPC wiring so it can be reasoned about (and
 * eventually unit-tested) without spinning up Electron at all.
 *
 * Every function reads/writes the exact same project.json /
 * scenes/<name>.json shape compiler/build_project.py already consumes -
 * see shared/projectTypes.ts's doc comment. Nothing here invents a
 * second project format.
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { parseHexColor, readPngSize, solidColorPng } from "./png.js";

import type {
  AssetBase,
  AssetInfo,
  AssetKind,
  AssetListing,
  CreateBackgroundPayload,
  CreateProjectPayload,
  CreateScenePayload,
  CreateSceneResult,
  ReadAssetPayload,
  ReadAssetResult,
  SaveProjectPayload,
  SaveScenePayload,
  MoveScenePayload,
} from "../shared/ipc.js";
import type { OpenProjectResult } from "../shared/ipc.js";
import type { ProjectJSON, SceneJSON, SceneRecord } from "../shared/projectTypes.js";

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".uge": "application/octet-stream",
  ".wav": "audio/wav",
};

/** JSON.stringify with the same 2-space indent + trailing newline
 * convention build_project.py uses for the one file it writes back on
 * its own (a scene's auto-filled blank collision grid), so files stay
 * diff-friendly regardless of whether the editor or the compiler last
 * touched them. */
function writeJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function sceneFilePath(rootPath: string, fileId: string): string {
  // fileId comes from the renderer - never let it walk out of scenes/.
  // It's the file's path under scenes/ without ".json", "/"-separated
  // when the scene is in a folder (GB Studio style, see moveScene()).
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/.test(fileId)) throw new Error(`Invalid scene id "${fileId}".`);
  return path.join(rootPath, "scenes", ...fileId.split("/")) + ".json";
}

/** Every scene file's id (path under scenes/ without .json), subfolders too. */
async function listSceneIds(dir: string, prefix = ""): Promise<string[]> {
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const n of names.sort()) {
    const st = await fs.stat(path.join(dir, n));
    if (st.isDirectory()) out.push(...(await listSceneIds(path.join(dir, n), `${prefix}${n}/`)));
    else if (n.endsWith(".json")) out.push(prefix + n.slice(0, -".json".length));
  }
  return out;
}

/** Remove the now-empty folders a scene file was in, up to scenes/. */
async function pruneEmptySceneDirs(rootPath: string, fileId: string): Promise<void> {
  const parts = fileId.split("/").slice(0, -1);
  while (parts.length) {
    const dir = path.join(rootPath, "scenes", ...parts);
    try {
      if ((await fs.readdir(dir)).length) return;
      await fs.rmdir(dir);
    } catch {
      return;
    }
    parts.pop();
  }
}

/** A scene name's folders as a path under scenes/, the way GB Studio
 * makes them: "Forest/Cave 1" -> "forest" (lowercase, spaces as "_"). */
function sceneFolderFor(name: string): string {
  return name
    .split("/")
    .slice(0, -1)
    .map((p) =>
      p
        .trim()
        .toLowerCase()
        .replace(/\s+/g, "_")
        .replace(/[^a-z0-9_-]+/g, ""),
    )
    .filter(Boolean)
    .join("/");
}

/** Guards against a relPath that escapes the project root (e.g. via
 * "../../etc/passwd") before it's ever handed to fs - readAsset is the
 * one place the renderer gets to name an arbitrary path under the
 * project, so it's the one place this needs checking. */
function resolveWithinRoot(rootPath: string, relPath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolved = path.resolve(resolvedRoot, relPath);
  if (resolved !== resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep)) {
    throw new Error(`"${relPath}" resolves outside the project folder.`);
  }
  return resolved;
}

/** Turns a Python-style file-stem identity ("town" for scenes/town.json)
 * into a safe filesystem-legal id from an arbitrary desired name, and
 * de-dupes it against files that already exist - used by createScene so
 * "New Scene" / "New Scene" twice doesn't clobber the first one. */
async function uniqueFileId(rootPath: string, desired: string): Promise<string> {
  const base =
    desired
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "scene";

  let candidate = base;
  let n = 2;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fs.access(sceneFilePath(rootPath, candidate));
      candidate = `${base}_${n}`;
      n += 1;
    } catch {
      return candidate;
    }
  }
}

export async function openProjectAtPath(rootPath: string): Promise<OpenProjectResult> {
  const projectFile = path.join(rootPath, "project.json");
  const raw = await fs.readFile(projectFile, "utf-8").catch(() => {
    throw new Error(`No project.json in ${rootPath}`);
  });
  const project = JSON.parse(raw) as ProjectJSON;

  // No scenes/ directory yet (a brand-new project) just means no scenes.
  const sceneIds = await listSceneIds(path.join(rootPath, "scenes"));

  const scenes: SceneRecord[] = [];
  for (const fileId of sceneIds) {
    const sceneRaw = await fs.readFile(sceneFilePath(rootPath, fileId), "utf-8");
    const data = JSON.parse(sceneRaw) as SceneJSON;
    scenes.push({ fileId, data });
  }

  await ensureAssetFolders(rootPath).catch(() => undefined);
  await ensurePlayerSprite(rootPath, project).catch(() => undefined);
  return { data: { rootPath, project, scenes } };
}

export async function saveProject(payload: SaveProjectPayload): Promise<void> {
  const projectFile = path.join(payload.rootPath, "project.json");
  await fs.writeFile(projectFile, writeJson(payload.project), "utf-8");
}

export async function saveScene(payload: SaveScenePayload): Promise<void> {
  const file = sceneFilePath(payload.rootPath, payload.fileId);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, writeJson(payload.scene), "utf-8");
}

/** Put a scene's file in the folder its name says (GB Studio: a scene
 * called "Forest/Cave 1" lives in scenes/forest/), writing `scene` there
 * and removing the old file. Returns the new file id. */
export async function moveScene(payload: MoveScenePayload): Promise<string> {
  const { rootPath, fileId, scene } = payload;
  const folder = sceneFolderFor(scene.name ?? "");
  const base = fileId.split("/").pop()!;
  let next = folder ? `${folder}/${base}` : base;
  if (next === fileId) return fileId;
  for (let n = 2; await exists(sceneFilePath(rootPath, next)); n++) next = `${folder ? `${folder}/` : ""}${base}_${n}`;
  const file = sceneFilePath(rootPath, next);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, writeJson(scene), "utf-8");
  await fs.unlink(sceneFilePath(rootPath, fileId));
  await pruneEmptySceneDirs(rootPath, fileId);
  return next;
}

export async function createScene(payload: CreateScenePayload): Promise<CreateSceneResult> {
  const scenesDir = path.join(payload.rootPath, "scenes");
  await fs.mkdir(scenesDir, { recursive: true });
  const fileId = await uniqueFileId(payload.rootPath, payload.fileId);
  await fs.writeFile(sceneFilePath(payload.rootPath, fileId), writeJson(payload.scene), "utf-8");
  return { fileId, scene: payload.scene };
}

export async function deleteScene(rootPath: string, fileId: string): Promise<void> {
  await fs.unlink(sceneFilePath(rootPath, fileId));
  await pruneEmptySceneDirs(rootPath, fileId);
}

export async function readAsset(payload: ReadAssetPayload): Promise<ReadAssetResult> {
  const base = await baseDir(payload.rootPath, payload.base ?? "project");
  const abs = resolveWithinRoot(base, payload.relPath);
  const ext = path.extname(abs).toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) {
    throw new Error(`Unsupported asset type "${ext}" for ${payload.relPath}.`);
  }
  const bytes = await fs.readFile(abs);
  return { dataUrl: `data:${mime};base64,${bytes.toString("base64")}` };
}

// ---------------------------------------------------------------------------
// Assets: listing, importing, generating blank backgrounds
// ---------------------------------------------------------------------------

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** The toolchain folder the app itself uses (see setDefaultEngineRoot). */
let defaultEngineRoot: string | null = null;

/** Called once at startup: the installed app's bundled toolchain, or the
 * repository checkout the dev build runs from. */
export function setDefaultEngineRoot(root: string | null): void {
  defaultEngineRoot = root;
}

/** The toolchain folder (containing engine/) to build a project with: a
 * checkout the project lives inside (walking up from it, e.g.
 * examples/demo -> ../../), else the app's own. */
export async function findEngineRoot(rootPath: string): Promise<string | null> {
  let dir = path.resolve(rootPath);
  for (let i = 0; i < 8; i++) {
    if (await exists(path.join(dir, "engine", "Makefile"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (defaultEngineRoot && (await exists(path.join(defaultEngineRoot, "engine", "source")))) return defaultEngineRoot;
  return null;
}

async function baseDir(rootPath: string, base: AssetBase): Promise<string> {
  if (base === "project") return rootPath;
  const engineRoot = await findEngineRoot(rootPath);
  if (!engineRoot) throw new Error("Couldn't find the Shimmer Engine toolchain folder above this project.");
  return engineRoot;
}

/** Every folder a project can hold assets in. Made (empty) for new projects
 * and on open, so people can see where things go. */
const ASSET_FOLDERS = [
  "assets/backgrounds",
  "assets/sprites",
  "assets/music",
  "assets/sounds",
  "assets/fonts",
  "assets/frames",
  "assets/ui",
];

async function ensureAssetFolders(rootPath: string): Promise<void> {
  for (const rel of ASSET_FOLDERS) await fs.mkdir(path.join(rootPath, rel), { recursive: true });
}

const IMAGE_EXTS = [".png"];
/* .uge = hUGETracker / GB Studio songs (compiled by compiler/uge.py, played
 * by engine/source/huge.c). */
const MUSIC_EXTS = [".uge"];
const MUSIC_DIR = "assets/music";

/** Folder each asset kind lives in, relative to its base. */
function assetFolder(kind: AssetKind): { base: AssetBase; rel: string; exts: string[] } {
  switch (kind) {
    case "backgrounds":
      return { base: "project", rel: "assets/backgrounds", exts: IMAGE_EXTS };
    case "sprites":
      return { base: "project", rel: "assets/sprites", exts: IMAGE_EXTS };
    case "music":
      return { base: "project", rel: MUSIC_DIR, exts: MUSIC_EXTS };
    case "fonts":
      return { base: "project", rel: "assets/fonts", exts: IMAGE_EXTS };
    case "frames":
      return { base: "project", rel: "assets/frames", exts: IMAGE_EXTS };
    case "sounds":
      return { base: "project", rel: "assets/sounds", exts: [".wav"] };
  }
}

/** The folder's assets. With `subfolders`, files in subfolders too, named
 * "folder/name" (sprites: a "/" in a sprite's name is a subfolder). */
async function listFolder(
  baseAbs: string,
  base: AssetBase,
  rel: string,
  exts: string[],
  subfolders = false,
  prefix = "",
): Promise<AssetInfo[]> {
  const dir = path.join(baseAbs, rel);
  let names: string[] = [];
  try {
    names = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: AssetInfo[] = [];
  for (const fileName of names.sort((a, b) => a.localeCompare(b))) {
    const st = await fs.stat(path.join(dir, fileName));
    if (st.isDirectory() && subfolders) {
      out.push(...(await listFolder(baseAbs, base, `${rel}/${fileName}`, exts, true, `${prefix}${fileName}/`)));
      continue;
    }
    const ext = path.extname(fileName).toLowerCase();
    if (!exts.includes(ext) || !st.isFile()) continue;
    out.push({
      name: prefix + fileName.slice(0, -ext.length),
      fileName,
      relPath: `${rel}/${fileName}`,
      base,
      bytes: st.size,
      mtimeMs: st.mtimeMs,
    });
  }
  return out;
}

export async function listAssets(rootPath: string): Promise<AssetListing> {
  const engineRoot = await findEngineRoot(rootPath);
  const backgrounds = await listFolder(rootPath, "project", "assets/backgrounds", IMAGE_EXTS);
  const sprites = await listFolder(rootPath, "project", "assets/sprites", IMAGE_EXTS, true);
  const music = await listFolder(rootPath, "project", MUSIC_DIR, MUSIC_EXTS);
  const fonts = await listFolder(rootPath, "project", "assets/fonts", IMAGE_EXTS);
  const frames = await listFolder(rootPath, "project", "assets/frames", IMAGE_EXTS);
  // GB Studio keeps its one frame in assets/ui/frame.png; compiler/ui.py
  // picks that up as a frame called "frame".
  if (!frames.some((f) => f.name === "frame")) {
    const ui = (await listFolder(rootPath, "project", "assets/ui", IMAGE_EXTS)).find((f) => f.name === "frame");
    if (ui) frames.unshift(ui);
  }

  const sounds = await listFolder(rootPath, "project", "assets/sounds", [".wav"]);

  return { backgrounds, sprites, music, fonts, frames, sounds, engineRoot };
}

/** A file name that doesn't collide with anything already in `dir`:
 * "town.png" -> "town_2.png" -> "town_3.png"... Importing never
 * overwrites an existing asset silently. */
async function uniqueFileName(dir: string, stem: string, ext: string, clashExts: string[] = [ext]): Promise<string> {
  const taken = async (name: string) => {
    for (const e of clashExts) if (await exists(path.join(dir, `${name}${e}`))) return true;
    return false;
  };
  let name = stem;
  let n = 2;
  while (await taken(name)) {
    name = `${stem}_${n}`;
    n += 1;
  }
  return `${name}${ext}`;
}

/** Asset names end up in scene JSON and (for sprites/music) in generated
 * C identifiers, so keep them to plain lowercase letters/digits/_. */
function safeStem(name: string, fallback: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || fallback
  );
}

export async function importAssetFiles(rootPath: string, kind: AssetKind, sourcePaths: string[]): Promise<AssetListing> {
  const folder = assetFolder(kind);
  const baseAbs = await baseDir(rootPath, folder.base);
  const destDir = path.join(baseAbs, folder.rel);
  await fs.mkdir(destDir, { recursive: true });

  for (const src of sourcePaths) {
    const ext = path.extname(src).toLowerCase();
    if (!folder.exts.includes(ext)) {
      throw new Error(`"${path.basename(src)}" isn't a ${folder.exts.join("/")} file.`);
    }
    const stem = safeStem(path.basename(src, path.extname(src)), kind === "music" ? "track" : kind === "sounds" ? "sound" : "image");
    const fileName = await uniqueFileName(destDir, stem, ext, kind === "fonts" ? [ext, ".json"] : [ext]);
    await fs.copyFile(src, path.join(destDir, fileName));
    // A GB Studio font's .json (character mapping) comes along with it.
    const meta = src.slice(0, -ext.length) + ".json";
    if (kind === "fonts" && (await exists(meta))) {
      await fs.copyFile(meta, path.join(destDir, fileName.slice(0, -ext.length) + ".json"));
    }
  }
  return listAssets(rootPath);
}

/** Copies engine/data/ui's font, frame and cursor into the project under
 * the names that replace the built-in ones. Never overwrites. */
export async function exportDefaultUi(rootPath: string): Promise<{ written: string[]; skipped: string[]; assets: AssetListing }> {
  const engineRoot = await findEngineRoot(rootPath);
  if (!engineRoot) throw new Error("Couldn't find the Shimmer Engine toolchain folder, which has the built-in font and frame.");
  const src = path.join(engineRoot, "engine", "data", "ui");
  const files: [string, string][] = [
    ["font.png", "assets/fonts/default.png"],
    ["frame.png", "assets/frames/default.png"],
    ["cursor.png", "assets/ui/cursor.png"],
  ];
  const written: string[] = [];
  const skipped: string[] = [];
  for (const [from, rel] of files) {
    const dest = path.join(rootPath, rel);
    if (await exists(dest)) {
      skipped.push(rel);
      continue;
    }
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(src, from), dest);
    written.push(rel);
  }
  return { written, skipped, assets: await listAssets(rootPath) };
}

const SPRITES_DIR = "assets/sprites";

function spritePath(rootPath: string, name: string): string {
  if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`"${name}" isn't a valid sprite name (use a-z, 0-9 and _).`);
  return path.join(rootPath, SPRITES_DIR, `${name}.png`);
}

/** Overwrites assets/sprites/<name>.png with `sourcePath`. */
export async function replaceSpriteImage(rootPath: string, name: string, sourcePath: string): Promise<AssetListing> {
  if (path.extname(sourcePath).toLowerCase() !== ".png") throw new Error(`"${path.basename(sourcePath)}" isn't a PNG file.`);
  const data = await fs.readFile(sourcePath);
  try {
    readPngSize(data);
  } catch {
    throw new Error(`"${path.basename(sourcePath)}" isn't a valid PNG file.`);
  }
  const file = spritePath(rootPath, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return listAssets(rootPath);
}

/** Renames assets/sprites/<from>.png. Returns the new name (cleaned up,
 * and refused if another sprite already has it). */
export async function renameSprite(rootPath: string, from: string, to: string): Promise<string> {
  // "Forest/tree" puts it in a Forest subfolder, which the lists show as a folder.
  const parts = to.split("/").map((p) => safeStem(p, ""));
  const name = parts.filter(Boolean).join("/");
  if (!parts[parts.length - 1]) throw new Error("Sprite names need at least one letter or digit.");
  if (name === from) return name;
  if (await exists(spritePath(rootPath, name))) throw new Error(`There's already a sprite called "${name}".`);
  await fs.mkdir(path.dirname(spritePath(rootPath, name)), { recursive: true });
  await fs.rename(spritePath(rootPath, from), spritePath(rootPath, name));
  return name;
}

export async function deleteSprite(rootPath: string, name: string): Promise<void> {
  await fs.rm(spritePath(rootPath, name));
}

/** Sprites are per project: a project that uses the default player sprite
 * but has no assets/sprites/player.png gets a copy of the engine's. */
async function ensurePlayerSprite(rootPath: string, project: ProjectJSON): Promise<void> {
  if ((project.playerSprite || "player") !== "player") return;
  const dest = path.join(rootPath, SPRITES_DIR, "player.png");
  if (await exists(dest)) return;
  const engineRoot = await findEngineRoot(rootPath);
  const src = engineRoot && path.join(engineRoot, "engine", "data", "player.png");
  if (!src || !(await exists(src))) return;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

export function importFilters(kind: AssetKind): { name: string; extensions: string[] }[] {
  const folder = assetFolder(kind);
  const label = kind === "music" ? "hUGETracker / GB Studio songs" : kind === "sounds" ? "WAV sounds" : "PNG images";
  return [{ name: label, extensions: folder.exts.map((e) => e.slice(1)) }];
}

// ---------------------------------------------------------------------------
// Songs (assets/music/*.uge), written by the music editor
// ---------------------------------------------------------------------------

function songPath(rootPath: string, name: string): string {
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`"${name}" isn't a valid song name (use a-z, 0-9 and _).`);
  return path.join(rootPath, MUSIC_DIR, `${name}.uge`);
}

/** Overwrites assets/music/<name>.uge with the song's bytes. */
export async function saveSong(rootPath: string, name: string, dataBase64: string): Promise<void> {
  const file = songPath(rootPath, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, Buffer.from(dataBase64, "base64"));
  await fs.rename(tmp, file);
}

/** Writes a new song under a name that doesn't clash with an existing one
 * (desiredName is cleaned up first). Returns the name it got. */
export async function createSong(rootPath: string, desiredName: string, dataBase64: string): Promise<string> {
  const dir = path.join(rootPath, MUSIC_DIR);
  await fs.mkdir(dir, { recursive: true });
  const fileName = await uniqueFileName(dir, safeStem(desiredName, "song"), ".uge");
  const name = fileName.slice(0, -4);
  await saveSong(rootPath, name, dataBase64);
  return name;
}

export async function deleteSong(rootPath: string, name: string): Promise<void> {
  await fs.rm(songPath(rootPath, name));
}

/** Renames assets/music/<from>.uge. Returns the new name (cleaned up, and
 * refused if another song already has it). */
export async function renameSong(rootPath: string, from: string, to: string): Promise<string> {
  const name = safeStem(to, "");
  if (!name) throw new Error("Song names need at least one letter or digit.");
  if (name === from) return name;
  if (await exists(songPath(rootPath, name))) throw new Error(`There's already a song called "${name}".`);
  await fs.rename(songPath(rootPath, from), songPath(rootPath, name));
  return name;
}

export async function createBackground(payload: CreateBackgroundPayload): Promise<AssetInfo> {
  const { width, height } = payload;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("Width and height must be positive whole numbers.");
  }
  if (width % 8 || height % 8) throw new Error("Width and height must be multiples of 8.");
  if (width > 2048 || height > 2048) throw new Error("Backgrounds are capped at 2048x2048 px.");

  const destDir = path.join(payload.rootPath, "assets", "backgrounds");
  await fs.mkdir(destDir, { recursive: true });
  const fileName = await uniqueFileName(destDir, safeStem(payload.name, "background"), ".png");
  const png = solidColorPng(width, height, parseHexColor(payload.color));
  await fs.writeFile(path.join(destDir, fileName), png);
  const st = await fs.stat(path.join(destDir, fileName));
  return {
    name: fileName.slice(0, -4),
    fileName,
    relPath: `assets/backgrounds/${fileName}`,
    base: "project",
    bytes: st.size,
    mtimeMs: st.mtimeMs,
  };
}

export async function resolveAssetPath(rootPath: string, relPath: string, base: AssetBase): Promise<string> {
  return resolveWithinRoot(await baseDir(rootPath, base), relPath);
}

// ---------------------------------------------------------------------------
// New project
// ---------------------------------------------------------------------------

/** GBA screen size - the starting scene fills exactly one screen. */
const START_BG_W = 240;
const START_BG_H = 160;

export async function createProject(payload: CreateProjectPayload): Promise<OpenProjectResult> {
  const name = payload.name.trim();
  if (!name) throw new Error("Give the project a name.");
  const folderName = safeStem(name, "project");
  const rootPath = path.join(payload.parentDir, folderName);

  if (await exists(rootPath)) {
    const contents = await fs.readdir(rootPath);
    if (contents.length > 0) {
      throw new Error(`A folder named "${folderName}" already exists there and isn't empty.`);
    }
  }

  await fs.mkdir(path.join(rootPath, "scenes"), { recursive: true });
  await ensureAssetFolders(rootPath);

  await fs.writeFile(
    path.join(rootPath, "assets", "backgrounds", "start.png"),
    solidColorPng(START_BG_W, START_BG_H, [0x5a, 0x9e, 0x5a]),
  );

  const project: ProjectJSON = { name, start_scene: "start", items: [], flags: [], variables: [] };
  await fs.writeFile(path.join(rootPath, "project.json"), writeJson(project), "utf-8");

  const scene: SceneJSON = {
    name: "start",
    background: "../assets/backgrounds/start.png",
    player_start: { x: 14, y: 9 },
  };
  await fs.writeFile(sceneFilePath(rootPath, "start"), writeJson(scene), "utf-8");

  return openProjectAtPath(rootPath);
}
