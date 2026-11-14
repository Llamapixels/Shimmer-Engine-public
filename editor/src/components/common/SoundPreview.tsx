import { useProjectStore } from "../../state/projectStore";
import { loadAssetUrl } from "../views/assetImages";

/** The built-in sounds as the engine plays them (audio.c): a square tone
 * at this pitch for this many frames. */
const BUILT_IN: Record<string, [number, number]> = {
  blip: [880, 12],
  door: [440, 10],
  save: [660, 14],
  item: [1319, 15],
};

let ctx: AudioContext | null = null;
let current: HTMLAudioElement | null = null;

function playTone(freq: number, frames: number) {
  ctx ??= new AudioContext();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "square";
  osc.frequency.value = freq;
  gain.gain.value = 0.12;
  osc.connect(gain).connect(ctx.destination);
  const end = ctx.currentTime + frames / 60;
  gain.gain.setValueAtTime(0.12, end - 0.01);
  gain.gain.linearRampToValueAtTime(0, end);
  osc.start();
  osc.stop(end);
}

/** Play a sound by its name: a WAV from assets/sounds or a built-in one. */
export async function previewSound(name: string): Promise<void> {
  if (!name || name === "none") return;
  const tone = BUILT_IN[name];
  if (tone) {
    playTone(tone[0], tone[1]);
    return;
  }
  const { project, assets } = useProjectStore.getState();
  const asset = assets?.sounds.find((a) => a.name === name);
  if (!project || !asset) return;
  const url = await loadAssetUrl(project.rootPath, asset);
  if (!url) return;
  current?.pause();
  current = new Audio(url);
  void current.play();
}

/** A small ▶ button that plays the sound picked next to it. */
export default function SoundPreviewButton({ name }: { name: string }) {
  const playable = !!name && name !== "none";
  return (
    <button
      type="button"
      className="btn btn-small sound-preview-btn"
      disabled={!playable}
      title={playable ? `Listen to "${name}"` : "No sound picked"}
      onClick={() => void previewSound(name)}
    >
      ▶
    </button>
  );
}
