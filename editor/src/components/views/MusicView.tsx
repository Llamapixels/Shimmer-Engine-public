import { useEffect, useState, useSyncExternalStore } from "react";

import { cellAt, useMusicStore, type MusicTool } from "../../music/musicStore";
import { player } from "../../music/player";
import { CHANNELS, NOTE_COUNT, PATTERN_LENGTH, channelInstruments, type PatternCell } from "../../music/song";
import { useProjectStore } from "../../state/projectStore";
import MidiImportDialog from "../music/MidiImportDialog";
import MusicInspector from "../music/MusicInspector";
import MusicNavigator from "../music/MusicNavigator";
import PianoRoll from "../music/PianoRoll";
import SequenceBar from "../music/SequenceBar";
import "./views.css";
import "./MusicView.css";
import Icon, { type IconName } from "../common/Icon";

const TOOLS: { tool: MusicTool; label: IconName; title: string }[] = [
  { tool: "pencil", label: "pencil", title: "Pencil (B): click to add notes, drag to move them" },
  { tool: "eraser", label: "eraser", title: "Eraser (E): click or drag over notes to delete them" },
  { tool: "select", label: "marquee", title: "Select (S): drag a box around notes" },
];

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

/** GB Studio-style music editor: songs/channels/instruments on the left,
 * the sequence and piano roll in the middle, an inspector on the right. */
export default function MusicView() {
  const project = useProjectStore((s) => s.project);
  const song = useMusicStore((s) => s.song);
  const songName = useMusicStore((s) => s.songName);
  const loading = useMusicStore((s) => s.loading);
  const error = useMusicStore((s) => s.error);
  const [midiOpen, setMidiOpen] = useState(false);

  // A different project was opened: forget the old one's song.
  useEffect(() => {
    const st = useMusicStore.getState();
    if (st.rootPath && st.rootPath !== project?.rootPath) st.closeSong();
  }, [project?.rootPath]);

  // Stop playback and save when leaving the section.
  useEffect(
    () => () => {
      player.stop();
      void useMusicStore.getState().flushSave();
    },
    [],
  );

  useMusicShortcuts(midiOpen);

  return (
    <div className="music-view">
      <MusicNavigator onImportMidi={() => setMidiOpen(true)} />
      <div className="music-center">
        <MusicToolbar />
        {error && (
          <div className="music-error">
            {error}
            <button className="link-btn" onClick={() => useMusicStore.setState({ error: null })}>
              dismiss
            </button>
          </div>
        )}
        {song ? (
          <>
            <SequenceBar />
            <PianoRoll />
          </>
        ) : (
          <div className="view-empty">{loading ? `Loading ${songName}…` : "Pick a song on the left, or make a new one with +."}</div>
        )}
      </div>
      <MusicInspector />
      {midiOpen && <MidiImportDialog onClose={() => setMidiOpen(false)} />}
    </div>
  );
}

function usePlaying(): boolean {
  return useSyncExternalStore(
    (cb) => player.subscribe(cb),
    () => player.playing,
  );
}

function togglePlay(fromStart: boolean) {
  const st = useMusicStore.getState();
  if (!st.song) return;
  if (player.playing) {
    player.stop();
    return;
  }
  const at = fromStart ? 0 : st.cursorRow;
  player.play(st.song, { order: Math.floor(at / PATTERN_LENGTH), row: at % PATTERN_LENGTH });
  for (let c = 0; c < 4; c++) player.setChannelMuted(c, st.muted[c]);
}

