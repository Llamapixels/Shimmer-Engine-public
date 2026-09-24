/**
 * MIDI files -> songs. parseMidi() reads a Standard MIDI File (format 0
 * or 1) into "voices" - the notes of one track on one MIDI channel -
 * and midiToSong() lays up to four of them onto the Game Boy channels
 * (two duty, wave, noise), quantized to tracker rows.
 *
 * The Game Boy channels are monophonic, so chords in a voice collapse
 * to one note per row (the highest, or the lowest for bass). Notes that
 * end before the next one starts get a note cut (E00). Drums (MIDI
 * channel 10) map onto the template song's drum instruments.
 */

import { CHANNEL_COUNT, NOTE_COUNT, PATTERN_LENGTH, TICKS_PER_SECOND, createPatternCell, createSequenceItem, type Pattern, type Song } from "./song";

export class MidiError extends Error {}

export interface MidiNote {
  start: number; // MIDI ticks
  end: number;
  pitch: number; // MIDI note number
  velocity: number;
}

export interface MidiVoice {
  id: string;
  track: number;
  channel: number; // 0-15; 9 = drums
  trackName: string;
  program: number | null;
  notes: MidiNote[];
}

export interface MidiFile {
  ticksPerBeat: number;
  /** [tick, microseconds per beat], sorted, starting at tick 0. */
  tempos: [number, number][];
  voices: MidiVoice[];
  name: string;
  endTick: number;
}

export function parseMidi(bytes: Uint8Array): MidiFile {
  let pos = 0;
  const need = (n: number) => {
    if (pos + n > bytes.length) throw new MidiError("The file ends early - it's truncated or not a MIDI file.");
  };
  const u8 = () => {
    need(1);
    return bytes[pos++];
  };
  const u16 = () => (u8() << 8) | u8();
  const u32 = () => ((u8() << 24) | (u8() << 16) | (u8() << 8) | u8()) >>> 0;
  const str = (n: number) => {
    need(n);
    const s = String.fromCharCode(...bytes.subarray(pos, pos + n));
    pos += n;
    return s;
  };
  const vlq = () => {
    let v = 0;
    for (let i = 0; i < 4; i++) {
      const b = u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) return v;
    }
    return v;
  };

  if (bytes.length < 14 || str(4) !== "MThd") throw new MidiError("This isn't a MIDI file (no MThd header).");
  const headerLen = u32();
  const format = u16();
  const trackCount = u16();
  const division = u16();
  pos += headerLen - 6;
  if (format > 1) throw new MidiError("Only MIDI format 0 and 1 files are supported (this one is format 2).");
  let ticksPerBeat = division;
  if (division & 0x8000) {
    // SMPTE timing: frames/second x ticks/frame. Treat it as 120 BPM.
    const fps = 256 - (division >> 8);
    ticksPerBeat = ((fps * (division & 0xff)) / 2) | 0;
  }
  if (ticksPerBeat <= 0) throw new MidiError("The file's timing division is invalid.");

  const tempos: [number, number][] = [];
  const voices = new Map<string, MidiVoice>();
  let songName = "";
  let endTick = 0;

  for (let t = 0; t < trackCount && pos < bytes.length; t++) {
    const id = str(4);
    const len = u32();
    const end = pos + len;
    if (id !== "MTrk") {
      pos = end;
      continue;
    }
    let tick = 0;
    let status = 0;
    let trackName = "";
    const programs = new Array<number | null>(16).fill(null);
    const open = new Map<number, { start: number; velocity: number }[]>(); // (channel<<7|pitch) -> stack
    const voiceFor = (channel: number) => {
      const key = `${t}:${channel}`;
      let v = voices.get(key);
      if (!v) {
        v = { id: key, track: t, channel, trackName: "", program: null, notes: [] };
        voices.set(key, v);
      }
      return v;
    };
    const noteOff = (channel: number, pitch: number) => {
      const stack = open.get((channel << 7) | pitch);
      const on = stack?.shift();
      if (on && tick > on.start) voiceFor(channel).notes.push({ start: on.start, end: tick, pitch, velocity: on.velocity });
    };

    while (pos < end) {
      tick += vlq();
      let b = u8();
      if (b === 0xff) {
        const type = u8();
        const mlen = vlq();
        const dataStart = pos;
        if (type === 0x51 && mlen === 3) tempos.push([tick, (bytes[pos] << 16) | (bytes[pos + 1] << 8) | bytes[pos + 2]]);
        else if (type === 0x03) trackName = new TextDecoder().decode(bytes.subarray(pos, pos + mlen)).trim();
        pos = dataStart + mlen;
        if (type === 0x2f) break;
        continue;
      }
      if (b === 0xf0 || b === 0xf7) {
        pos += vlq();
        continue;
      }
      if (b < 0x80) {
        // Running status: b is the first data byte.
        if (!status) throw new MidiError("Corrupt MIDI data (running status with no status).");
        pos--;
        b = status;
      } else {
        status = b;
      }
      const kind = b & 0xf0;
      const channel = b & 0x0f;
      if (kind === 0x80 || kind === 0x90) {
        const pitch = u8() & 0x7f;
        const velocity = u8() & 0x7f;
        if (kind === 0x90 && velocity > 0) {
          const k = (channel << 7) | pitch;
          if (!open.has(k)) open.set(k, []);
          open.get(k)!.push({ start: tick, velocity });
          const v = voiceFor(channel);
          if (v.program === null) v.program = programs[channel];
        } else {
          noteOff(channel, pitch);
        }
      } else if (kind === 0xc0) {
        programs[channel] = u8() & 0x7f;
      } else if (kind === 0xd0) {
        u8();
      } else {
        u8();
        u8();
      }
    }
    // Close notes still held at the end of the track.
    for (const [k, stack] of open) for (const _ of stack) noteOff(k >> 7, k & 0x7f);
    endTick = Math.max(endTick, tick);
    for (const v of voices.values()) if (v.track === t) v.trackName = trackName;
    if (t === 0 && trackName && !songName) songName = trackName;
    pos = end;
  }

  tempos.sort((a, b) => a[0] - b[0]);
  if (!tempos.length || tempos[0][0] > 0) tempos.unshift([0, 500000]);

  const list = [...voices.values()].filter((v) => v.notes.length > 0);
  for (const v of list) v.notes.sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  if (!list.length) throw new MidiError("The file has no notes.");
  return { ticksPerBeat, tempos, voices: list, name: songName, endTick };
}

