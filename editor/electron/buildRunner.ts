/**
 * Runs the two-step Shimmer Engine build (compiler/build_project.py, then
 * `make -C engine`) as a child process, mirroring the toolchain root's
 * reference build.sh (see this feature's task description - it's not
 * assumed to exist or be unmodified, so the same logic is reimplemented
 * here directly rather than shelling out to that file).
 *
 * Isolated from electron/main.ts's IPC wiring for the same reason
 * projectIO.ts is: so the command-construction and path-translation logic
 * (the only parts of this that can actually be verified without a real
 * Windows+WSL+devkitARM machine - see the module's test notes) can be
 * exercised on its own.
 */

import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { writeFile, unlink, readFile } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";

import type { BuildLogEvent, BuildRomResult } from "../shared/ipc.js";

/** How many trailing lines of combined stdout/stderr to include in a
 * failure message - enough to see a compiler BuildError or a devkitARM
 * error, without dumping an entire noisy `make` log into a one-line error
 * string. The full output is already visible to the user via the
 * streamed BuildLogEvents regardless. */
const ERROR_TAIL_LINES = 60;

/**
 * Translates a Windows drive path to its WSL mount equivalent:
 * `C:\Users\User\Desktop\gba studio` -> `/mnt/c/Users/User/Desktop/gba studio`.
 * Lowercases the drive letter, swaps backslashes for forward slashes, and
 * prefixes `/mnt/<letter>/` - the standard WSL2 mount scheme. Throws
 * rather than guessing when the input doesn't look like a drive path
 * (e.g. it's already a UNC or POSIX path), since a silently-wrong
 * translation would fail confusingly deep inside `wsl.exe` instead of
 * here where it's obvious what went wrong.
 */
export function windowsPathToWsl(winPath: string): string {
  const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(winPath);
  if (!m) {
    throw new Error(
      `"${winPath}" doesn't look like a Windows drive path (expected something like "C:\\Users\\...").`,
    );
  }
  const drive = m[1].toLowerCase();
  const rest = m[2].replace(/\\/g, "/");
  return `/mnt/${drive}/${rest}`;
}

/** Wraps a string in single quotes for safe interpolation into a
 * `bash -lc "..."` command line, escaping any single quotes it contains.
 * The toolchain root and project paths this feature deals with routinely
 * have spaces in them (see the user's actual path,
 * `C:\Users\User\Desktop\gba studio\...`), so naive unquoted
 * interpolation would silently split the command wrong. */
