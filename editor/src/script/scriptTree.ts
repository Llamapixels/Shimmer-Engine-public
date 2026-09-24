/**
 * Immutable operations on nested event scripts, for the drag-and-drop
 * editor. A script is a list of events; some events own nested lists
 * ("then"/"else" branches, or a menu's per-option "then"). A ListPath
 * says how to walk from the root list down to one of those nested
 * lists: each step is "the event at this index, then its X slot".
 */

import type { EventScript, ScriptEventJSON } from "../../shared/eventTypes";
import { getEventDef } from "./eventCatalog";

/** A branch key (from that event type's EventDef.branches - "then"/
 * "else"/"body"/"children" today, more as new branching events are
 * added), or a menu option index. */
export type Slot = "then" | "else" | "body" | "children" | number;

/** This event type's own branch keys (empty for a leaf event, or for
 * "menu" which uses numeric option-index slots instead - see
 * childSlots()). Driven entirely by eventCatalog.ts's EventDef.branches
 * so a new branching event type needs no changes here. */
function branchKeys(ev: ScriptEventJSON): Slot[] {
  return (getEventDef(ev.type)?.branches?.map((b) => b.key) ?? []) as Slot[];
}

export interface PathStep {
  index: number;
  slot: Slot;
}

export type ListPath = PathStep[];

/** Where an event sits: which list, and its position in it. */
export interface EventLocation {
  path: ListPath;
  index: number;
}

// ---------------------------------------------------------------------------
// Stable keys
// ---------------------------------------------------------------------------
//
// Events have no ids in the JSON (and shouldn't - the compiler owns that
// format). React still needs stable keys so that editing a field doesn't
// remount the block (losing input focus) and dragging a block moves its
// DOM node rather than shuffling contents. A WeakMap from event object to
// id does it without adding anything to the saved file: every edit goes
// through replaceEvent(), which hands the old object's id to the new one.

const ids = new WeakMap<object, string>();
let nextId = 1;

export function eventKey(ev: object): string {
  let id = ids.get(ev);
  if (!id) {
    id = `ev${nextId++}`;
    ids.set(ev, id);
  }
  return id;
}

