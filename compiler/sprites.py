"""Sprite sheets -> engine data (SpriteDef, see engine/include/entity.h).

A sprite is a PNG in the project's assets/sprites/ folder plus an optional
entry in project.json's "spriteSheets" list, laid out like GB Studio's
sprites (gb-studio-source/src/shared/lib/resources/types.ts, MIT):

    {
      "version": 2,
      "name": "hero",                  <- assets/sprites/hero.png
      "canvasWidth": 32, "canvasHeight": 32,
      "canvasOriginX": 0, "canvasOriginY": 0,
      "bounds": { "x": 0, "y": 0, "width": 16, "height": 16 },
      "animSpeed": 8,                  <- VBlanks per frame
      "spriteMode": "8x16",            <- editor's default tile size
      "states": [
        { "id": "...", "name": "",     <- "" = the default state
          "animationType": "multi_movement",
          "flipLeft": true,
          "animations": [              <- always 8, GB Studio's order:
            { "id": "...",             idle right/left/up/down,
              "speed": 8,              moving right/left/up/down
              "frames": [ { "id": "...", "tiles": [
                { "id": "...", "x": 0, "y": 0,          <- on the canvas, px
                  "sliceX": 0, "sliceY": 0,             <- in the PNG, px
                  "width": 8, "height": 16,             <- optional
                  "flipX": false, "flipY": false,
                  "priority": false } ] } ] } ] } ]
    }

A sprite with no entry gets GB Studio's automatic layout (see
default_sheet()). Tiles can be any size; every frame is drawn ("rasterized")
and then covered with as few GBA hardware OBJs as possible, each up to
64x64 (pack_layer()), so big sprites stay cheap. Frames mirrored by
"flipLeft" reuse the original frame's pixel data with the OBJs flipped.

Anchoring: an actor's position is the top-left of its 16x16 footprint.
The canvas's bottom-centre sits on the footprint's bottom-centre, shifted
by canvasOrigin:
    dx = x + (16 - canvasWidth) // 2 + canvasOriginX
    dy = y + (16 - canvasHeight) + canvasOriginY
The editor draws sprites the same way.
"""

from PIL import Image

ANIMATION_TYPES = (
    "fixed", "fixed_movement", "multi", "multi_movement",
    "horizontal", "horizontal_movement", "platform_player", "cursor",
)
SPRITE_MODES = {"8x8": 8, "8x16": 16}
MAX_CANVAS = 256
MAX_OBJS = 32               # engine's ASPRITE_MAX_OBJS
MAX_FRAMES_PER_ANIM = 255
MAX_STATES = 64
DEFAULT_ANIM_SPEED = 8

# GBA OBJ sizes in 8px cells: (w, h) -> (attr0 shape bits, attr1 size bits).
OBJ_SHAPES = {
    (8, 8): (0x0000, 0xC000), (8, 4): (0x4000, 0xC000), (4, 8): (0x8000, 0xC000),
    (4, 4): (0x0000, 0x8000), (4, 2): (0x4000, 0x8000), (2, 4): (0x8000, 0x8000),
    (2, 2): (0x0000, 0x4000), (4, 1): (0x4000, 0x4000), (1, 4): (0x8000, 0x4000),
    (2, 1): (0x4000, 0x0000), (1, 2): (0x8000, 0x0000), (1, 1): (0x0000, 0x0000),
}
# Tried largest first.
OBJ_SHAPE_ORDER = sorted(OBJ_SHAPES, key=lambda s: -s[0] * s[1])
ATTR1_HFLIP = 0x1000

# Engine animation slot (moving * 4 + Direction, Direction = down/up/
# right/left) -> GB Studio animation index (idle right/left/up/down,
# moving right/left/up/down).
GB_INDEX_FOR_DIRECTION = (3, 2, 0, 1)


class SpriteError(Exception):
    pass


def gba_color(rgb):
    def c5(v):
        return (v * 31 + 127) // 255
    r, g, b = rgb
    return c5(r) | (c5(g) << 5) | (c5(b) << 10)


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

