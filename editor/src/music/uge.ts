/**
 * .uge (hUGETracker / GB Studio) files <-> Song. A port of GB Studio's
 * loadUGESong()/saveUGESong()/compactUGESong()
 * (gb-studio-source/src/shared/lib/uge/ugeHelper.ts, MIT). Reads every
 * version GB Studio does (0-6) and always writes version 6, like it.
 */

import {
  CHANNEL_COUNT,
  INSTRUMENTS_PER_TYPE,
  PATTERN_LENGTH,
  SUBPATTERN_LENGTH,
  WAVE_COUNT,
  createEmptySong,
  createPattern,
  createSubPattern,
  isSplitPatternSequence,
  type DutyInstrument,
  type NoiseInstrument,
  type Pattern,
  type Song,
  type SubPatternCell,
  type WaveInstrument,
} from "./song";

export class UgeError extends Error {}

interface RawInstrument {
  type: number;
  name: string;
  length: number;
  lengthEnabled: number;
  initialVolume: number;
  volumeSweepAmount: number;
  freqSweepTime: number;
  freqSweepShift: number;
  duty: number;
  waveOutputLevel: number;
  waveWaveformIndex: number;
  subpatternEnabled: number;
  subpattern: SubPatternCell[];
  noiseCounterStep: number;
  noiseMacro: number[];
}

function subpatternFromNoiseMacro(noiseMacro: number[], ticksPerRow: number): SubPatternCell[] {
  const subpattern = createSubPattern();
  for (let n = 0; n < 6; n++) subpattern[n + 1].note = noiseMacro[n] + 36;
  const wrapPoint = Math.min(ticksPerRow, 7);
  subpattern[wrapPoint - 1].jump = wrapPoint;
  return subpattern;
}

