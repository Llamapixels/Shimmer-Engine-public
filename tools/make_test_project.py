"""
Write a tiny throwaway project (one scene, a plain background, a line of
dialogue) for smoke-testing a build without keeping example projects in
the repo:

    python tools/make_test_project.py <folder> [--font "Sky Blue"]

Then build it with `python compiler/build_rom.py <folder>`.
"""

import argparse
import json
from pathlib import Path

from PIL import Image


def main():
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("folder")
    ap.add_argument("--font", help="start with this font (e.g. one of the built-in ones)")
    args = ap.parse_args()

    root = Path(args.folder)
    (root / "scenes").mkdir(parents=True, exist_ok=True)
    (root / "assets" / "backgrounds").mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (240, 160), (90, 158, 90)).save(root / "assets" / "backgrounds" / "start.png")

    project = {"name": "Test", "start_scene": "start"}
    if args.font:
        project["ui"] = {"font": args.font}
    (root / "project.json").write_text(json.dumps(project, indent=2) + "\n", encoding="utf-8")

    scene = {
        "name": "start",
        "background": "../assets/backgrounds/start.png",
        "player_start": {"x": 14, "y": 9},
        "on_init": [{"type": "text", "text": "It builds!"}],
    }
    (root / "scenes" / "start.json").write_text(json.dumps(scene, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote a test project to {root}")


if __name__ == "__main__":
    main()