class SheetImage:
    """A sprite PNG as palette indices (0 = transparent) plus its GBA
    palette. Up to 15 colors, in the order they first appear."""

    def __init__(self, path, name):
        image = Image.open(path).convert("RGBA")
        self.width, self.height = image.size
        self.name = name
        colors = []
        index_of = {}
        rows = []
        data = list(image.getdata())
        for y in range(self.height):
            row = []
            for x in range(self.width):
                r, g, b, a = data[y * self.width + x]
                if a < 128:
                    row.append(0)
                    continue
                rgb = (r, g, b)
                i = index_of.get(rgb)
                if i is None:
                    colors.append(rgb)
                    i = index_of[rgb] = len(colors)
                row.append(i)
            rows.append(row)
        if len(colors) > 15:
            raise SpriteError(
                f"sprite '{name}' ({path.name}) has {len(colors)} colors; a GBA sprite "
                "palette holds 15 plus transparency. Reduce its colors.")
        self.rows = rows
        self.colors = colors
        self.palette = [0] + [gba_color(c) for c in colors] + [0] * (15 - len(colors))

    def pixel(self, x, y):
        if 0 <= x < self.width and 0 <= y < self.height:
            return self.rows[y][x]
        return 0


# ---------------------------------------------------------------------------
# Sheet data
# ---------------------------------------------------------------------------

_id_counter = [0]


def _new_id(prefix):
    _id_counter[0] += 1
    return f"{prefix}{_id_counter[0]}"


def _frame(tiles):
    return {"id": _new_id("f"), "tiles": tiles}


def _block(x, y, sx, sy, w, h, flip_x=False):
    return {"id": _new_id("t"), "x": x, "y": y, "sliceX": sx, "sliceY": sy,
            "width": w, "height": h, "flipX": flip_x, "flipY": False, "priority": False}


def default_sheet(name, width, height):
    """GB Studio's automatic layout for a sprite with no spriteSheets entry
    (its detectClassic, generalized from 16x16 frames to square frames the
    height of the image): 3 frames -> down/up/right, facing left by
    flipping right; 6 frames -> the same with two walking frames each;
    anything else -> one frame showing the whole image."""
    size = height
    count = width // size if size and width % size == 0 else 0
    anims = [[] for _ in range(8)]

    def cell(i):
        return _frame([_block(0, 0, i * size, 0, size, size)])

    if count == 3:
        anim_type = "multi"
        anims[0] = [cell(2)]
        anims[2] = [cell(1)]
        anims[3] = [cell(0)]
        cw = ch = size
    elif count == 6:
        anim_type = "multi_movement"
        anims[0] = [cell(4)]
        anims[2] = [cell(2)]
        anims[3] = [cell(0)]
        anims[4] = [cell(5), cell(4)]
        anims[6] = [cell(3), cell(2)]
        anims[7] = [cell(1), cell(0)]
        cw = ch = size
    else:
        anim_type = "fixed"
        cw, ch = min(width, MAX_CANVAS), min(height, MAX_CANVAS)
        anims[0] = [_frame([_block(0, 0, 0, 0, cw, ch)])]
    return {
        "version": 2,
        "name": name,
        "canvasWidth": cw,
        "canvasHeight": ch,
        "canvasOriginX": 0,
        "canvasOriginY": 0,
        "bounds": {"x": 0, "y": 0, "width": 16, "height": 16},
        "animSpeed": DEFAULT_ANIM_SPEED,
        "spriteMode": "8x16",
        "states": [{
            "id": _new_id("s"), "name": "", "animationType": anim_type, "flipLeft": True,
            "animations": [{"id": _new_id("a"), "frames": a} for a in anims],
        }],
    }


def animation_map(anim_type, flip_left):
    """For each of the 8 GB Studio animation slots: (animation index to
    show, mirrored?). A port of GB Studio's animationMapBySpriteType
    (gb-studio-source/src/shared/lib/sprites/helpers.ts)."""
    out = []
    for i in range(8):
        moving = i >= 4
        if anim_type == "fixed":
            r = (0, False)
        elif anim_type == "fixed_movement":
            r = (4 if moving else 0, False)
        elif anim_type == "multi":
            r = (0, True) if flip_left and i in (1, 5) else (i % 4, False)
        elif anim_type == "horizontal":
            r = (0, i % 2 != 0) if flip_left else (i % 2, False)
        elif anim_type == "horizontal_movement":
            base = 4 if moving else 0
            r = (base, i % 2 != 0) if flip_left else (i % 2 + base, False)
        elif anim_type == "platform_player":
            r = (i - 1, True) if flip_left and i in (1, 3, 5) else (i, False)
        elif anim_type == "cursor":
            r = (1, False) if i == 0 else (0, False)
        elif flip_left and i in (1, 5):
            r = (i - 1, True)
        else:
            r = (i, False)
        out.append(r)
    return out