// ---------------------------------------------------------------------------

const GM_FAMILIES = [
  "Piano", "Chromatic Percussion", "Organ", "Guitar", "Bass", "Strings", "Ensemble", "Brass",
  "Reed", "Pipe", "Synth Lead", "Synth Pad", "Synth Effects", "Ethnic", "Percussive", "Sound Effects",
];

export function voiceLabel(v: MidiVoice): string {
  const parts = [v.trackName || `Track ${v.track + 1}`];
  parts.push(v.channel === 9 ? "drums" : `ch ${v.channel + 1}`);
  if (v.channel !== 9 && v.program !== null) parts.push(GM_FAMILIES[v.program >> 3]);
  return parts.join(" · ");
}

export function voiceRange(v: MidiVoice): [number, number] {
  let lo = 127;
  let hi = 0;
  for (const n of v.notes) {
    lo = Math.min(lo, n.pitch);
    hi = Math.max(hi, n.pitch);
  }
  return [lo, hi];
}

const MIDI_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const midiNoteName = (p: number) => `${MIDI_NAMES[p % 12]}${Math.floor(p / 12) - 1}`;

/** hUGE note index 0 (its "C3", 65.4 Hz) is MIDI note 36. */
const MIDI_TO_HUGE = -36;

/** Octave shift (in semitones) that fits the most of a voice's notes into
 * the Game Boy's range. */
export function autoTranspose(v: MidiVoice): number {
  let best = 0;
  let bestScore = -1;
  for (let oct = -4; oct <= 4; oct++) {
    const shift = oct * 12;
    let score = 0;
    for (const n of v.notes) {
      const h = n.pitch + MIDI_TO_HUGE + shift;
      if (h >= 0 && h < NOTE_COUNT) score++;
    }
    // Prefer no shift on a tie, then smaller shifts.
    if (score > bestScore || (score === bestScore && Math.abs(oct) < Math.abs(best / 12))) {
      bestScore = score;
      best = shift;
    }
  }
  return best;
}

/** General MIDI drum note -> the template's noise instruments (played at
 * note 24, as GB Studio's examples do), with a priority for when several
 * drums land on one row. */
const DRUM_KIT: Record<number, { instrument: number; priority: number }> = {};
const drum = (notes: number[], instrument: number, priority: number) => {
  for (const n of notes) DRUM_KIT[n] = { instrument, priority };
};
drum([35, 36], 10, 6); // kick -> Bass Drum
drum([38, 40], 6, 5); // snare -> Snare Drum
drum([37, 39], 8, 4); // side stick, clap -> Snare Drum 3
drum([49, 52, 55, 57], 4, 4); // crashes -> Crash
drum([41, 43, 45], 11, 3); // low toms -> Bass Drum 2
drum([47, 48, 50], 7, 3); // high toms -> Snare Drum 2
drum([46], 3, 2); // open hat -> Open Hi-Hat
drum([51, 53, 59], 2, 1); // ride -> Closed Hi-Hat 3
drum([42, 44], 0, 1); // closed / pedal hat -> Closed Hi-Hat
const DRUM_OTHER = { instrument: 9, priority: 0 }; // -> Metallic Sound
export const DRUM_NOTE = 24;