export function loadUge(bytes: Uint8Array): Song {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  const need = (n: number) => {
    if (offset + n > bytes.byteLength) throw new UgeError("The file ends early - it's truncated or not a .uge file.");
  };
  const u8 = () => {
    need(1);
    return view.getUint8(offset++);
  };
  const u32 = () => {
    need(4);
    const v = view.getUint32(offset, true);
    offset += 4;
    return v;
  };
  const i32 = () => {
    need(4);
    const v = view.getInt32(offset, true);
    offset += 4;
    return v;
  };
  const decoder = new TextDecoder();
  const text = () => {
    need(256);
    const len = bytes[offset];
    const s = len > 0 ? decoder.decode(bytes.subarray(offset + 1, offset + 1 + len)) : "";
    offset += 256;
    return s;
  };

  const song = createEmptySong();
  const version = u32();
  if (version > 6) throw new UgeError(`.uge version ${version} isn't supported (0-6 are).`);

  song.name = text();
  song.artist = text();
  song.comment = text();

  const instrumentCount = version < 3 ? 15 : 45;
  const raw: RawInstrument[] = [];
  for (let n = 0; n < instrumentCount; n++) {
    const type = u32();
    const name = text();
    const length = u32();
    const lengthEnabled = u8();
    const initialVolume = Math.min(u8(), 15);
    const volumeDirection = u32();
    let volumeSweepAmount = u8();
    if (volumeSweepAmount !== 0) volumeSweepAmount = 8 - volumeSweepAmount;
    if (volumeDirection) volumeSweepAmount = -volumeSweepAmount;
    const freqSweepTime = u32();
    const freqSweepDirection = u32();
    let freqSweepShift = u32();
    if (freqSweepDirection) freqSweepShift = -freqSweepShift;
    const duty = u8();
    const waveOutputLevel = u32();
    const waveWaveformIndex = u32();

    let subpatternEnabled = 0;
    let noiseCounterStep = 0;
    const subpattern: SubPatternCell[] = [];
    const noiseMacro: number[] = [];
    if (version >= 6) {
      noiseCounterStep = u32();
      subpatternEnabled = u8();
      for (let m = 0; m < 64; m++) {
        const note = u32();
        u32(); // unused
        const jump = u32();
        const effectCode = u32();
        const effectParam = u8();
        const noEffect = effectCode === 0 && effectParam === 0;
        subpattern.push({
          note: note === 90 ? null : note,
          jump,
          effectCode: noEffect ? null : effectCode,
          effectParam: noEffect ? null : effectParam,
        });
      }
    } else {
      u32(); // unused
      noiseCounterStep = u32();
      u32(); // unused
      if (version >= 4) {
        for (let k = 0; k < 6; k++) {
          const b = u8();
          noiseMacro.push(b > 0x7f ? b - 0x100 : b);
        }
      }
    }
    raw.push({
      type,
      name,
      length,
      lengthEnabled,
      initialVolume,
      volumeSweepAmount,
      freqSweepTime,
      freqSweepShift,
      duty,
      waveOutputLevel,
      waveWaveformIndex,
      subpatternEnabled,
      subpattern,
      noiseCounterStep,
      noiseMacro,
    });
  }

  for (let n = 0; n < WAVE_COUNT; n++) {
    need(32);
    song.waves.push(bytes.slice(offset, offset + 32));
    offset += 32;
    if (version < 3) offset += 1; // older versions have an off-by-one
  }

  song.ticksPerRow = u32();
  if (version >= 6) {
    song.timerEnabled = u8() !== 0;
    song.timerDivider = u32();
  }

  const patternCount = u32();
  if (offset + patternCount * 13 * 64 > bytes.byteLength) {
    throw new UgeError(`The song claims ${patternCount} patterns, more than the file holds.`);
  }
  const rawPatterns: number[][][] = [];
  for (let n = 0; n < patternCount; n++) {
    const patternId = version >= 5 ? u32() : n;
    const rows: number[][] = [];
    for (let m = 0; m < PATTERN_LENGTH; m++) {
      if (version < 6) {
        const note = i32();
        const instrument = i32();
        const effectCode = i32();
        rows.push([note, instrument, effectCode, u8()]);
      } else {
        const note = i32();
        const instrument = i32();
        i32(); // unused
        const effectCode = i32();
        rows.push([note, instrument, effectCode, u8()]);
      }
    }
    // A repeated id means an old GB Studio (3.0.2 or earlier) wrote
    // consecutive patterns without unique ids.
    if (version === 5 && rawPatterns[patternId]) rawPatterns[n] = rows;
    else rawPatterns[patternId] = rows;
  }

  const orders: number[][] = [];
  for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
    const orderCount = u32(); // stored with an off-by-one
    const list: number[] = [];
    for (let i = 0; i < orderCount; i++) {
      const v = u32();
      if (i < orderCount - 1) list.push(v);
    }
    orders.push(list);
  }

  for (const r of raw) {
    const base = { index: 0, name: r.name, subpatternEnabled: false, subpattern: createSubPattern() };
    if (version >= 6) {
      base.subpatternEnabled = r.subpatternEnabled !== 0;
      base.subpattern = r.subpattern;
    }
    if (r.type === 0) {
      const ins: DutyInstrument = {
        ...base,
        index: song.dutyInstruments.length,
        length: r.lengthEnabled ? 64 - r.length : null,
        dutyCycle: r.duty,
        initialVolume: r.initialVolume,
        volumeSweepChange: r.volumeSweepAmount,
        frequencySweepTime: r.freqSweepTime,
        frequencySweepShift: r.freqSweepShift,
      };
      song.dutyInstruments.push(ins);
    } else if (r.type === 1) {
      const ins: WaveInstrument = {
        ...base,
        index: song.waveInstruments.length,
        length: r.lengthEnabled ? 256 - r.length : null,
        volume: r.waveOutputLevel,
        waveIndex: r.waveWaveformIndex,
      };
      song.waveInstruments.push(ins);
    } else if (r.type === 2) {
      const ins: NoiseInstrument = {
        ...base,
        index: song.noiseInstruments.length,
        length: r.lengthEnabled ? 64 - r.length : null,
        initialVolume: r.initialVolume,
        volumeSweepChange: r.volumeSweepAmount,
        bitCount: r.noiseCounterStep ? 7 : 15,
      };
      // Older files kept a "noise macro" instead of a subpattern.
      if (version < 6 && r.noiseMacro.length > 0) {
        ins.subpatternEnabled = true;
        ins.subpattern = subpatternFromNoiseMacro(r.noiseMacro, song.ticksPerRow);
      }
      song.noiseInstruments.push(ins);
    } else {
      throw new UgeError(`Instrument "${r.name}" has an unknown type (${r.type}).`);
    }
  }

  song.patterns = Array.from(rawPatterns, (rows) => {
    const pattern = createPattern();
    if (!rows) return pattern;
    rows.forEach(([note, instrument, effectCode, effectParam], i) => {
      const cell = pattern[i];
      if (note !== 90) cell.note = note;
      if (instrument !== 0) cell.instrument = instrument - 1;
      if (effectCode !== 0 || effectParam !== 0) {
        cell.effectCode = effectCode;
        cell.effectParam = effectParam;
      }
    });
    return pattern;
  });

  song.sequence = orders[0].map((_, i) => {
    const channels: [number, number, number, number] = [orders[0][i], orders[1][i] ?? 0, orders[2][i] ?? 0, orders[3][i] ?? 0];
    return { splitPattern: isSplitPatternSequence(channels), channels };
  });

  return compactSong(song);
}

/**
 * Drops pattern blocks no sequence item uses and renumbers the rest.
 * Blocks are kept whole (4 patterns), like GB Studio.
 */
export function compactSong(song: Song): Song {
  const used = new Set<number>();
  for (const item of song.sequence) for (const id of item.channels) used.add(Math.floor(id / CHANNEL_COUNT));

  const patterns: Pattern[] = [];
  const idMap = new Map<number, number>();
  const blocks = Math.ceil(song.patterns.length / CHANNEL_COUNT);
  for (let b = 0; b < blocks; b++) {
    if (!used.has(b)) continue;
    const newBase = patterns.length;
    for (let c = 0; c < CHANNEL_COUNT; c++) {
      const src = song.patterns[b * CHANNEL_COUNT + c] ?? createPattern();
      idMap.set(b * CHANNEL_COUNT + c, newBase + c);
      patterns.push(src.map((cell) => ({ ...cell })));
    }
  }
  return {
    ...song,
    patterns,
    sequence: song.sequence.map((item) => ({
      ...item,
      channels: item.channels.map((id) => idMap.get(id) ?? 0) as [number, number, number, number],
    })),
  };
}

