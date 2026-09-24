#!/usr/bin/env bash
# Build a Shimmer Engine project into a .gba
#
#   ./build.sh                 builds examples/demo
#   ./build.sh path/to/project
#
# Run from ~/advance-build (the space-free mount of this folder).

set -e
cd "$(dirname "$0")"

PROJECT="${1:-examples/demo}"

if [ -x .venv/bin/python ]; then
    PY=.venv/bin/python
else
    PY=python3
fi

"$PY" compiler/build_project.py "$PROJECT"

make -C engine

ROM_NAME="$(basename "$PROJECT")"
mkdir -p "$PROJECT/ROM"
cp engine/engine.gba "$PROJECT/ROM/$ROM_NAME.gba"
cp -f engine/engine.elf "$PROJECT/ROM/$ROM_NAME.elf" 2>/dev/null || true

echo
echo "ROM: $(pwd)/$PROJECT/ROM/$ROM_NAME.gba"
