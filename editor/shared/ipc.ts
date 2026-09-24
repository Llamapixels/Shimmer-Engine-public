/**
 * The contract between the renderer (src/) and the main process
 * (electron/main.ts), exposed to the renderer as `window.api` by
 * electron/preload.ts. Both sides import these types so a change to one
 * shows up as a type error on the other, instead of a silent runtime
 * mismatch across the IPC boundary.
 */

import type { DoorJSON, NpcJSON, ProjectData, SceneJSON, TimerJSON } from "./projectTypes.js";

/** Result of a fallible main-process operation, returned instead of
 * thrown across IPC (structured-clone doesn't preserve Error subclasses
 * or stack traces usefully, so a plain {ok, error} shape is more honest
 * about what the renderer actually gets). */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: string };

export interface OpenProjectResult {
  data: ProjectData;
}

export interface SaveScenePayload {
  rootPath: string;
  fileId: string;
  scene: SceneJSON;
}

export interface CreateScenePayload {
  rootPath: string;
  /** Desired file stem, e.g. "new_scene" -> scenes/new_scene.json.
   * Main process de-dupes against existing files if it's taken. */
  fileId: string;
  scene: SceneJSON;
}

export interface CreateSceneResult {
  fileId: string;
  scene: SceneJSON;
}

export interface DeleteScenePayload {
  rootPath: string;
  fileId: string;
}

export interface SaveProjectPayload {
  rootPath: string;
  project: ProjectData["project"];
}

/** Which folder a relPath is relative to. "project" = the project
 * folder (project.json's folder). "engine" = the Shimmer Engine folder
 * that holds engine/ (found by walking up from the project - see
 * projectIO.findEngineRoot), where the player sprite and music live. */
export type AssetBase = "project" | "engine";

export interface ReadAssetPayload {
  rootPath: string;
  /** Path relative to the project root (or the engine root when
   * base is "engine"), e.g. "assets/backgrounds/town.png". */
  relPath: string;
  base?: AssetBase;
}

export interface ReadAssetResult {
  /** A data: URL, ready to drop straight into an <img>/canvas - avoids a
   * second IPC round trip just to learn the MIME type. */
  dataUrl: string;
}

export type AssetKind = "backgrounds" | "sprites" | "music";

export interface AssetInfo {
  /** File stem - what scene JSON refers to for sprites ("npc1") and
   * music ("template"). */
  name: string;
  fileName: string;
  /** Relative to `base`'s folder, forward slashes. */
  relPath: string;
  base: AssetBase;
  bytes: number;
  mtimeMs: number;
}

export interface AssetListing {
  backgrounds: AssetInfo[];
  sprites: AssetInfo[];
  music: AssetInfo[];
  /** Absolute path of the folder containing engine/, or null if this
   * project isn't inside a Shimmer Engine checkout (music and the
   * player sprite can't be listed then). */
  engineRoot: string | null;
}

export interface ImportAssetsPayload {
  rootPath: string;
  kind: AssetKind;
}

export interface SpriteNamePayload {
  rootPath: string;
  name: string;
}

export interface RenameSpritePayload {
  rootPath: string;
  from: string;
  to: string;
}

export interface CreateBackgroundPayload {
  rootPath: string;
  /** Desired file stem; de-duped against existing files. */
  name: string;
  /** Pixel size - must be multiples of 8 (the compiler's rule). */
  width: number;
  height: number;
  /** "#rrggbb" fill color. */
  color: string;
}

export interface NewProjectDialogResult {
  /** Folder the user picked to create the new project inside. */
  parentDir: string;
}

export interface CreateProjectPayload {
  parentDir: string;
  name: string;
}

export interface RevealPayload {
  rootPath: string;
  relPath: string;
  base?: AssetBase;
}

// ---------------------------------------------------------------------------
// Songs (assets/music/<name>.uge)
// ---------------------------------------------------------------------------

export interface SaveSongPayload {
  rootPath: string;
  /** File stem under assets/music/. */
  name: string;
  /** The .uge file's bytes, base64. */
  dataBase64: string;
}

export interface CreateSongPayload {
  rootPath: string;
  /** Desired name; cleaned up and de-duped. */
  name: string;
  dataBase64: string;
}

export interface SongNamePayload {
  rootPath: string;
  name: string;
}

export interface RenameSongPayload {
  rootPath: string;
  from: string;
  to: string;
}

export interface PickedFile {
  fileName: string;
  dataBase64: string;
}

// ---------------------------------------------------------------------------
// Build ROM
// ---------------------------------------------------------------------------

export interface BuildRomPayload {
  rootPath: string;
}

/** The build's own outcome, distinct from the transport-level IpcResult<T>
 * this rides inside (see IpcResult's doc comment) - a thrown error means
 * the request itself couldn't even be attempted (e.g. the project isn't
 * open, or a build is already running), while this union is the result of
 * an attempt that actually ran the compiler/engine toolchain. */
export type BuildRomResult =
  | { ok: true; romPath: string }
  | { ok: false; error: string };

