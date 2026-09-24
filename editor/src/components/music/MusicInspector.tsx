import { useRef, useState, type ReactNode } from "react";

import { EFFECTS, effectLabel } from "../../music/effects";
import { cellAt, fromAbsRow, useMusicStore } from "../../music/musicStore";
import { player } from "../../music/player";
import {
  CHANNELS,
  NOTE_COUNT,
  SUBPATTERN_LENGTH,
  WAVE_COUNT,
  channelInstruments,
  createSubPattern,
  noteName,
  ticksPerRowToBpm,
  type DutyInstrument,
  type InstrumentType,
  type NoiseInstrument,
  type Song,
  type WaveInstrument,
} from "../../music/song";
import NumberInput from "../common/NumberInput";
import FieldRow from "../inspector/FieldRow";
import { WaveThumb } from "./MusicNavigator";

/** Right column: what's selected - notes, an instrument, a wave - or the
 * song's own settings. */
export default function MusicInspector() {
  const song = useMusicStore((s) => s.song);
  const inspect = useMusicStore((s) => s.inspect);
  const selection = useMusicStore((s) => s.selection);
  if (!song) return <div className="music-inspector" />;
  return (
    <div className="music-inspector">
      {inspect.kind === "cells" && selection.length > 0 ? (
        <CellsEditor />
      ) : inspect.kind === "instrument" ? (
        <InstrumentEditor type={inspect.type} index={inspect.index} />
      ) : inspect.kind === "wave" ? (
        <WaveEditor index={inspect.index} />
      ) : (
        <SongSettings />
      )}
    </div>
  );
}

/** FieldRow's look without its <label> wrapper - for rows holding
 * several buttons, where a label would click the first one. */
function GroupRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="field-row">
      <span className="field-row-label">{label}</span>
      {children}
      {hint && <span className="field-row-hint">{hint}</span>}
    </div>
  );
}

