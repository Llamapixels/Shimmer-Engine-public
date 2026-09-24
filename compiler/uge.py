"""hUGETracker / GB Studio .uge songs -> C data for engine/source/huge.c.

A Python port of GB Studio's loadUGESong() and exportToC()
(gb-studio-source/src/shared/lib/uge/ugeHelper.ts, MIT). The reader
handles every .uge version GB Studio does (0-6); the writer emits the
same bytes GB Studio's exporter feeds hUGEDriver (3-byte "dn" pattern
rows, 16-byte waves, 5-field instruments), just as HugeSong/HugeInstr
structs (engine/include/huge.h) instead of GBDK's hUGESong_t.
"""

import struct
from pathlib import Path

NO_NOTE = 90
LAST_NOTE = 72
PATTERN_ROWS = 64
SUBPATTERN_ROWS = 32     # hUGEDriver only runs the first 32 subpattern rows
INSTRUMENTS_PER_TYPE = 15
WAVE_COUNT = 16

DUTY, WAVE, NOISE = 0, 1, 2


class UgeError(Exception):
    pass


class _Reader:
    def __init__(self, data):
        self.data = data
        self.offset = 0

    def _take(self, fmt):
        size = struct.calcsize(fmt)
        if self.offset + size > len(self.data):
            raise UgeError("file ends early (truncated or not a .uge file)")
        value = struct.unpack_from(fmt, self.data, self.offset)
        self.offset += size
        return value

    def u8(self):
        return self._take("<B")[0]

    def u32(self):
        return self._take("<I")[0]

    def i32(self):
        return self._take("<i")[0]

    def skip(self, n):
        self.offset += n

    def text(self):
        # Pascal shortstring: length byte + 255 bytes of storage.
        length = self.data[self.offset] if self.offset < len(self.data) else 0
        raw = self.data[self.offset + 1:self.offset + 1 + length]
        self.offset += 256
        return raw.decode("utf-8", errors="replace")


def _subpattern_cell(note=None, jump=None, effect_code=None, effect_param=None):
    return {"note": note, "jump": jump,
            "effect_code": effect_code, "effect_param": effect_param}


def _subpattern_from_noise_macro(noise_macro, ticks_per_row):
    """Older (v4/v5) noise instruments had a 6-step "noise macro"
    instead of a subpattern - migrated the same way GB Studio does."""
    sub = [_subpattern_cell() for _ in range(64)]
    for n in range(6):
        sub[n + 1]["note"] = noise_macro[n] + 36
    wrap_point = min(ticks_per_row, 7)
    sub[wrap_point - 1]["jump"] = wrap_point
    return sub


