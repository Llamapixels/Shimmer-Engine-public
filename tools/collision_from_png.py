"""
Paint collision in any image editor, then import it into a scene.

    python tools/collision_from_png.py examples/demo/scenes/town.json town_collision.png

The collision image can be either:
  * the same size as the background (e.g. 512x512) - each 8x8 cell
    becomes whatever color covers most of it, or
  * one pixel per tile (e.g. 64x64 for a 512x512 background).

Colors (closest match wins):
    transparent / white  ->  .  walkable
    black                ->  #  solid
    blue                 ->  ~  water
    red                  ->  !  damage

Tip: in Aseprite/Photoshop, add a layer over the background, paint
blocks on it, hide the background, and export just that layer.

This is the stand-in for painting collision in the editor. The result
goes into the scene JSON's "collision" grid, which is the same data the
editor will write later.
"""

from pathlib import Path
import json
import sys

from PIL import Image


TILE = 8

PALETTE = [
    ((255, 255, 255), "."),
    ((0, 0, 0), "#"),
    ((0, 0, 255), "~"),
    ((255, 0, 0), "!"),
]


def classify(pixel):
    r, g, b, a = pixel
    if a < 128:
        return "."
    best = min(
        PALETTE,
        key=lambda p: (p[0][0] - r) ** 2 + (p[0][1] - g) ** 2 + (p[0][2] - b) ** 2)
    return best[1]


def main():
    if len(sys.argv) != 3:
        print("Usage: python tools/collision_from_png.py scene.json collision.png")
        return 1

    scene_path = Path(sys.argv[1])
    image_path = Path(sys.argv[2])

    scene = json.loads(scene_path.read_text(encoding="utf-8"))

    bg = Image.open((scene_path.parent / scene["background"]).resolve())
    w_tiles = bg.width // TILE
    h_tiles = bg.height // TILE

    img = Image.open(image_path).convert("RGBA")

    if img.size == (w_tiles, h_tiles):
        cell = 1
    elif img.size == bg.size:
        cell = TILE
    else:
        print(f"ERROR: {image_path.name} is {img.width}x{img.height}. "
              f"Expected {bg.width}x{bg.height} (same as background) "
              f"or {w_tiles}x{h_tiles} (one pixel per tile).")
        return 1

    rows = []
    for ty in range(h_tiles):
        row = []
        for tx in range(w_tiles):
            counts = {}
            for y in range(cell):
                for x in range(cell):
                    c = classify(img.getpixel((tx * cell + x, ty * cell + y)))
                    counts[c] = counts.get(c, 0) + 1
            row.append(max(counts, key=counts.get))
        rows.append("".join(row))

    scene["collision"] = rows
    scene_path.write_text(json.dumps(scene, indent=2) + "\n", encoding="utf-8")

    total = {}
    for r in rows:
        for ch in r:
            total[ch] = total.get(ch, 0) + 1
    print(f"Updated {scene_path}: " +
          ", ".join(f"'{k}' x{v}" for k, v in sorted(total.items())))
    return 0


if __name__ == "__main__":
    sys.exit(main())
