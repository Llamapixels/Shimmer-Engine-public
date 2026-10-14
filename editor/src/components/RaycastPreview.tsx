/*
 * First Person 3D scenes: a live preview of the view the game shows, over
 * the map canvas. Walk it with the keyboard (as the GBA's buttons do),
 * fire the weapon, or put the camera on a tile; it redraws as the scene is
 * painted.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { NpcJSON, ProjectJSON, SceneJSON } from "../../shared/projectTypes";
import type { SpriteImage } from "../sprites/image";
import { loadSpriteImage } from "../sprites/image";
import type { Facing } from "../sprites/model";
import { drawActor, drawAnimationFrame, sheetFor } from "../sprites/render";
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
  type ViewOptions,
} from "../world/raycastPreview";
import type { TextureImages } from "./RaycastTools";

const SCALE = 4;
/** Engine speeds: walking 1/8 tile a frame (rc_walk 1), a turn per frame
 * by rc_turn, falls speeding up by gravity. */
const TURN = [6, 10, 16].map((t) => (t / 1024) * Math.PI * 2);
const GRAVITY = [16, 24, 36].map((g) => g / 256);

const KEYS: Record<string, "fwd" | "back" | "left" | "right" | "sl" | "sr" | "fire" | "alt" | "jump" | "run"> = {
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
  " ": "fire",
  f: "alt",
  j: "jump",
  shift: "run",
};

/** The engine settings the preview follows. */
export interface PreviewSettings extends ViewOptions {
  walk: number;
  run: number | null;
  turn: number;
  gravity: number;
  jump: number | null;
  turnActors: boolean;
  weaponBob: boolean;
}

const FACINGS: Facing[] = ["down", "up", "right", "left"];

/** An actor's first frame facing each way, on the engine's 64x64 canvas. */
function actorPixels(img: SpriteImage | undefined, project: ProjectJSON, name: string): Billboard["px"] | null {
  if (!img) return null;
  const sheet = sheetFor(project, name, img);
  if (!sheet) return null;
  const out = {} as Billboard["px"];
  for (const f of FACINGS) {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingEnabled = false;
    drawActor(ctx, img, sheet, f, 24, 48, 1);
    out[f] = { w: 64, h: 64, data: new Uint32Array(ctx.getImageData(0, 0, 64, 64).data.buffer.slice(0)) };
  }
  return out;
}

