import { create } from "zustand";

import {
  cloneEvent,
  findByKey,
  getEvent,
  removeEvent,
  replaceEvent,
  type EventLocation,

} from "./scriptTree";
import type { EventScript, ScriptEventJSON } from "../../shared/eventTypes";

/**
 * Several selected event blocks in one script (Ctrl+click to add or remove
 * one, Shift+click for a run of them in the same list), for copying,
 * deleting, disabling or saving them together.
 */
interface SelectionState {
  rootId: string | null;
  keys: string[];
  /** The last block clicked: Shift+click selects from here. */
  anchor: { pathKey: string; index: number } | null;
  toggle: (rootId: string, key: string, anchor: { pathKey: string; index: number }) => void;
  setRun: (rootId: string, keys: string[]) => void;
  clear: () => void;
}

export const useEventSelection = create<SelectionState>((set, get) => ({
  rootId: null,
  keys: [],
  anchor: null,
  toggle: (rootId, key, anchor) => {
    const s = get();
    const keys = s.rootId === rootId ? s.keys : [];
    set({ rootId, keys: keys.includes(key) ? keys.filter((k) => k !== key) : [...keys, key], anchor });
  },
  setRun: (rootId, keys) => set({ rootId, keys }),
  clear: () => {
    if (get().keys.length || get().anchor) set({ rootId: null, keys: [], anchor: null });
  },
}));

/** Document order: a location as a list of numbers to compare. */
function orderOf(loc: EventLocation): number[] {
  const out: number[] = [];
  const rank: Record<string, number> = { then: 0, body: 0, children: 0, script: 0, else: 1 };
  for (const p of loc.path) out.push(p.index, typeof p.slot === "number" ? p.slot : (rank[p.slot] ?? 0));
  out.push(loc.index);
  return out;
}

function compare(a: number[], b: number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Is `inner` somewhere inside the event at `outer`? */
function within(inner: EventLocation, outer: EventLocation): boolean {
  const p = outer.path;
  if (inner.path.length <= p.length) return false;
  for (let i = 0; i < p.length; i++) if (inner.path[i].index !== p[i].index || inner.path[i].slot !== p[i].slot) return false;
  return inner.path[p.length].index === outer.index;
}

/** The selected events still in `root`, in document order, leaving out
 * any inside another selected one (it comes along with its parent). */
export function selectedLocations(root: EventScript, keys: string[]): EventLocation[] {
  const locs = keys.map((k) => findByKey(root, k)).filter((l): l is EventLocation => !!l);
  const top = locs.filter((l) => !locs.some((o) => o !== l && within(l, o)));
  return top.sort((a, b) => compare(orderOf(a), orderOf(b)));
}

export function selectedEvents(root: EventScript, keys: string[]): ScriptEventJSON[] {
  return selectedLocations(root, keys)
    .map((l) => getEvent(root, l))
    .filter((e): e is ScriptEventJSON => !!e)
    .map(cloneEvent);
}

/** Remove the selected events (last first, so earlier places don't move). */
export function removeSelected(root: EventScript, keys: string[]): EventScript {
  let r = root;
  for (const l of selectedLocations(root, keys).reverse()) r = removeEvent(r, l);
  return r;
}

/** Disable them all, or enable them all if they're all disabled already. */
export function toggleDisabled(root: EventScript, keys: string[]): EventScript {
  const locs = selectedLocations(root, keys);
  const allOff = locs.every((l) => !!getEvent(root, l)?.__disabled);
  let r = root;
  for (const l of locs) {
    const ev = getEvent(r, l);
    if (ev) r = replaceEvent(r, l, { ...ev, __disabled: allOff ? undefined : true });
  }
  return r;
}
