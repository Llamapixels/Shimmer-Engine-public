/**
 * Find / rename references to project-wide names (flags, items,
 * variables) and scene names across every script in the project, so
 * renaming one in Settings (or renaming a scene) doesn't silently break
 * scripts that point at the old name. Driven by the field kinds in
 * eventCatalog.ts, so a new event type with a "flag" field is covered
 * automatically.
 */

import type { EventScript, ScriptEventJSON } from "../../shared/eventTypes";
import type { SceneJSON } from "../../shared/projectTypes";
import { getEventDef } from "./eventCatalog";
import { mapEvents, walkEvents } from "./scriptTree";

/** flag/item/variable/scene are project-wide; actor/timer names are
 * scoped to one scene (only rename them within that scene). */
export type RefKind = "flag" | "item" | "variable" | "scene" | "actor" | "timer" | "music";

const VAR_IN_TEXT = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Every script list a scene owns. */
export function sceneScripts(scene: SceneJSON): (EventScript | undefined)[] {
  return [
    scene.on_init,
    ...(scene.doors ?? []).map((d) => d.events),
    ...(scene.npcs ?? []).map((n) => n.on_interact),
    ...(scene.timers ?? []).map((t) => t.script),
  ];
}

function textFields(ev: ScriptEventJSON): string[] {
  if (ev.type === "text") return [ev.text];
  if (ev.type === "choice") return [ev.prompt, ...ev.options];
  if (ev.type === "menu") return ev.options.map((o) => o.label);
  return [];
}

/** A name inside an expression string (see compiler/expr.py): a
 * variable ($name$ or a bare name), or a function's name argument -
 * flag(x), item(x), actor_x/actor_y/actor_dir(x), peek(slot, variable).
 * start/end cover just the name, not its $...$ or quotes. */
interface ExprRef {
  kind: RefKind;
  name: string;
  start: number;
  end: number;
}

/** Per-argument kinds of the functions whose arguments are names (null
 * = a button name, never renamed; undefined = an ordinary expression). */
const NAME_ARG_FUNCS: Record<string, (RefKind | null | undefined)[]> = {
  actor_x: ["actor"],
  actor_y: ["actor"],
  actor_dir: ["actor"],
  held: [null],
  pressed: [null],
  flag: ["flag"],
  item: ["item"],
  peek: [undefined, "variable"],
};
const EXPR_FUNCS = new Set([...Object.keys(NAME_ARG_FUNCS), "min", "max", "abs", "rnd", "isqrt", "saved", "scene", "time"]);
const EXPR_TOKEN = /\$([^$]+)\$|\d\w*|([A-Za-z_][A-Za-z0-9_]*)|"([^"]*)"|'([^']*)'|(\S)/g;

export function expressionRefs(expr: string): ExprRef[] {
  const tokens = [...expr.matchAll(EXPR_TOKEN)];
  const refs: ExprRef[] = [];
  // Open name-argument calls: which argument we're in, at which depth.
  const calls: { kinds: (RefKind | null | undefined)[]; arg: number; depth: number }[] = [];
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const at = t.index ?? 0;
    const [, dollar, ident, dq, sq, punct] = t;
    const call = calls[calls.length - 1];
    const argKind = call && call.depth === depth ? call.kinds[call.arg] : undefined;
    if (punct === "(") depth += 1;
    else if (punct === ")") {
      if (call && call.depth === depth) calls.pop();
      depth -= 1;
    } else if (punct === ",") {
      if (call && call.depth === depth) call.arg += 1;
    } else if (argKind !== undefined) {
      // A name argument: a bare, $-wrapped or quoted name.
      const name = ident ?? dollar ?? dq ?? sq;
      const offset = ident !== undefined ? 0 : 1;
      if (argKind && name !== undefined) refs.push({ kind: argKind, name, start: at + offset, end: at + offset + name.length });
    } else if (dollar !== undefined) {
      refs.push({ kind: "variable", name: dollar, start: at + 1, end: at + 1 + dollar.length });
    } else if (ident !== undefined) {
      const low = ident.toLowerCase();
      const next = tokens[i + 1]?.[5];
      if (next === "(" && EXPR_FUNCS.has(low)) {
        if (NAME_ARG_FUNCS[low]) calls.push({ kinds: NAME_ARG_FUNCS[low], arg: 0, depth: depth + 1 });
      } else if (low !== "true" && low !== "false") {
        refs.push({ kind: "variable", name: ident, start: at, end: at + ident.length });
      }
    }
  }
  return refs;
}