export interface SlotSettings {
  voice: string | null;
  instrument: number;
  /** Semitones. */
  transpose: number;
  /** Which note of a chord the channel keeps. */
  pick: "highest" | "lowest";
}

export interface ConvertOptions {
  rowsPerBeat: number;
  slots: [SlotSettings, SlotSettings, SlotSettings, SlotSettings];
  velocity: boolean;
  /** Turn later tempo changes into Fxx (set speed) effects. */
  tempoChanges: boolean;
  name: string;
}

export const MAX_POSITIONS = 255; // the engine's order count is a uint8

export function ticksPerRowFor(microsPerBeat: number, rowsPerBeat: number): number {
  const secondsPerRow = microsPerBeat / 1e6 / rowsPerBeat;
  return Math.max(1, Math.min(255, Math.round(secondsPerRow * TICKS_PER_SECOND)));
}

export function actualBpm(ticksPerRow: number, rowsPerBeat: number): number {
  return (TICKS_PER_SECOND * 60) / (ticksPerRow * rowsPerBeat);
}

export interface ConvertResult {
  song: Song;
  warnings: string[];
}

/**
 * Builds a song from `midi` using `template`'s instruments and waves
 * (normally GB Studio's new-song template).
 */
export function midiToSong(midi: MidiFile, template: Song, opts: ConvertOptions): ConvertResult {
  const warnings: string[] = [];
  const rowTicks = midi.ticksPerBeat / opts.rowsPerBeat;
  const toRow = (tick: number) => Math.round(tick / rowTicks);
  const voiceById = new Map(midi.voices.map((v) => [v.id, v]));

  let lastRow = 1;
  for (const s of opts.slots) {
    const v = s.voice ? voiceById.get(s.voice) : undefined;
    if (v) for (const n of v.notes) lastRow = Math.max(lastRow, toRow(n.end) + 1);
  }
  let positions = Math.ceil(lastRow / PATTERN_LENGTH);
  if (positions > MAX_POSITIONS) {
    warnings.push(`The song is ${positions} patterns long; only the first ${MAX_POSITIONS} fit.`);
    positions = MAX_POSITIONS;
  }
  const totalRows = positions * PATTERN_LENGTH;

  // One long pattern per channel, cut into 64-row pieces at the end.
  const lanes: Pattern[] = Array.from({ length: CHANNEL_COUNT }, () => Array.from({ length: totalRows }, createPatternCell));
  const outOfRange = [0, 0, 0, 0];
  const dropped = [0, 0, 0, 0];

  opts.slots.forEach((slot, ch) => {
    const v = slot.voice ? voiceById.get(slot.voice) : undefined;
    if (!v) return;
    const lane = lanes[ch];

    if (ch === 3) {
      // Noise: drums (or a melodic voice played as pitched noise).
      const isDrums = v.channel === 9;
      const chosen = new Map<number, { instrument: number; priority: number; note: number; velocity: number }>();
      for (const n of v.notes) {
        const r = toRow(n.start);
        if (r >= totalRows) continue;
        const hit = isDrums
          ? { ...(DRUM_KIT[n.pitch] ?? DRUM_OTHER), note: DRUM_NOTE }
          : { instrument: slot.instrument, priority: n.pitch, note: clampNote(n.pitch + MIDI_TO_HUGE + slot.transpose) };
        const prev = chosen.get(r);
        if (!prev || hit.priority > prev.priority) chosen.set(r, { ...hit, velocity: n.velocity });
        else dropped[ch]++;
      }
      for (const [r, h] of chosen) {
        lane[r] = { note: h.note, instrument: h.instrument, effectCode: null, effectParam: null };
        if (opts.velocity) setVolume(lane[r], h.velocity);
      }
      return;
    }

    // Melodic: one note per row (a chord keeps its highest or lowest).
    const byRow = new Map<number, MidiNote>();
    for (const n of v.notes) {
      const r = toRow(n.start);
      if (r >= totalRows) continue;
      const prev = byRow.get(r);
      if (!prev) byRow.set(r, n);
      else {
        dropped[ch]++;
        if (slot.pick === "highest" ? n.pitch > prev.pitch : n.pitch < prev.pitch) byRow.set(r, n);
      }
    }
    const rows = [...byRow.keys()].sort((a, b) => a - b);
    rows.forEach((r, i) => {
      const n = byRow.get(r)!;
      const raw = n.pitch + MIDI_TO_HUGE + slot.transpose;
      if (raw < 0 || raw >= NOTE_COUNT) outOfRange[ch]++;
      lane[r] = { note: clampNote(raw), instrument: slot.instrument, effectCode: null, effectParam: null };
      if (opts.velocity) setVolume(lane[r], n.velocity);
      // Cut the note if it ends before the next one starts.
      const endRow = Math.max(r + 1, toRow(n.end));
      const next = i + 1 < rows.length ? rows[i + 1] : totalRows;
      if (endRow < next && endRow < totalRows && lane[endRow].effectCode === null) {
        lane[endRow] = { ...lane[endRow], effectCode: 0xe, effectParam: 0 };
      }
    });
  });

  const tempo0 = midi.tempos[0][1];
  const ticksPerRow = ticksPerRowFor(tempo0, opts.rowsPerBeat);

  if (opts.tempoChanges) {
    let lastTpr = ticksPerRow;
    for (const [tick, micros] of midi.tempos.slice(1)) {
      const r = toRow(tick);
      if (r >= totalRows) break;
      const tpr = ticksPerRowFor(micros, opts.rowsPerBeat);
      if (tpr === lastTpr) continue;
      const free = lanes.find((lane) => lane[r].effectCode === null);
      if (free) {
        free[r] = { ...free[r], effectCode: 0xf, effectParam: tpr };
        lastTpr = tpr;
      } else {
        warnings.push(`A tempo change at row ${r} was skipped (every channel already has an effect there).`);
      }
    }
  }

  opts.slots.forEach((_, ch) => {
    const name = ["Duty 1", "Duty 2", "Wave", "Noise"][ch];
    if (dropped[ch]) warnings.push(`${name}: ${dropped[ch]} overlapping note(s) dropped (a channel plays one note at a time).`);
    if (outOfRange[ch]) warnings.push(`${name}: ${outOfRange[ch]} note(s) were outside C3-B8 and got clamped. Try another transpose.`);
  });

  // Cut into 64-row blocks, reusing identical blocks.
  const song: Song = {
    ...structuredClone(template),
    name: (midi.name || opts.name).slice(0, 255),
    comment: "Imported from MIDI",
    ticksPerRow,
    patterns: [],
    sequence: [],
  };
  const blocks = new Map<string, number>();
  for (let p = 0; p < positions; p++) {
    const block = lanes.map((lane) => lane.slice(p * PATTERN_LENGTH, (p + 1) * PATTERN_LENGTH));
    const key = JSON.stringify(block);
    let id = blocks.get(key);
    if (id === undefined) {
      id = song.patterns.length / CHANNEL_COUNT;
      blocks.set(key, id);
      song.patterns.push(...block);
    }
    song.sequence.push(createSequenceItem(id));
  }

  const bpm = 60e6 / tempo0;
  const got = actualBpm(ticksPerRow, opts.rowsPerBeat);
  if (Math.abs(got - bpm) / bpm > 0.04) {
    warnings.push(
      `Tempo is ${got.toFixed(0)} BPM instead of ${bpm.toFixed(0)} (the Game Boy's speed steps are coarse). ` +
        "A different rows-per-beat may get closer.",
    );
  }
  return { song, warnings };
}

