"""
Assemble editor/toolchain-bundle/ - what the installer ships as
resources/toolchain:

    toolchain-bundle/
        shimmer-build(.exe)   compiler/build_rom.py frozen with PyInstaller
        engine/               engine sources, headers and static data
        devkitpro/            the parts of devkitARM, libgba and gbafix a
                              GBA C build needs (C only, ARM7TDMI only)

    python editor/scripts/stage_toolchain.py --builder dist/shimmer-build.exe \\
        --devkitpro C:/msys64/opt/devkitpro

Everything else in devkitPro (C++, the debugger, docs, other CPUs'
libraries) is left out to keep the download small.
"""

import argparse
import re
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

# devkitARM/bin: only what gcc needs to compile and link C.
BIN_KEEP = re.compile(r"^arm-none-eabi-(gcc(-[\d.]+)?|cpp|as|ld|ld\.bfd|objcopy|ar)(\.exe)?$")
# libexec compilers we don't use.
LIBEXEC_SKIP = re.compile(r"^(cc1obj|cc1plus|lto1|g\+\+-mapper-server)(\.exe)?$")
# Library variants for other CPUs / big-endian, docs, GCC plugins, C++.
DIR_SKIP = {"share", "plugin", "be", "armv6k", "v6-m", "c++", "man", "info", "doc"}
FILE_SKIP = re.compile(r"^(libstdc\+\+|libsupc\+\+).*")


def copy_tree(src: Path, dst: Path, keep=lambda p: True):
    for p in sorted(src.rglob("*")):
        rel = p.relative_to(src)
        if any(part in DIR_SKIP for part in rel.parts):
            continue
        if not keep(p):
            continue
        out = dst / rel
        if p.is_dir():
            out.mkdir(parents=True, exist_ok=True)
        elif p.is_file():
            if FILE_SKIP.match(p.name):
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(p, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--builder", type=Path, required=True, help="the frozen build_rom executable")
    ap.add_argument("--devkitpro", type=Path, required=True)
    ap.add_argument("--out", type=Path, default=REPO / "editor" / "toolchain-bundle")
    args = ap.parse_args()

    out = args.out
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    # Build tool.
    shutil.copy2(args.builder, out / ("shimmer-build" + args.builder.suffix))

    # Engine: sources, headers and the static data files (never generated ones).
    engine = out / "engine"
    shutil.copytree(REPO / "engine" / "source", engine / "source", ignore=shutil.ignore_patterns("*.save"))
    shutil.copytree(REPO / "engine" / "include", engine / "include")
    (engine / "data").mkdir()
    shutil.copy2(REPO / "engine" / "data" / "player.png", engine / "data" / "player.png")
    shutil.copytree(REPO / "engine" / "data" / "ui", engine / "data" / "ui")
    # findEngineRoot() looks for engine/source in the bundled toolchain.

    # devkitPro subset.
    dkp = args.devkitpro
    arm = dkp / "devkitARM"

    def keep(p: Path) -> bool:
        rel = p.relative_to(arm).parts
        if p.is_file() and p.suffix.lower() == ".dll":
            return True  # Windows builds' runtime libraries
        if rel[0] == "bin" and p.is_file():
            return bool(BIN_KEEP.match(p.name))
        if rel[0] == "libexec" and p.is_file():
            return not LIBEXEC_SKIP.match(p.name)
        if rel[0] == "arm-none-eabi" and len(rel) > 1 and rel[1] == "bin" and p.is_file():
            return bool(re.match(r"^(as|ld|ld\.bfd|objcopy|ar)(\.exe)?$", p.name))
        return True

    copy_tree(arm, out / "devkitpro" / "devkitARM", keep)
    for sub in ("include", "lib"):
        shutil.copytree(dkp / "libgba" / sub, out / "devkitpro" / "libgba" / sub)
    tools = out / "devkitpro" / "tools" / "bin"
    tools.mkdir(parents=True)
    for p in (dkp / "tools" / "bin").iterdir():
        if p.stem == "gbafix":
            shutil.copy2(p, tools / p.name)
    # Windows builds of devkitPro's tools may need DLLs next to them.
    for p in (dkp / "tools" / "bin").glob("*.dll"):
        shutil.copy2(p, tools / p.name)

    (out / "LICENSES.txt").write_text(
        "devkitARM (GCC, binutils, newlib) and libgba are made by devkitPro (https://devkitpro.org)\n"
        "and are distributed under their own licenses (GPL / LGPL / BSD-style for newlib and libgba).\n"
        "Their sources are available from https://github.com/devkitPro.\n",
        encoding="utf-8",
    )

    size = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"Staged {out} ({size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
