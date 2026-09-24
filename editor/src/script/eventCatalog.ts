/**
 * Every event type the script editor can show, in one table: label,
 * category, which fields it has (and what kind of widget each needs),
 * which nested branches it has, a default when added fresh, and a
 * one-line summary for collapsed blocks. The field "kind"s are also
 * what lets the Settings tab find/rename every reference to a flag,
 * item, or variable across all scripts - see scriptRefs.ts.
 *
 * Mirrors compiler/build_project.py's compile_events() - if a field or
 * event type changes there, it changes here.
 */

import type { EventScript, ScriptEventJSON } from "../../shared/eventTypes";

export type FieldKind =
  | "text"
  | "multiline"
  | "int"
  | "flag"
  | "item"
  | "variable"
  | "varOrLiteral"
  | "actor"
  | "timer"
  | "scene"
  | "customScript"
  | "sound"
  | "music"
  | "direction"
  | "buttons"
  | "compareOp"
  | "tilePos"
  | "choiceOptions"
  | "state"
  | "bool"
  | "collisionBox"
  | "mathOp"
  | "arrayOp"
  | "fadeColor";

export interface FieldDef {
  /** JSON key. For "tilePos" this is a prefix-less pair: the event's
   * own "x"/"y" keys. */
  key: string;
  label: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  placeholder?: string;
}

export type BranchKey = "then" | "else" | "body" | "children";

export type EventCategory =
  | "Dialogue"
  | "Flags"
  | "Items"
  | "Variables"
  | "Math"
  | "Control Flow"
  | "Actors"
  | "Camera"
  | "Scene"
  | "Timing & Input"
  | "Sound"
  | "Scripts"
  | "Misc";

export const CATEGORY_ORDER: EventCategory[] = [
  "Dialogue",
  "Flags",
  "Items",
  "Variables",
  "Math",
  "Control Flow",
  "Actors",
  "Camera",
  "Scene",
  "Timing & Input",
  "Sound",
  "Scripts",
  "Misc",
];

/** Stripe color per category on the block's left edge. The accent
 * purple is kept for selection/active states, so these are separate. */
export const CATEGORY_COLOR: Record<EventCategory, string> = {
  Dialogue: "#4f8cff",
  Flags: "#f2b84b",
  Items: "#e88b3a",
  Variables: "#3dd68c",
  Math: "#2fb8a6",
  "Control Flow": "#c9578a",
  Actors: "#40c8dc",
  Camera: "#b58cff",
  Scene: "#e5484d",
  "Timing & Input": "#9aa0ae",
  Sound: "#ff7ab6",
  Scripts: "#7a8cff",
  Misc: "#6b7280",
};

/** Context the defaults need (first known flag, etc.) so a freshly added
 * event is already valid when possible instead of pointing at nothing. */
export interface CreateContext {
  flags: string[];
  items: string[];
  variables: string[];
  sceneNames: string[];
  firstActor: string | number | null;
  firstTimer: string | number | null;
  /** id of the first project.customScripts[] entry, if any. */
  firstCustomScript: string | null;
  /** name of the first engine/music/*.mod-style asset, if any. */
  firstMusicTrack: string | null;
}

export interface EventDef {
  type: ScriptEventJSON["type"];
  label: string;
  category: EventCategory;
  description: string;
  fields: FieldDef[];
  branches?: { key: BranchKey; label: string }[];
  /** "menu" has its own per-option branch list instead. */
  menuOptions?: boolean;
  create: (ctx: CreateContext) => ScriptEventJSON;
  summary: (ev: ScriptEventJSON) => string;
}

const MAX_I16 = 32767;
const MIN_I16 = -32768;

function actorLabel(a: unknown): string {
  if (a === "self") return "self";
  if (a === "player") return "Player";
  if (typeof a === "number") return `NPC #${a}`;
  return String(a ?? "?");
}

function valLabel(v: unknown): string {
  if (v && typeof v === "object" && "var" in v) return `$${(v as { var: string }).var}`;
  return String(v ?? 0);
}