export function shQuote(s: string): string {
  return `'${s.split("'").join(`'\\''`)}'`;
}

/**
 * Where the toolchain gets mirrored to before building - see
 * buildScriptContent()'s doc comment for why this exists. `$HOME` is
 * resolved by the shell that runs the command (bash's own `$HOME`), not
 * by Node, since this process's HOME isn't necessarily the WSL user's.
 */
const MIRROR_DIR = "$HOME/.shimmer-engine-build";

/**
 * Builds the bash command string that performs the build - the same two
 * steps build.sh performs (run the compiler, then `make -C engine`), plus
 * the same "prefer a local .venv, else python3, else python" interpreter
 * choice build.sh makes. That choice is left to the shell itself (rather
 * than checked from Node here) because it has to be evaluated *inside*
 * the environment that will actually run the build - for the Windows
 * case that's inside WSL, which this process can't inspect directly.
 *
 * Before either step, the whole toolchain is rsync'd into a space-free
 * location under $HOME (MIRROR_DIR). This isn't optional politeness -
 * it's a real, confirmed-on-hardware requirement: the devkitPro Makefile
 * this project uses (engine/Makefile) builds several of its own internal
 * lists (VPATH, the recursive `$(MAKE) -C $(BUILD) -f $(CURDIR)/Makefile`
 * invocation, etc.) straight from $(CURDIR), and GNU Make's own variable
 * lists are whitespace-separated - so a space anywhere in the project's
 * path breaks `make` itself (not just shell quoting, which is a separate,
 * already-handled concern - see shQuote()), with confusing "No rule to
 * make target" errors that don't look path-related at all. The user's
 * own path (`.../Desktop/gba studio/...`) has exactly this problem, and
 * their existing build.sh has a comment about it. Since a space-free
 * *install* path can't be guaranteed for every future user (that's a
 * Windows default "Desktop"/"Documents" convention, not something anyone
 * chooses), the build always mirrors into a known-safe location instead
 * of asking the user to avoid spaces.
 *
 * The compiler's generated output lands inside the mirror's own engine/
 * tree (not the original toolchain root) since `make` runs against the
 * mirror - so after a successful build, engine.gba is copied back out to
 * the project's own `ROM/` folder (named after the project, not the
 * generic "engine.gba" `make` produces), which is what the rest of this
 * app (and its "Reveal in Folder" button) expects. See romFileName()
 * below for how that name is picked.
 *
 * `--delete` keeps the mirror from accumulating stale files removed from
 * the real project (a renamed/deleted scene, say), at the cost of make
 * losing its incremental build cache every time (engine/build/ gets wiped
 * and rebuilt from scratch each build, since it doesn't exist in the
 * source toolchain to be synced back in). This engine is small enough
 * that a full rebuild is still fast; if that ever changes, the fix is to
 * `--exclude 'engine/build/'` from `--delete` (not just from the sync)
 * so the mirror keeps its own object files between builds.
 *
 * `toolchainRootPosix` and `projectRelPosix` must already be in
 * forward-slash form appropriate for the shell that will run this
 * command (a `/mnt/c/...` WSL path on Windows, the native path on
 * macOS/Linux).
 *
 * This used to be assembled as one giant `cmd1 && cmd2 && cmd3 && ...`
 * string and handed to `wsl.exe bash -lc "<that string>"` directly as a
 * single argv entry. In practice, on a real Windows+WSL2 machine, that
 * produced a build that reported success (exit code 0, and an
 * already-existing engine.gba from a previous build still sitting there
 * passed the `romPath` existence check) while never actually running -
 * the log showed the `if/elif/else` interpreter-picking block silently
 * failing to set `$PY` (`using interpreter:` with nothing after the
 * colon), then `"$PY" compiler/build_project.py ...` executing as an
 * empty command (`bash: line 1: : command not found`), which happened on
 * a cold WSL start (`wsl: Processing /etc/fstab with mount -a failed.`
 * printed first) - consistent with wsl.exe mis-delivering a very long,
 * heavily-quoted single `-c` argument during VM boot, a known class of
 * wsl.exe flakiness with long command lines. Since `&&`-chaining a chain
 * this long into one argv string is what's fragile here (not the logic
 * itself), the fix is to write this out as a real multi-line script FILE
 * on disk instead (buildRom() below writes this function's output to
 * BUILD_SCRIPT_NAME at the toolchain root) and have wsl.exe/bash run a
 * short `bash '<script path>'` invocation - a much smaller, simpler argv
 * that isn't exposed to that failure mode, and the on-disk script is also
 * easier for a person to inspect directly if something still goes wrong.
 */
export function buildScriptContent(
  toolchainRootPosix: string,
  projectRelPosix: string,
  romFileName: string,
): string {
  const root = shQuote(toolchainRootPosix);
  const project = shQuote(projectRelPosix);
  const rom = shQuote(romFileName);
  const elf = shQuote(romFileName.replace(/\.gba$/i, "") + ".elf");
  const mirror = MIRROR_DIR; // deliberately unquoted here so $HOME expands; quoted at each use site below
  return [
    `#!/usr/bin/env bash`,
    `# Auto-generated by Shimmer Engine's "Build ROM" - safe to delete.`,
    `set -e`,
    ``,
    `mkdir -p "${mirror}"`,
    `rsync -a --delete \\`,
    `  --exclude 'editor/node_modules/' --exclude 'editor/dist/' --exclude 'editor/dist-electron/' \\`,
    `  --exclude '_backup_*/' --exclude '${BUILD_SCRIPT_NAME}' \\`,
    `  ${root}/ "${mirror}/"`,
    `cd "${mirror}"`,
    ``,
    `if [ -x .venv/bin/python ]; then`,
    `  PY=.venv/bin/python`,
    `elif command -v python3 >/dev/null 2>&1; then`,
    `  PY=python3`,
    `else`,
    `  PY=python`,
    `fi`,
    `echo "[shimmer-engine] using interpreter: $PY"`,
    ``,
    `"$PY" compiler/build_project.py ${project}`,
    `make -C engine`,
    ``,
    `mkdir -p ${root}/${project}/ROM`,
    `cp "${mirror}/engine/engine.gba" ${root}/${project}/ROM/${rom}`,
    `cp -f "${mirror}/engine/engine.elf" ${root}/${project}/ROM/${elf} 2>/dev/null || true`,
    ``,
  ].join("\n");
}

/** Kept only so anything that still imports the old name (e.g. a stale
 * build of this file elsewhere) fails loudly instead of silently linking
 * against removed behavior. Not used by buildRom() anymore. */
export const buildShellCommand = buildScriptContent;

/** File name (not path) of the generated build script - written to, and
 * cleaned up from, the toolchain root itself, since that's a location
 * that's the same path on the Windows side and (via windowsPathToWsl) on
 * the WSL side. Excluded from the rsync mirror step above so it isn't
 * pointlessly duplicated into the mirror on every build. */
