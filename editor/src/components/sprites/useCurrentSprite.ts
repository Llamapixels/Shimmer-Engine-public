import type { AssetInfo } from "../../../shared/ipc";
import type { SpriteAnimationJSON, SpriteFrameJSON, SpriteSheetJSON, SpriteStateJSON } from "../../../shared/projectTypes";
import { useSpriteEditor } from "../../sprites/editorStore";
import { useSpriteImage, type SpriteImage } from "../../sprites/image";
import { sheetFor } from "../../sprites/render";
import { useProjectStore } from "../../state/projectStore";
import { useAssetUrl } from "../views/assetImages";

export interface CurrentSprite {
  asset: AssetInfo | null;
  img: SpriteImage | null;
  sheet: SpriteSheetJSON | null;
  state: SpriteStateJSON | null;
  animIndex: number;
  anim: SpriteAnimationJSON | null;
  frames: SpriteFrameJSON[];
  frameIndex: number;
  frame: SpriteFrameJSON | null;
}

/** The sprite, state, animation and frame the Sprites section is showing. */
export function useCurrentSprite(): CurrentSprite {
  const rootPath = useProjectStore((s) => s.project?.rootPath);
  const project = useProjectStore((s) => s.project?.project);
  const sprites = useProjectStore((s) => s.assets?.sprites);
  const name = useSpriteEditor((s) => s.sprite);
  const stateId = useSpriteEditor((s) => s.stateId);
  const animIndex = useSpriteEditor((s) => s.animIndex);
  const frameIndex = useSpriteEditor((s) => s.frameIndex);

  const asset = sprites?.find((a) => a.name === name) ?? null;
  const url = useAssetUrl(rootPath, asset);
  const img = useSpriteImage(url);
  const sheet = project && asset ? sheetFor(project, asset.name, img) : null;
  const state = sheet ? (sheet.states.find((s) => s.id === stateId) ?? sheet.states[0] ?? null) : null;
  const anim = state?.animations[animIndex] ?? null;
  const frames = anim?.frames ?? [];
  const fi = Math.min(frameIndex, Math.max(0, frames.length - 1));
  return { asset, img, sheet, state, animIndex, anim, frames, frameIndex: fi, frame: frames[fi] ?? null };
}