function renameInExpression(expr: string, kind: RefKind, from: string, to: string): string {
  let out = expr;
  for (const r of expressionRefs(expr).reverse()) {
    if (r.kind === kind && r.name === from) out = out.slice(0, r.start) + to + out.slice(r.end);
  }
  return out;
}

function eventRefs(ev: ScriptEventJSON, kind: RefKind): string[] {
  const def = getEventDef(ev.type);
  const out: string[] = [];
  const rec = ev as unknown as Record<string, unknown>;
  if (def) {
    for (const f of def.fields) {
      const v = rec[f.key];
      if (f.kind === kind && typeof v === "string") out.push(v);
      if (f.kind === "optionalVariable" && kind === "variable" && typeof v === "string" && v) out.push(v);
      if (f.kind === "expression" && typeof v === "string") {
        for (const r of expressionRefs(v)) if (r.kind === kind) out.push(r.name);
      }
      if (kind === "variable" && f.kind === "varOrLiteral" && v && typeof v === "object" && "var" in v) {
        out.push((v as { var: string }).var);
      }
    }
  }
  if (kind === "variable") {
    for (const t of textFields(ev)) for (const m of t.matchAll(VAR_IN_TEXT)) out.push(m[1]);
  }
  return out;
}

/** How many times `name` is referenced across all scenes. */
export function countRefs(scenes: SceneJSON[], kind: RefKind, name: string): number {
  let n = 0;
  for (const scene of scenes) {
    for (const script of sceneScripts(scene)) {
      walkEvents(script, (ev) => {
        for (const r of eventRefs(ev, kind)) if (r === name) n += 1;
      });
    }
    if (kind === "scene") for (const d of scene.doors ?? []) if (d.target_scene === name) n += 1;
    if (kind === "music" && scene.music === name) n += 1;
  }
  return n;
}

function renameInEvent(ev: ScriptEventJSON, kind: RefKind, from: string, to: string | number): ScriptEventJSON {
  const def = getEventDef(ev.type);
  if (!def) return ev;
  const rec = { ...(ev as unknown as Record<string, unknown>) };
  let changed = false;
  for (const f of def.fields) {
    const v = rec[f.key];
    if ((f.kind === kind || (f.kind === "optionalVariable" && kind === "variable")) && v === from) {
      rec[f.key] = to;
      changed = true;
    }
    if (f.kind === "expression" && typeof v === "string" && typeof to === "string") {
      const renamed = renameInExpression(v, kind, from, to);
      if (renamed !== v) {
        rec[f.key] = renamed;
        changed = true;
      }
    }
    if (kind === "variable" && f.kind === "varOrLiteral" && v && typeof v === "object" && (v as { var?: string }).var === from) {
      rec[f.key] = { var: to };
      changed = true;
    }
  }
  if (kind === "variable" && typeof to === "string") {
    const swap = (t: string) => t.replace(VAR_IN_TEXT, (m, name: string) => (name === from ? `{${to}}` : m));
    if (ev.type === "text") {
      const t = swap(ev.text);
      if (t !== ev.text) {
        rec.text = t;
        changed = true;
      }
    } else if (ev.type === "choice") {
      const p = swap(ev.prompt);
      const o = ev.options.map(swap) as [string, string];
      if (p !== ev.prompt || o[0] !== ev.options[0] || o[1] !== ev.options[1]) {
        rec.prompt = p;
        rec.options = o;
        changed = true;
      }
    } else if (ev.type === "menu") {
      const opts = (rec.options as { label: string; then?: EventScript }[]).map((o) => ({ ...o, label: swap(o.label) }));
      if (opts.some((o, i) => o.label !== ev.options[i].label)) {
        rec.options = opts;
        changed = true;
      }
    }
  }
  return changed ? (rec as unknown as ScriptEventJSON) : ev;
}

