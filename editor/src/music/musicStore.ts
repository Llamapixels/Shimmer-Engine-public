/**
 * The music editor's state: the open song, its undo history, and editor
 * settings (channel, tool, instrument, selection). Songs are saved back
 * to assets/music/<name>.uge automatically shortly after each edit, the
 * same way the rest of the editor saves scenes as you go.
 */

import { create } from "zustand";

import { useProjectStore } from "../state/projectStore";
import { player } from "./player";
import {
  CHANNELS,
  PATTERN_LENGTH,
  cloneSong,
  createSequenceItem,
  addPatternBlock,
  type InstrumentType,
  type PatternCell,
  type Song,
} from "./song";
import { loadUge, saveUge } from "./uge";
import templateUrl from "./template.uge?url";

export type MusicTool = "pencil" | "eraser" | "select";

export type Inspect =
  | { kind: "song" }
  | { kind: "cells" }
  | { kind: "instrument"; type: InstrumentType; index: number }
  | { kind: "wave"; index: number };

const HISTORY_LIMIT = 200;
const COALESCE_MS = 800;
const SAVE_DELAY_MS = 400;

export function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

let templateBytes: Promise<Uint8Array> | null = null;

/** GB Studio's new-song template (instruments and waves, no notes). */
export async function newSongFromTemplate(): Promise<Song> {
  templateBytes ??= fetch(templateUrl)
    .then((r) => r.arrayBuffer())
    .then((b) => new Uint8Array(b));
  const song = loadUge(await templateBytes);
  if (song.sequence.length === 0) {
    const block = addPatternBlock(song);
    song.sequence.push(createSequenceItem(block));
  }
  return song;
}

/** Absolute row (across the whole sequence) <-> sequence position + row. */
export const toAbsRow = (order: number, row: number) => order * PATTERN_LENGTH + row;
export const fromAbsRow = (abs: number) => ({ order: Math.floor(abs / PATTERN_LENGTH), row: abs % PATTERN_LENGTH });

/** The cell a channel plays at an absolute row (a live reference into
 * `song` - only mutate it inside edit()). */
export function cellAt(song: Song, channel: number, abs: number): PatternCell | undefined {
  const { order, row } = fromAbsRow(abs);
  const item = song.sequence[order];
  if (!item) return undefined;
  return song.patterns[item.channels[channel]]?.[row];
}

interface MusicState {
  rootPath: string | null;
  songName: string | null;
  song: Song | null;
  loading: boolean;
  error: string | null;
  saveState: "saved" | "pending" | "saving" | "error";
  past: Song[];
  future: Song[];
  lastCoalesce: { key: string; at: number } | null;

  channel: number;
  tool: MusicTool;
  /** Instrument used for new notes, per channel type. */
  instrument: Record<InstrumentType, number>;
  /** Selected absolute rows, in the current channel. */
  selection: number[];
  /** Where Paste and "play from" start: the last clicked row. */
  cursorRow: number;
  inspect: Inspect;
  zoom: number;
  showOtherChannels: boolean;
  muted: [boolean, boolean, boolean, boolean];
  clipboard: { rows: number; cells: (PatternCell | null)[] } | null;

  openSong: (rootPath: string, name: string) => Promise<void>;
  closeSong: () => void;
  /** Mutate a copy of the song; records undo history and saves. */
  edit: (fn: (song: Song) => void, coalesceKey?: string) => void;
  undo: () => void;
  redo: () => void;
  flushSave: () => Promise<void>;

  setChannel: (channel: number) => void;
  setTool: (tool: MusicTool) => void;
  setInstrument: (type: InstrumentType, index: number) => void;
  setSelection: (rows: number[], cursorRow?: number) => void;
  setInspect: (inspect: Inspect) => void;
  setZoom: (zoom: number) => void;
  setShowOtherChannels: (show: boolean) => void;
  toggleMute: (channel: number) => void;
  setClipboard: (clip: MusicState["clipboard"]) => void;