const BUILD_SCRIPT_NAME = ".shimmer-engine-build.sh";

/** Picks the exported ROM's file name: the project's own `name` field
 * from project.json (sanitized the same way createProject() derives a
 * folder name from it), falling back to the project folder's own name if
 * project.json is missing/unreadable/unnamed. Always ends in ".gba". */
async function romFileName(rootPath: string): Promise<string> {
  let base = path.basename(rootPath);
  try {
    const raw = await readFile(path.join(rootPath, "project.json"), "utf-8");
    const parsed = JSON.parse(raw) as { name?: unknown };
    if (typeof parsed.name === "string" && parsed.name.trim()) {
      base = parsed.name.trim();
    }
  } catch {
    // project.json missing or unreadable - fall back to the folder name.
  }
  const safe = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `${safe || "rom"}.gba`;
}

interface RunningBuild {
  child: ChildProcessByStdio<null, Readable, Readable>;
  cancelled: boolean;
}

let current: RunningBuild | null = null;

export function isBuildRunning(): boolean {
  return current !== null;
}

/** Kills the in-progress build, if any. Returns false if nothing was
 * running. Note: on Windows the child process is `wsl.exe` itself, not
 * the build inside the WSL VM directly - killing it terminates that WSL
 * invocation, which is the most this process can do from here without
 * reaching into the WSL VM's own process table. */
export function cancelBuild(): boolean {
  if (!current) return false;
  current.cancelled = true;
  try {
    current.child.kill();
  } catch {
    // Best effort - if the process already exited, there's nothing to do.
  }
  return true;
}

function tail(lines: string[], n: number): string {
  return lines.slice(-n).join("\n");
}

function startFailureMessage(toolchainRoot: string, isWindows: boolean, err: unknown): string {
  const base = err instanceof Error ? err.message : String(err);
  if (isWindows) {
    const scriptName = ["install-devkitpro-pacman", "install-devkitpro-pacman.sh"].find((name) =>
      existsSync(path.join(toolchainRoot, name)),
    );
    const hint = scriptName
      ? ` This toolchain has a "${scriptName}" script at its root - if WSL and devkitARM aren't set up yet, that's likely the one to run (from inside WSL). If WSL itself isn't installed, run "wsl --install" from an admin PowerShell first.`
      : ` Make sure WSL2 is installed ("wsl --install" from an admin PowerShell) and devkitARM is set up inside it.`;
    return `Couldn't start WSL to run the build (${base}).${hint}`;
  }
  return `Couldn't start the build (${base}). Make sure "bash" and "make" are on your PATH and devkitARM is installed.`;
}

/**
 * Runs the build for the project at `rootPath`, inside the toolchain at
 * `toolchainRoot` (the folder containing engine/Makefile - see
 * projectIO.findEngineRoot). `sendLog` is called with each streamed line
 * as it arrives, plus a few status lines of this function's own. Only
 * one build may run at a time process-wide; call isBuildRunning() first
 * if you need to guard against a concurrent call (electron/main.ts does).
 */
