/**
 * Starting the emulator for Play, per OS.
 *
 * What the user picks with File > Emulator for Play can be:
 *   - Windows: a program (.exe)
 *   - macOS:   an application bundle (.app), started with `open -a`
 *   - Linux:   a program (/usr/bin/mgba-qt, an AppImage, a Flatpak's
 *              exported launcher) or an app shortcut (.desktop file, as
 *              found in /usr/share/applications), whose Exec= line is run
 */
import { readFileSync } from "node:fs";

export interface EmulatorCommand {
  cmd: string;
  args: string[];
}

/** Split a .desktop Exec= value into arguments (quotes and backslash
 * escapes as in the Desktop Entry spec). */
export function splitExec(exec: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  let started = false;
  for (let i = 0; i < exec.length; i++) {
    const c = exec[i];
    if (inQuote) {
      if (c === "\\" && i + 1 < exec.length) cur += exec[++i];
      else if (c === '"') inQuote = false;
      else cur += c;
    } else if (c === '"') {
      inQuote = true;
      started = true;
    } else if (c === " " || c === "\t") {
      if (started) out.push(cur);
      cur = "";
      started = false;
    } else {
      cur += c;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

/** The command a .desktop file's Exec= line runs, with the ROM put where
 * its file placeholder (%f/%F/%u/%U) is, or at the end. */
export function desktopCommand(desktopText: string, rom: string): EmulatorCommand | null {
  // Only the main [Desktop Entry] group, not [Desktop Action ...] ones.
  let inMain = false;
  let exec: string | null = null;
  for (const raw of desktopText.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) inMain = line === "[Desktop Entry]";
    else if (inMain && line.startsWith("Exec=") && exec === null) exec = line.slice(5);
  }
  if (!exec) return null;
  const words = splitExec(exec);
  const args: string[] = [];
  let placed = false;
  for (const w of words) {
    if (/^%[fFuU]$/.test(w)) {
      if (!placed) args.push(rom);
      placed = true;
    } else if (/^%[ick]$/.test(w)) {
      // Icon/name/location codes. (Flatpak's "@@ %f @@" markers stay:
      // they give the sandboxed emulator access to the ROM.)
      continue;
    } else {
      args.push(w.replace(/%%/g, "%"));
    }
  }
  if (!placed) args.push(rom);
  const [cmd, ...rest] = args;
  return cmd ? { cmd, args: rest } : null;
}

/** How to start `emulator` (a path the user picked) on `rom`. */
export function emulatorCommand(emulator: string, rom: string): EmulatorCommand | null {
  if (process.platform === "darwin" && emulator.endsWith(".app")) {
    return { cmd: "open", args: ["-n", "-a", emulator, "--args", rom] };
  }
  if (emulator.endsWith(".desktop")) {
    try {
      return desktopCommand(readFileSync(emulator, "utf-8"), rom);
    } catch {
      return null;
    }
  }
  return { cmd: emulator, args: [rom] };
}

/** Where the Select Emulator dialog starts, and what it lists. */
export function chooserOptions(): { defaultPath?: string; filters: { name: string; extensions: string[] }[] } {
  if (process.platform === "win32") return { filters: [{ name: "Programs", extensions: ["exe"] }] };
  if (process.platform === "darwin") return { defaultPath: "/Applications", filters: [{ name: "Applications", extensions: ["app"] }] };
  return { defaultPath: "/usr/bin", filters: [{ name: "Programs and app shortcuts", extensions: ["*"] }] };
}

/** Advice when no emulator could be started. */
export function installHint(): string {
  if (process.platform === "linux") {
    return "Install a GBA emulator (for example from your Software Manager), then pick it with File > Emulator for Play > Select Emulator: a program (like those in /usr/bin), or its shortcut in /usr/share/applications.";
  }
  if (process.platform === "darwin") {
    return "Install a GBA emulator into Applications, then pick its .app with File > Emulator for Play > Select Emulator.";
  }
  return "Install a GBA emulator, then pick its .exe with File > Emulator for Play > Select Emulator.";
}
