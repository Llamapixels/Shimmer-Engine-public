"""
Dialogue fonts, frames and the menu cursor -> engine/data/ui_data.c/.h.

Same files as GB Studio uses, so its fonts and frames drop straight in:

    <project>/assets/fonts/<name>.png   8x8 cells, 16 per row, starting at
                                        character 32 (or 0 for 16+ rows).
                                        Columns of pure magenta (#FF00FF) or
                                        transparency are trimmed off each
                                        character, making the font variable
                                        width; a font with none is fixed width.
                                        Optional <name>.json:
                                        {"name": "...", "mapping": {"é": 233}}
                                        maps characters to cell codes.
    <project>/assets/frames/<name>.png  24x24: the dialogue box's 3x3 tiles
                                        (corners, edges, centre fill).
    <project>/assets/ui/frame.png       also a frame (named "frame"), as in
                                        GB Studio projects.
    <project>/assets/ui/cursor.png      8x8 menu cursor (optional).

Unlike the Game Boy's four shades, the real colours are kept (GBA 15-bit).
A font's background colour is whatever fills its first cell (the space
character); every other opaque colour is drawn as text, anything else
shows the frame behind it. All fonts, frames and the cursor share the
dialogue's one 16-colour palette: up to 15 colours between them.

project.json "ui" (all optional):
    { "font": "name", "frame": "name", "textSpeed": 1 }
textSpeed is frames per character (0 = whole page at once).

Built-in "default" font, frame and cursor live in engine/data/ui/.
"""

import json
from pathlib import Path

from PIL import Image

TILE = 8
MAX_COLORS = 15
FRAME_SIZE = 24
FONT_REF_NAME = "default"


class UiError(Exception):
    pass


def gba_color(rgb):
    def c5(v):
        return (v * 31 + 127) // 255
    r, g, b = rgb[:3]
    return c5(r) | (c5(g) << 5) | (c5(b) << 10)


class Palette:
    def __init__(self):
        self.colors = []   # 15-bit colours, palette index = position + 1

    def index(self, rgb, where):
        c = gba_color(rgb)
        if c not in self.colors:
            if len(self.colors) >= MAX_COLORS:
                raise UiError(
                    f"{where}: the dialogue fonts, frames and cursor use more than {MAX_COLORS} "
                    "colours between them (the GBA gives the dialogue box one 16-colour palette). "
                    "Use fewer colours, or fewer fonts/frames with different colours.")
            self.colors.append(c)
        return self.colors.index(c) + 1

    def c_values(self):
        return [0] + self.colors + [0] * (15 - len(self.colors))


def _is_trim(p):
    r, g, b, a = p
    return a < 128 or (r > 249 and b > 249 and g < 10)


