import { app, BrowserWindow, dialog, ipcMain, Menu, shell, type MenuItemConstructorOptions } from "electron";
import { existsSync } from "node:fs";
import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { IPC_CHANNELS, THEMES, type MenuCommand, type ThemeId } from "../shared/ipc.js";
import type {
  BuildRomPayload,
  OpenRomPayload,
  CreateBackgroundPayload,
  CreateProjectPayload,
  CreateScenePayload,
  CreateSongPayload,
  RenameSongPayload,
  SaveSongPayload,
  SongNamePayload,
  DeleteScenePayload,
  MoveScenePayload,
  ImportAssetsPayload,
  IpcResult,
  ReadAssetPayload,
  RenameSpritePayload,
  SpriteNamePayload,
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
    backgroundColor: "#1c1c1c",
    // The window/taskbar icon (editor/resources/icon.png).
    icon: path.join(__dirname, "..", "..", "resources", process.platform === "win32" ? "icon.ico" : "icon.png"),
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

// ---------------------------------------------------------------------------
// App settings (just the theme for now), kept in the user data folder so
// the View > Theme radio is right before the renderer has even loaded.

const settingsFile = () => path.join(app.getPath("userData"), "settings.json");
let theme: ThemeId = "dark";

async function loadSettings(): Promise<void> {
  try {
    const s = JSON.parse(await readFile(settingsFile(), "utf-8")) as { theme?: string };
    if (THEMES.some((t) => t.id === s.theme)) theme = s.theme as ThemeId;
  } catch {
    /* first run, or unreadable - keep the default */
  }
}

function setTheme(next: ThemeId): void {
  theme = next;
  void writeFile(settingsFile(), JSON.stringify({ theme }, null, 2)).catch(() => {});
  Menu.setApplicationMenu(buildMenu());
  sendMenuCommand({ kind: "theme", theme });
}

function sendMenuCommand(command: MenuCommand): void {
  mainWindow?.webContents.send(IPC_CHANNELS.menuCommand, command);
}

/** Folders and files Save As leaves out of the copy: build output only. */
const SAVE_AS_SKIP = new Set(["build", "ROM"]);

function registerIpcHandlers(): void {
  handle(IPC_CHANNELS.getTheme, async () => theme);

  // File > Save As: copy the whole project folder (assets, scenes,
  // project.json - not build output) to a new folder, then open it.
  handle(IPC_CHANNELS.saveProjectAs, async (payload: { rootPath: string }) => {
    checkRoot(payload.rootPath);
    if (!mainWindow) return null;
    const src = path.resolve(payload.rootPath);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: "Save Project As",
      buttonLabel: "Save Project Here",
      defaultPath: `${src} copy`,
      properties: ["createDirectory", "showOverwriteConfirmation"],
    });
    if (result.canceled || !result.filePath) return null;
    const dest = path.resolve(result.filePath);
    if (dest === src || dest.startsWith(src + path.sep)) {
      throw new Error("Pick a folder outside the current project.");
    }
    if (existsSync(dest)) throw new Error(`"${dest}" already exists - pick a new name.`);
    await cp(src, dest, {
      recursive: true,
      filter: (from) => {
        const rel = path.relative(src, from);
        return !SAVE_AS_SKIP.has(rel.split(path.sep)[0]);
      },
    });
    return trackRoot(await projectIO.openProjectAtPath(dest));
  });

  // "Open example": copy the demo project somewhere writable (Documents)
  // the first time, then open that copy.
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

  handle(IPC_CHANNELS.moveScene, async (payload: MoveScenePayload) => {
    checkRoot(payload.rootPath);
    return projectIO.moveScene(payload);
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

  handle(IPC_CHANNELS.replaceSpriteImage, async (payload: SpriteNamePayload) => {
    checkRoot(payload.rootPath);
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: `Replace ${payload.name}.png`,
      properties: ["openFile"],
      filters: [{ name: "PNG images", extensions: ["png"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return projectIO.replaceSpriteImage(payload.rootPath, payload.name, result.filePaths[0]);
  });

  handle(IPC_CHANNELS.renameSprite, async (payload: RenameSpritePayload) => {
    checkRoot(payload.rootPath);
    return projectIO.renameSprite(payload.rootPath, payload.from, payload.to);
  });

  handle(IPC_CHANNELS.deleteSprite, async (payload: SpriteNamePayload) => {
    checkRoot(payload.rootPath);
    return projectIO.deleteSprite(payload.rootPath, payload.name);
  });

  handle(IPC_CHANNELS.createBackground, async (payload: CreateBackgroundPayload) => {
    checkRoot(payload.rootPath);
    return projectIO.createBackground(payload);
  });

  handle(IPC_CHANNELS.saveSong, async (payload: SaveSongPayload) => {
    checkRoot(payload.rootPath);
    return projectIO.saveSong(payload.rootPath, payload.name, payload.dataBase64);
  });

  handle(IPC_CHANNELS.createSong, async (payload: CreateSongPayload) => {
    checkRoot(payload.rootPath);
    return projectIO.createSong(payload.rootPath, payload.name, payload.dataBase64);
  });

  handle(IPC_CHANNELS.deleteSong, async (payload: SongNamePayload) => {
    checkRoot(payload.rootPath);
    return projectIO.deleteSong(payload.rootPath, payload.name);
  });

  handle(IPC_CHANNELS.renameSong, async (payload: RenameSongPayload) => {
    checkRoot(payload.rootPath);
    return projectIO.renameSong(payload.rootPath, payload.from, payload.to);
  });

  handle(IPC_CHANNELS.pickMidiFile, async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Import MIDI file",
      properties: ["openFile"],
      filters: [{ name: "MIDI files", extensions: ["mid", "midi"] }],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const file = result.filePaths[0];
    return { fileName: path.basename(file), dataBase64: (await readFile(file)).toString("base64") };
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

  handle(IPC_CHANNELS.openProjectFolder, async (payload: { rootPath: string }) => {
    checkRoot(payload.rootPath);
    const err = await shell.openPath(payload.rootPath);
    if (err) throw new Error(err);
  });

  handle(IPC_CHANNELS.exportDefaultUi, async (payload: { rootPath: string }) => {
    checkRoot(payload.rootPath);
    return projectIO.exportDefaultUi(payload.rootPath);
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

  handle(IPC_CHANNELS.openRom, async (payload: OpenRomPayload) => {
    checkRoot(payload.rootPath);
    const rom = path.resolve(payload.romPath);
    if (!rom.startsWith(path.resolve(payload.rootPath) + path.sep) || !rom.toLowerCase().endsWith(".gba")) {
      throw new Error("That isn't this project's ROM.");
    }
    // Opens the ROM with whatever program .gba files are set to open with.
    const err = await shell.openPath(rom);
    if (err) {
      throw new Error(
        `Couldn't open the ROM (${err}). Install a GBA emulator such as mGBA and set it as the program for .gba files.`,
      );
    }
  });

  handle(IPC_CHANNELS.cancelBuild, async () => {
    return { cancelled: buildRunner.cancelBuild() };
  });
}

app.setName("Shimmer Engine");

const ITCH_URL = "https://holocatt.itch.io/shimmerengine";
const REDDIT_URL = "https://www.reddit.com/r/ShimmerEngine/";

/** The app menu: Electron's standard File/Edit/View/Window menus, then
 * Help (just About - no documentation links) and Community. */
function buildMenu(): Menu {
  const isMac = process.platform === "darwin";
  const showAbout = () => mainWindow?.webContents.send(IPC_CHANNELS.showAbout);
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        { label: "New Project…", accelerator: "CmdOrCtrl+N", click: () => sendMenuCommand({ kind: "newProject" }) },
        { label: "Open Project…", accelerator: "CmdOrCtrl+O", click: () => sendMenuCommand({ kind: "openProject" }) },
        { type: "separator" },
        { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendMenuCommand({ kind: "save" }) },
        { label: "Save As…", accelerator: "CmdOrCtrl+Shift+S", click: () => sendMenuCommand({ kind: "saveAs" }) },
        { type: "separator" },
        { label: "Reload Assets", accelerator: "F5", click: () => sendMenuCommand({ kind: "reloadAssets" }) },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "Exit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [
        {
          label: "Theme",
          submenu: THEMES.map((t) => ({
            label: t.label,
            type: "radio" as const,
            checked: t.id === theme,
            click: () => setTheme(t.id),
          })),
        },
        { type: "separator" },
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [{ label: "About Shimmer Engine", click: showAbout }],
    },
    {
      label: "Community",
      submenu: [
        { label: "Shimmer Engine on Reddit", click: () => void shell.openExternal(REDDIT_URL) },
        { label: "Check for Updates", click: () => void shell.openExternal(ITCH_URL) },
      ],
    },
  ];
  return Menu.buildFromTemplate(template);
}

app.whenReady().then(async () => {
  await loadSettings();
  // The installed app carries its engine and toolchain in resources/toolchain;
  // a dev build uses the repository it runs from.
  projectIO.setDefaultEngineRoot(
    app.isPackaged ? path.join(process.resourcesPath, "toolchain") : path.resolve(__dirname, "..", "..", ".."),
  );
  Menu.setApplicationMenu(buildMenu());
  registerIpcHandlers();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
