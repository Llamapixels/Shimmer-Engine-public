/**
 * UI state for the "Build ROM" feature - kept separate from
 * projectStore.ts (which is about the project's own data and undo
 * history) since a build isn't project data, just a transient
 * long-running action against whatever project is currently open. See
 * electron/buildRunner.ts for what actually runs the build.
 */
import { BUILD_SUCCESS_ART } from "../components/buildArt";
import { create } from "zustand";

import type { BuildLogEvent, BuildRomResult } from "../../shared/ipc";

export type BuildStatus = "idle" | "running" | "success" | "error" | "cancelled";

interface BuildState {
  open: boolean;
  status: BuildStatus;
  log: BuildLogEvent[];
  result: BuildRomResult | null;
  /** The project this build (or the last one) ran against - kept so the
   * "Reveal in Folder" button on a finished panel still knows where to
   * point even after the user switches sections. */
  rootPath: string | null;
  unsubscribe: (() => void) | null;

  openPanel: () => void;
  closePanel: () => void;
  /** Build; with `play`, open the ROM in the user's emulator afterwards. */
  startBuild: (rootPath: string, play?: boolean) => Promise<void>;
  requestCancel: () => Promise<void>;
}

export const useBuildStore = create<BuildState>((set, get) => ({
  open: false,
  status: "idle",
  log: [],
  result: null,
  rootPath: null,
  unsubscribe: null,

  openPanel: () => set({ open: true }),

  closePanel: () => {
    // Closing mid-build would drop the only place progress is shown, and
    // the toolbar guards against starting a second build anyway - so
    // this is a no-op while running rather than a silent background
    // build the user has no way back into.
    if (get().status === "running") return;
    set({ open: false });
  },

  startBuild: async (rootPath: string, play = false) => {
    if (get().status === "running") return;

    get().unsubscribe?.();
    const unsubscribe = window.api.onBuildLog((event) => {
      set((s) => ({ log: [...s.log, event] }));
    });

    set({ open: true, status: "running", log: [], result: null, rootPath, unsubscribe });

    let res: Awaited<ReturnType<typeof window.api.buildRom>>;
    try {
      res = await window.api.buildRom({ rootPath });
    } catch (err) {
      res = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    get().unsubscribe?.();
    set({ unsubscribe: null });

    if (!res.ok) {
      // The build couldn't even start (e.g. the project wasn't open or
      // the engine folder wasn't found) - nothing reached the log, so put
      // the reason there.
      set((s) => ({
        status: "error",
        result: { ok: false, error: res.ok ? "" : res.error },
        log: [...s.log, { stream: "status", line: res.ok ? "" : res.error }],
      }));
      return;
    }

    if (res.value.ok) {
      set((s) => ({ status: "success", result: res.value, log: [...s.log, { stream: "art", line: BUILD_SUCCESS_ART }] }));
      if (play) {
        const opened = await window.api.openRom({ rootPath, romPath: res.value.romPath });
        if (opened.ok) set({ open: false });
        else set((s) => ({ log: [...s.log, { stream: "stderr", line: opened.error }] }));
      }
    } else {
      set({
        status: res.value.error === "Build cancelled." ? "cancelled" : "error",
        result: res.value,
      });
    }
  },

  requestCancel: async () => {
    if (get().status !== "running") return;
    await window.api.cancelBuild();
    // The actual status flip to "cancelled" happens once buildRom's
    // promise resolves (see startBuild above) and the child process has
    // actually exited - not here, so the panel doesn't claim "cancelled"
    // a moment before it's true.
  },
}));