function carryKey<T extends object>(from: object, to: T): T {
  ids.set(to, eventKey(from));
  return to;
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Where the event with this React key currently is (null if it's gone).
 * Used by anything that edits an event *later* - a tile pick, a typed
 * field - so it finds the event by identity even if events were added,
 * moved or deleted around it in the meantime. */
export function findByKey(root: EventScript, key: string, path: ListPath = []): EventLocation | null {
  for (let i = 0; i < root.length; i++) {
    const ev = root[i];
    if (ids.get(ev) === key) return { path, index: i };
    for (const slot of childSlots(ev)) {
      const inner = getSlotList(ev, slot);
      if (!inner) continue;
      const hit = findByKey(inner, key, [...path, { index: i, slot }]);
      if (hit) return hit;
    }
  }
  return null;
}

export function getSlotList(ev: ScriptEventJSON, slot: Slot): EventScript | undefined {
  if (typeof slot === "number") {
    return ev.type === "menu" ? ev.options[slot]?.then : undefined;
  }
  if (!branchKeys(ev).includes(slot)) return undefined;
  return (ev as unknown as Record<string, EventScript | undefined>)[slot];
}

export function getList(root: EventScript, path: ListPath): EventScript {
  let list = root;
  for (const step of path) {
    const ev = list[step.index];
    if (!ev) return [];
    list = getSlotList(ev, step.slot) ?? [];
  }
  return list;
}

export function getEvent(root: EventScript, loc: EventLocation): ScriptEventJSON | undefined {
  return getList(root, loc.path)[loc.index];
}

// ---------------------------------------------------------------------------
// Writing (all immutable - return a new root)
// ---------------------------------------------------------------------------

function withSlotList(ev: ScriptEventJSON, slot: Slot, list: EventScript): ScriptEventJSON {
  if (typeof slot === "number") {
    if (ev.type !== "menu") return ev;
    const options = ev.options.slice();
    options[slot] = { ...options[slot], then: list };
    return carryKey(ev, { ...ev, options });
  }
  return carryKey(ev, { ...ev, [slot]: list } as ScriptEventJSON);
}

export function setList(root: EventScript, path: ListPath, list: EventScript): EventScript {
  if (path.length === 0) return list;
  const [step, ...rest] = path;
  const ev = root[step.index];
  if (!ev) return root;
  const inner = getSlotList(ev, step.slot) ?? [];
  const next = root.slice();
  next[step.index] = withSlotList(ev, step.slot, setList(inner, rest, list));
  return next;
}

export function updateList(root: EventScript, path: ListPath, fn: (list: EventScript) => EventScript): EventScript {
  return setList(root, path, fn(getList(root, path)));
}

/** Replace one event with an edited copy, keeping its React key. */
export function replaceEvent(root: EventScript, loc: EventLocation, next: ScriptEventJSON): EventScript {
  return updateList(root, loc.path, (list) => {
    const old = list[loc.index];
    if (!old) return list;
    const copy = list.slice();
    copy[loc.index] = carryKey(old, next);
    return copy;
  });
}

export function insertEvents(root: EventScript, path: ListPath, index: number, events: ScriptEventJSON[]): EventScript {
  return updateList(root, path, (list) => {
    const copy = list.slice();
    copy.splice(Math.max(0, Math.min(index, copy.length)), 0, ...events);
    return copy;
  });
}

export function removeEvent(root: EventScript, loc: EventLocation): EventScript {
  return updateList(root, loc.path, (list) => list.filter((_, i) => i !== loc.index));
}

/** Deep copy with fresh keys everywhere - for duplicate/paste/alt-drag
 * copy, so the copy never shares identity with the original. */
export function cloneEvent<T extends ScriptEventJSON>(ev: T): T {
  return JSON.parse(JSON.stringify(ev)) as T;
}

/** Removes the event object `target` (by identity) wherever it is in
 * the tree. */
function removeByRef(list: EventScript, target: ScriptEventJSON): EventScript {
  let changed = false;
  const out: EventScript = [];
  for (const ev of list) {
    if (ev === target) {
      changed = true;
      continue;
    }
    let next = ev;
    if (ev.type === "menu") {
      let optChanged = false;
      const options = ev.options.map((o) => {
        if (!o.then) return o;
        const t = removeByRef(o.then, target);
        if (t !== o.then) {
          optChanged = true;
          return { ...o, then: t };
        }
        return o;
      });
      if (optChanged) next = carryKey(ev, { ...ev, options });
    } else {
      for (const slot of branchKeys(ev)) {
        const inner = (next as unknown as Record<string, EventScript | undefined>)[slot as string];
        if (!inner) continue;
        const r = removeByRef(inner, target);
        if (r !== inner) next = carryKey(ev, { ...next, [slot as string]: r } as ScriptEventJSON);
      }
    }
    if (next !== ev) changed = true;
    out.push(next);
  }
  return changed ? out : list;
}

/** True if `inner` is `outer` itself or a list nested inside the event at
 * `outer` - i.e. dropping `outer`'s event there would put it inside
 * itself. */
export function isInside(eventLoc: EventLocation, listPath: ListPath): boolean {
  const own = [...eventLoc.path, { index: eventLoc.index, slot: "then" as Slot }];
  if (listPath.length < own.length) return false;
  for (let i = 0; i < eventLoc.path.length; i++) {
    const a = eventLoc.path[i];
    const b = listPath[i];
    if (a.index !== b.index || a.slot !== b.slot) return false;
  }
  return listPath[eventLoc.path.length].index === eventLoc.index;
}

function samePath(a: ListPath, b: ListPath): boolean {
  return a.length === b.length && a.every((s, i) => s.index === b[i].index && s.slot === b[i].slot);
}

/**
 * Move (or copy) the event at `from` so it lands at position `toIndex`
 * of the list at `toPath` - where toIndex is counted in the list as it
 * is *before* the move. Works across any nesting levels: insert a copy
 * at the destination first (paths are still valid, nothing has shifted
 * yet), then remove the original by object identity (which doesn't
 * care what shifted). Returns null for an impossible drop (into itself).
 */
export function moveEvent(
  root: EventScript,
  from: EventLocation,
  toPath: ListPath,
  toIndex: number,
  copy = false,
): EventScript | null {
  const original = getEvent(root, from);
  if (!original) return null;
  if (isInside(from, toPath)) return null;

  // Dropping right where it already is: no-op.
  if (!copy && samePath(from.path, toPath) && (toIndex === from.index || toIndex === from.index + 1)) {
    return root;
  }

  const moved = copy ? cloneEvent(original) : carryKey(original, cloneEvent(original));
  const inserted = insertEvents(root, toPath, toIndex, [moved]);
  return copy ? inserted : removeByRef(inserted, original);
}

/** Every nested list inside one event, with the slot that reaches it. */
export function childSlots(ev: ScriptEventJSON): Slot[] {
  if (ev.type === "menu") return ev.options.map((_, i) => i);
  return branchKeys(ev);
}

/** Calls fn on every event in the tree (depth-first, parents first). */
export function walkEvents(list: EventScript | undefined, fn: (ev: ScriptEventJSON) => void): void {
  if (!list) return;
  for (const ev of list) {
    fn(ev);
    for (const slot of childSlots(ev)) walkEvents(getSlotList(ev, slot), fn);
  }
}

/** Rebuilds a tree bottom-up, letting fn replace any event (after its
 * children have been mapped). Used for rename-everywhere. */
export function mapEvents(list: EventScript | undefined, fn: (ev: ScriptEventJSON) => ScriptEventJSON): EventScript | undefined {
  if (!list) return list;
  let changed = false;
  const out = list.map((ev) => {
    let next = ev;
    for (const slot of childSlots(ev)) {
      const inner = getSlotList(next, slot);
      const mapped = mapEvents(inner, fn);
      if (mapped !== inner && mapped) next = withSlotList(next, slot, mapped);
    }
    next = fn(next);
    if (next !== ev) {
      changed = true;
      carryKey(ev, next);
    }
    return next;
  });
  return changed ? out : list;
}
