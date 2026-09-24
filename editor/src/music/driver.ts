/**
 * TypeScript port of engine/source/huge.c (the engine's hUGEDriver), so
 * the editor plays songs exactly as the game does. It follows the C
 * line for line - including the GBA-specific register writes (NR30 bank
 * bits, 16-bit wave RAM writes) - and drives an Apu (apu.ts) instead of
 * the hardware. Keep the two in sync.
 */

import { LAST_NOTE, NO_NOTE, type HugeInstr, type HugeSongData } from "./compile";

/** Register ids, named after the Game Boy's (the GBA has the same
 * registers at different addresses). */
export enum Reg {
  NR10,
  NR11,
  NR12,
  NR13,
  NR14,
  NR21,
  NR22,
  NR23,
  NR24,
  NR30,
  NR31,
  NR32,
  NR33,
  NR34,
  NR41,
  NR42,
  NR43,
  NR44,
  NR50,
  NR51,
}

export interface RegisterBus {
  write(reg: Reg, value: number): void;
  read(reg: Reg): number;
  /** GBA wave RAM, as eight 16-bit words (samples packed high nibble first). */
  writeWave16(index: number, value: number): void;
}

const REG_ENV = [Reg.NR12, Reg.NR22, Reg.NR32, Reg.NR42];
const REG_GO = [Reg.NR14, Reg.NR24, Reg.NR34, Reg.NR44];

const NR30_PLAY_BANK0 = 0x80;
const NR30_WRITE_BANK0 = 0x40;
const PATTERN_LENGTH = 64;
const NO_WAVE = 100;

/** hUGE_note_table.inc: NRx3/NRx4 period for each of the 72 notes. */
export const NOTE_TABLE = [
  44, 156, 262, 363, 457, 547, 631, 710, 786, 854, 923, 986, 1046, 1102, 1155, 1205, 1253, 1297, 1339, 1379, 1417, 1452, 1486, 1517,
  1546, 1575, 1602, 1627, 1650, 1673, 1694, 1714, 1732, 1750, 1767, 1783, 1798, 1812, 1825, 1837, 1849, 1860, 1871, 1881, 1890, 1899,
  1907, 1915, 1923, 1930, 1936, 1943, 1949, 1954, 1959, 1964, 1969, 1974, 1978, 1982, 1985, 1988, 1992, 1995, 1998, 2001, 2004, 2006,
  2009, 2011, 2013, 2015,
];

interface Channel {
  period: number;
  toneportaTarget: number;
  note: number;
  highmask: number;
  table: Uint8Array | null;
  tableRow: number;
}

const newChannel = (): Channel => ({ period: 0, toneportaTarget: 0, note: 0, highmask: 0, table: null, tableRow: 0 });

const u8 = (v: number) => v & 0xff;
const u16 = (v: number) => v & 0xffff;
const swap8 = (v: number) => u8((v << 4) | (v >> 4));

export class HugeDriver {
  private song: HugeSongData | null = null;
  private ticksPerRow = 0;
  private currentWave = NO_WAVE;
  private pattern: Uint8Array[] = [];
  private muteChannels = 0;
  private counter = 0;
  private tick = 0;
  private rowBreak = 0;
  private nextOrder = 0;
  private row = 0;
  private currentOrder = 0;
  private stepWidth4 = 0;
  private channels: Channel[] = [newChannel(), newChannel(), newChannel(), newChannel()];
  private wrapped = false;

  /** Called with the routine id for effect 6xx. */
  onRoutine: ((routine: number) => void) | null = null;

  constructor(private bus: RegisterBus) {}

  /** Where playback is: the row about to play and its order. */
  get position(): { order: number; row: number; tick: number } {
    return { order: this.currentOrder, row: this.row, tick: this.tick };
  }

  get hasWrapped(): boolean {
    return this.wrapped;
  }

  private isMuted(ch: number): boolean {
    return ((this.muteChannels >> ch) & 1) === 1;
  }

  private loadPatterns(order: number): void {
    for (let ch = 0; ch < 4; ch++) this.pattern[ch] = this.song!.orders[ch][order];
  }

  private getNotePeriod(note: number): number {
    if (note >= LAST_NOTE) note = LAST_NOTE - 1;
    return NOTE_TABLE[note];
  }

  private getNotePoly(note: number): number {
    const a = u8(~u8(note + 192));
    if (a < 7) return a;
    const b = u8((a >> 2) - 1);
    const c = u8((a & 3) + 4);
    return c | swap8(b);
  }