function MusicToolbar() {
  const song = useMusicStore((s) => s.song);
  const tool = useMusicStore((s) => s.tool);
  const channel = useMusicStore((s) => s.channel);
  const instrument = useMusicStore((s) => s.instrument);
  const zoom = useMusicStore((s) => s.zoom);
  const canUndo = useMusicStore((s) => s.past.length > 0);
  const canRedo = useMusicStore((s) => s.future.length > 0);
  const saveState = useMusicStore((s) => s.saveState);
  const st = useMusicStore.getState();
  const playing = usePlaying();
  if (!song) return <div className="music-toolbar" />;
  const type = CHANNELS[channel].type;
  const instruments = channelInstruments(song, channel);

  return (
    <div className="music-toolbar">
      <button className={`music-play${playing ? " music-play-on" : ""}`} onClick={() => togglePlay(false)} title="Play from the cursor / stop (Space)">
        {playing ? "■" : "▶"}
      </button>
      <button className="btn btn-small" onClick={() => togglePlay(true)} title="Play from the start (Shift+Space)" disabled={playing}>
        From start
      </button>
      <div className="music-tools">
        {TOOLS.map((t) => (
          <button key={t.tool} className={`music-tool${tool === t.tool ? " music-tool-on" : ""}`} onClick={() => st.setTool(t.tool)} title={t.title}>
            <Icon name={t.label} size={14} />
          </button>
        ))}
      </div>
      <label className="music-toolbar-field" title="Channel being edited (keys 1-4)">
        <span>Channel</span>
        <select value={channel} onChange={(e) => st.setChannel(Number(e.target.value))}>
          {CHANNELS.map((c) => (
            <option key={c.index} value={c.index}>
              {c.index + 1}. {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="music-toolbar-field" title="Instrument for new notes">
        <span>Instrument</span>
        <select value={instrument[type]} onChange={(e) => st.setInstrument(type, Number(e.target.value))}>
          {instruments.map((ins, i) => (
            <option key={i} value={i}>
              {String(i + 1).padStart(2, "0")} {ins.name}
            </option>
          ))}
        </select>
      </label>
      <div className="music-zoom">
        <button className="icon-btn" onClick={() => st.setZoom(zoom / 1.25)} title="Zoom out (Ctrl+wheel)">
          −
        </button>
        <span>{Math.round(zoom * 100)}%</span>
        <button className="icon-btn" onClick={() => st.setZoom(zoom * 1.25)} title="Zoom in (Ctrl+wheel)">
          +
        </button>
      </div>
      <div className="music-toolbar-right">
        <button className="icon-btn" disabled={!canUndo} onClick={st.undo} title="Undo (Ctrl+Z)">
          <Icon name="undo" />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={st.redo} title="Redo (Ctrl+Y)">
          <Icon name="redo" />
        </button>
        <span className={`music-save music-save-${saveState}`}>
          {saveState === "saved" ? "Saved" : saveState === "error" ? "Save failed" : "Saving…"}
        </span>
      </div>
    </div>
  );
}

const clearCell = (c: PatternCell) => Object.assign(c, { note: null, instrument: null, effectCode: null, effectParam: null });

/** Keyboard shortcuts while the music section is open. */
function useMusicShortcuts(paused: boolean) {
  useEffect(() => {
    if (paused) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const st = useMusicStore.getState();
      const song = st.song;
      if (!song) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      const channel = st.channel;
      const total = song.sequence.length * PATTERN_LENGTH;

      if (k === " ") {
        e.preventDefault();
        togglePlay(e.shiftKey);
      } else if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        st.undo();
      } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        st.redo();
      } else if (mod && k === "s") {
        e.preventDefault();
        void st.flushSave();
      } else if (mod && k === "a") {
        e.preventDefault();
        const rows: number[] = [];
        for (let a = 0; a < total; a++) if (cellAt(song, channel, a)?.note != null) rows.push(a);
        st.setSelection(rows);
      } else if (mod && (k === "c" || k === "x")) {
        if (!st.selection.length) return;
        e.preventDefault();
        const first = st.selection[0];
        const last = st.selection[st.selection.length - 1];
        const cells: (PatternCell | null)[] = [];
        for (let a = first; a <= last; a++) {
          const c = cellAt(song, channel, a);
          cells.push(st.selection.includes(a) && c ? { ...c } : null);
        }
        st.setClipboard({ rows: cells.length, cells });
        if (k === "x") {
          st.edit((s) => {
            for (const a of st.selection) {
              const c = cellAt(s, channel, a);
              if (c) clearCell(c);
            }
          });
          st.setSelection([]);
        }
      } else if (mod && k === "v") {
        const clip = st.clipboard;
        if (!clip) return;
        e.preventDefault();
        const at = st.cursorRow;
        const rows: number[] = [];
        st.edit((s) => {
          clip.cells.forEach((c, i) => {
            const dst = c && cellAt(s, channel, at + i);
            if (dst) {
              Object.assign(dst, c);
              rows.push(at + i);
            }
          });
        });
        st.setSelection(rows, at);
      } else if ((k === "delete" || k === "backspace") && st.selection.length) {
        e.preventDefault();
        st.edit((s) => {
          for (const a of st.selection) {
            const c = cellAt(s, channel, a);
            if (!c) continue;
            if (c.note !== null) {
              c.note = null;
              c.instrument = null;
            } else {
              c.effectCode = null;
              c.effectParam = null;
            }
          }
        });
      } else if ((k === "arrowup" || k === "arrowdown") && st.selection.length) {
        e.preventDefault();
        const d = (k === "arrowup" ? 1 : -1) * (e.shiftKey ? 12 : 1);
        st.edit((s) => {
          for (const a of st.selection) {
            const c = cellAt(s, channel, a);
            if (c?.note != null) c.note = Math.max(0, Math.min(NOTE_COUNT - 1, c.note + d));
          }
        }, "arrow-transpose");
      } else if ((k === "arrowleft" || k === "arrowright") && st.selection.length) {
        e.preventDefault();
        const d = k === "arrowright" ? 1 : -1;
        const sel = st.selection;
        if (sel[0] + d < 0 || sel[sel.length - 1] + d >= total) return;
        st.edit((s) => {
          const moved = sel.map((a) => ({ a, c: { ...cellAt(s, channel, a)! } }));
          for (const { a } of moved) clearCell(cellAt(s, channel, a)!);
          for (const { a, c } of moved) Object.assign(cellAt(s, channel, a + d)!, c);
        }, "arrow-move");
        st.setSelection(
          sel.map((a) => a + d),
          st.cursorRow + d,
        );
      } else if (k === "escape") {
        st.setSelection([]);
      } else if (!mod && !e.altKey) {
        if (k === "b") st.setTool("pencil");
        else if (k === "e") st.setTool("eraser");
        else if (k === "s") st.setTool("select");
        else if (["1", "2", "3", "4"].includes(k)) st.setChannel(Number(k) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paused]);
}
