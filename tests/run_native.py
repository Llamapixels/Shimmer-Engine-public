"""Run collision regressions against the engine sources using a host GCC.

Usage: python tests/run_native.py --cc C:/msys64/mingw64/bin/gcc.exe
The GBA hardware entry point is removed by whole-program optimization;
only hardware and script-dispatch dependencies are stubbed in the harness.
"""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import json
import copy

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cc", default="gcc")
    args = parser.parse_args()
    cc = shutil.which(args.cc)
    if not cc:
        parser.error(f"Host C compiler not found: {args.cc}")
    env = os.environ.copy()
    env["PATH"] = str(Path(cc).parent) + os.pathsep + env.get("PATH", "")
    build = ROOT / "tests" / "build"
    build.mkdir(exist_ok=True)
    sys.path.insert(0, str(ROOT / "compiler"))
    import modes
    settings = build / "mode_settings.h"
    settings.write_text(modes.header(), encoding="utf-8")
    import build_project
    project = build / "compiled" / "project"
    shutil.copytree(ROOT / "tests/fixtures/hit_detection/assets", project / "assets", dirs_exist_ok=True)
    shutil.copytree(ROOT / "tests/fixtures/hit_detection/scenes", project / "scenes", dirs_exist_ok=True)
    shutil.copyfile(ROOT / "tests/fixtures/hit_detection/project.json", project / "project.json")
    import sprites
    from PIL import Image
    sprite_dir = project / "assets/sprites"
    sprite_dir.mkdir(exist_ok=True)
    sheets = []
    for name, names in (("player", ["", "attack", "run"]),
                        ("alternate", ["", "run", "attack", "guard", 'pose "é"\\x'])):
        Image.new("RGBA", (16, 16), (220, 60, 60, 255)).save(sprite_dir / f"{name}.png")
        sheet = sprites.default_sheet(name, 16, 16)
        base = sheet["states"][0]
        sheet["states"] = []
        for index, state_name in enumerate(names):
            state = copy.deepcopy(base)
            state.update({"id": f"{name}_{index}", "name": state_name})
            sheet["states"].append(state)
        sheets.append(sheet)
    config_path = project / "project.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    config["spriteSheets"] = sheets
    config["customScripts"] = [
        {"id": "set_attack", "name": "Set attack", "params": [{"name": "actorA", "kind": "actor"}],
         "script": [{"type": "actor_set_state", "actor": "@actorA", "state": "attack"}]},
        {"id": "nested_attack", "name": "Nested attack", "params": [{"name": "target", "kind": "actor"}],
         "script": [{"type": "call_script", "script": "set_attack", "args": {"actorA": {"actor": "@target"}}}]},
        {"id": "player_guard", "name": "Player guard",
         "script": [{"type": "actor_set_state", "actor": "player", "state": "guard"}]},
    ]
    config["prefabs"] = [{"id": "coin", "name": "Coin", "kind": "npc", "template": {
        "collision_group": 5, "collect_on_touch": False,
        "on_interact": [{"type": "actor_collect", "actor": "self"}],
        "on_collect": [{"type": "add_var", "var": "actor_hits", "delta": 1},
                       {"type": "actor_remove", "actor": "self"}],
    }}]
    config_path.write_text(json.dumps(config), encoding="utf-8")
    scene_path = project / "scenes/start.json"
    scene = json.loads(scene_path.read_text(encoding="utf-8"))
    scene["npcs"][0].update({"collision_group": 4, "on_hit_1": [],
        "on_hit_4": [{"type": "actor_hide", "actor": "self"}],
        "on_player_hit": [{"type": "actor_show", "actor": "self"}], "player_hit_enabled": False,
        "hit_1_enabled": False, "hit_4_enabled": False})
    scene["npcs"][1]["on_player_hit"] = []
    scene["npcs"][1]["sprite"] = "alternate"
    scene["npcs"][0]["on_init"] = [{"type": "call_script", "script": "set_attack",
        "args": {"actorA": {"actor": "self"}}}]
    scene["on_player_hit"]["4"] = [{"type": "wait", "frames": 4}]
    scene["on_init"].append({"type": "actor_set_hit_response", "actor": "solid",
        "response": "group4", "enabled": True})
    scene["on_init"].append({"type": "launch_projectile", "sprite": "player",
        "actor": "player", "group": 4, "hits": "group4"})
    scene["npcs"].append({"name": "drop_enemy", "x": 16, "y": 9,
        "collision_group": 2, "solid": True, "collisions": True, "interact_enabled": True,
        "on_interact": [{"type": "wait", "frames": 1}],
        "on_hit_4": [{"type": "actor_set_collision_group", "actor": "self", "group": "pickup"}],
        "on_collect": [{"type": "add_var", "var": "actor_hits", "delta": 10},
                       {"type": "actor_remove", "actor": "self"}]})
    scene["on_init"].extend([
        {"type": "actor_set_solid", "actor": "drop_enemy", "enabled": False},
        {"type": "actor_set_interaction", "actor": "drop_enemy", "enabled": False},
    ])
    scene["on_init"].extend([
        {"type": "call_script", "script": "set_attack", "args": {"actorA": {"actor": "solid"}}},
        {"type": "call_script", "script": "nested_attack", "args": {"target": {"actor": "ghost"}}},
        {"type": "player_set_sprite", "sprite": "alternate"},
        {"type": "call_script", "script": "player_guard"},
        {"type": "call_script", "script": "set_attack", "args": {"actorA": {"actor": "player"}}},
        {"type": "actor_set_state", "actor": "player", "state": 'pose "é"\\x'},
        {"type": "actor_set_state", "actor": "player", "state": "Default"},
        {"type": "spawn_prefab", "prefab": "coin", "max": 1, "at": "tile", "x": 4, "y": 5},
    ])
    scene_path.write_text(json.dumps(scene), encoding="utf-8")
    platform = {"name": "zz_platform", "type": "platform", "background": scene["background"],
        "on_init": [{"type": "call_script", "script": "set_attack", "args": {"actorA": {"actor": 0}}}],
        "player_start": {"x": 2, "y": 2}, "npcs": [
            {"x": 4, "y": 4},
            {"x": 6, "y": 4, "platform": True},
            {"x": 8, "y": 4, "solid": True},
            {"x": 10, "y": 4, "platform": True, "solid": False},
            {"x": 12, "y": 4, "collisions": False, "interact_enabled": False},
            {"x": 14, "y": 4, "collision_group": 5,
             "on_collect": [{"type": "wait", "frames": 1}]},
        ]}
    (project / "scenes/zz_platform.json").write_text(json.dumps(platform), encoding="utf-8")
    build_project.build(project, build / "compiled/data")
    for name in ("test_hits", "test_interaction", "test_compiled_hits", "test_entity_collisions"):
        output = build / (name + (".exe" if os.name == "nt" else ""))
        subprocess.run([
            cc, "-std=c99", "-O2", "-flto", "-fwhole-program",
            "-ffunction-sections", "-fdata-sections",
            "-include", str(settings),
            "-I", str(build), "-I", str(build / "compiled/data"),
            "-I", "tests/native", "-I", "engine/include", "-I", "engine/data",
            f"tests/native/{name}.c", "-Wl,--gc-sections", "-o", str(output),
        ], cwd=ROOT, env=env, check=True)
        subprocess.run([str(output)], cwd=ROOT, env=env, check=True)


if __name__ == "__main__":
    main()