  private updateChannelFreq(ch: number, value: number, h: number): void {
    if (this.isMuted(ch)) return;
    const lo = value & 0xff;
    const hi = (value >> 8) & 0xff;
    const bus = this.bus;
    switch (ch) {
      case 0:
        this.channels[0].period = u16(value);
        bus.write(Reg.NR13, lo);
        bus.write(Reg.NR14, u8(hi | h));
        break;
      case 1:
        this.channels[1].period = u16(value);
        bus.write(Reg.NR23, lo);
        bus.write(Reg.NR24, u8(hi | h));
        break;
      case 2:
        this.channels[2].period = u16(value);
        bus.write(Reg.NR33, lo);
        bus.write(Reg.NR34, u8(hi | h));
        break;
      default:
        bus.write(Reg.NR43, u8(this.getNotePoly(lo) | this.stepWidth4));
        bus.write(Reg.NR44, u8(h));
        break;
    }
  }

  private playNote(ch: number): void {
    if (this.isMuted(ch)) return;
    const c = this.channels[ch];
    const bus = this.bus;
    switch (ch) {
      case 0:
        bus.write(Reg.NR13, c.period & 0xff);
        bus.write(Reg.NR14, u8(c.highmask | (c.period >> 8)));
        break;
      case 1:
        bus.write(Reg.NR23, c.period & 0xff);
        bus.write(Reg.NR24, u8(c.highmask | (c.period >> 8)));
        break;
      case 2:
        bus.write(Reg.NR30, 0);
        bus.write(Reg.NR30, NR30_PLAY_BANK0);
        bus.write(Reg.NR33, c.period & 0xff);
        bus.write(Reg.NR34, u8(c.highmask | (c.period >> 8)));
        break;
      default:
        bus.write(Reg.NR43, c.period & 0xff);
        bus.write(Reg.NR44, c.highmask);
        break;
    }
  }

  private updateCh3Waveform(index: number): void {
    this.currentWave = index;
    const base = (index & 0x0f) * 16;
    const w = this.song!.waves;
    const pan = this.bus.read(Reg.NR51);
    this.bus.write(Reg.NR51, pan & 0xbb);
    this.bus.write(Reg.NR30, NR30_WRITE_BANK0);
    for (let i = 0; i < 8; i++) this.bus.writeWave16(i, w[base + i * 2] | (w[base + i * 2 + 1] << 8));
    this.bus.write(Reg.NR30, NR30_PLAY_BANK0);
    this.bus.write(Reg.NR51, pan);
  }

  private noteCut(ch: number): void {
    this.bus.write(REG_ENV[ch], 0);
    if (ch === 2) return;
    this.bus.write(REG_GO[ch], 0xff);
  }

