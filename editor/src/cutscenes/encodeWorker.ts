/// <reference lib="webworker" />
/**
 * Runs the cutscene encoder off the main thread so the editor stays
 * responsive while a video converts. Message in: { frames, settings };
 * out: { progress } ... then { cut } (or { error }).
 */
import { encodeCut, type CutSettings } from "./encoder";

self.onmessage = (e: MessageEvent<{ frames: ArrayBuffer[]; settings: CutSettings }>) => {
  try {
    const frames = e.data.frames.map((b) => new Uint8ClampedArray(b));
    let last = 0;
    const cut = encodeCut(frames, e.data.settings, (done, total) => {
      const now = Date.now();
      if (now - last > 100 || done === total) {
        last = now;
        self.postMessage({ progress: done / total });
      }
    });
    self.postMessage({ cut: cut.buffer }, [cut.buffer]);
  } catch (err) {
    self.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
