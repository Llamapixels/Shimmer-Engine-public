import { useEffect, useMemo, useRef, useState } from "react";

import type { AssetInfo } from "../../shared/ipc";
import { useProjectStore } from "../state/projectStore";
import { AUDIO_RATE, CutDecoder, MODE_SIZE, audioToS8, cutInfo, type CutMode, type CutSettings } from "./encoder";
import { type Fit, type LoadedVideo, drawFrame, extractAudio, extractFrames, loadVideo } from "./videoDecode";
import "./Cutscenes.css";

const ROM_BYTES = 32 * 1024 * 1024;

const QUALITY: { id: string; label: string; threshold: number; hint: string }[] = [
  { id: "best", label: "Best", threshold: 0, hint: "Every changed pixel is kept. Biggest file." },
  { id: "good", label: "Good", threshold: 3, hint: "Ignores tiny changes. Usually looks the same, noticeably smaller." },
  { id: "small", label: "Small", threshold: 10, hint: "Ignores small changes - some smearing on busy video, much smaller." },
];

function b64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromB64DataUrl(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(2)} MB` : `${Math.round(n / 1024)} KB`);

interface Loaded {
  name: string;
  cut: Uint8Array;
  raw: Uint8Array | null;
  meta: Record<string, unknown> | null;
}

/** The Cutscenes section: videos converted for the GBA, played full-screen
 * by the "Play Cutscene" event. */
export default function CutscenesView() {
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const cutscenes = useProjectStore((s) => s.assets?.cutscenes ?? []);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = cutscenes.find((c) => c.name === selected) ?? null;

  useEffect(() => {
    if (!selected && cutscenes.length) setSelected(cutscenes[0].name);
  }, [cutscenes, selected]);

  // Read the selected cutscene's files.
  useEffect(() => {
    if (!current || !rootPath) {
      setLoaded(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const read = async (rel: string) => {
        const r = await window.api.readAsset({ rootPath, relPath: rel, base: "project" });
        return r.ok ? fromB64DataUrl(r.value.dataUrl) : null;
      };
      const cut = await read(current.relPath);
      const raw = await read(current.relPath.replace(/\.cut$/i, ".raw"));
      const metaBytes = await read(current.relPath.replace(/\.cut$/i, ".json"));
      let meta: Record<string, unknown> | null = null;
      try {
        meta = metaBytes ? JSON.parse(new TextDecoder().decode(metaBytes)) : null;
      } catch {
        meta = null;
      }
      if (!cancelled) setLoaded(cut ? { name: current.name, cut, raw, meta } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [current, rootPath]);

  const remove = async () => {
    if (!current || !rootPath) return;
    if (!window.confirm(`Delete the cutscene "${current.name}"? Play Cutscene events that use it will stop building until changed.`)) return;
    const r = await window.api.deleteCutscene({ rootPath, name: current.name });
    if (!r.ok) return setError(r.error);
    useProjectStore.setState({ assets: r.value });
    setSelected(null);
  };

  return (
    <div className="cut-view">
      <aside className="cut-list">
        <div className="cut-list-head">
          <span>Cutscenes</span>
          <button className="btn btn-small btn-primary" onClick={() => setImportOpen(true)}>
            + Import video
          </button>
        </div>
        {cutscenes.map((c) => (
          <button key={c.relPath} className={`cut-item${c.name === selected ? " cut-item-on" : ""}`} onClick={() => setSelected(c.name)}>
            <span className="cut-item-name">{c.name}</span>
            <span className="cut-item-size">{kb(c.bytes)}</span>
          </button>
        ))}
        {cutscenes.length === 0 && (
          <p className="cut-empty-note">
            No cutscenes yet. Import a video (MP4 or WebM) to turn it into a GBA cutscene, then show it with the <b>Play Cutscene</b> event.
          </p>
        )}
      </aside>

      <section className="cut-main">
        {error && <div className="cut-error">{error}</div>}
        {loaded ? (
          <CutscenePlayer key={loaded.name} loaded={loaded} onDelete={() => void remove()} />
        ) : (
          <div className="cut-placeholder">{cutscenes.length ? "Loading…" : "Import a video to get started."}</div>
        )}
      </section>

      {importOpen && rootPath && (
        <ImportDialog
          rootPath={rootPath}
          existing={cutscenes}
          onClose={() => setImportOpen(false)}
          onDone={(name) => {
            setImportOpen(false);
            setSelected(name);
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Plays a converted cutscene exactly as the GBA will show it. */
function CutscenePlayer({ loaded, onDelete }: { loaded: Loaded; onDelete: () => void }) {
  const info = useMemo(() => cutInfo(loaded.cut), [loaded.cut]);
  const decoder = useMemo(() => (info ? new CutDecoder(loaded.cut) : null), [loaded.cut, info]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const audioCtx = useRef<AudioContext | null>(null);
  const audioSrc = useRef<AudioBufferSourceNode | null>(null);
  const playingStop = useRef<() => void>(() => {});

  const draw = (i: number) => {
    const cv = canvasRef.current;
    if (!cv || !decoder || !info) return;
    const rgba = decoder.seek(i);
    cv.width = info.width;
    cv.height = info.height;
    cv.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(rgba), info.width, info.height), 0, 0);
  };

  useEffect(() => {
    draw(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame, decoder]);

  const stop = () => {
    audioSrc.current?.stop();
    audioSrc.current = null;
    setPlaying(false);
  };

  useEffect(() => () => playingStop.current(), []);

  const play = () => {
    if (!info || !decoder) return;
    const ctx = audioCtx.current ?? new AudioContext();
    audioCtx.current = ctx;
    const startFrame = frame >= info.frames - 1 ? 0 : frame;
    if (startFrame === 0) decoder.reset();
    const offset = startFrame / info.fps;
    if (loaded.raw && loaded.raw.length) {
      const buf = ctx.createBuffer(1, loaded.raw.length, AUDIO_RATE);
      const d = buf.getChannelData(0);
      for (let i = 0; i < loaded.raw.length; i++) d[i] = ((loaded.raw[i] << 24) >> 24) / 128;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0, Math.min(offset, buf.duration));
      audioSrc.current = src;
    }
    const t0 = ctx.currentTime - offset;
    setPlaying(true);
    const tick = () => {
      if (!audioCtx.current) return;
      const f = Math.floor((ctx.currentTime - t0) * info.fps);
      if (f >= info.frames) {
        setFrame(info.frames - 1);
        stop();
        return;
      }
      setFrame(f);
      rafId = requestAnimationFrame(tick);
    };
    let rafId = requestAnimationFrame(tick);
    const stopRef = stop;
    audioSrc.current?.addEventListener("ended", () => cancelAnimationFrame(rafId));
    playingStop.current = () => {
      cancelAnimationFrame(rafId);
      stopRef();
    };
  };

  if (!info || !decoder) return <div className="cut-error">This file isn't a Shimmer cutscene - import the video again.</div>;

  const seconds = info.frames / info.fps;
  const rawBytes = loaded.raw?.length ?? 0;
  const total = loaded.cut.length + rawBytes;
  const avgFrame = Math.round(loaded.cut.length / info.frames);
  const meta = loaded.meta;

  return (
    <div className="cut-player">
      <div className="cut-screen">
        <canvas ref={canvasRef} className="cut-canvas" style={{ aspectRatio: "3 / 2" }} />
      </div>
      <div className="cut-controls">
        {playing ? (
          <button className="btn" onClick={() => playingStop.current()}>
            ❚❚ Pause
          </button>
        ) : (
          <button className="btn btn-primary" onClick={play}>
            ▶ Play
          </button>
        )}
        <input
          className="cut-scrub"
          type="range"
          min={0}
          max={info.frames - 1}
          value={frame}
          onChange={(e) => {
            if (playing) playingStop.current();
            setFrame(Number(e.target.value));
          }}
        />
        <span className="cut-time">
          {(frame / info.fps).toFixed(1)}s / {seconds.toFixed(1)}s
        </span>
      </div>
      <div className="cut-info">
        <div>
          <b>{loaded.name}</b>
          {meta?.source ? <span className="cut-muted"> from {String(meta.source)}</span> : null}
        </div>
        <div className="cut-stats">
          <span>
            {info.mode === "full" ? "Full screen 240×160" : "Half size 120×80, shown 2×"} · {info.fps} fps · {info.frames} frames
          </span>
          <span>
            Video {kb(loaded.cut.length)} ({kb(Math.round(loaded.cut.length / seconds))}/s, ~{kb(avgFrame)} per frame) · Sound {rawBytes ? kb(rawBytes) : "none"}
          </span>
          <span>
            Total {kb(total)} = {((total / ROM_BYTES) * 100).toFixed(1)}% of a 32 MB cartridge
          </span>
        </div>
        <p className="cut-muted">
          Use it with the <b>Play Cutscene</b> event (Scene category). It plays full-screen, then the scene comes back as it was.
        </p>
        <button className="btn btn-small btn-danger" onClick={onDelete}>
          Delete cutscene
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ImportDialog({
  rootPath,
  existing,
  onClose,
  onDone,
}: {
  rootPath: string;
  existing: AssetInfo[];
  onClose: () => void;
  onDone: (name: string) => void;
}) {
  const [source, setSource] = useState<{ name: string; video: LoadedVideo } | null>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<CutMode>("full");
  const [fps, setFps] = useState(15);
  const [fit, setFit] = useState<Fit>("fit");
  const [quality, setQuality] = useState("good");
  const [dither, setDither] = useState(false);
  const [withAudio, setWithAudio] = useState(true);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef(false);
  const previewRef = useRef<HTMLCanvasElement>(null);

  const pick = async () => {
    setError(null);
    const r = await window.api.pickVideoFile();
    if (!r.ok) return setError(r.error);
    if (!r.value) return;
    try {
      const video = await loadVideo(r.value.base64, r.value.mime);
      setSource({ name: r.value.fileName, video });
      setStart(0);
      setEnd(Math.round(video.duration * 10) / 10);
      if (!name) setName(r.value.fileName.replace(/\.[^.]+$/, "").replace(/[^A-Za-z0-9_ -]/g, "_"));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  // A still of the start frame at the chosen size and fit.
  useEffect(() => {
    const v = source?.video;
    const cv = previewRef.current;
    if (!v || !cv) return;
    const { w, h } = MODE_SIZE[mode];
    cv.width = w;
    cv.height = h;
    const show = () => drawFrame(cv.getContext("2d")!, v.video, w, h, fit);
    v.video.currentTime = Math.min(v.duration - 0.01, start + 0.05);
    v.video.addEventListener("seeked", show, { once: true });
  }, [source, mode, fit, start]);

  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source.video.url);
  }, [source]);

  const length = Math.max(0, end - start);
  const threshold = QUALITY.find((q) => q.id === quality)!.threshold;
  // A rough guess before converting (real video varies a lot).
  const guess = useMemo(() => {
    const perFrame = (mode === "full" ? 38400 : 9600) * (threshold === 0 ? 0.22 : threshold < 5 ? 0.14 : 0.09);
    return Math.round(length * fps * perFrame + (withAudio ? length * AUDIO_RATE : 0));
  }, [mode, fps, threshold, length, withAudio]);

  const convert = async () => {
    if (!source) return;
    const stem = name.trim().replace(/[^A-Za-z0-9_ -]/g, "_");
    if (!stem) return setError("Give the cutscene a name.");
    if (existing.some((c) => c.name === stem) && !window.confirm(`Replace the cutscene "${stem}"?`)) return;
    if (length <= 0) return setError("The end time must be after the start.");
    if (length * fps > 65000) return setError("That's too many frames - shorten it or lower the frame rate.");
    setBusy(true);
    setError(null);
    cancelRef.current = false;
    try {
      const { w, h } = MODE_SIZE[mode];
      setStatus("Reading frames…");
      const frames = await extractFrames(source.video, w, h, fps, fit, start, end, (d, t) => setProgress(d / t), () => cancelRef.current);
      setStatus("Reading sound…");
      setProgress(0);
      const audio = withAudio ? await extractAudio(source.video, start, end) : null;
      setStatus("Compressing for the GBA…");
      const settings: CutSettings = { mode, fps, threshold, dither };
      const cut = await new Promise<Uint8Array>((resolve, reject) => {
        const worker = new Worker(new URL("./encodeWorker.ts", import.meta.url), { type: "module" });
        worker.onmessage = (e: MessageEvent<{ progress?: number; cut?: ArrayBuffer; error?: string }>) => {
          if (e.data.progress !== undefined) setProgress(e.data.progress);
          else if (e.data.cut) {
            worker.terminate();
            resolve(new Uint8Array(e.data.cut));
          } else {
            worker.terminate();
            reject(new Error(e.data.error ?? "Encoding failed."));
          }
        };
        worker.onerror = (e) => {
          worker.terminate();
          reject(new Error(e.message || "Encoding failed."));
        };
        const buffers = frames.map((f) => f.buffer as ArrayBuffer);
        worker.postMessage({ frames: buffers, settings }, buffers);
      });
      setStatus("Saving…");
      const raw = audio && audio.length ? audioToS8(audio) : null;
      const meta = JSON.stringify(
        { source: source.name, start, end, mode, fps, fit, quality, dither, audio: !!raw, made: new Date().toISOString() },
        null,
        2,
      );
      const r = await window.api.saveCutscene({ rootPath, name: stem, cutBase64: b64(cut), rawBase64: raw ? b64(raw) : null, meta });
      if (!r.ok) throw new Error(r.error);
      useProjectStore.setState({ assets: r.value });
      if (withAudio && !raw) useProjectStore.getState().showNotice("That video has no sound track - the cutscene is silent.");
      onDone(stem);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="art-modal-backdrop" onMouseDown={busy ? undefined : onClose}>
      <div className="art-modal cut-import" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Import video as a cutscene</h3>
        {!source ? (
          <>
            <p className="art-modal-note">
              MP4 (H.264) or WebM works best. Short is best too: about 1 MB per 10 seconds of full-screen video is typical, and a
              cartridge holds 32 MB.
            </p>
            <button className="btn btn-primary" onClick={() => void pick()}>
              Choose a video…
            </button>
          </>
        ) : (
          <>
            <div className="cut-import-grid">
              <canvas ref={previewRef} className="cut-import-preview" />
              <div className="cut-import-fields">
                <div className="cut-muted">
                  {source.name} · {source.video.width}×{source.video.height} · {source.video.duration.toFixed(1)}s
                </div>
                <label className="art-modal-field">
                  Name
                  <input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <div className="art-modal-row">
                  <label className="art-modal-field">
                    Start (s)
                    <input type="number" step={0.1} min={0} max={source.video.duration} value={start} onChange={(e) => setStart(Number(e.target.value))} />
                  </label>
                  <label className="art-modal-field">
                    End (s)
                    <input type="number" step={0.1} min={0} max={source.video.duration} value={end} onChange={(e) => setEnd(Number(e.target.value))} />
                  </label>
                </div>
                <div className="art-modal-row">
                  <label className="art-modal-field">
                    Size
                    <select value={mode} onChange={(e) => setMode(e.target.value as CutMode)}>
                      <option value="full">Full screen 240×160</option>
                      <option value="half">Half 120×80 (4× smaller, chunkier)</option>
                    </select>
                  </label>
                  <label className="art-modal-field">
                    Frame rate
                    <select value={fps} onChange={(e) => setFps(Number(e.target.value))}>
                      {[6, 8, 10, 12, 15, 20, 24, 30].map((f) => (
                        <option key={f} value={f}>
                          {f} fps
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="art-modal-row">
                  <label className="art-modal-field">
                    Fit
                    <select value={fit} onChange={(e) => setFit(e.target.value as Fit)}>
                      <option value="fit">Fit (black bars)</option>
                      <option value="fill">Fill (crop edges)</option>
                      <option value="stretch">Stretch</option>
                    </select>
                  </label>
                  <label className="art-modal-field" title={QUALITY.find((q) => q.id === quality)?.hint}>
                    Quality
                    <select value={quality} onChange={(e) => setQuality(e.target.value)}>
                      {QUALITY.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="art-opt" title="Smoother colour gradients; can make the file a little bigger">
                  <input type="checkbox" checked={dither} onChange={(e) => setDither(e.target.checked)} /> Dither colours
                </label>
                <label className="art-opt">
                  <input type="checkbox" checked={withAudio} onChange={(e) => setWithAudio(e.target.checked)} /> Include the sound
                </label>
                <div className="cut-muted">
                  {length.toFixed(1)}s · {Math.floor(length * fps)} frames · roughly {kb(guess)} ({((guess / ROM_BYTES) * 100).toFixed(1)}% of a cartridge)
                </div>
              </div>
            </div>
            {status && (
              <div className="cut-progress">
                <span>{status}</span>
                <progress value={progress} max={1} />
              </div>
            )}
          </>
        )}
        {error && <p className="art-modal-error">{error}</p>}
        <div className="art-modal-actions">
          <button
            className="btn"
            onClick={() => {
              if (busy) cancelRef.current = true;
              else onClose();
            }}
          >
            Cancel
          </button>
          {source && (
            <button className="btn btn-primary" disabled={busy} onClick={() => void convert()}>
              Convert
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