def _int(value, field, where, lo, hi, default=None):
    if value is None and default is not None:
        value = default
    if not isinstance(value, int) or isinstance(value, bool):
        raise SpriteError(f"{where}: \"{field}\" must be a whole number.")
    if not lo <= value <= hi:
        raise SpriteError(f"{where}: \"{field}\" ({value}) must be between {lo} and {hi}.")
    return value


def check_sheet(sheet, where):
    """Validate a version-2 sheet entry; returns it with defaults filled."""
    if sheet.get("version") != 2:
        raise SpriteError(
            f"{where}: this sprite was saved by an older version of the editor. Open the "
            "project in the Shimmer Engine editor once to upgrade it, then build again.")
    s = dict(sheet)
    s["canvasWidth"] = _int(s.get("canvasWidth"), "canvasWidth", where, 1, MAX_CANVAS, 16)
    s["canvasHeight"] = _int(s.get("canvasHeight"), "canvasHeight", where, 1, MAX_CANVAS, 16)
    s["canvasOriginX"] = _int(s.get("canvasOriginX"), "canvasOriginX", where, -512, 512, 0)
    s["canvasOriginY"] = _int(s.get("canvasOriginY"), "canvasOriginY", where, -512, 512, 0)
    s["animSpeed"] = _int(s.get("animSpeed"), "animSpeed", where, 1, 255, DEFAULT_ANIM_SPEED)
    mode = s.get("spriteMode") or "8x16"
    if mode not in SPRITE_MODES:
        raise SpriteError(f"{where}: unknown \"spriteMode\" '{mode}'. Use 8x8 or 8x16.")
    s["spriteMode"] = mode
    b = s.get("bounds") or {}
    s["bounds"] = {
        "x": _int(b.get("x"), "bounds.x", where, -512, 512, 0),
        "y": _int(b.get("y"), "bounds.y", where, -512, 512, 0),
        "width": _int(b.get("width"), "bounds.width", where, 0, 1024, 16),
        "height": _int(b.get("height"), "bounds.height", where, 0, 1024, 16),
    }
    states = s.get("states") or []
    if not isinstance(states, list) or not states:
        raise SpriteError(f"{where}: needs at least one animation state.")
    if len(states) > MAX_STATES:
        raise SpriteError(f"{where}: {len(states)} states; the most is {MAX_STATES}.")
    names = set()
    for i, st in enumerate(states):
        swhere = f"{where}: state {i} ('{st.get('name', '')}')"
        if st.get("animationType", "multi_movement") not in ANIMATION_TYPES:
            raise SpriteError(f"{swhere}: unknown animationType '{st.get('animationType')}'.")
        name = st.get("name", "")
        if name in names:
            raise SpriteError(f"{swhere}: two states are called '{name or 'Default'}'.")
        names.add(name)
        anims = st.get("animations") or []
        if not isinstance(anims, list):
            raise SpriteError(f"{swhere}: \"animations\" must be a list.")
    return s


# ---------------------------------------------------------------------------
# Frames -> hardware OBJs
# ---------------------------------------------------------------------------

def rasterize(image, tiles, tile_h):
    """Draw a frame's tiles in order into layers: runs of tiles with the
    same priority. Returns [(behind, {(x, y): color index})], canvas px."""
    layers = []
    for t in tiles:
        w = int(t.get("width") or 8)
        h = int(t.get("height") or tile_h)
        if w <= 0 or h <= 0:
            continue
        behind = bool(t.get("priority", False))
        if not layers or layers[-1][0] != behind:
            layers.append((behind, {}))
        pixels = layers[-1][1]
        x0, y0 = int(t.get("x", 0)), int(t.get("y", 0))
        sx0, sy0 = int(t.get("sliceX", 0)), int(t.get("sliceY", 0))
        fx, fy = bool(t.get("flipX")), bool(t.get("flipY"))
        for py in range(h):
            sy = sy0 + (h - 1 - py if fy else py)
            for px in range(w):
                sx = sx0 + (w - 1 - px if fx else px)
                c = image.pixel(sx, sy)
                if c:
                    pixels[(x0 + px, y0 + py)] = c
    return layers