def load_font(path, palette, name):
    where = f"font '{name}' ({path.name})"
    img = Image.open(path).convert("RGBA")
    w, h = img.size
    if w < TILE or h < TILE or w % TILE or h % TILE:
        raise UiError(f"{where}: {w}x{h} isn't a grid of 8x8 characters.")
    cols, rows = w // TILE, h // TILE
    first = 32 if rows * cols <= 224 else 0
    count = min(cols * rows, 256 - first)
    px = img.load()

    # Background: the most common colour in the first cell (the space).
    counts = {}
    for y in range(TILE):
        for x in range(TILE):
            p = px[x, y]
            if not _is_trim(p):
                counts[p[:3]] = counts.get(p[:3], 0) + 1
    background = max(counts, key=counts.get) if counts else None

    glyphs = []   # per character: 8 rows as 32-bit 4bpp words
    widths = []
    variable = False
    for i in range(count):
        cx, cy = (i % cols) * TILE, (i // cols) * TILE
        cells = [[px[cx + x, cy + y] for x in range(TILE)] for y in range(TILE)]
        used = [x for x in range(TILE) if any(not _is_trim(cells[y][x]) for y in range(TILE))]
        if used and (used[0] > 0 or used[-1] < TILE - 1):
            variable = True
        left = used[0] if used else 0
        width = (used[-1] - left + 1) if used else 0
        rows_out = []
        for y in range(TILE):
            word = 0
            for x in range(left, TILE):
                p = cells[y][x]
                if _is_trim(p) or p[:3] == background:
                    continue
                word |= palette.index(p, where) << (4 * (x - left))
            rows_out.append(word)
        glyphs.append(rows_out)
        widths.append(width)
    if not variable:
        widths = [TILE] * count
    elif first <= 32 < first + count and widths[32 - first] == 0:
        widths[32 - first] = 3   # an all-trimmed space still needs a width

    mapping = {}
    meta = path.with_suffix(".json")
    if meta.exists():
        try:
            data = json.loads(meta.read_text(encoding="utf-8"))
        except ValueError as e:
            raise UiError(f"{where}: {meta.name} isn't valid JSON ({e}).") from None
        for ch, code in (data.get("mapping") or {}).items():
            if isinstance(ch, str) and len(ch) == 1 and isinstance(code, int) and 0 <= code < 256:
                mapping[ch] = code
    return {"name": name, "first": first, "glyphs": glyphs, "widths": widths,
            "fixed": not variable, "mapping": mapping}


def load_tiles(path, palette, where, tw, th, corner_clear=False):
    """4bpp tile rows. Transparent pixels show what's behind; with
    corner_clear, an image with no transparency at all has its top-left
    pixel's colour treated as transparent instead (GB Studio cursors are
    drawn on an opaque background)."""
    img = Image.open(path).convert("RGBA")
    if img.size != (tw * TILE, th * TILE):
        raise UiError(f"{where}: must be {tw * TILE}x{th * TILE} pixels (it's {img.width}x{img.height}).")
    px = img.load()
    clear = None
    if corner_clear and all(p[3] >= 128 for p in img.getdata()):
        clear = px[0, 0][:3]
    tiles = []
    for ty in range(th):
        for tx in range(tw):
            rows = []
            for y in range(TILE):
                word = 0
                for x in range(TILE):
                    p = px[tx * TILE + x, ty * TILE + y]
                    if p[3] < 128 or p[:3] == clear:
                        continue
                    word |= palette.index(p, where) << (4 * x)
                rows.append(word)
            tiles.append(rows)
    return tiles


def _assets(folder):
    return sorted(folder.glob("*.png"), key=lambda p: p.name.lower()) if folder.is_dir() else []


def build_ui(project, project_dir, defaults_dir, referenced):
    """Load the project's fonts/frames/cursor (+ the built-in defaults
    where needed). `referenced` is the raw text of the project and scene
    files, used to tell whether the built-in "default" font/frame is named
    anywhere. Returns a dict for ui_to_c() and the compiler's lookups."""
    ui = project.get("ui") or {}
    if not isinstance(ui, dict):
        raise UiError("project.json \"ui\" must be an object.")
    palette = Palette()
    defaults_dir = Path(defaults_dir)

    font_files = {p.stem: p for p in _assets(project_dir / "assets" / "fonts")}
    frame_files = {p.stem: p for p in _assets(project_dir / "assets" / "frames")}
    gbs_frame = project_dir / "assets" / "ui" / "frame.png"   # where GB Studio keeps it
    if gbs_frame.exists() and "frame" not in frame_files:
        frame_files = {"frame": gbs_frame, **frame_files}

    want_font = ui.get("font") or (next(iter(font_files)) if font_files else FONT_REF_NAME)
    want_frame = ui.get("frame") or (next(iter(frame_files)) if frame_files else FONT_REF_NAME)

    def needs_default(files, wanted, field, code):
        """Include the built-in default when there's nothing else, or
        when it's named in the settings, a text code or an event."""
        if FONT_REF_NAME in files:
            return False
        named = f"!{code}:{FONT_REF_NAME}!" in referenced or f'"{field}": "{FONT_REF_NAME}"' in referenced
        return not files or wanted == FONT_REF_NAME or named

    if needs_default(font_files, want_font, "font", "F"):
        font_files = {FONT_REF_NAME: defaults_dir / "font.png", **font_files}
    if needs_default(frame_files, want_frame, "frame", "R"):
        frame_files = {FONT_REF_NAME: defaults_dir / "frame.png", **frame_files}

    fonts = []
    try:
        for name, path in font_files.items():
            fonts.append(load_font(path, palette, name))
        frames = [load_tiles(path, palette, f"frame '{name}' ({path.name})", 3, 3)
                  for name, path in frame_files.items()]
        cursor_path = project_dir / "assets" / "ui" / "cursor.png"
        if not cursor_path.exists():
            cursor_path = defaults_dir / "cursor.png"
        cursor = load_tiles(cursor_path, palette, f"cursor ({cursor_path.name})", 1, 1,
                            corner_clear=True)[0]
    except OSError as e:
        raise UiError(f"Couldn't read a UI image: {e}") from None

    font_names = list(font_files)
    frame_names = list(frame_files)
    if want_font not in font_names:
        raise UiError(f"project.json ui.font: no font called '{want_font}'. Fonts: {', '.join(font_names)}")
    if want_frame not in frame_names:
        raise UiError(f"project.json ui.frame: no frame called '{want_frame}'. Frames: {', '.join(frame_names)}")
    speed = ui.get("textSpeed", 1)
    if not isinstance(speed, int) or isinstance(speed, bool) or not 0 <= speed <= 30:
        raise UiError("project.json ui.textSpeed must be a whole number from 0 to 30.")

    mapping = {}
    for f in fonts:
        mapping.update(f["mapping"])
    return {
        "fonts": fonts, "font_names": font_names, "frames": frames, "frame_names": frame_names,
        "cursor": cursor, "palette": palette.c_values(), "mapping": mapping,
        "default_font": font_names.index(want_font), "default_frame": frame_names.index(want_frame),
        "speed": speed,
    }


def encode_char(ch, ui):
    """A text character -> the byte the engine looks up in the font."""
    if ch in ui["mapping"]:
        return chr(ui["mapping"][ch] or ord("?"))
    if ch == "\n":
        return ch
    if 32 <= ord(ch) < 256:
        return ch
    return "?"


def _words(values, per_line=8):
    return ",\n".join("    " + ", ".join(f"0x{v:08X}" for v in values[i:i + per_line])
                      for i in range(0, len(values), per_line))


def ui_to_c(ui):
    c = ["/* Generated by compiler/ui.py - do not edit. */", "#include <stdint.h>", "",
         '#include "ui.h"', ""]
    for i, f in enumerate(ui["fonts"]):
        words = [w for g in f["glyphs"] for w in g]
        c.append(f"/* font: {f['name']} ({'fixed' if f['fixed'] else 'variable'} width) */")
        c.append(f"static const uint32_t font{i}_glyphs[{len(words)}] = {{\n{_words(words)}\n}};")
        c.append(f"static const uint8_t font{i}_widths[{len(f['widths'])}] = {{ "
                 + ", ".join(map(str, f["widths"])) + " };")
    c.append(f"const UiFont ui_fonts[{len(ui['fonts'])}] = {{")
    for i, f in enumerate(ui["fonts"]):
        c.append(f"    {{ font{i}_glyphs, font{i}_widths, {len(f['widths'])}, {f['first']} }},")
    c.append("};")
    c.append(f"const uint32_t ui_frames[{len(ui['frames'])}][72] = {{")
    for name, fr in zip(ui["frame_names"], ui["frames"]):
        c.append(f"    /* frame: {name} */\n    {{\n{_words([w for t in fr for w in t])}\n    }},")
    c.append("};")
    c.append(f"const uint32_t ui_cursor[8] = {{ {', '.join(f'0x{w:08X}' for w in ui['cursor'])} }};")
    c.append("const uint16_t ui_palette[16] = { " + ", ".join(f"0x{v:04X}" for v in ui["palette"]) + " };")
    c.append(f"const uint8_t ui_font_count = {len(ui['fonts'])};")
    c.append(f"const uint8_t ui_frame_count = {len(ui['frames'])};")
    c.append(f"const uint8_t ui_default_font = {ui['default_font']};")
    c.append(f"const uint8_t ui_default_frame = {ui['default_frame']};")
    c.append(f"const uint8_t ui_default_text_speed = {ui['speed']};")
    return "\n".join(c) + "\n"
