import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync } from "node:fs";
import path from "node:path";

import { IPC_CHANNELS } from "../shared/ipc.js";
import type {
  BuildRomPayload,
  CreateBackgroundPayload,
  CreateProjectPayload,
  CreateScenePayload,
  DeleteScenePayload,
  ImportAssetsPayload,
  IpcResult,
  ReadAssetPayload,
  ReplacePlayerSpritePayload,
  RevealPayload,
  SaveProjectPayload,
  SaveScenePayload,
} from "../shared/ipc.js";
import * as buildRunner from "./buildRunner.js";
import * as projectIO from "./projectIO.js";

// __dirname is a CommonJS global (see electron/tsconfig.json's doc
// comment on why this compiles as CommonJS) - Node provides it
// automatically here, no import.meta/fileURLToPath computation needed.

// vite.config.ts pins the dev server to this exact port (strictPort:
// true).
const DEV_SERVER_URL = "http://localhost:5173";

// Which renderer to load: the dev server, or the built dist/index.html.
// This can't just be "is the app packaged" (app.isPackaged), because an
// *unpackaged* run also needs to pick correctly between two cases: `npm
// run dev` (electron/tsconfig.json output only, no `dist/` yet - wants
// the dev server) and `npm start` after `npm run build` (both `dist/`
// and dist-electron/ exist - wants the built file, not a dev server
// that probably isn't even running). Checking whether the built file
// actually exists on disk answers that correctly in every case,
// packaged or not, with nothing extra to configure or pass through.
const builtIndexHtml = path.join(__dirname, "..", "..", "dist", "index.html");
const useDevServer = !existsSync(builtIndexHtml);

let mainWindow: BrowserWindow | null = null;

/** Project folders the user has actually opened or created this session.
 * Every handler that reads or writes project files checks its rootPath
 * against this, so the renderer can only ever touch projects the user
 * chose - not arbitrary folders it names. */
const openedRoots = new Set<string>();

/** The folder picked in the New Project dialog - createProject only
 * accepts this one, not any path the renderer makes up. */
let pickedParentDir: string | null = null;

function trackRoot<T extends { data: { rootPath: string } }>(result: T): T {
  openedRoots.add(path.resolve(result.data.rootPath));
  return result;
}

function checkRoot(rootPath: string): void {
  if (!openedRoots.has(path.resolve(rootPath))) {
    throw new Error("That project isn't open.");
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: "#20232b",
    titleBarStyle: "hiddenInset",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      // NOT sandboxed. Electron's sandboxed preload context only gets a
      // tiny allowlisted require() (electron, events, timers, url, a
      // few others) - it can't load arbitrary local files, which is
      // exactly what preload.js needs (it requires ../shared/ipc.js for
      // the IPC_CHANNELS constants both sides share) - see the "Error:
      // module not found: ../shared/ipc.js" crash this replaced.
      // contextIsolation + nodeIntegration: false are what actually
      // keep the renderer sandboxed from Node/Electron internals - the
      // preload script itself is trusted code we wrote, so giving it
      // full Node access to do that one require is fine; it still only
      // exposes the narrow window.api surface (see preload.ts) to the
      // page.
      sandbox: false,
    },
  });

  if (useDevServer) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(builtIndexHtml);
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

/** Wraps a handler so a thrown Error becomes an {ok:false, error} the
 * renderer can show the user, instead of an unhandled IPC rejection with
 * a stack trace that means nothing to them (see shared/ipc.ts's
 * IpcResult doc comment for why this crosses the boundary as data). */