/** The sky picture (scenes-relative path), as pixels. */
function useSkyPixels(rootPath: string | null, ref: string | undefined): Pixels | null {
  const [px, setPx] = useState<Pixels | null>(null);
  useEffect(() => {
    setPx(null);
    if (!rootPath || !ref) return;
    let cancelled = false;
    window.api
      .readAsset({ rootPath, relPath: `scenes/${ref}`, base: "project" })
      .then((r) => {
        if (!r.ok || cancelled) return;
        const im = new Image();
        im.onload = () => {
          if (cancelled) return;
          const h = Math.min(im.height, VIEW_H);
          const c = document.createElement("canvas");
          c.width = im.width;
          c.height = h;
          const ctx = c.getContext("2d", { willReadFrequently: true })!;
          ctx.drawImage(im, 0, 0);
          setPx({ w: im.width, h, data: new Uint32Array(ctx.getImageData(0, 0, im.width, h).data.buffer.slice(0)) });
        };
        im.src = r.value.dataUrl;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rootPath, ref]);
  return px;
}

/** The weapon sprite's image. */
function useWeapon(rootPath: string | null, name: string | undefined): SpriteImage | null {
  const [img, setImg] = useState<SpriteImage | null>(null);
  useEffect(() => {
    setImg(null);
    if (!rootPath || !name) return;
    let cancelled = false;
    window.api
      .readAsset({ rootPath, relPath: `assets/sprites/${name}.png`, base: "project" })
      .then((r) => (r.ok ? loadSpriteImage(r.value.dataUrl) : null))
      .then((im) => !cancelled && im && setImg(im))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [rootPath, name]);
  return img;
}

export default function RaycastPreview({
  scene,
  w,
  h,
  textures,
  sheets,
  project,
  playerSprite,
  settings,
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
  settings: PreviewSettings;
  camera: Camera | null;
  onCamera: (c: Camera) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const setTilePick = useProjectStore((s) => s.setTilePick);
  const rootPath = useProjectStore((s) => s.project?.rootPath ?? null);
  const [focused, setFocused] = useState(false);
  const skyPx = useSkyPixels(rootPath, scene.raycast?.sky);
  const weaponImg = useWeapon(rootPath, scene.raycast?.weapon);
  /** Weapon animation: which (0 idle, 4 walking, 2 fire, 3 alt) and its frame. */
  const [weapon, setWeapon] = useState({ anim: 0, frame: 0, bob: 0 });

  const texPixels = useMemo(() => {
    const out: Record<string, Pixels> = {};
    for (const [name, img] of Object.entries(textures.images)) out[name] = pixelsOf(img as HTMLImageElement);
    return out;
  }, [textures.images]);
  const map = useMemo(() => buildMap(scene, w, h, texPixels, skyPx), [scene, w, h, texPixels, skyPx]);
  const boards = useMemo(() => {
    if (!project) return [];
    const out: Billboard[] = [];
    for (const npc of (scene.npcs ?? []) as NpcJSON[]) {
      if (npc.pinned) continue;
      const name = npc.sprite || playerSprite;
      const px = actorPixels(sheets[name], project, name);
      if (px) out.push({ x: npc.x + 1, y: npc.y + 1, facing: (npc.direction ?? "down") as Facing, px });
    }
    return out;
  }, [scene.npcs, sheets, project, playerSprite]);

  // Start at the player's start.
  const cam = camera ?? startCamera(map, scene);
  useEffect(() => {
    if (!camera) onCamera(startCamera(map, scene));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera === null]);

  // Draw (the settings object is new each render: compare its content).
  const settingsKey = JSON.stringify(settings);
  const buf = useMemo(() => new ImageData(VIEW_W, VIEW_H), []);
  const small = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = VIEW_W;
    c.height = VIEW_H;
    return c;
  }, []);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    renderView(map, cam, boards, settings, settings.turnActors, new Uint32Array(buf.data.buffer));
    small.getContext("2d")!.putImageData(buf, 0, 0);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(small, 0, 0, c.width, c.height);
    // The weapon: bottom centre of the 240x160 screen (2 screen px a view px).
    const name = scene.raycast?.weapon;
    if (weaponImg && project && name) {
      const sheet = sheetFor(project, name, weaponImg);
      if (sheet) {
        const k = SCALE / 2;
        const bob = settings.weaponBob ? weapon.bob : 0;
        const x = 112 + (scene.raycast?.weapon_x ?? 0) + Math.round(Math.cos(bob) * 4 * (bob ? 1 : 0));
        const y = 144 + (scene.raycast?.weapon_y ?? 0) + Math.round(Math.abs(Math.sin(bob * 2)) * 3);
        if (!drawAnimationFrame(ctx, weaponImg, sheet, weapon.anim, weapon.frame, x * k, y * k, k))
          drawAnimationFrame(ctx, weaponImg, sheet, 0, 0, x * k, y * k, k);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, cam.x, cam.y, cam.angle, cam.floor, boards, buf, small, settingsKey, weaponImg, weapon, project, scene.raycast]);

  // Walk: keys held, stepped at the game's 60 frames a second.
  const held = useRef(new Set<string>());
  const camRef = useRef(cam);
  camRef.current = cam;
  const mapRef = useRef(map);
  mapRef.current = map;
  const setRef = useRef(settings);
  setRef.current = settings;
  const raf = useRef<number | null>(null);
  const vz = useRef(0);
  const air = useRef(0);   // height above the floor while jumping
  const fire = useRef({ anim: 0, left: 0 });
  const bob = useRef(0);
  const fall = useRef(0);
  const tick = (last: number) => (now: number) => {
    let frames = Math.min(6, Math.round((now - last) / (1000 / 60)));
    let c = camRef.current;
    const k = held.current;
    const st = setRef.current;
    let walking = false;
    for (; frames > 0; frames--) {
      const a = c.angle + ((k.has("right") ? 1 : 0) - (k.has("left") ? 1 : 0)) * (TURN[st.turn] ?? TURN[1]);
      const speed = k.has("run") && st.run ? st.run : st.walk;
      const fwd = ((k.has("fwd") ? 1 : 0) - (k.has("back") ? 1 : 0)) * speed;
      const side = ((k.has("sr") ? 1 : 0) - (k.has("sl") ? 1 : 0)) * speed;
      const moved = walk(mapRef.current, { ...c, angle: a, floor: c.floor + air.current }, fwd, side, st);
      walking ||= moved.x !== c.x || moved.y !== c.y;
      c = { ...moved, floor: c.floor };
      // Jumping (J), then falling back.
      if (k.has("jump") && st.jump && air.current === 0 && vz.current === 0) vz.current = Math.sqrt(2 * (GRAVITY[st.gravity] ?? GRAVITY[1]) * st.jump);
      if (vz.current !== 0 || air.current > 0) {
        vz.current -= GRAVITY[st.gravity] ?? GRAVITY[1];
        air.current += vz.current;
        if (air.current <= 0) {
          air.current = 0;
          vz.current = 0;
        }
      }
      const before = c.floor;
      c = settle(mapRef.current, c, fall.current + (GRAVITY[st.gravity] ?? GRAVITY[1]), st);
      fall.current = c.floor < before ? fall.current + (GRAVITY[st.gravity] ?? GRAVITY[1]) : 0;
      if (c.floor > before && air.current > 0) air.current = Math.max(0, air.current - (c.floor - before));   // landed on a ledge
      if (walking) bob.current += 0.11 * speed * 8;
      // Fire (Space) / Alt fire (F): the weapon's animation plays once.
      if (fire.current.left > 0) fire.current.left--;
    }
    const shown = air.current ? { ...c, floor: c.floor + air.current } : c;
    if (shown !== camRef.current) onCamera(shown);
    const f = fire.current;
    setWeapon({ anim: f.left > 0 ? f.anim : walking ? 4 : 0, frame: f.left > 0 ? Math.floor((now / 1000) * 15) : Math.floor(now / 133), bob: walking ? bob.current : 0 });
    raf.current = k.size || fall.current || air.current || f.left > 0 ? requestAnimationFrame(tick(now)) : null;
    if (!raf.current) setWeapon((w0) => ({ ...w0, anim: 0, frame: 0, bob: 0 }));
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
        <span className="rc-preview-hint">
          {focused ? "W/S walk · A/D turn · Q/E strafe · Space fire · F alt · J jump · Shift run" : "Click the view, then walk with the keys"}
        </span>
        <button
          className="btn btn-small"
          title="Click a tile on the map to put the camera there"
          onClick={() =>
            setTilePick({
              label: "where the 3D camera stands",
              onPick: (x, y) => onCamera(settle(map, { ...cam, x: x + 0.5, y: y + 0.5, floor: 0 }, 255, settings)),
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
          if ((k === "fire" || k === "alt") && !e.repeat && fire.current.left === 0) {
            const anim = k === "fire" ? 2 : 3;
            const sheet = weaponImg && project && scene.raycast?.weapon ? sheetFor(project, scene.raycast.weapon, weaponImg) : null;
            const frames = sheet?.states[0]?.animations[anim]?.frames.length || sheet?.states[0]?.animations[2]?.frames.length || 1;
            fire.current = { anim: sheet?.states[0]?.animations[anim]?.frames.length ? anim : 2, left: Math.max(8, frames * 4) };
          }
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