  private doEffect(ch: number, b: number, c: number, fromTable: boolean): boolean {
    const fx = b & 0x0f;
    if (fx === 0 && c === 0) return true;

    const chan = this.channels[ch];
    const bus = this.bus;
    const tick0 = this.tick === 0;
    const onlyTick0 = !fromTable && !tick0;
    const skipTick0 = !fromTable && tick0;

    switch (fx) {
      case 0x0: {
        let k = u8(this.counter - 1);
        while (k >= 3) k -= 3;
        let n = chan.note;
        if (k === 0) n = u8(n + (c & 0x0f));
        else if (k === 1) n = u8(n + (c >> 4));
        this.updateChannelFreq(ch, this.getNotePeriod(n), 0);
        break;
      }
      case 0x1:
        if (skipTick0) break;
        this.updateChannelFreq(ch, u16(chan.period + c), 0);
        break;
      case 0x2:
        if (skipTick0) break;
        this.updateChannelFreq(ch, u16(chan.period - c), 0);
        break;
      case 0x3: {
        if (fromTable) break;
        if (tick0) {
          chan.toneportaTarget = this.getNotePeriod(chan.note);
          return false;
        }
        let cur = chan.period;
        const target = chan.toneportaTarget;
        if (target < cur) {
          cur -= c;
          if (cur < target) cur = target;
        } else if (target > cur) {
          cur += c;
          if (cur > target) cur = target;
        }
        chan.period = u16(cur);
        const h = chan.highmask;
        chan.highmask &= 0x7f;
        this.updateChannelFreq(ch, u16(cur), h);
        break;
      }
      case 0x4: {
        if (skipTick0) break;
        let period = this.getNotePeriod(chan.note);
        if ((this.counter & (c >> 4)) === 0) period = u16(period + (c & 0x0f));
        this.updateChannelFreq(ch, period, 0);
        break;
      }
      case 0x5:
        if (onlyTick0) break;
        bus.write(Reg.NR50, c);
        break;
      case 0x6:
        this.onRoutine?.(c & 0x0f);
        break;
      case 0x7:
        if (fromTable) break;
        if (tick0) return false;
        if (this.tick === c) this.playNote(ch);
        break;
      case 0x8:
        if (onlyTick0) break;
        bus.write(Reg.NR51, c);
        break;
      case 0x9:
        if (onlyTick0 || this.isMuted(ch)) break;
        if (ch === 0) bus.write(Reg.NR11, c);
        else if (ch === 1) bus.write(Reg.NR21, c);
        else if (ch === 3) bus.write(Reg.NR43, u8((bus.read(Reg.NR43) & ~0x08) | c));
        else {
          this.updateCh3Waveform(c);
          this.playNote(2);
        }
        break;
      case 0xa: {
        if (onlyTick0 || this.isMuted(ch)) break;
        const down = c & 0x0f;
        const up = c >> 4;
        let vol = bus.read(REG_ENV[ch]) >> 4;
        vol = vol < down ? 0 : vol - down;
        vol += up;
        if (vol > 15) vol = 15;
        bus.write(REG_ENV[ch], u8(vol << 4));
        if (ch === 3) bus.write(REG_GO[ch], 0x80 | (chan.highmask & 0x40));
        else bus.write(REG_GO[ch], 0x80 | (chan.highmask & 0x40) | ((chan.period >> 8) & 0x07));
        this.playNote(ch);
        break;
      }
      case 0xb:
        if (onlyTick0) break;
        if ((this.tick | this.rowBreak) === 0) this.rowBreak = 1;
        this.nextOrder = c;
        break;
      case 0xc: {
        if (onlyTick0 || this.isMuted(ch)) break;
        const v = swap8(c);
        if (ch === 0 || ch === 1) {
          bus.write(REG_ENV[ch], u8((bus.read(REG_ENV[ch]) & 0x0f) | v));
          this.playNote(ch);
        } else if (ch === 2) {
          let level: number;
          if (v >= 10 << 4) level = 0x20;
          else if (v >= 5 << 4) level = 0x40;
          else if (v === 0) level = 0x00;
          else level = 0x60;
          bus.write(Reg.NR32, level);
        } else {
          bus.write(Reg.NR42, v);
          this.playNote(3);
        }
        break;
      }
      case 0xd:
        if (onlyTick0) break;
        this.rowBreak = c;
        break;
      case 0xe:
        if (fromTable ? !tick0 : this.tick !== c) break;
        if (this.isMuted(ch)) break;
        this.noteCut(ch);
        break;
      case 0xf:
        if (onlyTick0) break;
        this.ticksPerRow = c;
        break;
    }
    return true;
  }

  private doTable(ch: number): void {
    const chan = this.channels[ch];
    const table = chan.table!;
    const at = u8(chan.tableRow * 3);
    chan.tableRow = u8(chan.tableRow + 1);

    let note = table[at] ?? NO_NOTE;
    const b = table[at + 1] ?? 0;
    const c = table[at + 2] ?? 0;

    let jump = b >> 4;
    if (note & 0x80) {
      note &= 0x7f;
      jump |= 0x10;
    }
    if (jump) chan.tableRow = jump - 1;

    if (note !== NO_NOTE) {
      const n = u8(note - 36 + chan.note);
      const h = chan.highmask & 0x7f;
      if (ch === 3) this.updateChannelFreq(ch, n, h);
      else this.updateChannelFreq(ch, this.getNotePeriod(n), h);
    }

    this.doEffect(ch, b, c, true);
  }

  init(song: HugeSongData): void {
    this.song = song;
    this.ticksPerRow = song.ticksPerRow;
    this.muteChannels = 0;
    this.counter = 0;
    this.tick = 0;
    this.rowBreak = 0;
    this.nextOrder = 0;
    this.row = 0;
    this.currentOrder = 0;
    this.stepWidth4 = 0;
    this.wrapped = false;
    this.channels = [newChannel(), newChannel(), newChannel(), newChannel()];
    this.currentWave = NO_WAVE;
    this.loadPatterns(0);
  }

  /** Not in the C: start from a given order and row (the editor's
   * "play from here"). */
  seek(order: number, row: number): void {
    if (!this.song) return;
    this.currentOrder = Math.max(0, Math.min(order, this.song.orderCount - 1));
    this.row = row & (PATTERN_LENGTH - 1);
    this.tick = 0;
    this.loadPatterns(this.currentOrder);
  }