export function saveUge(input: Song): Uint8Array {
  const song = compactSong(input);
  const buffer = new ArrayBuffer(
    4 + 3 * 256 + 45 * 1400 + WAVE_COUNT * 32 + 16 + song.patterns.length * (4 + 64 * 17) + 4 * (8 + song.sequence.length * 4) + 64,
  );
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let idx = 0;
  const u8 = (v: number) => view.setUint8(idx++, v & 0xff);
  const i8 = (v: number) => view.setInt8(idx++, v);
  const u32 = (v: number) => {
    view.setUint32(idx, v >>> 0, true);
    idx += 4;
  };
  const encoder = new TextEncoder();
  const text = (s: string) => {
    const encoded = encoder.encode(s ?? "").subarray(0, 255);
    u8(encoded.length);
    bytes.set(encoded, idx);
    idx += 255;
  };
  const subpattern = (enabled: boolean, cells: SubPatternCell[]) => {
    i8(enabled ? 1 : 0);
    for (let n = 0; n < SUBPATTERN_LENGTH; n++) {
      const c = cells[n];
      u32(c?.note ?? 90);
      u32(0);
      u32(c?.jump ?? 0);
      u32(c?.effectCode ?? 0);
      u8(c?.effectParam ?? 0);
    }
  };
  const envelope = (initialVolume: number, change: number) => {
    u8(initialVolume);
    u32(change < 0 ? 1 : 0);
    u8(change !== 0 ? 8 - Math.abs(change) : 0);
  };

  u32(6);
  text(song.name);
  text(song.artist);
  text(song.comment);

  for (let n = 0; n < INSTRUMENTS_PER_TYPE; n++) {
    const i = song.dutyInstruments[n];
    u32(0);
    text(i?.name ?? "");
    u32(i && i.length !== null ? 64 - i.length : 0);
    u8(!i || i.length === null ? 0 : 1);
    envelope(i?.initialVolume ?? 0, i?.volumeSweepChange ?? 0);
    u32(i?.frequencySweepTime ?? 0);
    u32((i?.frequencySweepShift ?? 0) < 0 ? 1 : 0);
    u32(Math.abs(i?.frequencySweepShift ?? 0));
    u8(i?.dutyCycle ?? 0);
    u32(0);
    u32(0);
    u32(0);
    subpattern(!!i?.subpatternEnabled, i?.subpattern ?? []);
  }
  for (let n = 0; n < INSTRUMENTS_PER_TYPE; n++) {
    const i = song.waveInstruments[n];
    u32(1);
    text(i?.name ?? "");
    u32(i && i.length !== null ? 256 - i.length : 0);
    u8(!i || i.length === null ? 0 : 1);
    u8(0);
    u32(0);
    u8(0);
    u32(0);
    u32(0);
    u32(0);
    u8(0);
    u32(i?.volume ?? 0);
    u32(i?.waveIndex ?? 0);
    u32(0);
    subpattern(!!i?.subpatternEnabled, i?.subpattern ?? []);
  }
  for (let n = 0; n < INSTRUMENTS_PER_TYPE; n++) {
    const i = song.noiseInstruments[n];
    u32(2);
    text(i?.name ?? "");
    u32(i && i.length !== null ? 64 - i.length : 0);
    u8(!i || i.length === null ? 0 : 1);
    envelope(i?.initialVolume ?? 0, i?.volumeSweepChange ?? 0);
    u32(0);
    u32(0);
    u32(0);
    u8(0);
    u32(0);
    u32(0);
    u32(i?.bitCount === 7 ? 1 : 0);
    subpattern(!!i?.subpatternEnabled, i?.subpattern ?? []);
  }
  for (let n = 0; n < WAVE_COUNT; n++) for (let m = 0; m < 32; m++) u8(song.waves[n] ? song.waves[n][m] : 0);

  u32(song.ticksPerRow);
  i8(song.timerEnabled ? 1 : 0);
  u32(song.timerDivider);

  u32(song.patterns.length);
  song.patterns.forEach((pattern, id) => {
    u32(id);
    for (let m = 0; m < PATTERN_LENGTH; m++) {
      const t = pattern[m];
      u32(t.note === null ? 90 : t.note);
      u32(t.instrument === null ? 0 : t.instrument + 1);
      u32(0);
      u32(t.effectCode === null ? 0 : t.effectCode);
      u8(t.effectParam === null ? 0 : t.effectParam);
    }
  });
  for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
    u32(song.sequence.length + 1); // stored with an off-by-one
    for (const item of song.sequence) u32(item.channels[ch]);
    u32(0);
  }
  for (let n = 0; n < 16; n++) u32(0); // empty routines

  return bytes.slice(0, idx);
}
