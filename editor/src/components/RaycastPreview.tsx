/*
 * First Person 3D scenes: a live preview of the view the game shows, over
 * the map canvas. Walk it with the keyboard (as the GBA's buttons do) or
 * put the camera on a tile; it redraws as the scene is painted.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { NpcJSON, ProjectJSON, SceneJSON } from "../../shared/projectTypes";
import type { SpriteImage } from "../sprites/image";
import type { Facing } from "../sprites/model";
import { drawActor, sheetFor } from "../sprites/render";
import { useProjectStore } from "../state/projectStore";
import {
  buildMap,
  pixelsOf,
  renderView,
  settle,
  startCamera,
  VIEW_H,
  VIEW_W,
  walk,
  type Billboard,
  type Camera,
  type Pixels,
} from "../world/raycastPreview";
import type { TextureImages } from "./RaycastTools";

const SCALE = 4;
/** Engine speeds: 1 px (1/8 tile) a frame walking, 10/1024 of a turn a
 * frame turning (rc_turn "Normal"), falls speeding up 24/256 units a frame. */
const WALK = 1 / 8;
const TURN = (10 / 1024) * Math.PI * 2;
const FALL = 24 / 256;

const KEYS: Record<string, "fwd" | "back" | "left" | "right" | "sl" | "sr"> = {
  arrowup: "fwd",
  w: "fwd",
  arrowdown: "back",
  s: "back",
  arrowleft: "left",
  a: "left",
  arrowright: "right",
  d: "right",
  q: "sl",
  e: "sr",
};

/** An actor's first frame on the engine's 64x64 billboard canvas. */
function actorPixels(npc: NpcJSON, img: SpriteImage | undefined, project: ProjectJSON, name: string): Pixels | null {
  if (!img) return null;
  const sheet = sheetFor(project, name, img);
  if (!sheet) return null;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingEnabled = false;
  if (!drawActor(ctx, img, sheet, (npc.direction ?? "down") as Facing, 24, 48, 1)) return null;
  return { w: 64, h: 64, data: new Uint32Array(ctx.getImageData(0, 0, 64, 64).data.buffer.slice(0)) };
}

export default function RaycastPreview({
  scene,
  w,
  h,
  textures,
  sheets,
  project,
  playerSprite,
  camera,
  onCamera,
  onClose,
}: {
  scene: SceneJSON;
  w: number;
  h: number;
  textures: TextureImages;
  sheets: Record<string, SpriteImage>;
  project: ProjectJSON | undefined;
  playerSprite: string;
  camera: Camera | null;
  onCamera: (c: Camera) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const setTilePick = useProjectStore((s) => s.setTilePick);
  const [focused, setFocused] = useState(false);

  const texPixels = useMemo(() => {
    const out: Record<string, Pixels> = {};
    for (const [name, img] of Object.entries(textures.images)) out[name] = pixelsOf(img as HTMLImageElement);
    return out;
  }, [textures.images]);
  const map = useMemo(() => buildMap(scene, w, h, texPixels), [scene, w, h, texPixels]);
  const boards = useMemo(() => {
    if (!project) return [];
    const out: Billboard[] = [];
    for (const npc of scene.npcs ?? []) {
      if (npc.pinned) continue;
      const name = npc.sprite || playerSprite;
      const px = actorPixels(npc, sheets[name], project, name);
      if (px) out.push({ x: npc.x + 1, y: npc.y + 1, px });
    }
    return out;
  }, [scene.npcs, sheets, project, playerSprite]);

  // Start at the player's start.
  const cam = camera ?? startCamera(map, scene);
  useEffect(() => {
    if (!camera) onCamera(startCamera(map, scene));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera === null]);

  // Draw.
  const buf = useMemo(() => new ImageData(VIEW_W, VIEW_H), []);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    renderView(map, cam, boards, new Uint32Array(buf.data.buffer));
    const small = document.createElement("canvas");
    small.width = VIEW_W;
    small.height = VIEW_H;
    small.getContext("2d")!.putImageData(buf, 0, 0);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, c.width, c.height);
  }, [map, cam.x, cam.y, cam.angle, cam.floor, boards, buf]);

  // Walk: keys held, stepped at the game's 60 frames a second.
  const held = useRef(new Set<string>());
  const camRef = useRef(cam);
  camRef.current = cam;
  const mapRef = useRef(map);
  mapRef.current = map;
  const raf = useRef<number | null>(null);
  const fall = useRef(0);
  const tick = (last: number) => (now: number) => {
    let frames = Math.min(6, Math.round((now - last) / (1000 / 60)));
    let c = camRef.current;
    const k = held.current;
    for (; frames > 0; frames--) {
      const a = c.angle + ((k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0)) * TURN;
      c = walk(mapRef.current, { ...c, angle: a }, ((k.has("fwd") ? 1 : 0) - (k.has("back") ? 1 : 0)) * WALK, ((k.has("sr") ? 1 : 0) - (k.has("sl") ? 1 : 0)) * WALK);
      const before = c.floor;
      fall.current += FALL;
      c = settle(mapRef.current, c, fall.current);
      if (c.floor >= before) fall.current = 0;
    }
    if (c !== camRef.current) onCamera(c);
    raf.current = k.size || fall.current ? requestAnimationFrame(tick(now)) : null;
  };
  const start = () => {
    if (raf.current === null) raf.current = requestAnimationFrame(tick(performance.now()));
  };
  useEffect(
    () => () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    },
    [],
  );
  // The map changed under the camera (a lift, a painted floor): settle.
  useEffect(() => {
    fall.current = 0;
    start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  return (
    <div className="rc-preview" onMouseDown={(e) => e.stopPropagation()}>
      <div className="rc-preview-head">
        <b>3D preview</b>
        <span className="rc-preview-hint">{focused ? "W/S or ↑/↓ walk · A/D or ←/→ turn · Q/E strafe" : "Click the view, then walk with the keys"}</span>
        <button
          className="btn btn-small"
          title="Click a tile on the map to put the camera there"
          onClick={() =>
            setTilePick({
              label: "where the 3D camera stands",
              onPick: (x, y) => {
                const c = settle(map, { ...cam, x: x + 0.5, y: y + 0.5, floor: 0 }, 255);
                onCamera(c);
              },
            })
          }
        >
          Place camera
        </button>
        <button className="btn btn-small" title="Back to the player's start" onClick={() => onCamera(startCamera(map, scene))}>
          Start
        </button>
        <button className="icon-btn" title="Close the preview" onClick={onClose}>
          ×
        </button>
      </div>
      <canvas
        ref={ref}
        width={VIEW_W * SCALE}
        height={VIEW_H * SCALE}
        className={`rc-preview-canvas${focused ? " rc-preview-canvas-focus" : ""}`}
        tabIndex={0}
        data-testid="rc-preview"
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          held.current.clear();
        }}
        onKeyDown={(e) => {
          const k = KEYS[e.key.toLowerCase()];
          if (!k) return;
          e.preventDefault();
          e.stopPropagation();
          held.current.add(k);
          start();
        }}
        onKeyUp={(e) => {
          const k = KEYS[e.key.toLowerCase()];
          if (!k) return;
          e.stopPropagation();
          held.current.delete(k);
        }}
      />
    </div>
  );
}