function handle<Args extends unknown[], T>(
  channel: string,
  fn: (...args: Args) => Promise<T>,
): void {
  ipcMain.handle(channel, async (_event, ...args: Args): Promise<IpcResult<T>> => {
    try {
      const value = await fn(...args);
      return { ok: true, value };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}

function registerIpcHandlers(): void {
  handle(IPC_CHANNELS.openProjectDialog, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Open Shimmer Engine Project",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return trackRoot(await projectIO.openProjectAtPath(result.filePaths[0]));
  });

  // Used for "Recent projects" - opening only reads project.json and
  // scenes/*.json, and a successful open is what grants write access.
  handle(IPC_CHANNELS.openProjectAtPath, async (rootPath: string) =>
    trackRoot(await projectIO.openProjectAtPath(rootPath)),
  );

  handle(IPC_CHANNELS.saveProject, async (payload: SaveProjectPayload) => {
    checkRoot(payload.rootPath);
    return projectIO.saveProject(payload);
  });

  handle(IPC_CHANNELS.saveScene, async (payload: SaveScenePayload) => {
    checkRoot(payload.rootPath);
    return projectIO.saveScene(payload);
  });

  handle(IPC_CHANNELS.createScene, async (payload: CreateScenePayload) => {
    checkRoot(payload.rootPath);
    return projectIO.createScene(payload);
  });

  handle(IPC_CHANNELS.deleteScene, async (payload: DeleteScenePayload) => {
    checkRoot(payload.rootPath);
    return projectIO.deleteScene(payload.rootPath, payload.fileId);
  });

  handle(IPC_CHANNELS.readAsset, async (payload: ReadAssetPayload) => {
    checkRoot(payload.rootPath);
    return projectIO.readAsset(payload);
  });

  handle(IPC_CHANNELS.listAssets, async (rootPath: string) => {
    checkRoot(rootPath);
    return projectIO.listAssets(rootPath);
  });

  handle(IPC_CHANNELS.importAssets, async (payload: ImportAssetsPayload) => {
    checkRoot(payload.rootPath);
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Import ${payload.kind}`,
      properties: ["openFile", "multiSelections"],
      filters: projectIO.importFilters(payload.kind),
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return projectIO.importAssetFiles(payload.rootPath, payload.kind, result.filePaths);
  });

  handle(IPC_CHANNELS.replacePlayerSprite, async (payload: ReplacePlayerSpritePayload) => {
    checkRoot(payload.rootPath);
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Replace player sprite sheet",
      properties: ["openFile"],
      filters: [{ name: "PNG images", extensions: ["png"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return projectIO.replacePlayerSprite(payload.rootPath, result.filePaths[0]);
  });

  handle(IPC_CHANNELS.createBackground, async (payload: CreateBackgroundPayload) => {
    checkRoot(payload.rootPath);
    return projectIO.createBackground(payload);
  });

  handle(IPC_CHANNELS.newProjectDialog, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choose where to create the new project",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    pickedParentDir = result.filePaths[0];
    return { parentDir: result.filePaths[0] };
  });

  handle(IPC_CHANNELS.createProject, async (payload: CreateProjectPayload) => {
    if (!pickedParentDir || path.resolve(payload.parentDir) !== path.resolve(pickedParentDir)) {
      throw new Error("Choose a folder for the new project first.");
    }
    return trackRoot(await projectIO.createProject(payload));
  });

  handle(IPC_CHANNELS.revealInFolder, async (payload: RevealPayload) => {
    checkRoot(payload.rootPath);
    const abs = await projectIO.resolveAssetPath(payload.rootPath, payload.relPath, payload.base ?? "project");
    shell.showItemInFolder(abs);
  });

  handle(IPC_CHANNELS.buildRom, async (payload: BuildRomPayload) => {
    checkRoot(payload.rootPath);
    if (buildRunner.isBuildRunning()) {
      // Belt-and-suspenders alongside the renderer's own "disable while
      // running" guard (see src/state/buildStore.ts) - this is the one
      // that actually matters, since it's enforced regardless of what
      // the renderer does or how many windows/callers there are.
      throw new Error("A build is already running.");
    }
    const toolchainRoot = await projectIO.findEngineRoot(payload.rootPath);
    if (!toolchainRoot) {
      throw new Error("Couldn't find the compiler/engine folder above this project.");
    }
    return buildRunner.buildRom(payload.rootPath, toolchainRoot, (event) => {
      mainWindow?.webContents.send(IPC_CHANNELS.buildLog, event);
    });
  });

  handle(IPC_CHANNELS.cancelBuild, async () => {
    return { cancelled: buildRunner.cancelBuild() };
  });
}

app.setName("Shimmer Engine");

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