def pack_layer(pixels):
    """Cover a layer's pixels with GBA OBJs (8x8 up to 64x64 on an 8px grid
    from the layer's top-left). Greedy: take the first uncovered cell
    (top to bottom, left to right) and the shape and position covering it
    that covers the most uncovered non-empty cells, with no more empty
    cells than useful ones (ties: smaller shape, then less overlap).
    Returns [(x, y, wc, hc)] in px/cells."""
    if not pixels:
        return []
    xs = [p[0] for p in pixels]
    ys = [p[1] for p in pixels]
    ox, oy = min(xs), min(ys)
    cells = {((x - ox) // 8, (y - oy) // 8) for (x, y) in pixels}
    uncovered = set(cells)
    objs = []
    for cell in sorted(cells, key=lambda c: (c[1], c[0])):
        if cell not in uncovered:
            continue
        cx, cy = cell
        best = None
        for (wc, hc) in OBJ_SHAPE_ORDER:
            # The cell is the first uncovered one, so nothing above it
            # needs covering: it sits on the shape's top row, anywhere
            # along it.
            for x0 in range(max(0, cx - wc + 1), cx + 1):
                new = overlap = 0
                for j in range(hc):
                    for i in range(wc):
                        c = (x0 + i, cy + j)
                        if c in uncovered:
                            new += 1
                        elif c in cells:
                            overlap += 1
                if new * 2 < wc * hc:
                    continue
                score = (new, -wc * hc, -overlap)
                if best is None or score > best[0]:
                    best = (score, x0, wc, hc)
        _, x0, wc, hc = best
        for j in range(hc):
            for i in range(wc):
                uncovered.discard((x0 + i, cy + j))
        objs.append((ox + x0 * 8, oy + cy * 8, wc, hc))
    return objs


def _tile_bytes(pixels, x, y):
    out = []
    for py in range(8):
        for px in range(0, 8, 2):
            lo = pixels.get((x + px, y + py), 0)
            hi = pixels.get((x + px + 1, y + py), 0)
            out.append(lo | (hi << 4))
    return out


def pack_frame(image, tiles, tile_h, anchor):
    """One frame -> (objs, tile_data bytes, vram tile count). objs are
    dicts: dx, dy, w, h, attr0, attr1, offset, behind."""
    ax, ay = anchor
    objs = []
    data = []
    seen = {}
    for behind, pixels in rasterize(image, tiles, tile_h):
        for (x, y, wc, hc) in pack_layer(pixels):
            obj_bytes = []
            for j in range(hc):
                for i in range(wc):
                    obj_bytes += _tile_bytes(pixels, x + i * 8, y + j * 8)
            key = (wc, hc, tuple(obj_bytes))
            offset = seen.get(key)
            if offset is None:
                offset = seen[key] = len(data) // 32
                data += obj_bytes
            attr0, attr1 = OBJ_SHAPES[(wc, hc)]
            objs.append({"dx": x + ax, "dy": y + ay, "w": wc * 8, "h": hc * 8,
                         "attr0": attr0, "attr1": attr1, "offset": offset, "behind": behind})
    # Hardware draws lower OAM entries on top; layers were drawn bottom
    # first, so reverse to keep later tiles in front.
    objs.reverse()
    return objs, bytes(data), len(data) // 32


def mirror_objs(objs, anchor, canvas_w):
    """Horizontally mirror a packed frame across its canvas: same pixel
    data, each OBJ flipped and moved."""
    ax = anchor[0]
    out = []
    for o in objs:
        cx = o["dx"] - ax
        m = dict(o)
        m["dx"] = (canvas_w - cx - o["w"]) + ax
        m["attr1"] = o["attr1"] ^ ATTR1_HFLIP
        out.append(m)
    return out


class CompiledSprite:
    def __init__(self):
        self.frames = []        # [(objs, data_key)]
        self.tile_data = []     # unique pixel blobs
        self.anims = []         # [(frame indices, speed)]
        self.state_maps = []    # [12 anim indices], engine slot order
        self.state_names = {}   # name -> state index
        self.state_types = []   # animationType per state
        self.bounds = (0, 0, 16, 16)
        self.palette = []
        self.max_objs = 0
        self.max_vram = 0


def compile_sprite(sheet, image, where):
    """A checked sheet (check_sheet()) + its SheetImage -> CompiledSprite."""
    cs = CompiledSprite()
    cs.palette = image.palette
    b = sheet["bounds"]
    cs.bounds = (b["x"], b["y"], b["width"], b["height"])
    cw, ch = sheet["canvasWidth"], sheet["canvasHeight"]
    anchor = ((16 - cw) // 2 + sheet["canvasOriginX"], 16 - ch + sheet["canvasOriginY"])
    tile_h = SPRITE_MODES[sheet["spriteMode"]]

    packed = {}       # frame content key -> (objs, data index)
    frame_index = {}  # (objs key, data index) -> engine frame index
    data_index = {}   # bytes -> index into cs.tile_data

    def frame_for(frame, mirrored, fwhere):
        tiles = frame.get("tiles") or []
        content = repr([{k: v for k, v in t.items() if k != "id"} for t in tiles])
        got = packed.get(content)
        if got is None:
            objs, data, _ = pack_frame(image, tiles, tile_h, anchor)
            if len(objs) > MAX_OBJS:
                raise SpriteError(
                    f"{fwhere}: needs {len(objs)} hardware sprites (OBJs); the engine allows "
                    f"{MAX_OBJS} per frame. Merge overlapping tiles or use fewer colors layers.")
            di = data_index.get(data)
            if di is None:
                di = data_index[data] = len(cs.tile_data)
                cs.tile_data.append(data)
            got = packed[content] = (objs, di)
        objs, di = got
        if mirrored:
            objs = mirror_objs(objs, anchor, cw)
        okey = (repr(objs), di)
        fi = frame_index.get(okey)
        if fi is None:
            fi = frame_index[okey] = len(cs.frames)
            cs.frames.append((objs, di))
            cs.max_objs = max(cs.max_objs, len(objs))
            cs.max_vram = max(cs.max_vram, len(cs.tile_data[di]) // 32)
        return fi

    anim_index = {}   # (state, animation, mirrored) -> engine animation
    for si, st in enumerate(sheet["states"]):
        swhere = f"{where}: state '{st.get('name') or 'Default'}'"
        cs.state_names[st.get("name", "")] = si
        cs.state_types.append(st.get("animationType", "multi_movement"))
        anims = st.get("animations") or []
        mapping = animation_map(st.get("animationType", "multi_movement"), bool(st.get("flipLeft", True)))

        def engine_anim(ai, mirrored):
            key = (si, ai, mirrored)
            if key in anim_index:
                return anim_index[key]
            anim = anims[ai] if 0 <= ai < len(anims) else {"frames": []}
            frames = anim.get("frames") or []
            if len(frames) > MAX_FRAMES_PER_ANIM:
                raise SpriteError(f"{swhere}: an animation has {len(frames)} frames; the most is "
                                  f"{MAX_FRAMES_PER_ANIM}.")
            idx = [frame_for(f, mirrored, f"{swhere}, animation {ai + 1}, frame {n + 1}")
                   for n, f in enumerate(frames)]
            speed = anim.get("speed") or sheet["animSpeed"]
            speed = _int(speed, "speed", swhere, 1, 255)
            anim_index[key] = len(cs.anims)
            cs.anims.append((idx, speed))
            return anim_index[key]

        slots = []
        for moving in (0, 1):
            for direction in range(4):
                ai, mirrored = mapping[GB_INDEX_FOR_DIRECTION[direction] + 4 * moving]
                slots.append(engine_anim(ai, mirrored))
        # Extra slots (entity.h's ENTITY_SLOT_*): wall slide right/left,
        # wall kick right/left. Platformer states have their own
        # animations 8-11 (left mirrors right with flipLeft); empty ones,
        # and other types, show the jump (idle up/down slots).
        is_platform = st.get("animationType") == "platform_player"
        flip = bool(st.get("flipLeft", True))

        def has_frames(ai):
            return 0 <= ai < len(anims) and any(f.get("tiles") for f in (anims[ai].get("frames") or []))

        for right_ai, left_ai in ((8, 9), (10, 11)):
            if is_platform and has_frames(right_ai):
                slots.append(engine_anim(right_ai, False))
                slots.append(engine_anim(right_ai, True) if flip else
                             engine_anim(left_ai if has_frames(left_ai) else right_ai, not has_frames(left_ai)))
            else:
                slots.append(slots[1])   # idle up = jump right for platform_player
                slots.append(slots[0])   # idle down = jump left
        cs.state_maps.append(slots)

    if len(cs.anims) > 255:
        raise SpriteError(f"{where}: {len(cs.anims)} animations after mirroring; the most is 255.")
    return cs


# ---------------------------------------------------------------------------
# C output
# ---------------------------------------------------------------------------

def _bytes_c(values, per_line=16):
    return ",\n".join("    " + ", ".join(f"0x{v:02X}" for v in values[i:i + per_line])
                      for i in range(0, len(values), per_line))


# Animation state names the scene types use when a sprite has them, in
# engine/include/modes.h's MODE_ANIM_* order.
MODE_ANIM_NAMES = ["jump", "fall", "climb", "run", "dash", "wall_slide", "float",
                   "knockback", "crouch", "hover", "push"]


def emit_sprite(cs, ident, source_name):
    """C definitions for one CompiledSprite. Returns (code, SpriteDef
    initializer)."""
    out = [f"/* sprite: {source_name} - {len(cs.frames)} frame(s), up to {cs.max_objs} OBJ(s) "
           f"/ {cs.max_vram} VRAM tile(s) per frame */"]
    for i, data in enumerate(cs.tile_data):
        if data:
            out.append(f"static const uint8_t {ident}_tiles{i}[{len(data)}] __attribute__((aligned(4))) = {{\n"
                       f"{_bytes_c(list(data))}\n}};")
    for fi, (objs, _di) in enumerate(cs.frames):
        if objs:
            rows = [f"    {{ {o['dx']}, {o['dy']}, {o['offset']}, 0x{o['attr0']:04X}, 0x{o['attr1']:04X}, "
                    f"{o['w']}, {o['h']}, {1 if o['behind'] else 0} }}," for o in objs]
            out.append(f"static const ASpriteObj {ident}_objs{fi}[{len(objs)}] = {{\n" + "\n".join(rows) + "\n};")
    frames = []
    for fi, (objs, di) in enumerate(cs.frames):
        data = cs.tile_data[di]
        if objs:
            frames.append(f"    {{ {ident}_objs{fi}, {len(objs)}, {ident}_tiles{di}, {len(data) // 32} }},")
        else:
            frames.append("    { 0, 0, 0, 0 },")
    if frames:
        out.append(f"static const ASpriteFrame {ident}_frames[{len(frames)}] = {{\n" + "\n".join(frames) + "\n};")
    for ai, (idx, _speed) in enumerate(cs.anims):
        if idx:
            out.append(f"static const uint16_t {ident}_anim{ai}[{len(idx)}] = {{ {', '.join(map(str, idx))} }};")
    anims = [f"    {{ {ident}_anim{ai}, {len(idx)}, {speed} }}," if idx else f"    {{ 0, 0, {speed} }},"
             for ai, (idx, speed) in enumerate(cs.anims)]
    out.append(f"static const EntityAnimation {ident}_anims[{len(anims)}] = {{\n" + "\n".join(anims) + "\n};")
    maps = [v for m in cs.state_maps for v in m]
    out.append(f"static const uint8_t {ident}_maps[{len(maps)}] = {{ {', '.join(map(str, maps))} }};")
    out.append(f"static const uint16_t {ident}_palette[16] = {{ "
               + ", ".join(f"0x{v:04X}" for v in cs.palette) + " };")
    # States the scene types look for by name (modes.h MODE_ANIM_*).
    by_name = {n.strip().lower(): i for n, i in cs.state_names.items() if n}
    named = [by_name.get(n, -1) + 1 for n in MODE_ANIM_NAMES]
    states_ref = "0"
    if any(named):
        states_ref = f"{ident}_mode_states"
        out.append(f"static const uint8_t {states_ref}[{len(named)}] = {{ {', '.join(map(str, named))} }};")
    platform_mask = sum(1 << i for i, t in enumerate(cs.state_types) if t == "platform_player" and i < 32)
    cursor_mask = sum(1 << i for i, t in enumerate(cs.state_types) if t == "cursor" and i < 32)
    bx, by, bw, bh = cs.bounds
    init = (f"{{ {ident + '_frames' if frames else '0'}, {len(cs.frames)}, {cs.max_objs}, {cs.max_vram}, "
            f"{ident}_anims, {len(cs.anims)}, {ident}_maps, {len(cs.state_maps)}, "
            f"{bx}, {by}, {bw}, {bh}, {ident}_palette, {states_ref}, 0x{platform_mask:X}u, 0x{cursor_mask:X}u }}")
    return "\n\n".join(out), init
