# Shimmer Engine

Make Game Boy Advance games without writing code. Draw your maps and sprites, place
characters, script events with blocks, write music, add video cutscenes, and build a real
`.gba` ROM.

Inspired by GB Studio. Early alpha.

- Downloads: https://holocatt.itch.io/shimmerengine
- Community: https://www.reddit.com/r/ShimmerEngine/
- Wiki: https://llamapixels.github.io/Shimmer-Engine-public/
- How it's put together: [ARCHITECTURE.md](ARCHITECTURE.md)
- What's new: [DEVLOG.md](DEVLOG.md)

## Building from source

Editor (Node 20):

```
cd editor
npm ci
npm run dev
```

A ROM from the command line (needs devkitARM, from `$DEVKITPRO` or `/opt/devkitpro`):

```
python3 compiler/build_rom.py <project folder>
```

`npm run dist` in `editor/` packages an installer.

## Credits

Made by HoloCatt.

## License

GPL-3.0. See [LICENSE](LICENSE).