  /** Not in the C: swap in an edited song without restarting, keeping
   * the position (clamped if the sequence got shorter). */
  replaceSong(song: HugeSongData): void {
    if (!this.song || song.orderCount === 0) {
      this.init(song);
      return;
    }
    this.song = song;
    this.ticksPerRow = song.ticksPerRow;
    if (this.currentOrder >= song.orderCount) {
      this.currentOrder = 0;
      this.row = 0;
      this.tick = 0;
    }
    this.loadPatterns(this.currentOrder);
  }

  muteChannel(ch: number, mute: boolean): void {
    this.muteChannels = (this.muteChannels & ~(1 << ch)) | ((mute ? 1 : 0) << ch);
    if (mute) this.noteCut(ch);
  }

  silence(): void {
    for (let ch = 0; ch < 4; ch++) this.noteCut(ch);
    this.bus.write(Reg.NR30, 0);
  }

  private processRow(): void {
    const song = this.song!;
    const bus = this.bus;
    for (let ch = 0; ch < 4; ch++) {
      const chan = this.channels[ch];
      const cell = this.row * 3;
      const note = this.pattern[ch][cell];
      const b = this.pattern[ch][cell + 1];
      const c = this.pattern[ch][cell + 2];
      const valid = note < LAST_NOTE;

      if (valid) {
        chan.note = note;
        if (ch < 3) {
          if ((b & 0x0f) !== 3) chan.period = this.getNotePeriod(note);
        } else {
          chan.period = this.getNotePoly(note);
        }

        const instr = b >> 4;
        if (instr === 0) {
          chan.highmask &= 0x7f;
        } else if (!this.isMuted(ch)) {
          let ins: HugeInstr;
          switch (ch) {
            case 0:
              ins = song.duty[instr - 1];
              bus.write(Reg.NR10, ins.b0);
              bus.write(Reg.NR11, ins.b1);
              bus.write(Reg.NR12, ins.b2);
              chan.highmask = ins.highmask;
              break;
            case 1:
              ins = song.duty[instr - 1];
              bus.write(Reg.NR21, ins.b1);
              bus.write(Reg.NR22, ins.b2);
              chan.highmask = ins.highmask;
              break;
            case 2:
              ins = song.wave[instr - 1];
              bus.write(Reg.NR31, ins.b0);
              bus.write(Reg.NR32, ins.b1);
              if (ins.b2 !== this.currentWave) this.updateCh3Waveform(ins.b2);
              chan.highmask = ins.highmask;
              break;
            default:
              ins = song.noise[instr - 1];
              bus.write(Reg.NR42, ins.b0);
              bus.write(Reg.NR41, ins.highmask & 0x3f);
              this.stepWidth4 = (ins.highmask & 0x80) >> 4;
              chan.period |= this.stepWidth4;
              chan.highmask = (ins.highmask & 0x40) | 0x80;
              break;
          }
          chan.table = ins.table;
          chan.tableRow = 0;
        }
      }

      const play = this.doEffect(ch, b, c, false);
      if (valid && play) this.playNote(ch);
      if (chan.table) this.doTable(ch);
    }
  }

  private processEffects(): void {
    for (let ch = 0; ch < 4; ch++) {
      if (!this.isMuted(ch)) {
        const cell = this.row * 3;
        if (this.pattern[ch][cell + 2] !== 0) this.doEffect(ch, this.pattern[ch][cell + 1], this.pattern[ch][cell + 2], false);
      }
      if (this.channels[ch].table) this.doTable(ch);
    }
  }

  private tickTime(): void {
    const song = this.song!;
    this.counter = u8(this.counter + 1);
    this.tick = u8(this.tick + 1);
    if (this.tick !== this.ticksPerRow) return;
    this.tick = 0;

    let startRow: number;
    let order: number;
    if (this.rowBreak) {
      startRow = this.rowBreak - 1;
      this.rowBreak = 0;
      if (this.nextOrder) {
        order = this.nextOrder - 1;
        this.nextOrder = 0;
        this.load(order, startRow);
        return;
      }
    } else {
      this.row = u8(this.row + 1);
      if (this.row !== PATTERN_LENGTH) return;
      startRow = 0;
    }
    order = this.currentOrder + 1;
    if (order >= song.orderCount) this.wrapped = true;
    this.load(order, startRow);
  }

  private load(order: number, startRow: number): void {
    if (order >= this.song!.orderCount) order = 0;
    this.currentOrder = order;
    this.loadPatterns(order);
    this.row = startRow & (PATTERN_LENGTH - 1);
  }

  /** One tick (the game calls this once per frame). */
  dosound(): void {
    if (!this.song || this.song.orderCount === 0) return;
    if (this.tick === 0) this.processRow();
    else this.processEffects();
    this.tickTime();
  }
}
