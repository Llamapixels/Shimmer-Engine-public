import { contextBridge, ipcRenderer } from "electron";

import { IPC_CHANNELS } from "../shared/ipc.js";
import type { ShimmerEngineApi, BuildLogEvent } from "../shared/ipc.js";

// contextIsolation is on (see main.ts's webPreferences), so this is the
// only surface the renderer gets: no direct ipcRenderer/node access,
// just these named methods - each a thin 1:1 wrapper over one
// electron/main.ts IPC handler. Parameter types come from the
// ShimmerEngineApi annotation, so a mismatch with shared/ipc.ts is a
// compile error here.
const api: ShimmerEngineApi = {
  openProjectDialog: () => ipcRenderer.invoke(IPC_CHANNELS.openProjectDialog),
  openProjectAtPath: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.openProjectAtPath, rootPath),
  saveProject: (payload) => ipcRenderer.invoke(IPC_CHANNELS.saveProject, payload),
  saveScene: (payload) => ipcRenderer.invoke(IPC_CHANNELS.saveScene, payload),
  createScene: (payload) => ipcRenderer.invoke(IPC_CHANNELS.createScene, payload),
  deleteScene: (payload) => ipcRenderer.invoke(IPC_CHANNELS.deleteScene, payload),
  readAsset: (payload) => ipcRenderer.invoke(IPC_CHANNELS.readAsset, payload),
  listAssets: (rootPath) => ipcRenderer.invoke(IPC_CHANNELS.listAssets, rootPath),
  importAssets: (payload) => ipcRenderer.invoke(IPC_CHANNELS.importAssets, payload),
  replacePlayerSprite: (payload) => ipcRenderer.invoke(IPC_CHANNELS.replacePlayerSprite, payload),
  createBackground: (payload) => ipcRenderer.invoke(IPC_CHANNELS.createBackground, payload),
  newProjectDialog: () => ipcRenderer.invoke(IPC_CHANNELS.newProjectDialog),
  createProject: (payload) => ipcRenderer.invoke(IPC_CHANNELS.createProject, payload),
  revealInFolder: (payload) => ipcRenderer.invoke(IPC_CHANNELS.revealInFolder, payload),
  saveSong: (payload) => ipcRenderer.invoke(IPC_CHANNELS.saveSong, payload),
  createSong: (payload) => ipcRenderer.invoke(IPC_CHANNELS.createSong, payload),
  deleteSong: (payload) => ipcRenderer.invoke(IPC_CHANNELS.deleteSong, payload),
  renameSong: (payload) => ipcRenderer.invoke(IPC_CHANNELS.renameSong, payload),
  pickMidiFile: () => ipcRenderer.invoke(IPC_CHANNELS.pickMidiFile),
  buildRom: (payload) => ipcRenderer.invoke(IPC_CHANNELS.buildRom, payload),
  cancelBuild: () => ipcRenderer.invoke(IPC_CHANNELS.cancelBuild),
  onBuildLog: (cb) => {
    const listener = (_event: unknown, data: BuildLogEvent) => cb(data);
    ipcRenderer.on(IPC_CHANNELS.buildLog, listener);
    return () => ipcRenderer.removeListener(IPC_CHANNELS.buildLog, listener);
  },
};

contextBridge.exposeInMainWorld("api", api);
