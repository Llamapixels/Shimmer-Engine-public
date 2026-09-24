/**
 * Song -> the byte layout hUGEDriver plays (3-byte "dn" rows, 16-byte
 * waves, 5-field instruments). The same data compiler/uge.py writes into
 * the ROM (and GB Studio's exportToC), so the editor's player runs
 * exactly what the game will.
 */

import { CHANNEL_COUNT, INSTRUMENTS_PER_TYPE, PATTERN_LENGTH, WAVE_COUNT, type Pattern, type Song, type SubPatternCell } from "./song";

export const NO_NOTE = 90;
export const LAST_NOTE = 72;
const SUBPATTERN_ROWS = 32; // hUGEDriver only runs the first 32 rows

export interface HugeInstr {
  b0: number;
  b1: number;
  b2: number;
  highmask: number;
  /** Subpattern: 32 rows x 3 bytes, or null. */
  table: Uint8Array | null;
}

export interface HugeSongData {
  ticksPerRow: number;
  orderCount: number;
  /** Per channel, per order: that pattern's 64 x 3 bytes. */
  orders: Uint8Array[][];
  duty: HugeInstr[];
  wave: HugeInstr[];
  noise: HugeInstr[];
  /** 16 waves x 16 bytes (two 4-bit samples per byte). */
  waves: Uint8Array;
}

function dn(out: number[], note: number, instrument: number, effect: number): void {
  out.push((note | ((instrument & 0x10) << 3)) & 0xff, ((instrument << 4) & 0xff) | ((effect >> 8) & 0x0f), effect & 0xff);
}

export function patternBytes(pattern: Pattern | undefined): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < PATTERN_LENGTH; i++) {
    const cell = pattern?.[i];
    if (!cell) {
      dn(out, NO_NOTE, 0, 0);
      continue;
    }
    const note = cell.note !== null && cell.note >= 0 && cell.note < LAST_NOTE ? cell.note : NO_NOTE;
    const instrument = cell.instrument !== null ? (cell.instrument + 1) & 0x1f : 0;
    const effect = cell.effectCode !== null ? ((cell.effectCode & 0x0f) << 8) | ((cell.effectParam ?? 0) & 0xff) : 0;
    dn(out, note, instrument, effect);
  }
  return Uint8Array.from(out);
}

function subpatternBytes(sub: SubPatternCell[]): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < SUBPATTERN_ROWS; i++) {
    const cell = sub[i] ?? { note: null, jump: null, effectCode: null, effectParam: null };
    const note = cell.note === null ? NO_NOTE : cell.note & 0x7f;
    // The last row always jumps back to row 0 if it has a jump set
    // (jump values are row + 1), so the table loops.
    const jump = i === SUBPATTERN_ROWS - 1 && cell.jump !== null ? 1 : (cell.jump ?? 0);
    const effect = cell.effectCode !== null ? ((cell.effectCode & 0x0f) << 8) | ((cell.effectParam ?? 0) & 0xff) : 0;
    dn(out, note, jump & 0x1f, effect);
  }
  return Uint8Array.from(out);
}

function envelope(initialVolume: number, change: number): number {
  let env = (initialVolume << 4) | (change > 0 ? 0x08 : 0);
  if (change !== 0) env |= 8 - Math.abs(change);
  return env & 0xff;
}

const EMPTY: HugeInstr = { b0: 0, b1: 0, b2: 0, highmask: 0, table: null };

export function compileSong(song: Song): HugeSongData {
  const patternCache = new Map<number, Uint8Array>();
  const bytesFor = (id: number) => {
    let b = patternCache.get(id);
    if (!b) {
      b = patternBytes(song.patterns[id]);
      patternCache.set(id, b);
    }
    return b;
  };
  const orders: Uint8Array[][] = [];
  for (let ch = 0; ch < CHANNEL_COUNT; ch++) orders.push(song.sequence.map((item) => bytesFor(item.channels[ch])));

  const table = (enabled: boolean, sub: SubPatternCell[]) => (enabled && sub.length ? subpatternBytes(sub) : null);

  const duty: HugeInstr[] = [];
  const wave: HugeInstr[] = [];
  const noise: HugeInstr[] = [];
  for (let i = 0; i < INSTRUMENTS_PER_TYPE; i++) {
    const d = song.dutyInstruments[i];
    duty.push(
      d
        ? {
            b0: ((d.frequencySweepTime << 4) | (d.frequencySweepShift < 0 ? 0x08 : 0) | Math.abs(d.frequencySweepShift)) & 0xff,
            b1: ((d.dutyCycle << 6) | ((d.length !== null ? 64 - d.length : 0) & 0x3f)) & 0xff,
            b2: envelope(d.initialVolume, d.volumeSweepChange),
            highmask: 0x80 | (d.length !== null ? 0x40 : 0),
            table: table(d.subpatternEnabled, d.subpattern),
          }
        : EMPTY,
    );
    const w = song.waveInstruments[i];
    wave.push(
      w
        ? {
            b0: (w.length !== null ? 256 - w.length : 0) & 0xff,
            b1: (w.volume << 5) & 0xff,
            b2: w.waveIndex & 0xff,
            highmask: 0x80 | (w.length !== null ? 0x40 : 0),
            table: table(w.subpatternEnabled, w.subpattern),
          }
        : EMPTY,
    );
    const n = song.noiseInstruments[i];
    if (n) {
      let highmask = (n.length !== null ? 64 - n.length : 0) & 0x3f;
      if (n.length !== null) highmask |= 0x40;
      if (n.bitCount === 7) highmask |= 0x80;
      noise.push({ b0: envelope(n.initialVolume, n.volumeSweepChange), b1: 0, b2: 0, highmask, table: table(n.subpatternEnabled, n.subpattern) });
    } else {
      noise.push(EMPTY);
    }
  }

  const waves = new Uint8Array(WAVE_COUNT * 16);
  for (let n = 0; n < WAVE_COUNT; n++) {
    const w = song.waves[n];
    for (let i = 0; i < 16; i++) waves[n * 16 + i] = (((w?.[i * 2] ?? 0) & 0x0f) << 4) | ((w?.[i * 2 + 1] ?? 0) & 0x0f);
  }

  return { ticksPerRow: song.ticksPerRow & 0xff, orderCount: song.sequence.length, orders, duty, wave, noise, waves };
}
