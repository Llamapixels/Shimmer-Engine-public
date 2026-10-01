import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { effectLabel } from "../../music/effects";
import { cellAt, fromAbsRow, toAbsRow, useMusicStore } from "../../music/musicStore";
import { player } from "../../music/player";
import { CHANNELS, NOTE_COUNT, PATTERN_LENGTH, cloneSong, isBlackKey, noteName, type PatternCell, type Song } from "../../music/song";

const KEY_W = 54;
const HEADER_H = 34;
const FX_H = 22;
const BASE_CELL_W = 14;
const BASE_CELL_H = 12;

/** One colour per instrument slot (15), for notes. */
export const INSTRUMENT_COLORS = Array.from({ length: 15 }, (_, i) => `hsl(${(i * 360) / 15 + 262}, 70%, 62%)`);
const CHANNEL_GHOST = ["rgba(255,160,90,0.35)", "rgba(90,200,255,0.35)", "rgba(120,230,140,0.35)", "rgba(240,220,90,0.35)"];

type Drag =
  | { kind: "move"; base: Song; rows: number[]; startAbs: number; startNote: number; dRows: number; dNotes: number; anchorNote: number }
  | { kind: "box"; x0: number; y0: number; x1: number; y1: number; additive: number[] }
  | { kind: "erase"; key: string }
  | { kind: "fx"; startAbs: number; endAbs: number };

interface Hit {
  zone: "grid" | "keys" | "header" | "fx" | "none";
  abs: number;
  note: number;
}

let eraseSeq = 0;