def load_uge(data):
    """Parse a .uge file's bytes into a plain dict song."""
    r = _Reader(data)
    version = r.u32()
    if version > 6:
        raise UgeError(f"UGE version {version} isn't supported (0-6 are)")

    song = {"name": r.text(), "artist": r.text(), "comment": r.text()}

    instrument_count = 15 if version < 3 else 45
    instruments = []
    for _ in range(instrument_count):
        ins = {"type": r.u32(), "name": r.text()}
        ins["length"] = r.u32()
        ins["length_enabled"] = r.u8()
        ins["initial_volume"] = min(r.u8(), 15)
        volume_direction = r.u32()
        sweep = r.u8()
        if sweep != 0:
            sweep = 8 - sweep
        if volume_direction:
            sweep = -sweep
        ins["volume_sweep_change"] = sweep

        ins["freq_sweep_time"] = r.u32()
        freq_sweep_direction = r.u32()
        ins["freq_sweep_shift"] = r.u32()
        ins["freq_sweep_negative"] = bool(freq_sweep_direction)

        ins["duty"] = r.u8()
        ins["wave_output_level"] = r.u32()
        ins["wave_index"] = r.u32()

        ins["subpattern_enabled"] = False
        ins["subpattern"] = None
        noise_macro = []
        if version >= 6:
            ins["noise_counter_step"] = r.u32()
            ins["subpattern_enabled"] = r.u8() != 0
            sub = []
            for _ in range(64):
                note = r.u32()
                r.skip(4)   # unused
                jump = r.u32()
                effect_code = r.u32()
                effect_param = r.u8()
                empty_fx = effect_code == 0 and effect_param == 0
                sub.append(_subpattern_cell(
                    None if note == NO_NOTE else note,
                    jump,
                    None if empty_fx else effect_code,
                    None if empty_fx else effect_param))
            ins["subpattern"] = sub
        else:
            r.skip(4)   # unused
            ins["noise_counter_step"] = r.u32()
            r.skip(4)   # unused
            if version >= 4:
                for _ in range(6):
                    v = r.u8()
                    noise_macro.append(v - 0x100 if v > 0x7F else v)
        ins["noise_macro"] = noise_macro
        instruments.append(ins)

    waves = []
    for _ in range(WAVE_COUNT):
        waves.append(bytes(data[r.offset:r.offset + 32]))
        r.skip(32)
        if version < 3:
            r.skip(1)   # older versions have an off-by-one error
    song["waves"] = waves

    song["ticks_per_row"] = r.u32()
    if version >= 6:
        song["timer_enabled"] = r.u8() != 0
        song["timer_divider"] = r.u32()

    pattern_count = r.u32()
    if r.offset + pattern_count * 13 * 64 > len(data):
        raise UgeError(f"song has too many patterns ({pattern_count})")
    patterns = {}
    for n in range(pattern_count):
        pattern_id = r.u32() if version >= 5 else n
        rows = []
        for _ in range(PATTERN_ROWS):
            if version < 6:
                note, instrument, effect_code = r.i32(), r.i32(), r.i32()
            else:
                note, instrument, _unused, effect_code = r.i32(), r.i32(), r.i32(), r.i32()
            effect_param = r.u8()
            rows.append((note, instrument, effect_code, effect_param))
        # Songs saved by GB Studio 3.0.2 or earlier repeat ids instead
        # of storing real ones (they expected them to be consecutive).
        if version == 5 and pattern_id in patterns:
            patterns[n] = rows
        else:
            patterns[pattern_id] = rows
    song["patterns"] = patterns

    orders = []
    for _ in range(4):
        count = r.u32()     # stored with an off-by-one
        values = [r.u32() for _ in range(count)]
        orders.append(values[:max(count - 1, 0)])
    song["orders"] = orders

    # Sort instruments into their three tables, file order within each.
    tables = {DUTY: [], WAVE: [], NOISE: []}
    for ins in instruments:
        kind = ins["type"]
        if kind not in tables:
            raise UgeError(f"invalid instrument type {kind} (\"{ins['name']}\")")
        if kind == NOISE and version < 6 and ins["noise_macro"]:
            ins["subpattern_enabled"] = True
            ins["subpattern"] = _subpattern_from_noise_macro(
                ins["noise_macro"], song["ticks_per_row"])
        tables[kind].append(ins)
    song["duty_instruments"] = tables[DUTY]
    song["wave_instruments"] = tables[WAVE]
    song["noise_instruments"] = tables[NOISE]
    return song


# --- C export --------------------------------------------------------------

def _dn(note, instrument, effect):
    """hUGE.inc's "dn" macro: one 3-byte pattern/subpattern row."""
    return [
        (note | ((instrument & 0x10) << 3)) & 0xFF,
        ((instrument << 4) & 0xFF) | ((effect >> 8) & 0x0F),
        effect & 0xFF,
    ]


def _pattern_bytes(rows):
    out = []
    for i in range(PATTERN_ROWS):
        if rows is None or i >= len(rows):
            out += _dn(NO_NOTE, 0, 0)
            continue
        note, instrument, effect_code, effect_param = rows[i]
        if not 0 <= note < LAST_NOTE:
            note = NO_NOTE
        effect = ((effect_code & 0x0F) << 8) | (effect_param & 0xFF)
        out += _dn(note, instrument & 0x1F, effect)
    return out


def _subpattern_bytes(sub):
    out = []
    for i in range(SUBPATTERN_ROWS):
        cell = sub[i]
        note = NO_NOTE if cell["note"] is None else cell["note"] & 0x7F
        is_last = i == SUBPATTERN_ROWS - 1
        # Same as GB Studio: the last exported row always jumps back to
        # row 0 (jump values are row + 1) so the table loops.
        if is_last and cell["jump"] is not None:
            jump = 1
        else:
            jump = cell["jump"] or 0
        effect = 0
        if cell["effect_code"] is not None:
            effect = ((cell["effect_code"] & 0x0F) << 8) | ((cell["effect_param"] or 0) & 0xFF)
        out += _dn(note, jump & 0x1F, effect)
    return out