/** Returns the scene with every reference renamed (same object if
 * nothing referenced it). */
export function renameRefsInScene(scene: SceneJSON, kind: RefKind, from: string, to: string | number): SceneJSON {
  if (kind === "music" && scene.music === from && typeof to === "string") {
    scene = { ...scene, music: to };
  }
  return mapSceneEvents(scene, (ev) => renameInEvent(ev, kind, from, to), kind === "scene" && typeof to === "string" ? { from, to } : null);
}

/** Placeholder written into events that pointed at a deleted NPC/timer by
 * number - shows up as "(not in this scene!)" in the editor and as a
 * clear "unknown actor" error from the compiler, instead of silently
 * pointing at whichever NPC slid into that slot. */
export const DELETED_REF = "(deleted)";

/** After deleting NPC/timer number `deleted` from a scene, fix every
 * numeric reference in that scene's scripts: higher numbers move down
 * by one, references to the deleted one become DELETED_REF. */
export function shiftIndexRefs(scene: SceneJSON, kind: "actor" | "timer", deleted: number): SceneJSON {
  return mapSceneEvents(
    scene,
    (ev) => {
      const def = getEventDef(ev.type);
      if (!def) return ev;
      const rec = ev as unknown as Record<string, unknown>;
      let out: Record<string, unknown> | null = null;
      for (const f of def.fields) {
        const v = rec[f.key];
        if (f.kind !== kind || typeof v !== "number") continue;
        if (v === deleted) (out ??= { ...rec })[f.key] = DELETED_REF;
        else if (v > deleted) (out ??= { ...rec })[f.key] = v - 1;
      }
      return out ? (out as unknown as ScriptEventJSON) : ev;
    },
    null,
  );
}

/** After deleting a custom script, fix every call_script event that
 * pointed at it (in scenes and in other custom scripts) to the
 * DELETED_REF sentinel, so it shows as "(deleted)" in the editor and
 * fails loudly at compile time instead of silently calling nothing. */
export function markDeletedCustomScript(scene: SceneJSON, deletedId: string): SceneJSON {
  return mapSceneEvents(
    scene,
    (ev) => (ev.type === "call_script" && ev.script === deletedId ? { ...ev, script: DELETED_REF } : ev),
    null,
  );
}

/** Same fix-up, for a bare EventScript (a custom script's own body, which
 * isn't scoped to a scene). */
export function markDeletedCustomScriptInScript(script: EventScript, deletedId: string): EventScript {
  return (
    mapEvents(script, (ev) =>
      ev.type === "call_script" && ev.script === deletedId ? { ...ev, script: DELETED_REF } : ev,
    ) ?? script
  );
}

function mapSceneEvents(
  scene: SceneJSON,
  fn: (ev: ScriptEventJSON) => ScriptEventJSON,
  sceneRename: { from: string; to: string } | null,
): SceneJSON {
  const kind = sceneRename ? "scene" : null;
  const from = sceneRename?.from;
  const to = sceneRename?.to;
  let changed = false;
  const mapScript = (s: EventScript | undefined) => {
    const r = mapEvents(s, fn);
    if (r !== s) changed = true;
    return r;
  };

  const next: SceneJSON = { ...scene };
  if (scene.on_init) next.on_init = mapScript(scene.on_init);
  if (scene.doors) {
    next.doors = scene.doors.map((d) => {
      let nd = d;
      if (d.events) {
        const e = mapScript(d.events);
        if (e !== d.events) nd = { ...nd, events: e };
      }
      if (kind === "scene" && d.target_scene === from) {
        nd = { ...nd, target_scene: to };
        changed = true;
      }
      return nd;
    });
  }
  if (scene.npcs) {
    next.npcs = scene.npcs.map((n) => {
      if (!n.on_interact) return n;
      const e = mapScript(n.on_interact);
      return e !== n.on_interact ? { ...n, on_interact: e } : n;
    });
  }
  if (scene.timers) {
    next.timers = scene.timers.map((t) => {
      if (!t.script) return t;
      const e = mapScript(t.script);
      return e !== t.script ? { ...t, script: e } : t;
    });
  }
  return changed ? next : scene;
}