export default function PianoRoll() {
  const song = useMusicStore((s) => s.song);
  const channel = useMusicStore((s) => s.channel);
  const selection = useMusicStore((s) => s.selection);
  const zoom = useMusicStore((s) => s.zoom);
  const showOther = useMusicStore((s) => s.showOtherChannels);
  const tool = useMusicStore((s) => s.tool);
  const cursorRow = useMusicStore((s) => s.cursorRow);
  const scrollRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<Hit | null>(null);
  const [, setFrame] = useState(0);
  const playheadRef = useRef<number | null>(null);

  const cw = Math.round(BASE_CELL_W * zoom);
  const ch = Math.round(BASE_CELL_H * zoom);
  const totalRows = (song?.sequence.length ?? 0) * PATTERN_LENGTH;

  // Track the viewport size.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Start scrolled so middle C-ish is in view.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = (NOTE_COUNT - 40) * ch - 40;
    // Only on mount / zoom change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ch]);

  const hitTest = useCallback(
    (clientX: number, clientY: number): Hit => {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      const vx = clientX - r.left;
      const vy = clientY - r.top;
      const abs = Math.floor((vx + el.scrollLeft - KEY_W) / cw);
      const note = NOTE_COUNT - 1 - Math.floor((vy + el.scrollTop - HEADER_H) / ch);
      if (vx < 0 || vy < 0 || vx > el.clientWidth || vy > el.clientHeight) return { zone: "none", abs, note };
      if (vy < HEADER_H) return { zone: "header", abs, note };
      if (vy > el.clientHeight - FX_H) return { zone: "fx", abs, note };
      if (vx < KEY_W) return { zone: "keys", abs, note };
      return { zone: "grid", abs, note };
    },
    [cw, ch],
  );

  // ---- drawing ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const el = scrollRef.current;
    if (!canvas || !el || !song) return;
    const dpr = window.devicePixelRatio || 1;
    const W = size.w;
    const H = size.h;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
    }
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const sx = el.scrollLeft;
    const sy = el.scrollTop;
    const gridX = (abs: number) => KEY_W + abs * cw - sx;
    const gridY = (note: number) => HEADER_H + (NOTE_COUNT - 1 - note) * ch - sy;
    const firstAbs = Math.max(0, Math.floor(sx / cw));
    const lastAbs = Math.min(totalRows - 1, Math.ceil((sx + W - KEY_W) / cw));

    g.fillStyle = "#121318";
    g.fillRect(0, 0, W, H);

    // Note lanes.
    g.save();
    g.beginPath();
    g.rect(KEY_W, HEADER_H, W - KEY_W, H - HEADER_H - FX_H);
    g.clip();
    for (let n = 0; n < NOTE_COUNT; n++) {
      const y = gridY(n);
      if (y > H || y + ch < HEADER_H) continue;
      g.fillStyle = isBlackKey(n) ? "#15161c" : "#1b1c23";
      g.fillRect(KEY_W, y, W, ch);
      if (n % 12 === 0) {
        g.fillStyle = "rgba(255,255,255,0.10)";
        g.fillRect(KEY_W, y + ch - 1, W, 1);
      }
    }
    // Past the end of the song.
    const endX = gridX(totalRows);
    if (endX < W) {
      g.fillStyle = "rgba(0,0,0,0.45)";
      g.fillRect(endX, HEADER_H, W - endX, H);
    }
    // Row lines.
    for (let a = firstAbs; a <= lastAbs + 1; a++) {
      const x = gridX(a);
      const row = a % PATTERN_LENGTH;
      g.fillStyle = row === 0 ? "rgba(121,31,255,0.55)" : row % 16 === 0 ? "rgba(255,255,255,0.16)" : row % 4 === 0 ? "rgba(255,255,255,0.08)" : "rgba(255,255,255,0.03)";
      g.fillRect(x, HEADER_H, 1, H);
    }

    // Other channels, ghosted.
    if (showOther) {
      for (let c = 0; c < 4; c++) {
        if (c === channel) continue;
        g.fillStyle = CHANNEL_GHOST[c];
        for (let a = firstAbs; a <= lastAbs; a++) {
          const cell = cellAt(song, c, a);
          if (cell?.note == null) continue;
          g.fillRect(gridX(a) + 1, gridY(cell.note) + 2, cw - 2, ch - 4);
        }
      }
    }

    // Selected channel: sustains, then notes on top.
    const sel = new Set(selection);
    const drag = dragRef.current;
    const moving = drag?.kind === "move" ? drag : null;
    // Start one note back so a sustain entering the view is drawn.
    let startAbs = firstAbs;
    while (startAbs > 0 && cellAt(song, channel, startAbs)?.note == null) startAbs--;
    let held: { note: number; from: number; instrument: number | null } | null = null;
    const flush = (until: number) => {
      if (!held) return;
      const x0 = gridX(held.from) + cw;
      const x1 = gridX(until);
      if (x1 > x0) {
        g.fillStyle = held.instrument !== null ? INSTRUMENT_COLORS[held.instrument % 15] : "#888";
        g.globalAlpha = 0.35;
        g.fillRect(x0, gridY(held.note) + ch / 2 - 2, x1 - x0, 4);
        g.globalAlpha = 1;
      }
      held = null;
    };
    for (let a = startAbs; a <= lastAbs + 1 && a < totalRows; a++) {
      const cell = cellAt(song, channel, a);
      if (!cell) continue;
      if (cell.note !== null) {
        flush(a);
        // A note cut on the note's own row silences it straight away.
        held = cell.effectCode === 0xe ? null : { note: cell.note, from: a, instrument: cell.instrument };
      } else if (cell.effectCode === 0xe && held) {
        flush(a + 1);
      }
    }
    flush(Math.min(totalRows, lastAbs + 2));
    for (let a = firstAbs; a <= lastAbs; a++) {
      const cell = cellAt(song, channel, a);
      if (cell?.note == null) continue;
      const x = gridX(a);
      const y = gridY(cell.note);
      g.fillStyle = cell.instrument !== null ? INSTRUMENT_COLORS[cell.instrument % 15] : "#9a9ca8";
      g.globalAlpha = moving && sel.has(a) ? 0.3 : 1;
      g.fillRect(x + 1, y + 1, cw - 1, ch - 1);
      g.globalAlpha = 1;
      if (sel.has(a)) {
        g.strokeStyle = "#fff";
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, cw - 2, ch - 2);
      }
      if (cell.effectCode !== null) {
        g.fillStyle = "rgba(0,0,0,0.6)";
        g.fillRect(x + cw - 4, y + 1, 3, 3);
      }
    }
    // Notes being dragged.
    if (moving) {
      for (const a of moving.rows) {
        const cell = cellAt(moving.base, channel, a);
        if (cell?.note == null) continue;
        const na = a + moving.dRows;
        const nn = Math.max(0, Math.min(NOTE_COUNT - 1, cell.note + moving.dNotes));
        g.fillStyle = cell.instrument !== null ? INSTRUMENT_COLORS[cell.instrument % 15] : "#9a9ca8";
        g.fillRect(gridX(na) + 1, gridY(nn) + 1, cw - 1, ch - 1);
        g.strokeStyle = "#fff";
        g.lineWidth = 2;
        g.strokeRect(gridX(na) + 1, gridY(nn) + 1, cw - 2, ch - 2);
      }
    }
    // Selected empty rows (effect-only selection) and the cursor row.
    g.fillStyle = "rgba(121,31,255,0.12)";
    for (const a of selection) {
      if (a < firstAbs || a > lastAbs) continue;
      if (cellAt(song, channel, a)?.note == null) g.fillRect(gridX(a), HEADER_H, cw, H);
    }
    // Hover cell (pencil).
    if (hover?.zone === "grid" && tool === "pencil" && !drag && hover.abs < totalRows && hover.note >= 0 && hover.note < NOTE_COUNT) {
      g.strokeStyle = "rgba(255,255,255,0.45)";
      g.lineWidth = 1;
      g.strokeRect(gridX(hover.abs) + 0.5, gridY(hover.note) + 0.5, cw - 1, ch - 1);
    }
    // Box selection.
    if (drag?.kind === "box") {
      const x = Math.min(drag.x0, drag.x1) - sx;
      const y = Math.min(drag.y0, drag.y1) - sy;
      g.fillStyle = "rgba(121,31,255,0.18)";
      g.strokeStyle = "rgba(121,31,255,0.9)";
      g.lineWidth = 1;
      g.fillRect(x, y, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
      g.strokeRect(x + 0.5, y + 0.5, Math.abs(drag.x1 - drag.x0), Math.abs(drag.y1 - drag.y0));
    }
    g.restore();

    // Playhead / start cursor.
    const ph = playheadRef.current;
    const markX = gridX(ph ?? cursorRow);
    if (markX >= KEY_W && markX <= W) {
      g.fillStyle = ph !== null ? "#3dd68c" : "rgba(242,184,75,0.8)";
      g.fillRect(markX, HEADER_H - 6, ph !== null ? 2 : 1, H - HEADER_H + 6);
    }

    // Effects lane.
    const fy = H - FX_H;
    g.fillStyle = "#17181e";
    g.fillRect(KEY_W, fy, W - KEY_W, FX_H);
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(KEY_W, fy, W - KEY_W, 1);
    g.font = `${Math.max(8, Math.min(10, cw - 4))}px ${getComputedStyle(document.body).getPropertyValue("--font-mono") || "monospace"}`;
    g.textBaseline = "middle";
    g.textAlign = "center";
    for (let a = firstAbs; a <= lastAbs; a++) {
      const cell = cellAt(song, channel, a);
      const x = gridX(a);
      if (sel.has(a)) {
        g.fillStyle = "rgba(121,31,255,0.35)";
        g.fillRect(x, fy + 1, cw, FX_H - 1);
      }
      if (cell?.effectCode == null) continue;
      g.fillStyle = "#f2b84b";
      g.fillText(cell.effectCode.toString(16).toUpperCase(), x + cw / 2, fy + FX_H / 2);
    }

    // Header: sequence positions and row numbers.
    g.fillStyle = "#262626";
    g.fillRect(0, 0, W, HEADER_H);
    g.textAlign = "left";
    g.font = `11px ${getComputedStyle(document.body).fontFamily}`;
    const firstOrder = Math.floor(firstAbs / PATTERN_LENGTH);
    const lastOrder = Math.floor(lastAbs / PATTERN_LENGTH);
    for (let o = firstOrder; o <= lastOrder && o < song.sequence.length; o++) {
      const x = gridX(o * PATTERN_LENGTH);
      g.fillStyle = "rgba(121,31,255,0.55)";
      g.fillRect(x, 0, 1, HEADER_H);
      const item = song.sequence[o];
      const label = item.splitPattern
        ? `${o + 1}  ·  ${CHANNELS[channel].short} pattern ${item.channels[channel]} (split)`
        : `${o + 1}  ·  pattern ${String(Math.floor(item.channels[0] / 4)).padStart(2, "0")}`;
      g.fillStyle = "#e7e8ec";
      g.fillText(label, Math.max(x + 6, KEY_W + 6), 10);
    }
    g.fillStyle = "#6b6d78";
    g.font = `10px ${getComputedStyle(document.body).fontFamily}`;
    const step = cw < 10 ? 16 : 8;
    for (let a = firstAbs - (firstAbs % step); a <= lastAbs; a += step) {
      if (a < 0) continue;
      g.fillText(String(a % PATTERN_LENGTH), gridX(a) + 2, 25);
    }
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(0, HEADER_H - 1, W, 1);

    // Keyboard.
    g.save();
    g.beginPath();
    g.rect(0, HEADER_H, KEY_W, H - HEADER_H - FX_H);
    g.clip();
    for (let n = 0; n < NOTE_COUNT; n++) {
      const y = gridY(n);
      if (y > H || y + ch < HEADER_H) continue;
      const black = isBlackKey(n);
      g.fillStyle = hover?.zone === "keys" && hover.note === n ? "#ffd23f" : black ? "#26272e" : "#d9dae0";
      g.fillRect(0, y, black ? KEY_W - 14 : KEY_W, ch - 1);
      if (n % 12 === 0 || ch >= 14) {
        g.fillStyle = black ? "#9a9ca8" : "#3b3d48";
        g.font = `${Math.min(10, ch - 2)}px ${getComputedStyle(document.body).fontFamily}`;
        g.textBaseline = "middle";
        g.fillText(noteName(n), 4, y + ch / 2);
      }
    }
    g.restore();
    g.fillStyle = "#262626";
    g.fillRect(0, 0, KEY_W, HEADER_H);
    g.fillRect(0, H - FX_H, KEY_W, FX_H);
    g.fillStyle = "#9a9ca8";
    g.font = `10px ${getComputedStyle(document.body).fontFamily}`;
    g.textBaseline = "middle";
    g.fillText("FX", 6, H - FX_H / 2);
    g.fillText(CHANNELS[channel].name, 6, 17);
  }, [song, size, cw, ch, totalRows, channel, selection, showOther, hover, tool, cursorRow]);

  // Playhead animation while playing.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const pos = player.position;
      const abs = pos ? toAbsRow(pos.order, pos.row) : null;
      if (abs !== playheadRef.current) {
        playheadRef.current = abs;
        const el = scrollRef.current;
        if (el && abs !== null) {
          const x = KEY_W + abs * cw;
          if (x < el.scrollLeft + KEY_W || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - KEY_W - 40;
        }
        setFrame((f) => f + 1);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [cw]);

  useEffect(() => {
    draw();
  });

  // Bring the start cursor into view when it's moved from elsewhere
  // (the sequence bar).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const x = KEY_W + cursorRow * cw;
    if (x < el.scrollLeft + KEY_W || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - KEY_W - 8;
  }, [cursorRow, cw]);

  // ---- editing helpers ----
  const edit = useMusicStore((s) => s.edit);
  const setSelection = useMusicStore((s) => s.setSelection);

  const previewCell = (s: Song, cell: PatternCell) => {
    if (cell.note === null) return;
    player.previewNote(s, channel, cell.instrument ?? useMusicStore.getState().instrument[CHANNELS[channel].type], cell.note);
  };

  const applyMove = (d: Extract<Drag, { kind: "move" }>) => {
    edit((s) => {
      s.patterns = cloneSong(d.base).patterns;
      const moved: { abs: number; cell: PatternCell }[] = [];
      for (const a of d.rows) {
        const src = cellAt(s, channel, a);
        if (!src) continue;
        moved.push({ abs: a, cell: { ...src } });
        src.note = null;
        src.instrument = null;
        src.effectCode = null;
        src.effectParam = null;
      }
      for (const m of moved) {
        const dst = cellAt(s, channel, m.abs + d.dRows);
        if (!dst) continue;
        Object.assign(dst, m.cell);
        if (dst.note !== null) dst.note = Math.max(0, Math.min(NOTE_COUNT - 1, dst.note + d.dNotes));
      }
    }, "pianoroll-move");
    setSelection(
      d.rows.map((a) => a + d.dRows).filter((a) => a >= 0 && a < totalRows),
      d.startAbs + d.dRows,
    );
  };

  const onMouseDown = (e: React.MouseEvent) => {
    if (!song || e.button > 2) return;
    const hit = hitTest(e.clientX, e.clientY);
    const store = useMusicStore.getState();
    const inSong = hit.abs >= 0 && hit.abs < totalRows;
    if (hit.zone === "keys") {
      if (hit.note >= 0 && hit.note < NOTE_COUNT) {
        player.previewNote(song, channel, store.instrument[CHANNELS[channel].type], hit.note);
      }
      return;
    }
    if (hit.zone === "header") {
      if (inSong) store.setSelection([], hit.abs);
      return;
    }
    if (hit.zone === "fx") {
      if (!inSong) return;
      dragRef.current = { kind: "fx", startAbs: hit.abs, endAbs: hit.abs };
      store.setSelection(e.shiftKey ? [...store.selection, hit.abs] : [hit.abs], hit.abs);
      return;
    }
    if (hit.zone !== "grid") return;
    e.preventDefault();
    scrollRef.current?.focus();
    const cell = inSong ? cellAt(song, channel, hit.abs) : undefined;
    const onNote = !!cell && cell.note === hit.note;

    // Right click: delete the note under the cursor (any tool).
    if (e.button === 2) {
      if (onNote) {
        edit((s) => {
          const c = cellAt(s, channel, hit.abs)!;
          c.note = null;
          c.instrument = null;
        });
        store.setSelection(store.selection.filter((a) => a !== hit.abs));
      }
      return;
    }

    if (store.tool === "eraser") {
      dragRef.current = { kind: "erase", key: `erase${eraseSeq++}` };
      if (onNote) {
        edit((s) => {
          const c = cellAt(s, channel, hit.abs)!;
          c.note = null;
          c.instrument = null;
        }, (dragRef.current as { key: string }).key);
      }
      return;
    }

    const el = scrollRef.current!;
    const r = el.getBoundingClientRect();
    const px = e.clientX - r.left + el.scrollLeft;
    const py = e.clientY - r.top + el.scrollTop;

    if (store.tool === "select" && !onNote) {
      dragRef.current = { kind: "box", x0: px, y0: py, x1: px, y1: py, additive: e.shiftKey ? store.selection : [] };
      if (!e.shiftKey) store.setSelection([], inSong ? hit.abs : undefined);
      return;
    }

    if (!inSong || hit.note < 0 || hit.note >= NOTE_COUNT) return;

    let rows: number[];
    let base = song;
    if (onNote) {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        rows = store.selection.includes(hit.abs) ? store.selection.filter((a) => a !== hit.abs) : [...store.selection, hit.abs];
        store.setSelection(rows, hit.abs);
        return;
      }
      rows = store.selection.includes(hit.abs) ? store.selection : [hit.abs];
      store.setSelection(rows, hit.abs);
      previewCell(song, cell!);
    } else {
      // Pencil on an empty spot: add a note there (replacing whatever
      // note the channel had on that row).
      const instrument = store.instrument[CHANNELS[channel].type];
      const next = cloneSong(song);
      const c = cellAt(next, channel, hit.abs)!;
      c.note = hit.note;
      c.instrument = instrument;
      edit((s) => {
        const t = cellAt(s, channel, hit.abs)!;
        t.note = hit.note;
        t.instrument = instrument;
      });
      base = next;
      rows = [hit.abs];
      store.setSelection(rows, hit.abs);
      previewCell(next, c);
    }
    dragRef.current = { kind: "move", base, rows, startAbs: hit.abs, startNote: hit.note, dRows: 0, dNotes: 0, anchorNote: hit.note };
  };

  const onMouseMove = (e: React.MouseEvent | MouseEvent) => {
    if (!song) return;
    const hit = hitTest(e.clientX, e.clientY);
    const d = dragRef.current;
    if (!d) {
      if (hit.zone !== hover?.zone || hit.abs !== hover.abs || hit.note !== hover.note) setHover(hit);
      return;
    }
    if (d.kind === "move") {
      const minRow = Math.min(...d.rows);
      const maxRow = Math.max(...d.rows);
      const dRows = Math.max(-minRow, Math.min(totalRows - 1 - maxRow, hit.abs - d.startAbs));
      const dNotes = hit.note - d.startNote;
      if (dRows !== d.dRows || dNotes !== d.dNotes) {
        d.dRows = dRows;
        d.dNotes = dNotes;
        const anchor = cellAt(d.base, channel, d.startAbs);
        if (anchor?.note != null && dNotes !== 0) {
          const n = Math.max(0, Math.min(NOTE_COUNT - 1, anchor.note + dNotes));
          if (n !== d.anchorNote) {
            d.anchorNote = n;
            previewCell(d.base, { ...anchor, note: n });
          }
        }
        draw();
      }
    } else if (d.kind === "box") {
      const el = scrollRef.current!;
      const r = el.getBoundingClientRect();
      d.x1 = e.clientX - r.left + el.scrollLeft;
      d.y1 = e.clientY - r.top + el.scrollTop;
      const a0 = Math.floor((Math.min(d.x0, d.x1) - KEY_W) / cw);
      const a1 = Math.floor((Math.max(d.x0, d.x1) - KEY_W) / cw);
      const n0 = NOTE_COUNT - 1 - Math.floor((Math.max(d.y0, d.y1) - HEADER_H) / ch);
      const n1 = NOTE_COUNT - 1 - Math.floor((Math.min(d.y0, d.y1) - HEADER_H) / ch);
      const rows: number[] = [...d.additive];
      for (let a = Math.max(0, a0); a <= Math.min(totalRows - 1, a1); a++) {
        const n = cellAt(song, channel, a)?.note;
        if (n != null && n >= n0 && n <= n1) rows.push(a);
      }
      useMusicStore.getState().setSelection(rows);
      draw();
    } else if (d.kind === "erase") {
      if (hit.zone !== "grid" || hit.abs < 0 || hit.abs >= totalRows) return;
      const cell = cellAt(song, channel, hit.abs);
      if (cell && cell.note === hit.note) {
        edit((s) => {
          const c = cellAt(s, channel, hit.abs)!;
          c.note = null;
          c.instrument = null;
        }, d.key);
      }
    } else if (d.kind === "fx") {
      if (hit.abs !== d.endAbs && hit.abs >= 0 && hit.abs < totalRows) {
        d.endAbs = hit.abs;
        const rows: number[] = [];
        for (let a = Math.min(d.startAbs, d.endAbs); a <= Math.max(d.startAbs, d.endAbs); a++) rows.push(a);
        useMusicStore.getState().setSelection(rows, d.startAbs);
      }
    }
  };

  const onMouseUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (d?.kind === "move" && (d.dRows !== 0 || d.dNotes !== 0)) applyMove(d);
    draw();
  };

  // Drags keep working outside the canvas.
  useEffect(() => {
    const move = (e: MouseEvent) => dragRef.current && onMouseMove(e);
    const up = () => dragRef.current && onMouseUp();
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  });

  // Ctrl + wheel zooms.
  const onWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      useMusicStore.getState().setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
    }
  };

  const hoverCell = hover && song && hover.zone !== "none" && hover.abs >= 0 && hover.abs < totalRows ? hover : null;
  const hoverInfo = hoverCell
    ? (() => {
        const { order, row } = fromAbsRow(hoverCell.abs);
        const cell = cellAt(song!, channel, hoverCell.abs);
        const parts = [`${order + 1}:${String(row).padStart(2, "0")}`];
        if (hoverCell.zone === "grid" || hoverCell.zone === "keys") parts.push(noteName(Math.max(0, Math.min(NOTE_COUNT - 1, hoverCell.note))));
        if (cell?.note != null) parts.push(`note ${noteName(cell.note)}${cell.instrument !== null ? ` · inst ${cell.instrument + 1}` : ""}`);
        if (cell?.effectCode != null) parts.push(`fx ${effectLabel(cell.effectCode, cell.effectParam)}`);
        return parts.join("   ");
      })()
    : null;

  return (
    <div className="piano-roll-wrap">
      <div
        ref={scrollRef}
        className={`piano-roll piano-roll-tool-${tool}`}
        tabIndex={0}
        onScroll={() => draw()}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseLeave={() => !dragRef.current && setHover(null)}
        onContextMenu={(e) => e.preventDefault()}
        onWheel={onWheel}
      >
        <div style={{ width: KEY_W + totalRows * cw + 200, height: HEADER_H + NOTE_COUNT * ch + FX_H }} />
      </div>
      <canvas ref={canvasRef} className="piano-roll-canvas" />
      {hoverInfo && <div className="piano-roll-hover">{hoverInfo}</div>}
    </div>
  );
}
