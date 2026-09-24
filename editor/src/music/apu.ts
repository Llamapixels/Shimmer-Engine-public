/**
 * A Game Boy / GBA PSG synthesizer: the four sound channels the songs are
 * written for (two squares, wave, noise), driven through the same
 * registers the engine's driver writes. It renders float samples for
 * WebAudio; accuracy is aimed at "sounds like the hardware" (duty
 * cycles, envelopes, sweep, length counters, the noise LFSR, panning),
 * not cycle-exact emulation.
 *
 * Register semantics follow the GBA where it differs from the Game Boy:
 * NR30 bit 7 turns channel 3 on (its bank bits are ignored - the driver
 * always plays bank 0), NR32's volume is bits 5-6, and wave RAM is
 * written as 16-bit words.
 */

import { Reg, type RegisterBus } from "./driver";

const CPU_HZ = 4194304; // the PSG's timing is the Game Boy's on the GBA too
const DUTY_TABLE = [
  [0, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
  [1, 0, 0, 0, 0, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
];

class Envelope {
  volume = 0;
  private period = 0;
  private up = false;
  private timer = 0;

  trigger(nrx2: number): void {
    this.volume = nrx2 >> 4;
    this.up = (nrx2 & 0x08) !== 0;
    this.period = nrx2 & 0x07;
    this.timer = this.period;
  }

  step(): void {
    if (this.period === 0) return;
    if (--this.timer > 0) return;
    this.timer = this.period;
    if (this.up && this.volume < 15) this.volume++;
    else if (!this.up && this.volume > 0) this.volume--;
  }
}

class SquareChannel {
  on = false;
  duty = 0;
  freq = 0;
  length = 0;
  lengthEnabled = false;
  env = new Envelope();
  nrx2 = 0;
  phase = 0; // 0..8 steps of the duty cycle
  // Sweep (channel 1 only)
  sweepPeriod = 0;
  sweepNegate = false;
  sweepShift = 0;
  private sweepTimer = 0;
  private sweepEnabled = false;
  private shadow = 0;

  constructor(private hasSweep: boolean) {}

  get dacOn(): boolean {
    return (this.nrx2 & 0xf8) !== 0;
  }

  trigger(): void {
    this.on = this.dacOn;
    if (this.length === 0) this.length = 64;
    this.env.trigger(this.nrx2);
    if (this.hasSweep) {
      this.shadow = this.freq;
      this.sweepTimer = this.sweepPeriod || 8;
      this.sweepEnabled = this.sweepPeriod !== 0 || this.sweepShift !== 0;
      if (this.sweepShift !== 0) this.sweepCalc();
    }
  }

  private sweepCalc(): number {
    const delta = this.shadow >> this.sweepShift;
    const next = this.sweepNegate ? this.shadow - delta : this.shadow + delta;
    if (next > 2047) this.on = false;
    return next;
  }

  stepSweep(): void {
    if (!this.hasSweep || !this.sweepEnabled) return;
    if (--this.sweepTimer > 0) return;
    this.sweepTimer = this.sweepPeriod || 8;
    if (this.sweepPeriod === 0) return;
    const next = this.sweepCalc();
    if (next <= 2047 && this.sweepShift !== 0) {
      this.shadow = next;
      this.freq = next;
      this.sweepCalc();
    }
  }

  stepLength(): void {
    if (this.lengthEnabled && this.length > 0 && --this.length === 0) this.on = false;
  }

  /** Average output (0..15) over `seconds`, band-limited by averaging. */
  sample(seconds: number): number {
    if (!this.on) return 0;
    const hz = CPU_HZ / 4 / 8 / (2048 - this.freq); // 131072 / (2048 - f)
    const steps = hz * 8 * seconds;
    const pattern = DUTY_TABLE[this.duty];
    // Integrate the duty pattern over the steps covered this sample.
    let acc = 0;
    let remaining = steps;
    let p = this.phase;
    let guard = 64;
    while (remaining > 0 && guard-- > 0) {
      const inStep = Math.min(1 - (p % 1), remaining);
      acc += pattern[Math.floor(p) & 7] * inStep;
      p += inStep;
      remaining -= inStep;
    }
    if (remaining > 0) {
      // Very high pitch: the remainder is a whole number of cycles-ish.
      acc += (remaining * pattern.reduce((a, b) => a + b, 0)) / 8;
      p += remaining;
    }
    this.phase = p % 8;
    return (acc / steps) * this.env.volume;
  }
}

class WaveChannel {
  on = false;
  dac = false;
  freq = 0;
  length = 0;
  lengthEnabled = false;
  volumeCode = 0;
  ram = new Uint8Array(32); // samples 0..15
  phase = 0; // 0..32

  trigger(): void {
    this.on = this.dac;
    if (this.length === 0) this.length = 256;
    this.phase = 0;
  }

  stepLength(): void {
    if (this.lengthEnabled && this.length > 0 && --this.length === 0) this.on = false;
  }

  sample(seconds: number): number {
    if (!this.on || !this.dac) return 0;
    const hz = CPU_HZ / 2 / 32 / (2048 - this.freq); // 65536 / (2048 - f)
    const steps = hz * 32 * seconds;
    let acc = 0;
    let remaining = steps;
    let p = this.phase;
    let guard = 128;
    while (remaining > 0 && guard-- > 0) {
      const inStep = Math.min(1 - (p % 1), remaining);
      acc += this.ram[Math.floor(p) & 31] * inStep;
      p += inStep;
      remaining -= inStep;
    }
    if (remaining > 0) {
      acc += (remaining * this.ram.reduce((a, b) => a + b, 0)) / 32;
      p += remaining;
    }
    this.phase = p % 32;
    const level = acc / steps;
    // 0 = mute, 1 = 100%, 2 = 50%, 3 = 25%.
    return this.volumeCode === 0 ? 0 : level / (1 << (this.volumeCode - 1));
  }
}

class NoiseChannel {
  on = false;
  length = 0;
  lengthEnabled = false;
  env = new Envelope();
  nrx2 = 0;
  nr43 = 0;
  private lfsr = 0x7fff;
  private timer = 0;

  get dacOn(): boolean {
    return (this.nrx2 & 0xf8) !== 0;
  }

  trigger(): void {
    this.on = this.dacOn;
    if (this.length === 0) this.length = 64;
    this.env.trigger(this.nrx2);
    this.lfsr = 0x7fff;
  }

  stepLength(): void {
    if (this.lengthEnabled && this.length > 0 && --this.length === 0) this.on = false;
  }

  sample(seconds: number): number {
    if (!this.on) return 0;
    const r = this.nr43 & 7;
    const s = this.nr43 >> 4;
    const hz = 524288 / (r === 0 ? 0.5 : r) / (1 << (s + 1));
    const narrow = (this.nr43 & 0x08) !== 0;
    // Count LFSR clocks this sample and average the output bit.
    this.timer += hz * seconds;
    let clocks = Math.floor(this.timer);
    this.timer -= clocks;
    if (clocks === 0) return (~this.lfsr & 1) * this.env.volume;
    let acc = 0;
    const n = Math.min(clocks, 256);
    for (let i = 0; i < n; i++) {
      const bit = (this.lfsr ^ (this.lfsr >> 1)) & 1;
      this.lfsr = (this.lfsr >> 1) | (bit << 14);
      if (narrow) this.lfsr = (this.lfsr & ~0x40) | (bit << 6);
      acc += ~this.lfsr & 1;
    }
    clocks = n;
    return (acc / clocks) * this.env.volume;
  }
}

export class Apu implements RegisterBus {
  private regs = new Uint8Array(32);
  private ch1 = new SquareChannel(true);
  private ch2 = new SquareChannel(false);
  private ch3 = new WaveChannel();
  private ch4 = new NoiseChannel();
  private frameTimer = 0;
  private frameStep = 0;
  // DC-blocking high-pass, like the Game Boy's output capacitor.
  private hpL = { x: 0, y: 0 };
  private hpR = { x: 0, y: 0 };
  /** Per-channel mute for the editor's channel toggles (0-3). */
  readonly silenced = [false, false, false, false];

  constructor(readonly sampleRate: number) {
    this.reset();
  }

  reset(): void {
    this.regs.fill(0);
    this.ch1 = new SquareChannel(true);
    this.ch2 = new SquareChannel(false);
    this.ch3 = new WaveChannel();
    this.ch4 = new NoiseChannel();
    this.regs[Reg.NR50] = 0x77;
    this.regs[Reg.NR51] = 0xff;
  }

  read(reg: Reg): number {
    return this.regs[reg];
  }

  writeWave16(index: number, value: number): void {
    const b0 = value & 0xff;
    const b1 = (value >> 8) & 0xff;
    const i = (index & 7) * 4;
    this.ch3.ram[i] = b0 >> 4;
    this.ch3.ram[i + 1] = b0 & 0x0f;
    this.ch3.ram[i + 2] = b1 >> 4;
    this.ch3.ram[i + 3] = b1 & 0x0f;
  }

  write(reg: Reg, value: number): void {
    value &= 0xff;
    this.regs[reg] = value;
    const { ch1, ch2, ch3, ch4 } = this;
    switch (reg) {
      case Reg.NR10:
        ch1.sweepPeriod = (value >> 4) & 7;
        ch1.sweepNegate = (value & 0x08) !== 0;
        ch1.sweepShift = value & 7;
        break;
      case Reg.NR11:
      case Reg.NR21: {
        const ch = reg === Reg.NR11 ? ch1 : ch2;
        ch.duty = value >> 6;
        ch.length = 64 - (value & 0x3f);
        break;
      }
      case Reg.NR12:
      case Reg.NR22: {
        const ch = reg === Reg.NR12 ? ch1 : ch2;
        ch.nrx2 = value;
        if (!ch.dacOn) ch.on = false;
        break;
      }
      case Reg.NR13:
        ch1.freq = (ch1.freq & 0x700) | value;
        break;
      case Reg.NR23:
        ch2.freq = (ch2.freq & 0x700) | value;
        break;
      case Reg.NR14:
      case Reg.NR24: {
        const ch = reg === Reg.NR14 ? ch1 : ch2;
        ch.freq = (ch.freq & 0xff) | ((value & 7) << 8);
        ch.lengthEnabled = (value & 0x40) !== 0;
        if (value & 0x80) ch.trigger();
        break;
      }
      case Reg.NR30:
        ch3.dac = (value & 0x80) !== 0;
        if (!ch3.dac) ch3.on = false;
        break;
      case Reg.NR31:
        ch3.length = 256 - value;
        break;
      case Reg.NR32:
        ch3.volumeCode = (value >> 5) & 3;
        break;
      case Reg.NR33:
        ch3.freq = (ch3.freq & 0x700) | value;
        break;
      case Reg.NR34:
        ch3.freq = (ch3.freq & 0xff) | ((value & 7) << 8);
        ch3.lengthEnabled = (value & 0x40) !== 0;
        if (value & 0x80) ch3.trigger();
        break;
      case Reg.NR41:
        ch4.length = 64 - (value & 0x3f);
        break;
      case Reg.NR42:
        ch4.nrx2 = value;
        if (!ch4.dacOn) ch4.on = false;
        break;
      case Reg.NR43:
        ch4.nr43 = value;
        break;
      case Reg.NR44:
        ch4.lengthEnabled = (value & 0x40) !== 0;
        if (value & 0x80) ch4.trigger();
        break;
    }
  }

  /** Is each channel currently sounding (for the editor's meters)? */
  get active(): [boolean, boolean, boolean, boolean] {
    return [this.ch1.on, this.ch2.on, this.ch3.on && this.ch3.dac, this.ch4.on];
  }

  private frameSequencer(): void {
    const step = this.frameStep;
    this.frameStep = (step + 1) & 7;
    if ((step & 1) === 0) {
      this.ch1.stepLength();
      this.ch2.stepLength();
      this.ch3.stepLength();
      this.ch4.stepLength();
    }
    if (step === 2 || step === 6) this.ch1.stepSweep();
    if (step === 7) {
      this.ch1.env.step();
      this.ch2.env.step();
      this.ch4.env.step();
    }
  }

  /** Renders `count` stereo samples into left/right starting at `offset`. */
  render(left: Float32Array, right: Float32Array, offset: number, count: number): void {
    const dt = 1 / this.sampleRate;
    const frameDt = 1 / 512;
    const R = 0.995; // high-pass pole
    for (let i = 0; i < count; i++) {
      this.frameTimer += dt;
      while (this.frameTimer >= frameDt) {
        this.frameTimer -= frameDt;
        this.frameSequencer();
      }
      const outs = [this.ch1.sample(dt), this.ch2.sample(dt), this.ch3.sample(dt), this.ch4.sample(dt)];
      const nr51 = this.regs[Reg.NR51];
      const nr50 = this.regs[Reg.NR50];
      let l = 0;
      let r = 0;
      for (let c = 0; c < 4; c++) {
        if (this.silenced[c]) continue;
        // 0..15 -> -1..1, like the Game Boy's DACs.
        const v = outs[c] / 7.5 - 1;
        const dac = c === 0 ? this.ch1.dacOn : c === 1 ? this.ch2.dacOn : c === 2 ? this.ch3.dac : this.ch4.dacOn;
        if (!dac) continue;
        if (nr51 & (0x10 << c)) l += v;
        if (nr51 & (1 << c)) r += v;
      }
      l *= (((nr50 >> 4) & 7) + 1) / 8 / 4;
      r *= ((nr50 & 7) + 1) / 8 / 4;
      const yl = l - this.hpL.x + R * this.hpL.y;
      this.hpL.x = l;
      this.hpL.y = yl;
      const yr = r - this.hpR.x + R * this.hpR.y;
      this.hpR.x = r;
      this.hpR.y = yr;
      left[offset + i] = yl * 0.8;
      right[offset + i] = yr * 0.8;
    }
  }
}
