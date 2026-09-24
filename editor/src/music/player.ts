/**
 * Plays songs in the editor: the driver port (driver.ts) ticking at the
 * Game Boy's frame rate, feeding the PSG synth (apu.ts), through
 * WebAudio. One shared instance - the music editor only ever plays one
 * thing at a time.
 */

import { Apu } from "./apu";
import { compileSong, type HugeSongData } from "./compile";
import { HugeDriver, Reg } from "./driver";
import { PATTERN_LENGTH, createPattern, type Song } from "./song";

/** One driver tick: a Game Boy frame (70224 cycles at 4.194304 MHz). */
export const TICK_SECONDS = 70224 / 4194304;

export interface PlaybackPosition {
  order: number;
  row: number;
}

type Mode = { kind: "idle" } | { kind: "song"; loop: boolean } | { kind: "preview"; ticksLeft: number };

/** Renders the driver + APU into sample buffers (also used offline). */
export class SongRenderer {
  readonly apu: Apu;
  readonly driver: HugeDriver;
  private tickTimer = 0;
  mode: Mode = { kind: "idle" };

  constructor(sampleRate: number) {
    this.apu = new Apu(sampleRate);
    this.driver = new HugeDriver(this.apu);
  }

  start(data: HugeSongData, mode: Mode, from?: PlaybackPosition): void {
    this.apu.reset();
    // music.c does this before every song: everything on, both speakers.
    this.apu.write(Reg.NR50, 0x77);
    this.apu.write(Reg.NR51, 0xff);
    this.driver.init(data);
    if (from) this.driver.seek(from.order, from.row);
    this.tickTimer = 0;
    this.mode = mode;
  }

  stop(): void {
    if (this.mode.kind !== "idle") this.driver.silence();
    this.mode = { kind: "idle" };
  }

  render(left: Float32Array, right: Float32Array): void {
    const dt = 1 / this.apu.sampleRate;
    let i = 0;
    while (i < left.length) {
      if (this.mode.kind !== "idle" && this.tickTimer <= 0) {
        this.tickTimer += TICK_SECONDS;
        this.tickOnce();
      }
      // Render up to the next tick in one go.
      const until = this.mode.kind === "idle" ? left.length - i : Math.max(1, Math.ceil(this.tickTimer / dt));
      const n = Math.min(until, left.length - i);
      this.apu.render(left, right, i, n);
      this.tickTimer -= n * dt;
      i += n;
    }
  }

  private tickOnce(): void {
    const mode = this.mode;
    if (mode.kind === "preview") {
      if (mode.ticksLeft-- <= 0) {
        this.stop();
        return;
      }
    }
    this.driver.dosound();
    if (mode.kind === "song" && !mode.loop && this.driver.hasWrapped) this.stop();
  }
}

class Player {
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private renderer: SongRenderer | null = null;
  private listeners = new Set<() => void>();
  private songMutes = [false, false, false, false];

  private ensure(): SongRenderer {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.renderer = new SongRenderer(this.ctx.sampleRate);
      this.node = this.ctx.createScriptProcessor(2048, 0, 2);
      this.node.onaudioprocess = (e) => {
        this.renderer!.render(e.outputBuffer.getChannelData(0), e.outputBuffer.getChannelData(1));
      };
      this.node.connect(this.ctx.destination);
    }
    void this.ctx.resume();
    return this.renderer!;
  }

  /** Called whenever playing starts/stops (for the play button). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get playing(): boolean {
    return this.renderer?.mode.kind === "song";
  }

  /** The row being heard right now, or null when not playing a song. */
  get position(): PlaybackPosition | null {
    if (!this.playing) return null;
    const p = this.renderer!.driver.position;
    // The driver has already advanced past the row it last played.
    let row = p.row - (p.tick === 0 ? 1 : 0);
    let order = p.order;
    if (row < 0) {
      row = PATTERN_LENGTH - 1;
      order = Math.max(0, order - 1);
    }
    return { order, row };
  }

  get channelActivity(): [boolean, boolean, boolean, boolean] {
    return this.renderer?.apu.active ?? [false, false, false, false];
  }

  play(song: Song, from?: PlaybackPosition, loop = true): void {
    const data = compileSong(song);
    if (data.orderCount === 0) return;
    const r = this.ensure();
    r.start(data, { kind: "song", loop }, from);
    this.applyMutes();
    this.emit();
  }

  /** Keep playing an edited song from where it is. */
  update(song: Song): void {
    if (!this.playing) return;
    this.renderer!.driver.replaceSong(compileSong(song));
  }

  stop(): void {
    this.renderer?.stop();
    this.emit();
  }

  /** Editor channel toggles: silence a channel's output. */
  setChannelMuted(channel: number, muted: boolean): void {
    this.songMutes[channel] = muted;
    this.applyMutes();
  }

  private applyMutes(): void {
    if (!this.renderer) return;
    for (let c = 0; c < 4; c++) this.renderer.apu.silenced[c] = this.songMutes[c];
  }

  /**
   * Plays one note on a channel with one of the song's instruments, for
   * about `seconds` (the piano roll and instrument editor use this). Runs
   * through the real driver, so subpatterns and effects apply.
   */
  previewNote(song: Song, channel: number, instrument: number, note: number, seconds = 0.6): void {
    const r = this.ensure();
    if (this.playing) return; // don't interrupt the song
    const preview: Song = { ...song, patterns: [createPattern(), createPattern(), createPattern(), createPattern()], ticksPerRow: 255 };
    preview.patterns[channel][0] = { note, instrument, effectCode: null, effectParam: null };
    preview.sequence = [{ splitPattern: false, channels: [0, 1, 2, 3] }];
    r.start(compileSong(preview), { kind: "preview", ticksLeft: Math.round(seconds / TICK_SECONDS) });
    for (let c = 0; c < 4; c++) r.apu.silenced[c] = false;
    this.emit();
  }
}

export const player = new Player();

/** Offline render (tests, and a future WAV export). */
export function renderSong(song: Song, seconds: number, sampleRate = 44100): { left: Float32Array; right: Float32Array } {
  const r = new SongRenderer(sampleRate);
  r.start(compileSong(song), { kind: "song", loop: true });
  const left = new Float32Array(Math.round(seconds * sampleRate));
  const right = new Float32Array(left.length);
  r.render(left, right);
  return { left, right };
}
