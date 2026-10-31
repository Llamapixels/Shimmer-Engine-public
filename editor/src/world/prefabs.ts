import type { DoorJSON, NpcJSON, PrefabJSON, SceneJSON } from "../../shared/projectTypes";

export const PREFAB_DRAG_TYPE = "application/x-shimmer-prefab";

/** Bounds are the rendered scene/canvas; this handles both zoom and scrolling. */
export function prefabDropTile(
  point: { clientX: number; clientY: number },
  bounds: { left: number; top: number; width: number; height: number },
  tileW: number, tileH: number, prefab: PrefabJSON,
): { x: number; y: number } | null {
  if (bounds.width <= 0 || bounds.height <= 0 || tileW <= 0 || tileH <= 0) return null;
  if (point.clientX < bounds.left || point.clientY < bounds.top ||
      point.clientX >= bounds.left + bounds.width || point.clientY >= bounds.top + bounds.height) return null;
  const t = prefab.template as Partial<DoorJSON>;
  const width = prefab.kind === "npc" ? 2 : t.width ?? 1;
  const height = prefab.kind === "npc" ? 2 : t.height ?? 1;
  return {
    x: Math.max(0, Math.min(tileW - width, Math.floor((point.clientX - bounds.left) * tileW / bounds.width))),
    y: Math.max(0, Math.min(tileH - height, Math.floor((point.clientY - bounds.top) * tileH / bounds.height))),
  };
}

export function prefabCopy(prefab: PrefabJSON, scene: SceneJSON, x: number, y: number, playerSprite: string) {
  const template = structuredClone(prefab.template);
  if (prefab.kind === "npc") {
    const t = template as Partial<NpcJSON>;
    const base = t.name || prefab.name.split("/").pop() || "Actor";
    const used = new Set((scene.npcs ?? []).map((n) => n.name));
    let name = base;
    for (let suffix = 2; used.has(name) || name === "self" || name === "player"; suffix++) name = `${base}_${suffix}`;
    return { kind: "npc" as const, value: { sprite: playerSprite, direction: "down", movement: "static", ...t, name, x, y } as NpcJSON };
  }
  return { kind: "door" as const, value: { width: 1, height: 1, ...template, x, y } as DoorJSON };
}
