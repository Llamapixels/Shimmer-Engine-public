/**
 * Export for Web: the built ROM plus a browser GBA emulator (EmulatorJS
 * with its mGBA core, shipped in web-player/) in the project's Web
 * folder - zip it and upload it to itch.io as an HTML game.
 *
 * Browsers won't let the page load its own files when index.html is
 * opened straight from disk, so previewWeb() serves the folder on
 * localhost and opens it in the default browser.
 */

import { app, shell } from "electron";
import { createReadStream, existsSync } from "node:fs";
import { copyFile, cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";

const WEB_FOLDER = "Web";

function playerDir(): string {
  return app.isPackaged ? path.join(process.resourcesPath, "web-player") : path.join(app.getAppPath(), "web-player");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function indexHtml(name: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(name)}</title>
<style>
  html, body { margin: 0; height: 100%; background: #000; overflow: hidden; }
  #game { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="game"></div>
<script>
  EJS_player = "#game";
  EJS_core = "gba";
  EJS_gameUrl = "game.gba";
  EJS_gameName = ${JSON.stringify(name)};
  EJS_pathtodata = "data/";
  EJS_DEBUG_XX = true;   // load data/src/*.js (no minified build is shipped)
  EJS_threads = false;
  EJS_color = "#7a5cff";
  EJS_backgroundColor = "#000000";
  EJS_startButtonName = "Play";
</script>
<script src="data/loader.js"></script>
</body>
</html>
`;
}

const README = `This folder is your game, playable in a web browser.

To put it on itch.io: zip this whole folder (index.html must be at the top
of the zip), upload the zip, set "Kind of project" to HTML and tick "This
file will be played in the browser". A viewport of 720 x 480 suits it.

Opening index.html straight from your computer won't work - browsers block
the page from loading its own files that way. Use Export for Web > Open in
Browser in Shimmer Engine to try it, or any local web server.

The emulator is EmulatorJS (https://github.com/EmulatorJS/EmulatorJS,
GPL-3.0, see LICENSE-EmulatorJS.txt) with its mGBA core
(https://github.com/EmulatorJS/mgba, MPL-2.0).
`;

/** Copy the player and the ROM into <project>/Web. Returns the folder. */
export async function exportWeb(rootPath: string, romPath: string, name: string): Promise<string> {
  const player = playerDir();
  if (!existsSync(path.join(player, "data", "loader.js"))) throw new Error("The web player files are missing from this install.");
  if (!existsSync(romPath)) throw new Error("Build the ROM first.");
  const out = path.join(rootPath, WEB_FOLDER);
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });
  await cp(path.join(player, "data"), path.join(out, "data"), { recursive: true });
  await copyFile(path.join(player, "LICENSE-EmulatorJS.txt"), path.join(out, "LICENSE-EmulatorJS.txt"));
  await copyFile(romPath, path.join(out, "game.gba"));
  await writeFile(path.join(out, "index.html"), indexHtml(name), "utf-8");
  await writeFile(path.join(out, "README.txt"), README, "utf-8");
  return out;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8",
};

let server: http.Server | null = null;
let serverRoot = "";
let serverPort = 0;

/** Serve <project>/Web on localhost (one server, re-pointed per project)
 * and open it in the default browser. */
export async function previewWeb(rootPath: string): Promise<string> {
  const root = path.join(rootPath, WEB_FOLDER);
  if (!existsSync(path.join(root, "index.html"))) throw new Error("Export for Web first.");
  serverRoot = root;
  if (!server) {
    server = http.createServer(async (req, res) => {
      try {
        const rel = decodeURIComponent((req.url ?? "/").split("?")[0]);
        const file = path.resolve(serverRoot, "." + (rel.endsWith("/") ? rel + "index.html" : rel));
        if (!file.startsWith(serverRoot + path.sep) || !(await stat(file)).isFile()) throw new Error("not found");
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream" });
        createReadStream(file).pipe(res);
      } catch {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address();
    serverPort = typeof addr === "object" && addr ? addr.port : 0;
  }
  const url = `http://127.0.0.1:${serverPort}/index.html`;
  await shell.openExternal(url);
  return url;
}
