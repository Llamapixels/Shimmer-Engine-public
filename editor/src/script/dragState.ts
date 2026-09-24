import { create } from "zustand";

import type { EventLocation, ListPath } from "./scriptTree";

/**
 * Drag-and-drop state for the script editor. HTML5 drag events don't
 * let a dragover handler read what's being dragged (dataTransfer is
 * locked until drop), so the source lives here instead. `rootId` names
 * which script the drag started in - dropping only works within the
 * same script (use Copy/Paste to move events between scripts).
 */
interface DragState {
  source: { rootId: string; from: EventLocation } | null;
  /** Set a tick after the drag starts: which block to show dimmed. Kept
   * separate from `source` so the browser snapshots the drag image
   * before the block dims, while drop targets still see the source
   * immediately (a fast drag can reach a drop zone within that tick). */
  dimmed: { rootId: string; from: EventLocation } | null;
  /** Where the insertion line is currently drawn. */
  target: { rootId: string; path: ListPath; index: number } | null;
  start: (rootId: string, from: EventLocation) => void;
  setTarget: (t: DragState["target"]) => void;
  end: () => void;
}

export const useDragState = create<DragState>((set) => ({
  source: null,
  dimmed: null,
  target: null,
  start: (rootId, from) => {
    set({ source: { rootId, from }, target: null });
    setTimeout(() => set((s) => (s.source ? { dimmed: s.source } : s)), 0);
  },
  setTarget: (target) =>
    set((s) => {
      const a = s.target;
      if (
        a &&
        target &&
        a.rootId === target.rootId &&
        a.index === target.index &&
        a.path.length === target.path.length &&
        a.path.every((p, i) => p.index === target.path[i].index && p.slot === target.path[i].slot)
      ) {
        return s;
      }
      return { target };
    }),
  end: () => set({ source: null, dimmed: null, target: null }),
}));

export function pathKey(path: ListPath): string {
  return path.map((p) => `${p.index}.${p.slot}`).join("/");
}
