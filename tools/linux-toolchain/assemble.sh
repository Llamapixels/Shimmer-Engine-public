#!/usr/bin/env bash
# Builds the devkitPro-shaped toolchain the Linux release bundles.
#
# devkitPro's Linux GCC needs glibc 2.36+ (it calls arc4random), so it
# won't run on Ubuntu 22.04-based distros (Zorin 17, Mint 21, Pop 22.04).
# Arm's own arm-none-eabi GCC runs on glibc 2.28+, so the Linux release
# uses it, plus devkitPro's GBA pieces: gba.specs / gba_cart.ld /
# gba_crt0.o, libgba and gbafix. gba_shim.c stands in for the bit of
# devkitPro's libsysbase that gba_crt0.o needs.
#
#   assemble.sh <devkitpro dir> <arm toolchain dir> <out dir>
#
# <out dir> then has the same layout build_rom.py expects of devkitPro
# (devkitARM/, libgba/, tools/bin/gbafix) and goes to stage_toolchain.py.
set -euo pipefail

DKP=$1
ARM=$2
OUT=$3
HERE=$(cd "$(dirname "$0")" && pwd)

rm -rf "$OUT"
mkdir -p "$OUT"
cp -a "$ARM" "$OUT/devkitARM"
A="$OUT/devkitARM"
GCCVER=$(ls "$A/lib/gcc/arm-none-eabi")
DKP_GCC=$(ls -d "$DKP"/devkitARM/lib/gcc/arm-none-eabi/* | head -1)

# Keep only the libraries a GBA build uses: the default (ARMv4T) set and
# thumb/nofp (what -mthumb -mcpu=arm7tdmi picks). The rest are for
# Cortex-M/A CPUs and would add hundreds of MB.
for base in "$A/arm-none-eabi/lib" "$A/lib/gcc/arm-none-eabi/$GCCVER"; do
  rm -rf "$base/arm"
  find "$base/thumb" -mindepth 1 -maxdepth 1 ! -name nofp -exec rm -rf {} +
done

L="$A/arm-none-eabi/lib"
G="$A/lib/gcc/arm-none-eabi/$GCCVER"
cp "$DKP/devkitARM/arm-none-eabi/lib/"{gba.specs,gba_cart.ld,gba_crt0.o} "$L/"
cp "$DKP_GCC/sync-none.specs" "$G/"
mkdir -p "$G/thumb/nofp"
cp "$DKP_GCC/thumb/sync-none.specs" "$G/thumb/nofp/"

"$A/bin/arm-none-eabi-gcc" -O2 -mthumb -mthumb-interwork -mcpu=arm7tdmi \
  -c "$HERE/gba_shim.c" -o "$L/gba_shim.o"
sed -i 's|^gba_crt0%O%s crti%O%s|gba_crt0%O%s gba_shim%O%s crti%O%s|' "$L/gba.specs"
grep -q gba_shim "$L/gba.specs"

cp -a "$DKP/libgba" "$OUT/"
mkdir -p "$OUT/tools/bin"
cp "$DKP/tools/bin/gbafix" "$OUT/tools/bin/"

echo "Assembled $OUT (Arm GCC $GCCVER + devkitPro GBA files)"