  createSong: (name: string, song?: Song) => Promise<string | null>;
  renameSong: (to: string) => Promise<void>;
  deleteSong: () => Promise<void>;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saving: Promise<void> = Promise.resolve();

export const useMusicStore = create<MusicState>((set, get) => {
  const writeNow = async () => {
    saveTimer = null;
    const { rootPath, songName, song } = get();
    if (!rootPath || !songName || !song) return;
    set({ saveState: "saving" });
    const bytes = saveUge(song);
    saving = saving.then(async () => {
      const r = await window.api.saveSong({ rootPath, name: songName, dataBase64: bytesToBase64(bytes) });
      if (get().songName !== songName) return;
      set(r.ok ? { saveState: saveTimer ? "pending" : "saved" } : { saveState: "error", error: r.error });
    });
    await saving;
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    set({ saveState: "pending" });
    saveTimer = setTimeout(() => void writeNow(), SAVE_DELAY_MS);
  };

  const replaceSong = (song: Song) => {
    set({ song });
    player.update(song);
    scheduleSave();
  };

  return {
    rootPath: null,
    songName: null,
    song: null,
    loading: false,
    error: null,
    saveState: "saved",
    past: [],
    future: [],
    lastCoalesce: null,

    channel: 0,
    tool: "pencil",
    instrument: { duty: 0, wave: 0, noise: 0 },
    selection: [],
    cursorRow: 0,
    inspect: { kind: "song" },
    zoom: 1,
    showOtherChannels: true,
    muted: [false, false, false, false],
    clipboard: null,

    openSong: async (rootPath, name) => {
      await get().flushSave();
      player.stop();
      set({ loading: true, error: null, rootPath, songName: name });
      const r = await window.api.readAsset({ rootPath, relPath: `assets/music/${name}.uge` });
      if (get().songName !== name) return;
      if (!r.ok) {
        set({ loading: false, song: null, error: r.error });
        return;
      }
      try {
        const song = loadUge(base64ToBytes(r.value.dataUrl.slice(r.value.dataUrl.indexOf(",") + 1)));
        set({
          loading: false,
          song,
          past: [],
          future: [],
          lastCoalesce: null,
          selection: [],
          cursorRow: 0,
          inspect: { kind: "song" },
          saveState: "saved",
        });
      } catch (e) {
        set({ loading: false, song: null, error: `Couldn't read ${name}.uge: ${e instanceof Error ? e.message : String(e)}` });
      }
    },

    closeSong: () => {
      player.stop();
      set({ songName: null, song: null, past: [], future: [], selection: [] });
    },

    edit: (fn, coalesceKey) => {
      const { song, past, lastCoalesce } = get();
      if (!song) return;
      const next = cloneSong(song);
      fn(next);
      const now = Date.now();
      const coalesce = !!coalesceKey && lastCoalesce?.key === coalesceKey && now - lastCoalesce.at < COALESCE_MS;
      set({
        past: coalesce ? past : [...past, song].slice(-HISTORY_LIMIT),
        future: [],
        lastCoalesce: coalesceKey ? { key: coalesceKey, at: now } : null,
      });
      replaceSong(next);
    },

    undo: () => {
      const { song, past, future } = get();
      if (!song || past.length === 0) return;
      set({ past: past.slice(0, -1), future: [song, ...future], lastCoalesce: null });
      replaceSong(past[past.length - 1]);
    },

    redo: () => {
      const { song, past, future } = get();
      if (!song || future.length === 0) return;
      set({ past: [...past, song], future: future.slice(1), lastCoalesce: null });
      replaceSong(future[0]);
    },

    flushSave: async () => {
      if (saveTimer) {
        clearTimeout(saveTimer);
        await writeNow();
      }
      await saving;
    },

    setChannel: (channel) => set({ channel, selection: [], inspect: get().inspect.kind === "cells" ? { kind: "song" } : get().inspect }),
    setTool: (tool) => set({ tool }),
    setInstrument: (type, index) => set({ instrument: { ...get().instrument, [type]: index } }),
    setSelection: (rows, cursorRow) =>
      set({
        selection: [...new Set(rows)].sort((a, b) => a - b),
        cursorRow: cursorRow ?? get().cursorRow,
        inspect: rows.length ? { kind: "cells" } : get().inspect.kind === "cells" ? { kind: "song" } : get().inspect,
      }),
    setInspect: (inspect) => set({ inspect }),
    setZoom: (zoom) => set({ zoom: Math.max(0.5, Math.min(3, zoom)) }),
    setShowOtherChannels: (showOtherChannels) => set({ showOtherChannels }),
    toggleMute: (channel) => {
      const muted = [...get().muted] as MusicState["muted"];
      muted[channel] = !muted[channel];
      player.setChannelMuted(channel, muted[channel]);
      set({ muted });
    },
    setClipboard: (clipboard) => set({ clipboard }),

    createSong: async (name, song) => {
      const rootPath = useProjectStore.getState().project?.rootPath;
      if (!rootPath) return null;
      const s = song ?? (await newSongFromTemplate());
      const r = await window.api.createSong({ rootPath, name, dataBase64: bytesToBase64(saveUge(s)) });
      if (!r.ok) {
        set({ error: r.error });
        return null;
      }
      await useProjectStore.getState().refreshAssets();
      await get().openSong(rootPath, r.value);
      return r.value;
    },

    renameSong: async (to) => {
      const { rootPath, songName } = get();
      if (!rootPath || !songName) return;
      await get().flushSave();
      const r = await window.api.renameSong({ rootPath, from: songName, to });
      if (!r.ok) {
        set({ error: r.error });
        return;
      }
      if (r.value !== songName) {
        // Scenes and Play Music events that used the old name follow it.
        useProjectStore.getState().renameRef("music", songName, r.value);
        set({ songName: r.value });
      }
      await useProjectStore.getState().refreshAssets();
    },

    deleteSong: async () => {
      const { rootPath, songName } = get();
      if (!rootPath || !songName) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = null;
      await saving;
      player.stop();
      const r = await window.api.deleteSong({ rootPath, name: songName });
      if (!r.ok) {
        set({ error: r.error });
        return;
      }
      set({ songName: null, song: null, past: [], future: [], selection: [] });
      await useProjectStore.getState().refreshAssets();
    },
  };
});

/** Channel type of the store's current channel. */
export function currentType(state: { channel: number }): InstrumentType {
  return CHANNELS[state.channel].type;
}
