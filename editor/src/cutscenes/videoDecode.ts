/**
 * Reads a video file in the editor itself (the app's built-in video and
 * audio decoders - no ffmpeg needed): frames at a chosen rate and size,
 * and the sound resampled to the GBA's WAV rate.
 */
import { AUDIO_RATE } from "./encoder";

export type Fit = "fit" | "fill" | "stretch";

export interface LoadedVideo {
  url: string;
  video: HTMLVideoElement;
  duration: number;
  width: number;
  height: number;
  bytes: ArrayBuffer;
}

export async function loadVideo(base64: string, mime: string): Promise<LoadedVideo> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.src = url;
  await new Promise<void>((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("This video can't be read - try an MP4 (H.264) or WebM file."));
  });
  return { url, video, duration: video.duration, width: video.videoWidth, height: video.videoHeight, bytes: bytes.buffer };
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = t;
  });
}

/** Draw the current video frame into w x h, fitted as asked. */
export function drawFrame(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, w: number, h: number, fit: Fit) {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (fit === "stretch" || !vw || !vh) {
    ctx.drawImage(video, 0, 0, w, h);
    return;
  }
  const scale = fit === "fit" ? Math.min(w / vw, h / vh) : Math.max(w / vw, h / vh);
  const dw = vw * scale;
  const dh = vh * scale;
  ctx.drawImage(video, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Every frame from `start` to `end` seconds at `fps`, as RGBA at w x h. */
export async function extractFrames(
  v: LoadedVideo,
  w: number,
  h: number,
  fps: number,
  fit: Fit,
  start: number,
  end: number,
  progress: (done: number, total: number) => void,
  cancelled: () => boolean,
): Promise<Uint8ClampedArray[]> {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const count = Math.max(1, Math.floor((end - start) * fps));
  const frames: Uint8ClampedArray[] = [];
  for (let i = 0; i < count; i++) {
    if (cancelled()) throw new Error("Cancelled.");
    // The middle of each frame's time slot avoids landing on a boundary.
    await seek(v.video, Math.min(v.duration - 0.001, start + (i + 0.5) / fps));
    drawFrame(ctx, v.video, w, h, fit);
    frames.push(ctx.getImageData(0, 0, w, h).data);
    progress(i + 1, count);
  }
  return frames;
}

/** The video's sound from `start` to `end`, mono at AUDIO_RATE, or null
 * when it has none. */
export async function extractAudio(v: LoadedVideo, start: number, end: number): Promise<Float32Array | null> {
  try {
    const length = Math.max(1, Math.ceil(v.duration * AUDIO_RATE));
    const ctx = new OfflineAudioContext(1, length, AUDIO_RATE);
    const buf = await ctx.decodeAudioData(v.bytes.slice(0));
    const n = buf.length;
    const mono = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) mono[i] += d[i] / buf.numberOfChannels;
    }
    const a = Math.max(0, Math.floor(start * AUDIO_RATE));
    const b = Math.min(n, Math.ceil(end * AUDIO_RATE));
    return mono.slice(a, Math.max(a, b));
  } catch {
    return null;
  }
}
