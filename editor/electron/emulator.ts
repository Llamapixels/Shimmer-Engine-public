/**
 * Finding and starting the emulator for Play, per OS.
 *
 * What the user picks with File > Emulator for Play can be:
 *   - Windows: a program (.exe)
 *   - macOS:   an application bundle (.app), started with `open -a`
 *   - Linux:   a program (/usr/bin/mgba-qt, an AppImage, a Flatpak's
 *              exported launcher) or an app shortcut (.desktop file, as
 *              found in /usr/share/applications), whose Exec= line is run
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}

/** mGBA wherever it's usually installed on this OS, or null. */
export function findMgba(): string | null {
  const home = os.homedir();
  const candidates: (string | null)[] = [];
  if (process.platform === "win32") {
    const pf = process.env.ProgramFiles ?? "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";
    const local = process.env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
    candidates.push(
      path.join(pf, "mGBA", "mGBA.exe"),
      path.join(pf86, "mGBA", "mGBA.exe"),
      path.join(local, "Programs", "mGBA", "mGBA.exe"),
      onPath("mGBA.exe"),
    );
  } else if (process.platform === "darwin") {
    candidates.push("/Applications/mGBA.app", path.join(home, "Applications", "mGBA.app"));
  } else {
    candidates.push(
      onPath("mgba-qt"),
      onPath("mgba"),
      // Flatpak (what Linux Mint's Software Manager often installs).
      "/var/lib/flatpak/exports/bin/io.mgba.mGBA",
      path.join(home, ".local", "share", "flatpak", "exports", "bin", "io.mgba.mGBA"),
      // Snap.
      "/snap/bin/mgba",
    );
  }
  for (const c of candidates) if (c && existsSync(c)) return c;
  return null;
}

/** Where the Choose Emulator dialog starts, and what it lists. */
export function chooserOptions(): { defaultPath?: string; filters: { name: string; extensions: string[] }[] } {
  if (process.platform === "win32") return { filters: [{ name: "Programs", extensions: ["exe"] }] };
  if (process.platform === "darwin") return { defaultPath: "/Applications", filters: [{ name: "Applications", extensions: ["app"] }] };
  return { defaultPath: "/usr/bin", filters: [{ name: "Programs and app shortcuts", extensions: ["*"] }] };
}

/** Advice when no emulator could be started. */
export function installHint(): string {
  if (process.platform === "linux") {
    return "Install mGBA (for example from your Software Manager), then pick it with File > Emulator for Play: the program is usually /usr/bin/mgba-qt, or /var/lib/flatpak/exports/bin/io.mgba.mGBA for the Flatpak. Its shortcut in /usr/share/applications works too. Or use File > Emulator for Play > Find mGBA.";
  }
  if (process.platform === "darwin") {
    return "Install mGBA (mgba.io) into Applications, then pick mGBA.app with File > Emulator for Play, or use Find mGBA.";
  }
  return "Install a GBA emulator such as mGBA and set it as the program for .gba files, or pick its .exe with File > Emulator for Play.";
}
