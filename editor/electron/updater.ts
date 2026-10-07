/**
 * Check for Updates: compares this version with the newest GitHub release
 * and, if the user agrees, downloads that release's installer for this OS
 * and starts it:
 *   - Windows: runs the Setup .exe (it installs and reopens the app)
 *   - Linux:   an AppImage replaces the running one and restarts; for the
 *              .deb install, the package opens in the software installer
 *   - macOS:   opens the .dmg to drag the new app into Applications
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { chmod, rename, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { app, dialog, shell, type BrowserWindow } from "electron";

const RELEASES_API = "https://api.github.com/repos/Llamapixels/Shimmer-Engine-public/releases?per_page=20";

interface Asset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface Release {
  tag_name: string;
  name: string | null;
  body: string | null;
  draft: boolean;
  html_url: string;
  assets: Asset[];
}

/** -1, 0 or 1. "0.4.1-alpha" style: numbers first, then a version
 * without a suffix is newer than one with ("1.0.0" > "1.0.0-beta"). */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [main, ...pre] = v.replace(/^v/i, "").split("-");
    return { nums: main.split(".").map((n) => parseInt(n, 10) || 0), pre: pre.join("-") };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  const xp = x.pre.split(".");
  const yp = y.pre.split(".");
  for (let i = 0; i < Math.max(xp.length, yp.length); i++) {
    if (xp[i] === undefined) return -1;
    if (yp[i] === undefined) return 1;
    const xn = Number(xp[i]);
    const yn = Number(yp[i]);
    const c = !isNaN(xn) && !isNaN(yn) ? xn - yn : xp[i].localeCompare(yp[i]);
    if (c) return c > 0 ? 1 : -1;
  }
  return 0;
}

/** The installer in `assets` for this computer, or null. */
export function pickAsset(assets: Asset[]): Asset | null {
  const find = (ext: string) => assets.find((a) => a.name.toLowerCase().endsWith(ext)) ?? null;
  if (process.platform === "win32") return find(".exe");
  if (process.platform === "darwin") return find(".dmg");
  return process.env.APPIMAGE ? find(".appimage") : find(".deb") ?? find(".appimage");
}

async function newestRelease(): Promise<Release | null> {
  const res = await fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}.`);
  const list = (await res.json()) as Release[];
  let best: Release | null = null;
  for (const r of list) if (!r.draft && (!best || compareVersions(r.tag_name, best.tag_name) > 0)) best = r;
  return best;
}

async function download(asset: Asset, to: string, win: BrowserWindow | null): Promise<void> {
  const res = await fetch(asset.browser_download_url);
  if (!res.ok || !res.body) throw new Error(`The download failed (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || asset.size || 0;
  let got = 0;
  const body = Readable.fromWeb(res.body as never);
  body.on("data", (chunk: Buffer) => {
    got += chunk.length;
    if (total && win && !win.isDestroyed()) {
      win.setProgressBar(got / total);
      win.setTitle(`Shimmer Engine - downloading update ${Math.floor((got / total) * 100)}%`);
    }
  });
  try {
    await pipeline(body, createWriteStream(to));
  } finally {
    if (win && !win.isDestroyed()) {
      win.setProgressBar(-1);
      win.setTitle("Shimmer Engine");
    }
  }
}

/** Starts the downloaded installer; true if the app should quit now. */
async function install(file: string, win: BrowserWindow | null): Promise<boolean> {
  if (process.platform === "win32") {
    spawn(file, [], { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  if (process.platform === "linux" && process.env.APPIMAGE && file.toLowerCase().endsWith(".appimage")) {
    const current = process.env.APPIMAGE;
    await chmod(file, 0o755);
    const next = path.join(path.dirname(current), `.${path.basename(current)}.new`);
    await rename(file, next).catch(async () => {
      // Different drive: copy through a stream instead.
      const { copyFile } = await import("node:fs/promises");
      await copyFile(file, next);
      await chmod(next, 0o755);
      await unlink(file).catch(() => {});
    });
    await rename(next, current);
    spawn(current, [], { detached: true, stdio: "ignore" }).unref();
    return true;
  }
  const err = await shell.openPath(file);
  if (err) throw new Error(`Couldn't open the installer (${err}). It was saved to ${file}`);
  if (win && !win.isDestroyed())
    await dialog.showMessageBox(win, {
      type: "info",
      message: process.platform === "darwin" ? "Drag Shimmer Engine into Applications" : "Finish installing",
      detail:
        process.platform === "darwin"
          ? "Replace the old Shimmer Engine in Applications with the one in the window that opened, then start it again."
          : "Install the package in the window that opened, then start Shimmer Engine again.",
    });
  return true;
}

let busy = false;

/** Help/Community > Check for Updates. `beforeQuit` saves open work. */
export async function checkForUpdates(win: BrowserWindow | null, beforeQuit: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  const show = (opts: Electron.MessageBoxOptions) => (win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts));
  try {
    const current = app.getVersion();
    const release = await newestRelease();
    if (!release || compareVersions(release.tag_name, current) <= 0) {
      await show({ type: "info", message: "Shimmer Engine is up to date.", detail: `You have version ${current}.` });
      return;
    }
    const version = release.tag_name.replace(/^v/i, "");
    const asset = pickAsset(release.assets);
    if (!asset) {
      const r = await show({
        type: "info",
        message: `Version ${version} is out (you have ${current}).`,
        detail: "There's no installer for this computer in that release yet.",
        buttons: ["Open the release page", "Close"],
        cancelId: 1,
      });
      if (r.response === 0) void shell.openExternal(release.html_url);
      return;
    }
    const notes = (release.body ?? "").trim();
    const r = await show({
      type: "question",
      message: `Version ${version} is available (you have ${current}).`,
      detail:
        (notes ? `${notes.length > 600 ? notes.slice(0, 600) + "…" : notes}\n\n` : "") +
        `Download and install it now? (${(asset.size / 1048576).toFixed(0)} MB) Your project is saved first.`,
      buttons: ["Download and Install", "Not Now"],
      defaultId: 0,
      cancelId: 1,
    });
    if (r.response !== 0) return;
    const file = path.join(os.tmpdir(), asset.name);
    await download(asset, file, win);
    await beforeQuit();
    if (await install(file, win)) app.quit();
  } catch (e) {
    await show({
      type: "error",
      message: "Couldn't check for updates.",
      detail: `${e instanceof Error ? e.message : String(e)}\n\nCheck your internet connection and try again.`,
    });
  } finally {
    busy = false;
  }
}