def _envelope(ins):
    change = ins["volume_sweep_change"]
    env = (ins["initial_volume"] << 4) | (0x08 if change > 0 else 0)
    if change != 0:
        env |= 8 - abs(change)
    return env & 0xFF


def _instr_fields(kind, ins):
    """(b0, b1, b2, highmask) for a HugeInstr - GB Studio's
    formatDutyInstrument / formatWaveInstrument / formatNoiseInstrument."""
    length_enabled = bool(ins["length_enabled"])
    if kind == DUTY:
        sweep = ((ins["freq_sweep_time"] << 4)
                 | (0x08 if ins["freq_sweep_negative"] and ins["freq_sweep_shift"] else 0)
                 | ins["freq_sweep_shift"]) & 0xFF
        len_duty = ((ins["duty"] << 6)
                    | ((ins["length"] if length_enabled else 0) & 0x3F)) & 0xFF
        highmask = 0x80 | (0x40 if length_enabled else 0)
        return sweep, len_duty, _envelope(ins), highmask
    if kind == WAVE:
        length = (ins["length"] if length_enabled else 0) & 0xFF
        volume = (ins["wave_output_level"] << 5) & 0xFF
        highmask = 0x80 | (0x40 if length_enabled else 0)
        return length, volume, ins["wave_index"] & 0xFF, highmask
    highmask = (ins["length"] if length_enabled else 0) & 0x3F
    if length_enabled:
        highmask |= 0x40
    if ins["noise_counter_step"]:
        highmask |= 0x80    # 7-bit LFSR ("bitCount 7")
    return _envelope(ins), 0, 0, highmask


def _c_bytes(values, per_line=12):
    lines = []
    for i in range(0, len(values), per_line):
        lines.append("    " + ", ".join(f"0x{v:02X}" for v in values[i:i + per_line]) + ",")
    return "\n".join(lines)


def song_to_c(song, prefix, source_name):
    """C definitions for one song. Returns (code, song_symbol)."""
    orders = song["orders"]
    order_count = len(orders[0])
    if order_count == 0:
        raise UgeError("song has no orders (its sequence is empty)")
    if order_count > 255:
        raise UgeError(f"song has {order_count} orders; the engine supports up to 255")

    title = source_name
    if song["name"]:
        title += f": \"{song['name']}\""
    if song["artist"]:
        title += f" by {song['artist']}"
    # Song text is user-supplied: keep it from opening/closing the comment.
    title = title.replace("/*", "/ *").replace("*/", "* /")
    out = [f"/* {title} */"]

    # Patterns, deduplicated by content (like GB Studio's exporter).
    pattern_syms = {}       # bytes -> symbol
    pattern_for_id = {}     # pattern id -> symbol

    def pattern_symbol(pattern_id):
        if pattern_id in pattern_for_id:
            return pattern_for_id[pattern_id]
        data = tuple(_pattern_bytes(song["patterns"].get(pattern_id)))
        sym = pattern_syms.get(data)
        if sym is None:
            sym = f"{prefix}_pattern_{len(pattern_syms)}"
            pattern_syms[data] = sym
            out.append(f"static const uint8_t {sym}[{len(data)}] = {{\n{_c_bytes(list(data))}\n}};")
        pattern_for_id[pattern_id] = sym
        return sym

    order_syms = []
    for ch in range(4):
        channel_orders = orders[ch]
        syms = [pattern_symbol(channel_orders[i] if i < len(channel_orders) else -1)
                for i in range(order_count)]
        sym = f"{prefix}_order{ch + 1}"
        order_syms.append(sym)
        body = ",\n".join(f"    {s}" for s in syms)
        out.append(f"static const uint8_t *const {sym}[{order_count}] = {{\n{body},\n}};")

    # Subpatterns (instrument "tables"), deduplicated.
    table_syms = {}

    def table_symbol(ins):
        if not ins["subpattern_enabled"] or not ins["subpattern"]:
            return "NULL"
        data = tuple(_subpattern_bytes(ins["subpattern"]))
        sym = table_syms.get(data)
        if sym is None:
            sym = f"{prefix}_table_{len(table_syms)}"
            table_syms[data] = sym
            out.append(f"static const uint8_t {sym}[{len(data)}] = {{\n{_c_bytes(list(data))}\n}};")
        return sym

    instr_syms = []
    for kind, key, label in ((DUTY, "duty_instruments", "duty"),
                             (WAVE, "wave_instruments", "wave"),
                             (NOISE, "noise_instruments", "noise")):
        entries = []
        for i in range(INSTRUMENTS_PER_TYPE):
            instruments = song[key]
            if i < len(instruments):
                ins = instruments[i]
                b0, b1, b2, hm = _instr_fields(kind, ins)
                table = table_symbol(ins)
            else:
                b0, b1, b2, hm, table = 0, 0, 0, 0, "NULL"
            entries.append(f"    {{ 0x{b0:02X}, 0x{b1:02X}, 0x{b2:02X}, 0x{hm:02X}, {table} }},")
        sym = f"{prefix}_{label}"
        instr_syms.append(sym)
        out.append(f"static const HugeInstr {sym}[{INSTRUMENTS_PER_TYPE}] = {{\n"
                   + "\n".join(entries) + "\n};")

    wave_bytes = []
    for n in range(WAVE_COUNT):
        wave = song["waves"][n] if n < len(song["waves"]) else bytes(32)
        wave = wave.ljust(32, b"\0")
        for i in range(16):
            wave_bytes.append(((wave[i * 2] & 0x0F) << 4) | (wave[i * 2 + 1] & 0x0F))
    waves_sym = f"{prefix}_waves"
    out.append(f"static const uint8_t {waves_sym}[{len(wave_bytes)}] = {{\n{_c_bytes(wave_bytes, 16)}\n}};")

    song_sym = f"{prefix}_song"
    out.append(
        f"static const HugeSong {song_sym} = {{\n"
        f"    {song['ticks_per_row'] & 0xFF},\n"
        f"    {order_count},\n"
        f"    {{ {', '.join(order_syms)} }},\n"
        f"    {instr_syms[0]}, {instr_syms[1]}, {instr_syms[2]},\n"
        f"    {waves_sym},\n"
        "};")
    return "\n\n".join(out), song_sym


