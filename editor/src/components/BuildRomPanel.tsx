import { useEffect, useRef, useState } from "react";

import { useBuildStore } from "../state/buildStore";
import { useProjectStore } from "../state/projectStore";
import "./BuildRomPanel.css";

/** Live build-log modal - see src/state/buildStore.ts for the state this
 * renders and electron/buildRunner.ts for what's actually running. Only
 * ever rendered while a build has been started at least once this
 * session (App.tsx mounts it unconditionally but it returns null when
 * closed, same pattern as other overlays in this app). */
export default function BuildRomPanel() {
  const open = useBuildStore((s) => s.open);
  const status = useBuildStore((s) => s.status);
  const log = useBuildStore((s) => s.log);
  const result = useBuildStore((s) => s.result);
  const rootPath = useBuildStore((s) => s.rootPath);
  const closePanel = useBuildStore((s) => s.closePanel);
  const requestCancel = useBuildStore((s) => s.requestCancel);

  const logRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  // The log as plain text (without the ASCII-art banner), for sharing errors.
  const copyLog = async () => {
    const text = log
      .filter((e) => e.stream !== "art")
      .map((e) => e.line)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      area.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  if (!open) return null;

  const title =
    status === "running"
      ? "Building ROM…"
      : status === "success"
        ? "Build succeeded"
        : status === "cancelled"
          ? "Build cancelled"
          : "Build failed";

  const romPath = result && result.ok ? result.romPath : null;

  return (
    <div className="build-panel-overlay" role="dialog" aria-modal="true" aria-label="Build ROM">
      <div className="build-panel">
        <div className="build-panel-header">
          {status === "running" && <span className="build-panel-spinner" aria-hidden />}
          <span className={`build-panel-title build-panel-title-${status}`}>{title}</span>
          {status !== "running" && (
            <button className="build-panel-close" onClick={closePanel} title="Close" aria-label="Close">
              ×
            </button>
          )}
        </div>

        <div className="build-panel-log" ref={logRef}>
          {log.length === 0 ? (
            <div className="build-panel-log-empty">Starting…</div>
          ) : (
            log.map((entry, i) =>
              entry.stream === "art" ? (
                <pre key={i} className="build-panel-art" data-testid="build-art">
                  {entry.line}
                </pre>
              ) : (
                <div key={i} className={`build-panel-line build-panel-line-${entry.stream}`}>
                  {entry.line}
                </div>
              ),
            )
          )}
        </div>

        <div className="build-panel-footer">
          {status === "running" && (
            <button className="btn btn-small btn-danger" onClick={() => void requestCancel()}>
              Cancel Build
            </button>
          )}

          {status === "success" && romPath && rootPath && (
            <>
              <div className="build-panel-rom-path" title={romPath}>
                {romPath}
              </div>
              <button
                className="btn btn-small"
                onClick={() => {
                  const fileName = romPath.split(/[\\/]/).pop() ?? "rom.gba";
                  window.api.revealInFolder({ rootPath, relPath: `ROM/${fileName}`, base: "project" });
                }}
              >
                Reveal in Folder
              </button>
              <WebExportButtons rootPath={rootPath} romPath={romPath} />
            </>
          )}

          {(status === "error" || status === "cancelled") && (
            <div className="build-panel-error-hint">
              {status === "error"
                ? (result && !result.ok && result.error.split("\n")[0]) || "See the log above for details."
                : "The build was stopped before it finished."}
            </div>
          )}

          {log.length > 0 && (
            <button className="btn btn-small" onClick={() => void copyLog()} title="Copy the build log, e.g. to share an error">
              {copied ? "Copied!" : "Copy Log"}
            </button>
          )}

          {status !== "running" && (
            <button className="btn btn-small" onClick={closePanel}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Export for Web: the ROM plus a browser emulator in the project's Web
 * folder (zip it for itch.io), and a local preview of it. */
function WebExportButtons({ rootPath, romPath }: { rootPath: string; romPath: string }) {
  const name = useProjectStore((s) => s.project?.project.name) ?? "Game";
  const [state, setState] = useState<{ folder?: string; error?: string; busy?: boolean }>({});
  const run = async () => {
    setState({ busy: true });
    const r = await window.api.exportWeb({ rootPath, romPath, name });
    setState(r.ok ? { folder: r.value } : { error: r.error });
  };
  return (
    <>
      <button
        className="btn btn-small"
        disabled={state.busy}
        onClick={() => void run()}
        title="Make a Web folder with an HTML page that plays the game in a browser - zip it and upload it to itch.io"
      >
        Export for Web
      </button>
      {state.folder && (
        <>
          <button className="btn btn-small" onClick={() => void window.api.previewWeb({ rootPath })}>
            Open in Browser
          </button>
          <button className="btn btn-small" onClick={() => window.api.revealInFolder({ rootPath, relPath: "Web/index.html", base: "project" })}>
            Show Web Folder
          </button>
          <div className="build-panel-rom-path">Saved to {state.folder} - zip that folder to upload it (see README.txt there).</div>
        </>
      )}
      {state.error && <div className="build-panel-error-hint">{state.error}</div>}
    </>
  );
}
