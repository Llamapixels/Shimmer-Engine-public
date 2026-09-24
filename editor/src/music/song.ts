/**
 * The in-memory song model the music editor works on - the same shape
 * as GB Studio's (gb-studio-source/src/shared/lib/uge/types.ts, MIT), so
 * .uge files round-trip the way they do there.
 *
 * Patterns are one channel's 64 rows. They come in blocks of four (ids
 * 4b..4b+3, one per channel), and each sequence item lists the pattern
 * id each channel plays - normally a whole block, [4b, 4b+1, 4b+2, 4b+3].
 */

export const PATTERN_LENGTH = 64;
export const SUBPATTERN_LENGTH = 64;
export const CHANNEL_COUNT = 4;
export const INSTRUMENTS_PER_TYPE = 15;
export const WAVE_COUNT = 16;
/** Notes 0..71 are C3..B8 (hUGEDriver's note table). */
export const NOTE_COUNT = 72;

export interface PatternCell {
  note: number | null;
  instrument: number | null;
  effectCode: number | null;
  effectParam: number | null;
}

export type Pattern = PatternCell[];

export interface SequenceItem {
  splitPattern: boolean;
  channels: [number, number, number, number];
}

export interface SubPatternCell {
  /** Offset from the playing note, centred on 36 (so 36 = same note). */
  note: number | null;
  /** Row to jump to, plus one (0/null = no jump). */
  jump: number | null;
  effectCode: number | null;
  effectParam: number | null;
}

interface InstrumentBase {
  index: number;
  name: string;
  /** Note length in the channel's length units, or null to hold. */
  length: number | null;
  subpatternEnabled: boolean;
  subpattern: SubPatternCell[];
}

export interface DutyInstrument extends InstrumentBase {
  /** 0-3: 12.5%, 25%, 50%, 75%. */
  dutyCycle: number;
  initialVolume: number;
  /** -7..7: negative fades out, positive fades in, 0 holds. */
  volumeSweepChange: number;
  frequencySweepTime: number;
  /** -7..7: negative sweeps down. */
  frequencySweepShift: number;
}

export interface WaveInstrument extends InstrumentBase {
  /** 0 = mute, 1 = 100%, 2 = 50%, 3 = 25%. */
  volume: number;
  waveIndex: number;
}

export interface NoiseInstrument extends InstrumentBase {
  initialVolume: number;
  volumeSweepChange: number;
  bitCount: 7 | 15;
}

export type InstrumentType = "duty" | "wave" | "noise";
export type AnyInstrument = DutyInstrument | WaveInstrument | NoiseInstrument;

export interface Song {
  version: number;
  name: string;
  artist: string;
  comment: string;
  dutyInstruments: DutyInstrument[];
  waveInstruments: WaveInstrument[];
  noiseInstruments: NoiseInstrument[];
  /** 16 waves of 32 4-bit samples. */
  waves: Uint8Array[];
  ticksPerRow: number;
  timerEnabled: boolean;
  timerDivider: number;
  patterns: Pattern[];
  sequence: SequenceItem[];
}

export const CHANNELS: { index: 0 | 1 | 2 | 3; name: string; short: string; type: InstrumentType }[] = [
  { index: 0, name: "Duty 1", short: "D1", type: "duty" },
  { index: 1, name: "Duty 2", short: "D2", type: "duty" },
  { index: 2, name: "Wave", short: "W", type: "wave" },
  { index: 3, name: "Noise", short: "N", type: "noise" },
];

export function channelInstruments(song: Song, channel: number): AnyInstrument[] {
  const type = CHANNELS[channel].type;
  return type === "duty" ? song.dutyInstruments : type === "wave" ? song.waveInstruments : song.noiseInstruments;
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** 0 -> "C3", 71 -> "B8". */
export function noteName(note: number): string {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) + 3}`;
}

export function isBlackKey(note: number): boolean {
  return NOTE_NAMES[note % 12].includes("#");
}

export const createPatternCell = (): PatternCell => ({ note: null, instrument: null, effectCode: null, effectParam: null });

export const createPattern = (): Pattern => Array.from({ length: PATTERN_LENGTH }, createPatternCell);

export const createSubPatternCell = (): SubPatternCell => ({ note: null, jump: null, effectCode: null, effectParam: null });

export const createSubPattern = (): SubPatternCell[] => Array.from({ length: SUBPATTERN_LENGTH }, createSubPatternCell);

/** A sequence item playing pattern block `block` on all four channels. */
export const createSequenceItem = (block: number): SequenceItem => ({
  splitPattern: false,
  channels: [block * 4, block * 4 + 1, block * 4 + 2, block * 4 + 3],
});

export function isSplitPatternSequence([a, b, c, d]: [number, number, number, number]): boolean {
  return a % 4 !== 0 || b !== a + 1 || c !== a + 2 || d !== a + 3;
}

export function createEmptySong(): Song {
  return {
    version: 6,
    name: "",
    artist: "",
    comment: "",
    dutyInstruments: [],
    waveInstruments: [],
    noiseInstruments: [],
    waves: [],
    ticksPerRow: 6,
    timerEnabled: false,
    timerDivider: 0,
    patterns: [],
    sequence: [],
  };
}

/** Deep copy (the waves are typed arrays, so structuredClone-safe). */
export function cloneSong(song: Song): Song {
  return structuredClone(song);
}

/** Pattern block count (ids 4b..4b+3 form block b). */
export function blockCount(song: Song): number {
  return Math.ceil(song.patterns.length / CHANNEL_COUNT);
}

/** Adds a new empty block of four patterns; returns its block number. */
export function addPatternBlock(song: Song): number {
  while (song.patterns.length % CHANNEL_COUNT !== 0) song.patterns.push(createPattern());
  const block = song.patterns.length / CHANNEL_COUNT;
  for (let i = 0; i < CHANNEL_COUNT; i++) song.patterns.push(createPattern());
  return block;
}

/** Rows per second at the driver's ~59.73 Hz tick rate. */
export const TICKS_PER_SECOND = 4194304 / 70224;

/** Approximate tempo, taking a beat as four rows (GB Studio's display). */
export function ticksPerRowToBpm(ticksPerRow: number): number {
  return (TICKS_PER_SECOND * 60) / (ticksPerRow * 4);
}