function Section({ title, children, actions }: { title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="music-insp-section">
      <div className="music-insp-title">
        <span>{title}</span>
        {actions}
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Song
// ---------------------------------------------------------------------------

function SongSettings() {
  const song = useMusicStore((s) => s.song)!;
  const songName = useMusicStore((s) => s.songName);
  const edit = useMusicStore((s) => s.edit);
  const notes = song.patterns.reduce((n, p) => n + p.filter((c) => c.note !== null).length, 0);
  return (
    <Section title="Song">
      <FieldRow label="File" hint="Scenes and Play Music events use this name. Double-click it in the list to rename.">
        <input value={`${songName}.uge`} readOnly />
      </FieldRow>
      <FieldRow label="Title">
        <input value={song.name} maxLength={255} onChange={(e) => edit((s) => void (s.name = e.target.value), "song-name")} />
      </FieldRow>
      <FieldRow label="Artist">
        <input value={song.artist} maxLength={255} onChange={(e) => edit((s) => void (s.artist = e.target.value), "song-artist")} />
      </FieldRow>
      <FieldRow label="Comment">
        <textarea rows={2} value={song.comment} maxLength={255} onChange={(e) => edit((s) => void (s.comment = e.target.value), "song-comment")} />
      </FieldRow>
      <FieldRow label="Speed (ticks per row)" hint={`≈ ${ticksPerRowToBpm(song.ticksPerRow).toFixed(0)} BPM with 4 rows per beat. Lower is faster; the game ticks ~60 times a second.`}>
        <NumberInput value={song.ticksPerRow} min={1} max={255} onChange={(v) => edit((s) => void (s.ticksPerRow = v), "song-speed")} />
      </FieldRow>
      <p className="music-insp-note">
        {song.sequence.length} positions · {Math.ceil(song.patterns.length / 4)} patterns · {notes} notes
      </p>
      <p className="music-insp-note">
        Pencil: click to add a note, drag to move it. Right-click deletes. Eraser: drag over notes. Select: drag a box.
        Click the FX lane to edit effects. Space plays, Ctrl+wheel zooms, arrows move the selection (Shift for octaves).
      </p>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Selected notes / rows
// ---------------------------------------------------------------------------

function CellsEditor() {
  const song = useMusicStore((s) => s.song)!;
  const channel = useMusicStore((s) => s.channel);
  const selection = useMusicStore((s) => s.selection);
  const edit = useMusicStore((s) => s.edit);
  const setSelection = useMusicStore((s) => s.setSelection);
  const instruments = channelInstruments(song, channel);
  const cells = selection.map((a) => cellAt(song, channel, a)).filter((c) => !!c);
  const single = selection.length === 1 ? cells[0] : null;
  const noteCount = cells.filter((c) => c!.note !== null).length;

  const each = (fn: (c: NonNullable<ReturnType<typeof cellAt>>) => void, key?: string) =>
    edit((s) => {
      for (const a of selection) {
        const c = cellAt(s, channel, a);
        if (c) fn(c);
      }
    }, key);

  const common = <T,>(get: (c: NonNullable<(typeof cells)[number]>) => T): T | "mixed" => {
    const vals = cells.map((c) => get(c!));
    return vals.every((v) => v === vals[0]) ? vals[0] : "mixed";
  };
  const instrument = common((c) => c.instrument);
  const effectCode = common((c) => c.effectCode);
  const effectParam = common((c) => c.effectParam);
  const effect = typeof effectCode === "number" ? EFFECTS[effectCode] : null;
  const param = typeof effectParam === "number" ? effectParam : 0;

  const where = single ? fromAbsRow(selection[0]) : null;

  return (
    <Section
      title={single ? `${CHANNELS[channel].name} · position ${where!.order + 1}, row ${where!.row}` : `${selection.length} rows selected (${noteCount} notes)`}
      actions={
        <button className="link-btn" onClick={() => setSelection([])}>
          done
        </button>
      }
    >
      {single && (
        <FieldRow label="Note">
          <select
            value={single.note ?? ""}
            onChange={(e) => {
              const note = e.target.value === "" ? null : Number(e.target.value);
              each((c) => {
                c.note = note;
                if (note !== null && c.instrument === null) c.instrument = useMusicStore.getState().instrument[CHANNELS[channel].type];
              });
              if (note !== null) player.previewNote(song, channel, single.instrument ?? 0, note);
            }}
          >
            <option value="">(none)</option>
            {Array.from({ length: NOTE_COUNT }, (_, n) => NOTE_COUNT - 1 - n).map((n) => (
              <option key={n} value={n}>
                {noteName(n)}
              </option>
            ))}
          </select>
        </FieldRow>
      )}
      {noteCount > 0 && (
        <>
          <FieldRow label="Instrument" hint="Blank keeps the previous note's instrument going (no retrigger).">
            <select
              value={instrument === "mixed" ? "mixed" : (instrument ?? "")}
              onChange={(e) => {
                if (e.target.value === "mixed") return;
                const v = e.target.value === "" ? null : Number(e.target.value);
                each((c) => {
                  if (c.note !== null) c.instrument = v;
                });
              }}
            >
              {instrument === "mixed" && <option value="mixed">(mixed)</option>}
              <option value="">(none - legato)</option>
              {instruments.map((ins, i) => (
                <option key={i} value={i}>
                  {String(i + 1).padStart(2, "0")} {ins.name}
                </option>
              ))}
            </select>
          </FieldRow>
          <GroupRow label="Transpose">
            <div className="music-btn-row">
              {[-12, -1, 1, 12].map((d) => (
                <button
                  key={d}
                  className="btn btn-small"
                  onClick={() =>
                    each((c) => {
                      if (c.note !== null) c.note = Math.max(0, Math.min(NOTE_COUNT - 1, c.note + d));
                    }, `transpose`)
                  }
                >
                  {d > 0 ? `+${d}` : d}
                </button>
              ))}
            </div>
          </GroupRow>
        </>
      )}
      <FieldRow label="Effect">
        <select
          value={effectCode === "mixed" ? "mixed" : (effectCode ?? "")}
          onChange={(e) => {
            if (e.target.value === "mixed") return;
            const code = e.target.value === "" ? null : Number(e.target.value);
            each((c) => {
              c.effectCode = code;
              c.effectParam = code === null ? null : (c.effectParam ?? 0);
            });
          }}
        >
          {effectCode === "mixed" && <option value="mixed">(mixed)</option>}
          <option value="">(none)</option>
          {EFFECTS.map((fx) => (
            <option key={fx.code} value={fx.code}>
              {fx.code.toString(16).toUpperCase()} · {fx.name}
            </option>
          ))}
        </select>
      </FieldRow>
      {effect && (
        <>
          {effect.params.kind === "byte" ? (
            <FieldRow label={effect.params.label} hint={effect.description}>
              <NumberInput value={param} min={0} max={255} onChange={(v) => each((c) => void (c.effectParam = v), "fx-param")} />
            </FieldRow>
          ) : (
            <>
              <div className="field-row-pair">
                <FieldRow label={effect.params.x}>
                  <NumberInput value={param >> 4} min={0} max={15} onChange={(v) => each((c) => void (c.effectParam = (v << 4) | ((c.effectParam ?? 0) & 0x0f)), "fx-x")} />
                </FieldRow>
                <FieldRow label={effect.params.y}>
                  <NumberInput value={param & 0x0f} min={0} max={15} onChange={(v) => each((c) => void (c.effectParam = ((c.effectParam ?? 0) & 0xf0) | v), "fx-y")} />
                </FieldRow>
              </div>
              <p className="music-insp-note">{effect.description}</p>
            </>
          )}
          <p className="music-insp-note">Shown as {effectLabel(effect.code, param)} in the FX lane.</p>
        </>
      )}
      <div className="music-btn-row">
        {noteCount > 0 && (
          <button
            className="btn btn-small"
            onClick={() =>
              each((c) => {
                c.note = null;
                c.instrument = null;
              })
            }
          >
            Delete notes
          </button>
        )}
        <button
          className="btn btn-small"
          onClick={() =>
            each((c) => {
              c.effectCode = null;
              c.effectParam = null;
            })
          }
        >
          Clear effects
        </button>
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

const DUTY_LABELS = ["12.5%", "25%", "50%", "75%"];
const DUTY_SHAPES = ["M0,10 H2 V2 H3 V10 H16", "M0,10 H2 V2 H4 V10 H16", "M0,10 H2 V2 H8 V10 H16", "M0,10 H2 V2 H14 V10 H16"];

function instrumentList(song: Song, type: InstrumentType) {
  return type === "duty" ? song.dutyInstruments : type === "wave" ? song.waveInstruments : song.noiseInstruments;
}

function InstrumentEditor({ type, index }: { type: InstrumentType; index: number }) {
  const song = useMusicStore((s) => s.song)!;
  const edit = useMusicStore((s) => s.edit);
  const ins = instrumentList(song, type)[index];
  const [testNote, setTestNote] = useState(type === "noise" ? 30 : 24);
  if (!ins) return <Section title="Instrument">This song has no {type} instrument {index + 1}.</Section>;

  const up = <T extends object>(fn: (i: T) => void, key?: string) =>
    edit((s) => {
      fn(instrumentList(s, type)[index] as unknown as T);
    }, key ? `ins-${type}-${index}-${key}` : undefined);
  const channel = type === "duty" ? 0 : type === "wave" ? 2 : 3;
  const test = () => player.previewNote(song, channel, index, testNote, 1.0);
  const maxLength = type === "wave" ? 256 : 64;

  return (
    <Section
      title={`${type === "duty" ? "Duty" : type === "wave" ? "Wave" : "Noise"} instrument ${index + 1}`}
      actions={
        <span className="music-test">
          <select value={testNote} onChange={(e) => setTestNote(Number(e.target.value))} title="Test note">
            {Array.from({ length: NOTE_COUNT }, (_, n) => (
              <option key={n} value={n}>
                {noteName(n)}
              </option>
            ))}
          </select>
          <button className="btn btn-small btn-primary" onClick={test}>
            ▶ Test
          </button>
        </span>
      }
    >
      <FieldRow label="Name">
        <input value={ins.name} maxLength={255} onChange={(e) => up<{ name: string }>((i) => void (i.name = e.target.value), "name")} />
      </FieldRow>
      <GroupRow
        label="Length"
        hint={ins.length === null ? "Notes hold until the next note or a cut." : `Notes stop after ${Math.round((ins.length / 256) * 1000)} ms.`}
      >
        <div className="music-inline">
          <label className="music-check">
            <input
              type="checkbox"
              checked={ins.length !== null}
              onChange={(e) => up<{ length: number | null }>((i) => void (i.length = e.target.checked ? Math.min(maxLength, 32) : null))}
            />
            Limit
          </label>
          {ins.length !== null && (
            <NumberInput value={ins.length} min={1} max={maxLength} onChange={(v) => up<{ length: number | null }>((i) => void (i.length = v), "length")} />
          )}
        </div>
      </GroupRow>

      {type === "duty" && <DutyFields ins={ins as DutyInstrument} up={up} />}
      {type === "wave" && <WaveFields ins={ins as WaveInstrument} up={up} />}
      {type === "noise" && <NoiseFields ins={ins as NoiseInstrument} up={up} />}

      <SubpatternEditor type={type} index={index} />
    </Section>
  );
}

type Up = <T extends object>(fn: (i: T) => void, key?: string) => void;

function Slider({ value, min, max, onChange, format }: { value: number; min: number; max: number; onChange: (v: number) => void; format?: (v: number) => string }) {
  return (
    <div className="music-slider">
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="music-slider-value">{format ? format(value) : value}</span>
    </div>
  );
}

function EnvelopePreview({ volume, change, length }: { volume: number; change: number; length: number | null }) {
  // One second, in 1/64 s envelope steps.
  const pts: string[] = [];
  let v = volume;
  const period = change === 0 ? 0 : 8 - Math.abs(change);
  const end = length !== null ? Math.min(64, Math.ceil((length / 256) * 64)) : 64;
  for (let t = 0; t <= 64; t++) {
    const y = t <= end ? v : 0;
    pts.push(`${t},${15 - y}`);
    if (period && t % period === period - 1) v = Math.max(0, Math.min(15, v + (change > 0 ? 1 : -1)));
  }
  return (
    <svg className="music-envelope" viewBox="-1 -1.5 66 18" preserveAspectRatio="none">
      <polyline points={pts.join(" ")} fill="none" stroke="var(--accent)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function VolumeFields({ ins, up }: { ins: DutyInstrument | NoiseInstrument; up: Up }) {
  return (
    <>
      <FieldRow label="Initial volume">
        <Slider value={ins.initialVolume} min={0} max={15} onChange={(v) => up<{ initialVolume: number }>((i) => void (i.initialVolume = v), "vol")} />
      </FieldRow>
      <FieldRow label="Volume sweep" hint="Negative fades out, positive fades in; bigger is faster.">
        <Slider value={ins.volumeSweepChange} min={-7} max={7} onChange={(v) => up<{ volumeSweepChange: number }>((i) => void (i.volumeSweepChange = v), "sweep")} />
      </FieldRow>
      <EnvelopePreview volume={ins.initialVolume} change={ins.volumeSweepChange} length={ins.length} />
    </>
  );
}

function DutyFields({ ins, up }: { ins: DutyInstrument; up: Up }) {
  return (
    <>
      <GroupRow label="Duty cycle">
        <div className="music-duty">
          {DUTY_LABELS.map((label, d) => (
            <button key={d} className={`music-duty-btn${ins.dutyCycle === d ? " music-duty-btn-on" : ""}`} onClick={() => up<DutyInstrument>((i) => void (i.dutyCycle = d))}>
              <svg viewBox="0 0 16 12">
                <path d={DUTY_SHAPES[d]} fill="none" stroke="currentColor" strokeWidth="1.2" />
              </svg>
              {label}
            </button>
          ))}
        </div>
      </GroupRow>
      <VolumeFields ins={ins} up={up} />
      <div className="field-row-pair">
        <FieldRow label="Pitch sweep time">
          <Slider value={ins.frequencySweepTime} min={0} max={7} onChange={(v) => up<DutyInstrument>((i) => void (i.frequencySweepTime = v), "fst")} />
        </FieldRow>
        <FieldRow label="Pitch sweep shift">
          <Slider value={ins.frequencySweepShift} min={-7} max={7} onChange={(v) => up<DutyInstrument>((i) => void (i.frequencySweepShift = v), "fss")} />
        </FieldRow>
      </div>
      <p className="music-insp-note">Pitch sweep only works on channel 1 (Duty 1).</p>
    </>
  );
}

const WAVE_VOLUMES = ["Mute", "100%", "50%", "25%"];

function WaveFields({ ins, up }: { ins: WaveInstrument; up: Up }) {
  const song = useMusicStore((s) => s.song)!;
  const setInspect = useMusicStore((s) => s.setInspect);
  return (
    <>
      <GroupRow label="Volume">
        <div className="music-btn-row">
          {WAVE_VOLUMES.map((label, v) => (
            <button key={v} className={`btn btn-small${ins.volume === v ? " btn-primary" : ""}`} onClick={() => up<WaveInstrument>((i) => void (i.volume = v))}>
              {label}
            </button>
          ))}
        </div>
      </GroupRow>
      <GroupRow label="Wave">
        <div className="music-wave-pick">
          {Array.from({ length: WAVE_COUNT }, (_, w) => (
            <button
              key={w}
              className={`music-wave-pick-btn${ins.waveIndex === w ? " music-wave-pick-btn-on" : ""}`}
              onClick={() => up<WaveInstrument>((i) => void (i.waveIndex = w))}
              onDoubleClick={() => setInspect({ kind: "wave", index: w })}
              title={`Wave ${w} (double-click to edit)`}
            >
              <WaveThumb samples={song.waves[w]} />
            </button>
          ))}
        </div>
      </GroupRow>
    </>
  );
}

function NoiseFields({ ins, up }: { ins: NoiseInstrument; up: Up }) {
  return (
    <>
      <VolumeFields ins={ins} up={up} />
      <GroupRow label="Noise mode" hint="7-bit sounds buzzier and more tonal.">
        <div className="music-btn-row">
          {([15, 7] as const).map((b) => (
            <button key={b} className={`btn btn-small${ins.bitCount === b ? " btn-primary" : ""}`} onClick={() => up<NoiseInstrument>((i) => void (i.bitCount = b))}>
              {b}-bit
            </button>
          ))}
        </div>
      </GroupRow>
    </>
  );
}

/**
 * An instrument's subpattern: a little per-tick script (note offset,
 * jump, effect) that runs while its notes play - for arpeggios, drum
 * pitch drops and the like. Only the first 32 rows are used.
 */
function SubpatternEditor({ type, index }: { type: InstrumentType; index: number }) {
  const song = useMusicStore((s) => s.song)!;
  const edit = useMusicStore((s) => s.edit);
  const ins = instrumentList(song, type)[index];
  const [open, setOpen] = useState(ins.subpatternEnabled);
  const rows = ins.subpattern.length ? ins.subpattern : createSubPattern();
  const lastUsed = Math.max(7, ...rows.slice(0, 32).map((c, i) => (c.note !== null || c.jump || c.effectCode !== null ? i : 0)));
  const [shown, setShown] = useState(Math.min(32, lastUsed + 2));

  const setCell = (row: number, patch: Partial<(typeof rows)[number]>) =>
    edit((s) => {
      const target = instrumentList(s, type)[index];
      if (!target.subpattern.length) target.subpattern = createSubPattern();
      while (target.subpattern.length < SUBPATTERN_LENGTH) target.subpattern.push({ note: null, jump: null, effectCode: null, effectParam: null });
      Object.assign(target.subpattern[row], patch);
    }, `sub-${type}-${index}-${row}-${Object.keys(patch).join()}`);

  return (
    <div className="music-subpattern">
      <div className="music-insp-subtitle">
        <label className="music-check">
          <input
            type="checkbox"
            checked={ins.subpatternEnabled}
            onChange={(e) => {
              const on = e.target.checked;
              edit((s) => {
                const t = instrumentList(s, type)[index];
                t.subpatternEnabled = on;
                if (!t.subpattern.length) t.subpattern = createSubPattern();
              });
              if (on) setOpen(true);
            }}
          />
          Subpattern
        </label>
        <button className="link-btn" onClick={() => setOpen(!open)}>
          {open ? "hide" : "show"}
        </button>
      </div>
      {open && (
        <>
          <p className="music-insp-note">Runs one row per tick while the note plays. Offset 0 = the note itself. Jump sends it to another row (use it to loop).</p>
          <table className="music-sub-table">
            <thead>
              <tr>
                <th>tick</th>
                <th>offset</th>
                <th>jump</th>
                <th>effect</th>
                <th>param</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, shown).map((c, r) => (
                <tr key={r}>
                  <td className="music-sub-row">{r}</td>
                  <td>
                    <select value={c.note ?? ""} onChange={(e) => setCell(r, { note: e.target.value === "" ? null : Number(e.target.value) })}>
                      <option value="">—</option>
                      {Array.from({ length: 72 }, (_, i) => (
                        <option key={i} value={i}>
                          {i - 36 > 0 ? `+${i - 36}` : i - 36}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select value={c.jump ?? 0} onChange={(e) => setCell(r, { jump: Number(e.target.value) || null })}>
                      <option value={0}>—</option>
                      {Array.from({ length: 32 }, (_, i) => (
                        <option key={i} value={i + 1}>
                          →{i}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <select
                      value={c.effectCode ?? ""}
                      onChange={(e) => {
                        const code = e.target.value === "" ? null : Number(e.target.value);
                        setCell(r, { effectCode: code, effectParam: code === null ? null : (c.effectParam ?? 0) });
                      }}
                    >
                      <option value="">—</option>
                      {EFFECTS.map((fx) => (
                        <option key={fx.code} value={fx.code} title={fx.name}>
                          {fx.code.toString(16).toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    {c.effectCode !== null && (
                      <NumberInput value={c.effectParam ?? 0} min={0} max={255} onChange={(v) => setCell(r, { effectParam: v })} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown < 32 && (
            <button className="link-btn" onClick={() => setShown(32)}>
              show all 32 rows
            </button>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Waves
// ---------------------------------------------------------------------------

const WAVE_PRESETS: { name: string; fn: (i: number) => number }[] = [
  { name: "Sine", fn: (i) => Math.round(7.5 + 7.5 * Math.sin((i / 32) * Math.PI * 2)) },
  { name: "Triangle", fn: (i) => (i < 16 ? i : 31 - i) },
  { name: "Saw", fn: (i) => Math.floor(i / 2) },
  { name: "Square", fn: (i) => (i < 16 ? 15 : 0) },
  { name: "Pulse 25%", fn: (i) => (i < 8 ? 15 : 0) },
];

function WaveEditor({ index }: { index: number }) {
  const song = useMusicStore((s) => s.song)!;
  const edit = useMusicStore((s) => s.edit);
  const wave = song.waves[index] ?? new Uint8Array(32);
  const svgRef = useRef<SVGSVGElement>(null);
  const drawing = useRef(false);
  const users = song.waveInstruments.filter((w) => w.waveIndex === index).map((w) => w.name || `Wave ${w.index + 1}`);

  const setAt = (e: React.PointerEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    const i = Math.max(0, Math.min(31, Math.floor(((e.clientX - r.left) / r.width) * 32)));
    const v = Math.max(0, Math.min(15, 15 - Math.floor(((e.clientY - r.top) / r.height) * 16)));
    if (wave[i] === v) return;
    edit((s) => {
      const w = s.waves[index] ?? new Uint8Array(32);
      w[i] = v;
      s.waves[index] = w;
    }, `wave-${index}`);
  };

  const preview = () => {
    const base = song.waveInstruments[0];
    const s: Song = { ...song, waveInstruments: [{ ...base, index: 0, volume: 1, waveIndex: index, length: null, subpatternEnabled: false }] };
    player.previewNote(s, 2, 0, 24, 1.0);
  };

  return (
    <Section
      title={`Wave ${index}`}
      actions={
        <button className="btn btn-small btn-primary" onClick={preview}>
          ▶ Test
        </button>
      }
    >
      <p className="music-insp-note">32 samples of 16 levels, played by the wave channel. Draw on it.</p>
      <svg
        ref={svgRef}
        className="music-wave-editor"
        viewBox="0 0 32 16"
        preserveAspectRatio="none"
        onPointerDown={(e) => {
          drawing.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          setAt(e);
        }}
        onPointerMove={(e) => drawing.current && setAt(e)}
        onPointerUp={() => (drawing.current = false)}
      >
        {Array.from({ length: 32 }, (_, i) => (
          <rect key={i} x={i + 0.08} y={15 - wave[i]} width={0.84} height={wave[i] + 1} fill="var(--accent)" opacity={0.85} />
        ))}
      </svg>
      <div className="music-btn-row">
        {WAVE_PRESETS.map((p) => (
          <button
            key={p.name}
            className="btn btn-small"
            onClick={() =>
              edit((s) => {
                s.waves[index] = Uint8Array.from({ length: 32 }, (_, i) => p.fn(i));
              })
            }
          >
            {p.name}
          </button>
        ))}
      </div>
      <p className="music-insp-note">{users.length ? `Used by: ${users.join(", ")}` : "No wave instrument uses this wave yet."}</p>
    </Section>
  );
}