function clampNote(n: number): number {
  while (n < 0) n += 12;
  while (n >= NOTE_COUNT) n -= 12;
  return n;
}

function setVolume(cell: Pattern[number], velocity: number) {
  cell.effectCode = 0xc;
  cell.effectParam = Math.max(1, Math.min(15, Math.round((velocity / 127) * 15)));
}

/** Picks voices for the four channels: drums to noise, and the three
 * busiest melodic voices - the lowest of them on the wave channel as
 * bass, the others on duty 1 and 2 (highest first). */
export function defaultSlots(midi: MidiFile): ConvertOptions["slots"] {
  const drums = midi.voices.filter((v) => v.channel === 9).sort((a, b) => b.notes.length - a.notes.length)[0];
  const melodic = midi.voices
    .filter((v) => v.channel !== 9)
    .sort((a, b) => b.notes.length - a.notes.length)
    .slice(0, 3);
  const avg = (v: MidiVoice) => v.notes.reduce((s, n) => s + n.pitch, 0) / v.notes.length;
  const byPitch = [...melodic].sort((a, b) => avg(b) - avg(a));
  // With two or more parts, the lowest one is the bass line.
  const bass = byPitch.length >= 2 ? byPitch[byPitch.length - 1] : undefined;
  const leads = byPitch.filter((v) => v !== bass);
  const slot = (v: MidiVoice | undefined, instrument: number, pick: SlotSettings["pick"]): SlotSettings => ({
    voice: v?.id ?? null,
    instrument,
    transpose: v ? autoTranspose(v) : 0,
    pick,
  });
  return [
    slot(leads[0], 8, "highest"), // 50% Pulse
    slot(leads[1], 7, "highest"), // 25% Pulse
    slot(bass, 10, "lowest"), // Triangular Wave
    slot(drums, 0, "highest"),
  ];
}