/** One line of streamed output from a running build, pushed from main to
 * renderer as it happens (see IPC_CHANNELS.buildLog) - not part of the
 * request/response round trip, since the whole point is the renderer
 * doesn't have to wait for buildRom() to resolve to show progress.
 * "status" is for messages this app itself prints (which command it's
 * running, that it finished, etc.), as opposed to "stdout"/"stderr" which
 * are the child process's own output verbatim. */
export interface BuildLogEvent {
  stream: "stdout" | "stderr" | "status";
  line: string;
}

export interface CancelBuildResult {
  /** False if there was nothing running to cancel. */
  cancelled: boolean;
}

/** The shape electron/preload.ts exposes on window.api. Every method
 * mirrors one electron/main.ts handler by name (see IPC_CHANNELS). */
export interface ShimmerEngineApi {
  openProjectDialog(): Promise<IpcResult<OpenProjectResult | null>>;
  openProjectAtPath(rootPath: string): Promise<IpcResult<OpenProjectResult>>;
  saveProject(payload: SaveProjectPayload): Promise<IpcResult<void>>;
  saveScene(payload: SaveScenePayload): Promise<IpcResult<void>>;
  createScene(payload: CreateScenePayload): Promise<IpcResult<CreateSceneResult>>;
  deleteScene(payload: DeleteScenePayload): Promise<IpcResult<void>>;
  readAsset(payload: ReadAssetPayload): Promise<IpcResult<ReadAssetResult>>;
  listAssets(rootPath: string): Promise<IpcResult<AssetListing>>;
  /** Opens a file picker, copies the chosen files into the right folder,
   * returns the fresh listing (null if cancelled). */
  importAssets(payload: ImportAssetsPayload): Promise<IpcResult<AssetListing | null>>;
  /** Overwrite assets/sprites/<name>.png with a PNG the user picks (the
   * sprite keeps its animations). The fresh listing, or null if cancelled. */
  replaceSpriteImage(payload: SpriteNamePayload): Promise<IpcResult<AssetListing | null>>;
  /** Renames assets/sprites/<from>.png; resolves to the new name. */
  renameSprite(payload: RenameSpritePayload): Promise<IpcResult<string>>;
  deleteSprite(payload: SpriteNamePayload): Promise<IpcResult<void>>;
  createBackground(payload: CreateBackgroundPayload): Promise<IpcResult<AssetInfo>>;
  newProjectDialog(): Promise<IpcResult<NewProjectDialogResult | null>>;
  createProject(payload: CreateProjectPayload): Promise<IpcResult<OpenProjectResult>>;
  revealInFolder(payload: RevealPayload): Promise<IpcResult<void>>;
  saveSong(payload: SaveSongPayload): Promise<IpcResult<void>>;
  /** Resolves to the name the song was actually saved under. */
  createSong(payload: CreateSongPayload): Promise<IpcResult<string>>;
  deleteSong(payload: SongNamePayload): Promise<IpcResult<void>>;
  /** Resolves to the new name. */
  renameSong(payload: RenameSongPayload): Promise<IpcResult<string>>;
  /** File picker for a .mid file; null if cancelled. */
  pickMidiFile(): Promise<IpcResult<PickedFile | null>>;
  /** Runs the compiler + devkitARM build for a project, streaming
   * progress via onBuildLog while it runs. Resolves once the build has
   * finished (or failed to start/was cancelled) - see BuildRomResult. */
  buildRom(payload: BuildRomPayload): Promise<IpcResult<BuildRomResult>>;
  /** Kills the in-progress build, if any. */
  cancelBuild(): Promise<IpcResult<CancelBuildResult>>;
  /** Subscribes to streamed build output; returns an unsubscribe
   * function. There's only ever one build running at a time (see
   * buildRom), so this isn't scoped to a particular request. */
  onBuildLog(cb: (event: BuildLogEvent) => void): () => void;
}

export const IPC_CHANNELS = {
  openProjectDialog: "project:open-dialog",
  openProjectAtPath: "project:open-path",
  saveProject: "project:save",
  saveScene: "scene:save",
  createScene: "scene:create",
  deleteScene: "scene:delete",
  readAsset: "asset:read",
  listAssets: "asset:list",
  importAssets: "asset:import",
  replaceSpriteImage: "sprite:replace-image",
  renameSprite: "sprite:rename",
  deleteSprite: "sprite:delete",
  createBackground: "asset:create-background",
  newProjectDialog: "project:new-dialog",
  createProject: "project:create",
  revealInFolder: "asset:reveal",
  saveSong: "song:save",
  createSong: "song:create",
  deleteSong: "song:delete",
  renameSong: "song:rename",
  pickMidiFile: "song:pick-midi",
  buildRom: "build:run",
  cancelBuild: "build:cancel",
  /** Main -> renderer push event (webContents.send), not an
   * ipcRenderer.invoke channel like the others above - see
   * ShimmerEngineApi.onBuildLog. */
  buildLog: "build:log",
} as const;

export type { DoorJSON, NpcJSON, TimerJSON };