def track_const(stem):
    """assets/music/<stem>.uge -> its UGE_* track id macro name."""
    return "UGE_" + "".join(ch.upper() if ch.isalnum() else "_" for ch in stem)


def build_uge_songs(music_dir, out_dir):
    """Compile every <music_dir>/*.uge into out_dir/uge_songs.c/.h.
    Always writes both files (with zero songs if there are none) since
    engine/include/music.h includes the header unconditionally.
    Raises UgeError naming the file on a bad song."""
    music_dir = Path(music_dir)
    files = sorted(music_dir.glob("*.uge"), key=lambda p: p.name.lower()) if music_dir.is_dir() else []

    header = ["/* Generated by compiler/build_project.py from the .uge songs in the project's assets/music folder - do not edit. */",
              "#ifndef UGE_SONGS_H",
              "#define UGE_SONGS_H",
              "",
              '#include "huge.h"',
              "",
              "/* Track ids for music_play(). */",
              f"#define UGE_SONG_COUNT {len(files)}"]
    source = ["/* Generated by compiler/build_project.py from the .uge songs in the project's assets/music folder - do not edit. */",
              "#include <stddef.h>",
              "#include <stdint.h>",
              "",
              '#include "huge.h"',
              '#include "uge_songs.h"',
              ""]

    song_syms = []
    for index, path in enumerate(files):
        try:
            song = load_uge(path.read_bytes())
            code, sym = song_to_c(song, f"uge{index}", path.name)
        except UgeError as e:
            raise UgeError(f"assets/music/{path.name}: {e}") from None
        source.append(code)
        source.append("")
        song_syms.append(sym)
        header.append(f"#define {track_const(path.stem)} {index}")

    header += ["",
               "extern const HugeSong *const uge_songs[];",
               "",
               "#endif",
               ""]
    if song_syms:
        source.append("const HugeSong *const uge_songs[] = {\n"
                      + "\n".join(f"    &{s}," for s in song_syms) + "\n};\n")
    else:
        source.append("const HugeSong *const uge_songs[] = { NULL };\n")

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for path, text in ((out_dir / "uge_songs.h", "\n".join(header)), (out_dir / "uge_songs.c", "\n".join(source))):
        if not path.exists() or path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")
    return [p.stem for p in files]