function short(text: string, n = 40): string {
  const oneLine = text.replace(/\n/g, " / ");
  return oneLine.length > n ? `${oneLine.slice(0, n - 1)}…` : oneLine;
}

const MATH_OP_SYMBOL: Record<import("../../shared/eventTypes").MathOp, string> = {
  add: "+",
  sub: "-",
  mul: "×",
  div: "÷",
  mod: "%",
};

// Helper so each summary gets its own narrowed event type.
function def<T extends ScriptEventJSON["type"]>(
  d: Omit<EventDef, "summary" | "create" | "type"> & {
    type: T;
    create: (ctx: CreateContext) => Extract<ScriptEventJSON, { type: T }>;
    summary: (ev: Extract<ScriptEventJSON, { type: T }>) => string;
  },
): EventDef {
  return d as unknown as EventDef;
}

export const EVENT_DEFS: EventDef[] = [
  // ---- Dialogue ----
  def({
    type: "text",
    label: "Display Text",
    category: "Dialogue",
    description: "Show a dialogue box. A new line starts a new page. Use {varname} to show a variable.",
    fields: [{ key: "text", label: "Text", kind: "multiline" }],
    create: () => ({ type: "text", text: "" }),
    summary: (ev) => `"${short(ev.text)}"`,
  }),
  def({
    type: "choice",
    label: "Yes/No Choice",
    category: "Dialogue",
    description: "Ask a two-option question. First option runs Then, second runs Else.",
    fields: [
      { key: "prompt", label: "Prompt", kind: "text" },
      { key: "options", label: "Options", kind: "choiceOptions" },
    ],
    branches: [
      { key: "then", label: "First option" },
      { key: "else", label: "Second option" },
    ],
    create: () => ({ type: "choice", prompt: "Are you sure?", options: ["Yes", "No"], then: [], else: [] }),
    summary: (ev) => `"${short(ev.prompt, 28)}" ${ev.options[0]}/${ev.options[1]}`,
  }),
  def({
    type: "menu",
    label: "Menu",
    category: "Dialogue",
    description: "A 2-4 option menu; each option runs its own events. Put a Display Text before it for a question.",
    fields: [],
    menuOptions: true,
    create: () => ({
      type: "menu",
      options: [
        { label: "Option 1", then: [] },
        { label: "Option 2", then: [] },
      ],
    }),
    summary: (ev) => ev.options.map((o) => o.label).join(" / "),
  }),

  // ---- Flags ----
  def({
    type: "set_flag",
    label: "Set Flag",
    category: "Flags",
    description: "Turn a flag on.",
    fields: [{ key: "flag", label: "Flag", kind: "flag" }],
    create: (c) => ({ type: "set_flag", flag: c.flags[0] ?? "" }),
    summary: (ev) => ev.flag || "(no flag)",
  }),
  def({
    type: "clear_flag",
    label: "Clear Flag",
    category: "Flags",
    description: "Turn a flag off.",
    fields: [{ key: "flag", label: "Flag", kind: "flag" }],
    create: (c) => ({ type: "clear_flag", flag: c.flags[0] ?? "" }),
    summary: (ev) => ev.flag || "(no flag)",
  }),
  def({
    type: "if_flag",
    label: "If Flag Is Set",
    category: "Flags",
    description: "Run Then if the flag is on, otherwise Else.",
    fields: [{ key: "flag", label: "Flag", kind: "flag" }],
    branches: [
      { key: "then", label: "Then" },
      { key: "else", label: "Else" },
    ],
    create: (c) => ({ type: "if_flag", flag: c.flags[0] ?? "", then: [], else: [] }),
    summary: (ev) => ev.flag || "(no flag)",
  }),

  // ---- Items ----
  def({
    type: "give_item",
    label: "Give Item",
    category: "Items",
    description: "Add an item to the player's inventory.",
    fields: [{ key: "item", label: "Item", kind: "item" }],
    create: (c) => ({ type: "give_item", item: c.items[0] ?? "" }),
    summary: (ev) => ev.item || "(no item)",
  }),
  def({
    type: "if_item",
    label: "If Has Item",
    category: "Items",
    description: "Run Then if the player holds the item, otherwise Else.",
    fields: [{ key: "item", label: "Item", kind: "item" }],
    branches: [
      { key: "then", label: "Then" },
      { key: "else", label: "Else" },
    ],
    create: (c) => ({ type: "if_item", item: c.items[0] ?? "", then: [], else: [] }),
    summary: (ev) => ev.item || "(no item)",
  }),

  // ---- Variables ----
  def({
    type: "set_var",
    label: "Set Variable",
    category: "Variables",
    description: "Set a variable to a number or to another variable's value.",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "value", label: "Value", kind: "varOrLiteral", min: MIN_I16, max: MAX_I16 },
    ],
    create: (c) => ({ type: "set_var", var: c.variables[0] ?? "", value: 0 }),
    summary: (ev) => `${ev.var || "?"} = ${valLabel(ev.value)}`,
  }),
  def({
    type: "add_var",
    label: "Add To Variable",
    category: "Variables",
    description: "Add a number (negative to subtract) or another variable.",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "delta", label: "Add", kind: "varOrLiteral", min: MIN_I16, max: MAX_I16 },
    ],
    create: (c) => ({ type: "add_var", var: c.variables[0] ?? "", delta: 1 }),
    summary: (ev) => `${ev.var || "?"} += ${valLabel(ev.delta)}`,
  }),
  def({
    type: "random_var",
    label: "Random Number",
    category: "Variables",
    description: "Set a variable to a random whole number between min and max (inclusive).",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "min", label: "Min", kind: "int", min: MIN_I16, max: MAX_I16 },
      { key: "max", label: "Max", kind: "int", min: MIN_I16, max: MAX_I16 },
    ],
    create: (c) => ({ type: "random_var", var: c.variables[0] ?? "", min: 1, max: 6 }),
    summary: (ev) => `${ev.var || "?"} = random ${ev.min}..${ev.max}`,
  }),
  def({
    type: "if_var",
    label: "If Variable Compare",
    category: "Variables",
    description: "Compare a variable to a number or another variable.",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "op", label: "Is", kind: "compareOp" },
      { key: "value", label: "Value", kind: "varOrLiteral", min: MIN_I16, max: MAX_I16 },
    ],
    branches: [
      { key: "then", label: "Then" },
      { key: "else", label: "Else" },
    ],
    create: (c) => ({ type: "if_var", var: c.variables[0] ?? "", op: "==", value: 0, then: [], else: [] }),
    summary: (ev) => `${ev.var || "?"} ${ev.op} ${valLabel(ev.value)}`,
  }),

  // ---- Actors ----
  def({
    type: "actor_show",
    label: "Show Actor",
    category: "Actors",
    description: "Make a hidden NPC visible (and solid/talkable) again.",
    fields: [{ key: "actor", label: "Actor", kind: "actor" }],
    create: (c) => ({ type: "actor_show", actor: c.firstActor ?? "self" }),
    summary: (ev) => actorLabel(ev.actor),
  }),
  def({
    type: "actor_hide",
    label: "Hide Actor",
    category: "Actors",
    description: "Hide an NPC. Hidden NPCs don't block movement or respond to talking.",
    fields: [{ key: "actor", label: "Actor", kind: "actor" }],
    create: (c) => ({ type: "actor_hide", actor: c.firstActor ?? "self" }),
    summary: (ev) => actorLabel(ev.actor),
  }),
  def({
    type: "actor_set_position",
    label: "Set Actor Position",
    category: "Actors",
    description: "Teleport an NPC to a tile.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "pos", label: "Tile", kind: "tilePos" },
    ],
    create: (c) => ({ type: "actor_set_position", actor: c.firstActor ?? "self", x: 0, y: 0 }),
    summary: (ev) => `${actorLabel(ev.actor)} → (${ev.x}, ${ev.y})`,
  }),
  def({
    type: "actor_move_to",
    label: "Move Actor To",
    category: "Actors",
    description: "Walk an NPC to a tile (ignores collision). Waits until it arrives.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "pos", label: "Tile", kind: "tilePos" },
    ],
    create: (c) => ({ type: "actor_move_to", actor: c.firstActor ?? "self", x: 0, y: 0 }),
    summary: (ev) => `${actorLabel(ev.actor)} walks to (${ev.x}, ${ev.y})`,
  }),
  def({
    type: "actor_set_direction",
    label: "Set Actor Direction",
    category: "Actors",
    description: "Turn an NPC to face a direction.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "direction", label: "Facing", kind: "direction" },
    ],
    create: (c) => ({ type: "actor_set_direction", actor: c.firstActor ?? "self", direction: "down" }),
    summary: (ev) => `${actorLabel(ev.actor)} faces ${ev.direction}`,
  }),

  def({
    type: "actor_set_state",
    label: "Set Actor State",
    category: "Actors",
    description:
      "Switch an NPC to one of its sprite's authored animation states (define states in the Sprites view). " +
      "Compile error if that NPC's sprite has no authored states.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "state", label: "State", kind: "state" },
    ],
    create: (c) => ({ type: "actor_set_state", actor: c.firstActor ?? "self", state: "" }),
    summary: (ev) => `${actorLabel(ev.actor)} → state "${ev.state}"`,
  }),
  def({
    type: "actor_set_animate",
    label: "Set Actor Animate",
    category: "Actors",
    description: "Turn per-frame animation stepping on or off for an NPC using authored states. Off holds the current frame.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "enabled", label: "Animate", kind: "bool" },
    ],
    create: (c) => ({ type: "actor_set_animate", actor: c.firstActor ?? "self", enabled: true }),
    summary: (ev) => `${actorLabel(ev.actor)} animate ${ev.enabled ? "on" : "off"}`,
  }),
  def({
    type: "actor_set_frame",
    label: "Set Actor Frame",
    category: "Actors",
    description: "Show a specific frame directly, by index into the actor's sprite sheet. Also pauses animation until re-enabled.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "frame", label: "Frame", kind: "int", min: 0, max: 255 },
    ],
    create: (c) => ({ type: "actor_set_frame", actor: c.firstActor ?? "self", frame: 0 }),
    summary: (ev) => `${actorLabel(ev.actor)} → frame ${ev.frame}`,
  }),
  def({
    type: "actor_set_collision_box",
    label: "Set Actor Collision Box",
    category: "Actors",
    description: "Override an NPC's collision box: offset + size in pixels within its sprite's 16×16 canvas.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "box", label: "Box", kind: "collisionBox" },
    ],
    create: (c) => ({ type: "actor_set_collision_box", actor: c.firstActor ?? "self", x: 0, y: 0, width: 16, height: 16 }),
    summary: (ev) => `${actorLabel(ev.actor)} box (${ev.x ?? 0}, ${ev.y ?? 0}) ${ev.width}×${ev.height}`,
  }),

  // ---- Camera ----
  def({
    type: "camera_move_to",
    label: "Camera Move To",
    category: "Camera",
    description: "Pan the camera to a tile and wait. The camera stays there until Camera Release.",
    fields: [{ key: "pos", label: "Tile", kind: "tilePos" }],
    create: () => ({ type: "camera_move_to", x: 0, y: 0 }),
    summary: (ev) => `(${ev.x}, ${ev.y})`,
  }),
  def({
    type: "camera_lock_actor",
    label: "Camera Follow Actor",
    category: "Camera",
    description: "Keep the camera centered on an NPC until Camera Release.",
    fields: [{ key: "actor", label: "Actor", kind: "actor" }],
    create: (c) => ({ type: "camera_lock_actor", actor: c.firstActor ?? "self" }),
    summary: (ev) => actorLabel(ev.actor),
  }),
  def({
    type: "camera_lock_point",
    label: "Camera Lock To Tile",
    category: "Camera",
    description: "Hold the camera on a fixed tile until Camera Release.",
    fields: [{ key: "pos", label: "Tile", kind: "tilePos" }],
    create: () => ({ type: "camera_lock_point", x: 0, y: 0 }),
    summary: (ev) => `(${ev.x}, ${ev.y})`,
  }),
  def({
    type: "camera_release",
    label: "Camera Release",
    category: "Camera",
    description: "Go back to following the player.",
    fields: [],
    create: () => ({ type: "camera_release" }),
    summary: () => "follow player",
  }),

  // ---- Scene ----
  def({
    type: "switch_scene",
    label: "Change Scene",
    category: "Scene",
    description: "Fade to another scene and place the player on a tile. Ends the script.",
    fields: [
      { key: "scene", label: "Scene", kind: "scene" },
      { key: "pos", label: "Player tile", kind: "tilePos" },
    ],
    create: (c) => ({ type: "switch_scene", scene: c.sceneNames[0] ?? "", x: 0, y: 0 }),
    summary: (ev) => `${ev.scene || "?"} at (${ev.x ?? 0}, ${ev.y ?? 0})`,
  }),
  def({
    type: "fade_out",
    label: "Fade Out",
    category: "Scene",
    description: "Fade the screen to black or white. \"Wait\" pauses the script until the fade finishes.",
    fields: [
      { key: "color", label: "To", kind: "fadeColor" },
      { key: "frames", label: "Frames", kind: "int", min: 1, max: MAX_I16 },
      { key: "wait", label: "Wait", kind: "bool" },
    ],
    create: () => ({ type: "fade_out", color: "black", frames: 30, wait: true }),
    summary: (ev) => `to ${ev.color}, ${ev.frames}f${ev.wait === false ? " (no wait)" : ""}`,
  }),
  def({
    type: "fade_in",
    label: "Fade In",
    category: "Scene",
    description: "Fade the screen back in from black or white. \"Wait\" pauses the script until the fade finishes.",
    fields: [
      { key: "color", label: "From", kind: "fadeColor" },
      { key: "frames", label: "Frames", kind: "int", min: 1, max: MAX_I16 },
      { key: "wait", label: "Wait", kind: "bool" },
    ],
    create: () => ({ type: "fade_in", color: "black", frames: 30, wait: true }),
    summary: (ev) => `from ${ev.color}, ${ev.frames}f${ev.wait === false ? " (no wait)" : ""}`,
  }),

  // ---- Timing & input ----
  def({
    type: "wait",
    label: "Wait",
    category: "Timing & Input",
    description: "Pause the script. 60 frames = 1 second.",
    fields: [{ key: "frames", label: "Frames", kind: "int", min: 0, max: MAX_I16 }],
    create: () => ({ type: "wait", frames: 30 }),
    summary: (ev) => `${ev.frames} frames (${(ev.frames / 60).toFixed(2).replace(/\.?0+$/, "")}s)`,
  }),
  def({
    type: "wait_button",
    label: "Wait For Button",
    category: "Timing & Input",
    description: "Pause until one of the chosen buttons is pressed.",
    fields: [{ key: "buttons", label: "Buttons", kind: "buttons" }],
    create: () => ({ type: "wait_button", buttons: "a" }),
    summary: (ev) => (Array.isArray(ev.buttons) ? ev.buttons : [ev.buttons]).map((b) => b.toUpperCase()).join(" / "),
  }),
  def({
    type: "start_timer",
    label: "Start Timer",
    category: "Timing & Input",
    description: "Start one of this scene's background timers.",
    fields: [{ key: "timer", label: "Timer", kind: "timer" }],
    create: (c) => ({ type: "start_timer", timer: c.firstTimer ?? 0 }),
    summary: (ev) => (typeof ev.timer === "number" ? `timer #${ev.timer}` : ev.timer),
  }),

  // ---- Sound ----
  def({
    type: "play_sound",
    label: "Play Sound",
    category: "Sound",
    description: "Play a built-in sound effect.",
    fields: [{ key: "sound", label: "Sound", kind: "sound" }],
    create: () => ({ type: "play_sound", sound: "blip" }),
    summary: (ev) => ev.sound,
  }),
  def({
    type: "play_music",
    label: "Play Music",
    category: "Sound",
    description:
      "Start (or restart) a music track, from an On Init/door/NPC/timer script - not just a scene's own Music property. " +
      "Already-playing the same track is a no-op (won't restart it). \"Loop\" (default on) repeats it forever until " +
      "Stop Music or another Play Music.",
    fields: [
      { key: "track", label: "Track", kind: "music" },
      { key: "loop", label: "Loop", kind: "bool" },
    ],
    create: (c) => ({ type: "play_music", track: c.firstMusicTrack ?? "", loop: true }),
    summary: (ev) => `${ev.track || "(no track)"}${ev.loop === false ? " (once)" : " (loop)"}`,
  }),
  def({
    type: "stop_music",
    label: "Stop Music",
    category: "Sound",
    description: "Silence whatever music is currently playing.",
    fields: [],
    create: () => ({ type: "stop_music" }),
    summary: () => "",
  }),

  // ---- Scripts ----
  def({
    type: "call_script",
    label: "Call Script",
    category: "Scripts",
    description:
      "Run one of this project's Custom Scripts here. Inline-expanded at compile time (a copy, not a live link) - " +
      "editing the custom script later changes every place that calls it, but a cycle (a script calling itself, " +
      "directly or through another script) is a compile error.",
    fields: [{ key: "script", label: "Script", kind: "customScript" }],
    create: (c) => ({ type: "call_script", script: c.firstCustomScript ?? "" }),
    summary: (ev) => ev.script || "(no script)",
  }),

  // ---- Math ----
  def({
    type: "math",
    label: "Math",
    category: "Math",
    description: "Add, subtract, multiply, divide, or modulo a variable by a number or another variable. Divide/modulo by 0 sets it to 0.",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "op", label: "Op", kind: "mathOp" },
      { key: "value", label: "Value", kind: "varOrLiteral", min: MIN_I16, max: MAX_I16 },
    ],
    create: (c) => ({ type: "math", var: c.variables[0] ?? "", op: "add", value: 1 }),
    summary: (ev) => `${ev.var || "?"} ${MATH_OP_SYMBOL[ev.op]}= ${valLabel(ev.value)}`,
  }),
  def({
    type: "array_var_math",
    label: "Array Variable Math",
    category: "Math",
    description:
      "Treats a run of variables as a list: \"Array\" is its first slot, \"Index\" is a variable holding how far into " +
      "it to reach. Get reads that slot into Output; every other op applies Math's operation to that slot in place, " +
      "using Value. Use this only when Index is chosen at runtime - a fixed slot is just Set Variable/Math.",
    fields: [
      { key: "array", label: "Array (first variable)", kind: "variable" },
      { key: "index", label: "Index (variable)", kind: "variable" },
      { key: "op", label: "Op", kind: "arrayOp" },
      { key: "value", label: "Value", kind: "varOrLiteral", min: MIN_I16, max: MAX_I16 },
      { key: "output", label: "Output (for Get)", kind: "variable" },
    ],
    create: (c) => ({
      type: "array_var_math",
      array: c.variables[0] ?? "",
      index: c.variables[1] ?? c.variables[0] ?? "",
      op: "get",
      value: 0,
      output: c.variables[0] ?? "",
    }),
    summary: (ev) =>
      ev.op === "get"
        ? `${ev.output || "?"} = ${ev.array || "?"}[${ev.index || "?"}]`
        : ev.op === "set"
          ? `${ev.array || "?"}[${ev.index || "?"}] = ${valLabel(ev.value)}`
          : `${ev.array || "?"}[${ev.index || "?"}] ${MATH_OP_SYMBOL[ev.op]}= ${valLabel(ev.value)}`,
  }),

  // ---- Control Flow ----
  def({
    type: "loop",
    label: "Loop",
    category: "Control Flow",
    description: "Repeat Events forever. Use Stop Script (or a scene change) to exit - an empty loop runs forever doing nothing.",
    fields: [],
    branches: [{ key: "body", label: "Events" }],
    create: () => ({ type: "loop", body: [] }),
    summary: () => "forever",
  }),
  def({
    type: "stop_script",
    label: "Stop Script",
    category: "Control Flow",
    description: "Immediately halt this script, wherever it appears.",
    fields: [],
    create: () => ({ type: "stop_script" }),
    summary: () => "",
  }),

  // ---- Actors (position/direction readback) ----
  def({
    type: "actor_get_position",
    label: "Store Actor Position",
    category: "Actors",
    description: "Store an NPC's current position (in pixels) into two variables.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "varX", label: "X Variable", kind: "variable" },
      { key: "varY", label: "Y Variable", kind: "variable" },
    ],
    create: (c) => ({ type: "actor_get_position", actor: c.firstActor ?? "self", varX: c.variables[0] ?? "", varY: c.variables[1] ?? c.variables[0] ?? "" }),
    summary: (ev) => `${ev.varX || "?"}, ${ev.varY || "?"} = ${actorLabel(ev.actor)} position`,
  }),
  def({
    type: "actor_get_direction",
    label: "Store Actor Direction",
    category: "Actors",
    description: "Store an NPC's current facing direction into a variable (0=down, 1=up, 2=right, 3=left).",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "var", label: "Variable", kind: "variable" },
    ],
    create: (c) => ({ type: "actor_get_direction", actor: c.firstActor ?? "self", var: c.variables[0] ?? "" }),
    summary: (ev) => `${ev.var || "?"} = ${actorLabel(ev.actor)} direction`,
  }),

  // ---- Camera (shake) ----
  def({
    type: "camera_shake",
    label: "Camera Shake",
    category: "Camera",
    description: "Shake the camera (background and every on-screen sprite together) for a number of frames. Doesn't pause the script.",
    fields: [
      { key: "frames", label: "Frames", kind: "int", min: 0, max: MAX_I16 },
      { key: "magnitude", label: "Strength (px)", kind: "int", min: 0, max: 16 },
    ],
    create: () => ({ type: "camera_shake", frames: 20, magnitude: 2 }),
    summary: (ev) => `${ev.frames} frames, ±${ev.magnitude}px`,
  }),

  // ---- Misc ----
  def({
    type: "comment",
    label: "Comment",
    category: "Misc",
    description: "A note in the script for yourself/others - no effect on the game.",
    fields: [{ key: "text", label: "Comment", kind: "multiline" }],
    create: () => ({ type: "comment", text: "" }),
    summary: (ev) => short(ev.text) || "(empty)",
  }),
  def({
    type: "group",
    label: "Group",
    category: "Misc",
    description: "Visually group a block of events under a label - purely organizational, no effect on the game.",
    fields: [{ key: "label", label: "Label", kind: "text" }],
    branches: [{ key: "children", label: "Events" }],
    create: () => ({ type: "group", label: "Group", children: [] }),
    summary: (ev) => ev.label || "Group",
  }),
];

export const EVENT_DEF_BY_TYPE: Record<string, EventDef> = Object.fromEntries(
  EVENT_DEFS.map((d) => [d.type, d]),
);

/** For event types the editor doesn't know (e.g. hand-written JSON from
 * a newer compiler) - shown read-only, round-tripped untouched. */
export function getEventDef(type: string): EventDef | undefined {
  return EVENT_DEF_BY_TYPE[type];
}

export function eventSummary(ev: ScriptEventJSON): string {
  const d = getEventDef(ev.type);
  if (!d) return "";
  try {
    return d.summary(ev);
  } catch {
    return "";
  }
}

export type { EventScript };
