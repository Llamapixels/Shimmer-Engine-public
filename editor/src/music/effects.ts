/** hUGETracker's effects (the effect column's code 0-F), with what their
 * parameter means - for the music editor's effect picker. */

export interface EffectDef {
  code: number;
  name: string;
  /** How the 8-bit parameter splits: one byte, or two nibbles x/y. */
  params: { kind: "byte"; label: string } | { kind: "nibbles"; x: string; y: string };
  description: string;
}

export const EFFECTS: EffectDef[] = [
  { code: 0x0, name: "Arpeggio", params: { kind: "nibbles", x: "Semitones 2", y: "Semitones 3" }, description: "Cycles the note, note + x and note + y every tick, for a chord." },
  { code: 0x1, name: "Portamento up", params: { kind: "byte", label: "Speed" }, description: "Slides the pitch up every tick." },
  { code: 0x2, name: "Portamento down", params: { kind: "byte", label: "Speed" }, description: "Slides the pitch down every tick." },
  { code: 0x3, name: "Tone portamento", params: { kind: "byte", label: "Speed" }, description: "Slides from the previous note to this row's note." },
  { code: 0x4, name: "Vibrato", params: { kind: "nibbles", x: "Speed", y: "Depth" }, description: "Wobbles the pitch." },
  { code: 0x5, name: "Set master volume", params: { kind: "nibbles", x: "Left (0-7)", y: "Right (0-7)" }, description: "Sets the overall volume of each speaker." },
  { code: 0x6, name: "Call routine", params: { kind: "byte", label: "Routine (0-15)" }, description: "Runs the script attached with the Set Music Routine event." },
  { code: 0x7, name: "Note delay", params: { kind: "byte", label: "Ticks" }, description: "Starts this row's note this many ticks late." },
  { code: 0x8, name: "Set panning", params: { kind: "byte", label: "Mask" }, description: "Which channels play on which speaker (bits 4-7 left, 0-3 right)." },
  { code: 0x9, name: "Set duty cycle / wave", params: { kind: "byte", label: "Value" }, description: "Squares: duty in bits 6-7. Wave: wave number. Noise: bit 3 = 7-bit mode." },
  { code: 0xa, name: "Volume slide", params: { kind: "nibbles", x: "Up", y: "Down" }, description: "Raises or lowers the volume every tick." },
  { code: 0xb, name: "Position jump", params: { kind: "byte", label: "Order (1 = first)" }, description: "Jumps to another sequence position after this row." },
  { code: 0xc, name: "Set volume", params: { kind: "byte", label: "Volume (0-15)" }, description: "Sets the note's volume." },
  { code: 0xd, name: "Pattern break", params: { kind: "byte", label: "Row (1 = first)" }, description: "Moves on to the next sequence position after this row." },
  { code: 0xe, name: "Note cut", params: { kind: "byte", label: "After ticks" }, description: "Stops the note after this many ticks." },
  { code: 0xf, name: "Set speed", params: { kind: "byte", label: "Ticks per row" }, description: "Changes the song's speed." },
];

export function effectLabel(code: number | null, param: number | null): string {
  if (code === null) return "";
  return `${code.toString(16).toUpperCase()}${(param ?? 0).toString(16).toUpperCase().padStart(2, "0")}`;
}