export async function buildRom(
  rootPath: string,
  toolchainRoot: string,
  sendLog: (event: BuildLogEvent) => void,
): Promise<BuildRomResult> {
  if (current) {
    return { ok: false, error: "A build is already running." };
  }

  const projectRelNative = path.relative(toolchainRoot, rootPath);
  if (!projectRelNative || projectRelNative.startsWith("..") || path.isAbsolute(projectRelNative)) {
    return {
      ok: false,
      error: `This project (${rootPath}) doesn't live inside the toolchain folder (${toolchainRoot}), so its build_project.py path can't be computed.`,
    };
  }
  const projectRelPosix = projectRelNative.split(path.sep).join("/");

  const isWindows = process.platform === "win32";
  let toolchainRootPosix: string;
  try {
    toolchainRootPosix = isWindows ? windowsPathToWsl(toolchainRoot) : toolchainRoot;
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't translate the toolchain folder path for WSL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const romFile = await romFileName(rootPath);

  // Write the build as a real script file rather than one giant `&&`-joined
  // string handed to wsl.exe as a single argv entry - see buildScriptContent's
  // doc comment for why (a real, observed wsl.exe failure mode on long
  // single-argument -c commands). The script lives at the toolchain root
  // itself so its WSL-side path is just windowsPathToWsl() of a path we
  // already have.
  const scriptContent = buildScriptContent(toolchainRootPosix, projectRelPosix, romFile);
  const scriptNativePath = path.join(toolchainRoot, BUILD_SCRIPT_NAME);
  try {
    await writeFile(scriptNativePath, scriptContent, "utf-8");
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't write the build script to ${scriptNativePath}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let scriptPathPosix: string;
  try {
    scriptPathPosix = isWindows ? windowsPathToWsl(scriptNativePath) : scriptNativePath;
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't translate the build script path for WSL: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const commandProgram = isWindows ? "wsl.exe" : "bash";
  // Short argv on purpose (just "bash <script path>", no -c) - the whole
  // point of writing the script to disk is to keep what crosses the
  // wsl.exe process boundary small and simple.
  const commandArgs = isWindows ? ["bash", "-l", scriptPathPosix] : ["-l", scriptPathPosix];

  sendLog({
    stream: "status",
    line: isWindows
      ? `Running via WSL: bash '${scriptPathPosix}' (script: ${scriptNativePath})`
      : `Running: bash '${scriptPathPosix}'`,
  });

  // Snapshot the ROM's current mtime (if it exists) so a build that
  // reports success can be checked against actually having rewritten it -
  // see the comment at the success check below for why this matters.
  const romPath = path.join(rootPath, "ROM", romFile);
  let preBuildMtimeMs: number | null = null;
  try {
    preBuildMtimeMs = statSync(romPath).mtimeMs;
  } catch {
    preBuildMtimeMs = null; // no ROM yet - any successful build is "fresh"
  }

  const cleanupScript = () => {
    unlink(scriptNativePath).catch(() => {
      // Best effort - leaving the script behind doesn't break the next
      // build (it's overwritten each time) and can help debugging.
    });
  };

  return new Promise((resolve) => {
    let child: ChildProcessByStdio<null, Readable, Readable>;
    try {
      child = spawn(commandProgram, commandArgs, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      cleanupScript();
      resolve({ ok: false, error: startFailureMessage(toolchainRoot, isWindows, err) });
      return;
    }

    const handle: RunningBuild = { child, cancelled: false };
    current = handle;

    const outLines: string[] = [];
    const allLines: string[] = [];
    let settled = false;

    const makePump = (stream: "stdout" | "stderr") => {
      let buf = "";
      return (chunk: Buffer) => {
        buf += chunk.toString("utf-8");
        const parts = buf.split(/\r?\n/);
        buf = parts.pop() ?? "";
        for (const line of parts) {
          if (stream === "stdout") outLines.push(line);
          allLines.push(line);
          sendLog({ stream, line });
        }
      };
    };
    child.stdout.on("data", makePump("stdout"));
    child.stderr.on("data", makePump("stderr"));

    // Fires when the process itself couldn't be started (e.g. wsl.exe or
    // bash isn't on PATH at all) - distinct from a build that started and
    // then failed, which is handled in the "close" listener below via a
    // non-zero exit code.
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      current = null;
      cleanupScript();
      resolve({ ok: false, error: startFailureMessage(toolchainRoot, isWindows, err) });
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      current = null;
      cleanupScript();

      if (handle.cancelled) {
        sendLog({ stream: "status", line: "Build cancelled." });
        resolve({ ok: false, error: "Build cancelled." });
        return;
      }

      const romExists = existsSync(romPath);
      // A process exit code of 0 isn't proof anything actually happened -
      // this exact bug shipped once already (see buildScriptContent's doc
      // comment): the interpreter-detection step silently produced an
      // empty command, the rest of the script never ran, but the shell's
      // own exit code was still 0 and an *old* engine.gba from a previous
      // build was still sitting there, so a naive "exit 0 and the file
      // exists" check reported success on a completely stale ROM. Requiring
      // the file's mtime to have actually moved forward catches that class
      // of silent no-op regardless of its cause.
      let romIsFresh = false;
      if (romExists) {
        try {
          const postBuildMtimeMs = statSync(romPath).mtimeMs;
          romIsFresh = preBuildMtimeMs === null || postBuildMtimeMs > preBuildMtimeMs;
        } catch {
          romIsFresh = false;
        }
      }

      if (code === 0 && romExists && romIsFresh) {
        sendLog({ stream: "status", line: `Build succeeded: ${romPath}` });
        resolve({ ok: true, romPath });
        return;
      }

      const combinedTail = tail(allLines, ERROR_TAIL_LINES) || "(no output captured)";
      let error: string;
      if (code === 0 && !romExists) {
        error = `The build reported success but no ROM was found at ${romPath}. Last output:\n${combinedTail}`;
      } else if (code === 0 && romExists && !romIsFresh) {
        error =
          `The build reported success but ${romPath} was never rewritten (still the same file from before ` +
          `this build ran). Something in the build script silently did nothing - check the log above for the ` +
          `last real output before it stopped. Last output:\n${combinedTail}`;
      } else {
        error = `Build failed (exit code ${code ?? "unknown"}). Last output:\n${combinedTail}`;
      }
      sendLog({ stream: "status", line: error });
      resolve({ ok: false, error });
    });
  });
}
