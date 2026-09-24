import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import {
  MidiError,
  actualBpm,
  autoTranspose,
  defaultSlots,
  midiNoteName,
  midiToSong,
  parseMidi,
  ticksPerRowFor,
  voiceLabel,
  voiceRange,
  type ConvertOptions,
  type MidiFile,
  type SlotSettings,
} from "../../music/midi";
import { base64ToBytes, newSongFromTemplate, useMusicStore } from "../../music/musicStore";
import { player } from "../../music/player";
import { CHANNELS, type Song } from "../../music/song";
import Icon from "../common/Icon";

const ROWS_PER_BEAT = [
  { value: 2, label: "2 rows per beat (8th notes)" },
  { value: 3, label: "3 rows per beat (8th triplets)" },
  { value: 4, label: "4 rows per beat (16th notes)" },
  { value: 6, label: "6 rows per beat (16th triplets)" },
  { value: 8, label: "8 rows per beat (32nd notes)" },
];

interface Props {
  onClose: () => void;
}

/** Picks a .mid file and turns it into a new song in assets/music. */
export default function MidiImportDialog({ onClose }: Props) {
  const createSong = useMusicStore((s) => s.createSong);
  const [fileName, setFileName] = useState<string | null>(null);
  const [midi, setMidi] = useState<MidiFile | null>(null);
  const [template, setTemplate] = useState<Song | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opts, setOpts] = useState<ConvertOptions | null>(null);
  const [busy, setBusy] = useState(false);
  const previewing = useSyncExternalStore(
    (cb) => player.subscribe(cb),
    () => player.playing,
  );

  const pick = async () => {
    setError(null);
    const r = await window.api.pickMidiFile();
    if (!r.ok) {
      setError(r.error);
      return;
    }
    if (!r.value) {
      if (!midi) onClose();
      return;
    }
    try {
      const parsed = parseMidi(base64ToBytes(r.value.dataBase64));
      const stem = r.value.fileName.replace(/\.midi?$/i, "");
      setFileName(r.value.fileName);
      setMidi(parsed);
      setOpts({
        rowsPerBeat: 4,
        slots: defaultSlots(parsed),
        velocity: false,
        tempoChanges: true,
        name: stem,
      });
    } catch (e) {
      setError(e instanceof MidiError ? e.message : `Couldn't read that file: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  useEffect(() => {
    void newSongFromTemplate().then(setTemplate);
    void pick();
    return () => player.stop();
    // Pick a file as soon as the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const result = useMemo(() => (midi && template && opts ? midiToSong(midi, template, opts) : null), [midi, template, opts]);

  // Changing options while previewing keeps playing the new version.
  useEffect(() => {
    if (result && player.playing) player.update(result.song);
  }, [result]);

  const setSlot = (i: number, patch: Partial<SlotSettings>) => {
    if (!opts) return;
    const slots = opts.slots.map((s, j) => (j === i ? { ...s, ...patch } : s)) as ConvertOptions["slots"];
    setOpts({ ...opts, slots });
  };

  const preview = () => {
    if (!result) return;
    if (previewing) player.stop();
    else player.play(result.song, { order: 0, row: 0 });
  };

  const doImport = async () => {
    if (!result || !opts) return;
    setBusy(true);
    player.stop();
    const name = await createSong(opts.name || "midi_song", result.song);
    setBusy(false);
    if (name) onClose();
  };

  const tempo = midi ? 60e6 / midi.tempos[0][1] : 0;
  const tpr = midi && opts ? ticksPerRowFor(midi.tempos[0][1], opts.rowsPerBeat) : 0;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal midi-dialog" role="dialog" aria-label="Import MIDI file">
        <div className="modal-head">
          <span>Import MIDI{fileName ? `: ${fileName}` : ""}</span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">
          {error && <p className="field-error">{error}</p>}
          {!midi && !error && <p className="view-note">Choose a .mid file…</p>}
          {midi && opts && (
            <>
              <p className="view-note">
                The Game Boy has four channels that each play one note at a time. Pick which part of the MIDI file goes on each
                one. Chords are reduced to their top (or bottom) note, and drums on MIDI channel 10 map onto the song's drum
                instruments. You can edit everything afterwards.
              </p>
              <div className="midi-grid">
                <div className="midi-grid-head">Channel</div>
                <div className="midi-grid-head">MIDI part</div>
                <div className="midi-grid-head">Instrument</div>
                <div className="midi-grid-head">Transpose</div>
                <div className="midi-grid-head">Chords keep</div>
                {CHANNELS.map((c, i) => {
                  const slot = opts.slots[i];
                  const v = midi.voices.find((x) => x.id === slot.voice);
                  const instruments = template ? (c.type === "duty" ? template.dutyInstruments : c.type === "wave" ? template.waveInstruments : template.noiseInstruments) : [];
                  const drums = i === 3 && v?.channel === 9;
                  return (
                    <div key={i} className="midi-grid-row">
                      <div className="midi-channel">
                        {i + 1}. {c.name}
                      </div>
                      <select
                        value={slot.voice ?? ""}
                        onChange={(e) => {
                          const nv = midi.voices.find((x) => x.id === e.target.value);
                          setSlot(i, { voice: nv?.id ?? null, transpose: nv && nv.channel !== 9 ? autoTranspose(nv) : 0 });
                        }}
                      >
                        <option value="">(silent)</option>
                        {midi.voices.map((mv) => {
                          const [lo, hi] = voiceRange(mv);
                          return (
                            <option key={mv.id} value={mv.id}>
                              {voiceLabel(mv)} - {mv.notes.length} notes{mv.channel === 9 ? "" : `, ${midiNoteName(lo)}-${midiNoteName(hi)}`}
                            </option>
                          );
                        })}
                      </select>
                      {drums ? (
                        <span className="midi-muted">drum kit</span>
                      ) : (
                        <select value={slot.instrument} onChange={(e) => setSlot(i, { instrument: Number(e.target.value) })} disabled={!v}>
                          {instruments.map((ins, k) => (
                            <option key={k} value={k}>
                              {String(k + 1).padStart(2, "0")} {ins.name}
                            </option>
                          ))}
                        </select>
                      )}
                      {drums ? (
                        <span />
                      ) : (
                        <select value={slot.transpose} onChange={(e) => setSlot(i, { transpose: Number(e.target.value) })} disabled={!v}>
                          {[-48, -36, -24, -12, 0, 12, 24, 36, 48].map((t) => (
                            <option key={t} value={t}>
                              {t === 0 ? "none" : `${t > 0 ? "+" : ""}${t / 12} octave${Math.abs(t) > 12 ? "s" : ""}`}
                            </option>
                          ))}
                        </select>
                      )}
                      {drums || i === 3 ? (
                        <span />
                      ) : (
                        <select value={slot.pick} onChange={(e) => setSlot(i, { pick: e.target.value as SlotSettings["pick"] })} disabled={!v}>
                          <option value="highest">highest</option>
                          <option value="lowest">lowest</option>
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="midi-options">
                <label className="field-row">
                  <span className="field-row-label">Song name</span>
                  <input value={opts.name} onChange={(e) => setOpts({ ...opts, name: e.target.value })} />
                </label>
                <label className="field-row">
                  <span className="field-row-label">Timing</span>
                  <select value={opts.rowsPerBeat} onChange={(e) => setOpts({ ...opts, rowsPerBeat: Number(e.target.value) })}>
                    {ROWS_PER_BEAT.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                  <span className="field-row-hint">
                    {tempo.toFixed(0)} BPM in the file → speed {tpr} ({actualBpm(tpr, opts.rowsPerBeat).toFixed(0)} BPM). More rows per beat keeps
                    fast notes apart but makes a longer song.
                  </span>
                </label>
                <label className="music-check">
                  <input type="checkbox" checked={opts.velocity} onChange={(e) => setOpts({ ...opts, velocity: e.target.checked })} />
                  Note velocities as volume (adds a Cxx effect to each note)
                </label>
                <label className="music-check">
                  <input type="checkbox" checked={opts.tempoChanges} onChange={(e) => setOpts({ ...opts, tempoChanges: e.target.checked })} />
                  Follow tempo changes (Fxx effects)
                </label>
              </div>
              {result && (
                <div className="midi-summary">
                  {result.song.sequence.length} positions, {result.song.patterns.length / 4} patterns.
                  {result.warnings.map((w, i) => (
                    <div key={i} className="midi-warning">
                      <Icon name="warning" /> {w}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={() => void pick()}>
            Choose another file…
          </button>
          <span className="modal-foot-space" />
          <button className="btn" onClick={preview} disabled={!result}>
            {previewing ? "■ Stop" : "▶ Preview"}
          </button>
          <button className="btn btn-primary" onClick={() => void doImport()} disabled={!result || busy}>
            {busy ? "Importing…" : "Import song"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
