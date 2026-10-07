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
import { SETTING_BY_KEY } from "../engine/engineSettings";

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
  | "fadeColor"
  | "expression"
  | "units"
  | "bits"
  | "relation"
  | "color"
  | "paletteTarget"
  | "optionalVariable"
  | "offset"
  | "font"
  | "frame"
  | "sprite"
  | "select"
  | "checks"
  | "float"
  | "engineSetting"
  | "engineValue"
  | "cutscene";

export interface FieldDef {
  /** JSON key. For "tilePos"/"offset" this is a prefix-less pair: the
   * event's own "x"/"y" keys (or xKey/yKey below). */
  key: string;
  /** "tilePos" only: the keys holding the pair, if not "x"/"y". */
  xKey?: string;
  yKey?: string;
  label: string;
  kind: FieldKind;
  min?: number;
  max?: number;
  placeholder?: string;
  /** "select" / "checks" (any number of them, stored as a list): the choices. */
  options?: { value: string; label: string }[];
  /** Shown (and assumed by the compiler) when the event has no value. */
  defaultValue?: unknown;
  /** Only shown when this returns true (options that depend on another). */
  showIf?: (ev: Record<string, unknown>) => boolean;
}

export type BranchKey = "then" | "else" | "body" | "children" | "script";

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
  | "Screen"
  | "Save Data"
  | "Sound"
  | "Scripts"
  | "Engine"
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
  "Screen",
  "Save Data",
  "Sound",
  "Scripts",
  "Engine",
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
  Screen: "#d9a441",
  "Save Data": "#8fbf4a",
  Sound: "#ff7ab6",
  Scripts: "#7a8cff",
  Engine: "#e07b39",
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
  /** name of the first song in assets/music, if any. */
  firstMusicTrack: string | null;
  /** name of a sprite other than the player's, if any. */
  firstSprite: string | null;
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
  /** "switch": a per-case branch list (shown before "branches"). */
  switchCases?: boolean;
  create: (ctx: CreateContext) => ScriptEventJSON;
  summary: (ev: ScriptEventJSON) => string;
}

const MAX_I16 = 32767;
const MIN_I16 = -32768;

function settingLabel(key: string): string {
  return SETTING_BY_KEY[key]?.label ?? key;
}

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

const IF_BRANCHES: { key: BranchKey; label: string }[] = [
  { key: "then", label: "Then" },
  { key: "else", label: "Else" },
];

function unitsLabel(units: unknown): string {
  return units === "pixels" ? " px" : "";
}

function bitsLabel(bits: number[] | undefined): string {
  return bits && bits.length ? bits.map((b) => `#${b}`).join(" ") : "(none)";
}

function buttonsLabel(b: string | string[]): string {
  return (Array.isArray(b) ? b : [b]).map((x) => x.toUpperCase()).join(" / ");
}

const RELATION_LABEL: Record<string, string> = {
  up: "is above",
  down: "is below",
  left: "is left of",
  right: "is right of",
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

/** Move Actor To / Set Actor Position, any target. */
function moveSummary(ev: Record<string, unknown>, verb: string): string {
  const who = actorLabel(ev.actor as never);
  if (ev.target === "actor") return `${who} ${verb} ${actorLabel(ev.target_actor as never)}`;
  const units = ev.units === "pixels" ? " px" : "";
  const where = ev.target === "variables" ? `($${ev.x_var || "?"}, $${ev.y_var || "?"})` : `(${ev.x ?? 0}, ${ev.y ?? 0})`;
  return `${who} ${verb} ${ev.relative ? "+" : ""}${where}${units}${ev.collisions ? ", collisions" : ""}`;
}

export const EVENT_DEFS: EventDef[] = [
  // ---- Dialogue ----
  def({
    type: "text",
    label: "Display Text",
    category: "Dialogue",
    description:
      "Show a dialogue box. A new line starts a new page; long text carries on to the next page. {varname} shows a variable, !F:name! switches font, !C:#ff4040! colours the text (!C! resets), !S2! sets the text speed (frames per letter, 0 = instant). Use the Insert buttons under the text to add these.",
    fields: [
      { key: "text", label: "Text", kind: "multiline" },
      {
        key: "position",
        label: "Position",
        kind: "select",
        defaultValue: "bottom",
        options: [
          { value: "bottom", label: "Bottom" },
          { value: "middle", label: "Middle" },
          { value: "top", label: "Top" },
          { value: "custom", label: "Custom (X, Y, width)" },
        ],
      },
      { key: "box_x", label: "X (tiles)", kind: "int", min: 0, max: 29, defaultValue: 0, showIf: (e) => e.position === "custom" },
      { key: "box_y", label: "Y (tiles)", kind: "int", min: 0, max: 19, defaultValue: 0, showIf: (e) => e.position === "custom" },
      { key: "box_width", label: "Width (tiles)", kind: "int", min: 1, max: 30, defaultValue: 30, showIf: (e) => e.position === "custom" },
      { key: "rows", label: "Rows", kind: "int", min: 1, max: 4, defaultValue: 2 },
      { key: "frame", label: "Frame", kind: "bool", defaultValue: true },
      {
        key: "focus",
        label: "Focus",
        kind: "select",
        defaultValue: "none",
        options: [
          { value: "none", label: "Off" },
          { value: "dim", label: "Dim the rest" },
          { value: "blur", label: "Blur the rest" },
          { value: "dim_blur", label: "Dim and blur the rest" },
        ],
      },
    ],
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
      {
        key: "focus",
        label: "Focus",
        kind: "select",
        defaultValue: "none",
        options: [
          { value: "none", label: "Off" },
          { value: "dim", label: "Dim the rest" },
          { value: "blur", label: "Blur the rest" },
          { value: "dim_blur", label: "Dim and blur the rest" },
        ],
      },
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
    fields: [
      {
        key: "focus",
        label: "Focus",
        kind: "select",
        defaultValue: "none",
        options: [
          { value: "none", label: "Off" },
          { value: "dim", label: "Dim the rest" },
          { value: "blur", label: "Blur the rest" },
          { value: "dim_blur", label: "Dim and blur the rest" },
        ],
      },
    ],
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
  def({
    type: "set_engine_setting",
    label: "Set Engine Setting",
    category: "Engine",
    description: "Change one of the scene type's settings (Settings > Engine) for the rest of this scene - e.g. lower gravity underwater, or turn on double jump after a power-up.",
    fields: [
      { key: "setting", label: "Setting", kind: "engineSetting" },
      { key: "value", label: "Value", kind: "engineValue" },
    ],
    create: () => ({ type: "set_engine_setting", setting: "pl_extra_jumps", value: 1 }),
    summary: (ev) => `${settingLabel(ev.setting)} = ${String(ev.value)}`,
  }),
  def({
    type: "launch_projectile",
    label: "Launch Projectile",
    category: "Engine",
    description: "Fire a sprite in a straight line from an actor. It runs the On Hit script of the actor it hits (or the scene's On Player Hit when it hits the player). Attach it to a button with Attach Script To Button to shoot.",
    fields: [
      { key: "sprite", label: "Sprite", kind: "sprite" },
      { key: "actor", label: "From", kind: "actor" },
      {
        key: "direction",
        label: "Direction",
        kind: "select",
        options: [
          { value: "facing", label: "The way it's facing" },
          { value: "up", label: "Up" },
          { value: "down", label: "Down" },
          { value: "left", label: "Left" },
          { value: "right", label: "Right" },
          { value: "angle", label: "Angle…" },
        ],
      },
      { key: "angle", label: "Angle (0 = right, 90 = up)", kind: "int", min: -360, max: 360 },
      { key: "speed", label: "Speed (px/frame)", kind: "float", min: 0.25, max: 8 },
      { key: "lifetime", label: "Lifetime (frames, 0 = until off screen)", kind: "int", min: 0, max: MAX_I16 },
      {
        key: "hits",
        label: "Hits",
        kind: "checks",
        options: [
          { value: "group1", label: "Group 1" },
          { value: "group2", label: "Group 2" },
          { value: "group3", label: "Group 3" },
          { value: "player", label: "Player" },
        ],
      },
      { key: "group", label: "Hits the player as group", kind: "int", min: 1, max: 3 },
      { key: "pierce", label: "Keeps going after a hit", kind: "bool" },
      { key: "through_walls", label: "Flies through walls", kind: "bool" },
      { key: "front", label: "Drawn in front of the player", kind: "bool" },
      { key: "offset_x", label: "Start offset X (px)", kind: "int", min: -128, max: 128 },
      { key: "offset_y", label: "Start offset Y (px)", kind: "int", min: -128, max: 128 },
    ],
    create: (c) => ({
      type: "launch_projectile",
      sprite: c.firstSprite ?? "player",
      actor: "player",
      direction: "facing",
      angle: 0,
      speed: 3,
      lifetime: 0,
      hits: ["group1", "group2", "group3"],
      group: 1,
    }),
    summary: (ev) => `${ev.sprite} from ${actorLabel(ev.actor ?? "player")}, ${ev.direction === "angle" ? `${ev.angle ?? 0}°` : ev.direction ?? "facing"}`,
  }),
  def({
    type: "text_set_font",
    label: "Set Font",
    category: "Dialogue",
    description: "Font for dialogue from now on. Fonts are PNGs in assets/fonts (GB Studio fonts work as-is).",
    fields: [{ key: "font", label: "Font", kind: "font" }],
    create: () => ({ type: "text_set_font", font: "default" }),
    summary: (ev) => ev.font || "(no font)",
  }),
  def({
    type: "text_set_frame",
    label: "Set Dialogue Frame",
    category: "Dialogue",
    description: "Box frame for dialogue from now on. Frames are 24x24 PNGs in assets/frames.",
    fields: [{ key: "frame", label: "Frame", kind: "frame" }],
    create: () => ({ type: "text_set_frame", frame: "default" }),
    summary: (ev) => ev.frame || "(no frame)",
  }),
  def({
    type: "text_set_speed",
    label: "Set Text Speed",
    category: "Dialogue",
    description: "How fast dialogue letters appear: frames per letter, 0 = the whole page at once.",
    fields: [{ key: "speed", label: "Frames per letter", kind: "int", min: 0, max: 30 }],
    create: () => ({ type: "text_set_speed", speed: 1 }),
    summary: (ev) => (ev.speed === 0 ? "instant" : `${ev.speed} frame${ev.speed === 1 ? "" : "s"} per letter`),
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
    description:
      "Teleport an actor (or the player) to a position: numbers, variables, or where another actor is. Relative adds to where it is now.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      {
        key: "target",
        label: "To",
        kind: "select",
        defaultValue: "position",
        options: [
          { value: "position", label: "A position" },
          { value: "variables", label: "Position in variables" },
          { value: "actor", label: "Another actor (or the player)" },
        ],
      },
      { key: "pos", label: "Position", kind: "tilePos", showIf: (e) => !e.target || e.target === "position" },
      { key: "x_var", label: "X variable", kind: "variable", showIf: (e) => e.target === "variables" },
      { key: "y_var", label: "Y variable", kind: "variable", showIf: (e) => e.target === "variables" },
      { key: "target_actor", label: "Actor to go to", kind: "actor", showIf: (e) => e.target === "actor" },
      {
        key: "units",
        label: "Units",
        kind: "select",
        defaultValue: "tiles",
        options: [
          { value: "tiles", label: "Tiles" },
          { value: "pixels", label: "Pixels" },
        ],
        showIf: (e) => e.target !== "actor",
      },
      { key: "relative", label: "Relative to where it is", kind: "bool", defaultValue: false, showIf: (e) => e.target !== "actor" },
    ],
    create: (c) => ({ type: "actor_set_position", actor: c.firstActor ?? "self", x: 0, y: 0 }),
    summary: (ev) => moveSummary(ev as unknown as Record<string, unknown>, "→"),
  }),
  def({
    type: "actor_move_to",
    label: "Move Actor To",
    category: "Actors",
    description:
      "Walk an actor (or the player) to a position: numbers, variables, or another actor. Waits until it arrives. With Collisions on it stops at solid tiles. Position is the actor's top-left tile (the Pick button shows its whole 16x16 box).",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      {
        key: "target",
        label: "To",
        kind: "select",
        defaultValue: "position",
        options: [
          { value: "position", label: "A position" },
          { value: "variables", label: "Position in variables" },
          { value: "actor", label: "Another actor (or the player)" },
        ],
      },
      { key: "pos", label: "Position", kind: "tilePos", showIf: (e) => !e.target || e.target === "position" },
      { key: "x_var", label: "X variable", kind: "variable", showIf: (e) => e.target === "variables" },
      { key: "y_var", label: "Y variable", kind: "variable", showIf: (e) => e.target === "variables" },
      { key: "target_actor", label: "Actor to go to", kind: "actor", showIf: (e) => e.target === "actor" },
      {
        key: "units",
        label: "Units",
        kind: "select",
        defaultValue: "tiles",
        options: [
          { value: "tiles", label: "Tiles" },
          { value: "pixels", label: "Pixels" },
        ],
        showIf: (e) => e.target !== "actor",
      },
      { key: "relative", label: "Relative to where it is", kind: "bool", defaultValue: false, showIf: (e) => e.target !== "actor" },
      { key: "collisions", label: "Collisions", kind: "bool", defaultValue: false },
      {
        key: "move_type",
        label: "Move",
        kind: "select",
        defaultValue: "horizontal",
        options: [
          { value: "horizontal", label: "Horizontal first" },
          { value: "vertical", label: "Vertical first" },
          { value: "diagonal", label: "Diagonal" },
        ],
      },
    ],
    create: (c) => ({ type: "actor_move_to", actor: c.firstActor ?? "self", x: 0, y: 0 }),
    summary: (ev) => moveSummary(ev as unknown as Record<string, unknown>, "walks to"),
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
      "Switch the player or an NPC to one of its sprite's animation states (define states in the Sprites view). " +
      "On the player the state sticks - the movement mode's own run/jump states won't replace it - until you set Default again.",
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
    description: "Turn per-frame animation stepping on or off for the player or an NPC. Off holds the current frame.",
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
    description: "Pan the camera so this tile is in the middle of the screen, and wait. The camera stays there until Camera Release.",
    fields: [
      { key: "pos", label: "Tile", kind: "tilePos" },
      { key: "speed", label: "Speed (px/frame)", kind: "int", min: 1, max: 16 },
    ],
    create: () => ({ type: "camera_move_to", x: 0, y: 0, speed: 1 }),
    summary: (ev) => `(${ev.x}, ${ev.y})${ev.speed && ev.speed !== 1 ? `, speed ${ev.speed}` : ""}`,
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
      {
        key: "transition",
        label: "Transition",
        kind: "select",
        defaultValue: "fade_black",
        options: [
          { value: "fade_black", label: "Fade to black" },
          { value: "fade_white", label: "Fade to white" },
          { value: "none", label: "None (cut)" },
        ],
      },
      {
        key: "transition_frames",
        label: "Fade length (frames)",
        kind: "int",
        min: 1,
        max: 255,
        defaultValue: 8,
        showIf: (e) => e.transition !== "none",
      },
    ],
    create: (c) => ({ type: "switch_scene", scene: c.sceneNames[0] ?? "", x: 0, y: 0 }),
    summary: (ev) =>
      `${ev.scene || "?"} at (${ev.x ?? 0}, ${ev.y ?? 0})` +
      (ev.transition === "fade_white" ? ", white fade" : ev.transition === "none" ? ", no fade" : ""),
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
    description:
      "Play a sound: a built-in beep, or a WAV from assets/sounds (add them in the Music section). WAVs play on the GBA's two digital channels, over the music; the options below are for WAVs.",
    fields: [
      { key: "sound", label: "Sound", kind: "sound" },
      {
        key: "channel",
        label: "Channel (WAV)",
        kind: "select",
        options: [
          { value: "auto", label: "Any free channel" },
          { value: "a", label: "Channel A" },
          { value: "b", label: "Channel B" },
        ],
      },
      { key: "loop", label: "Loop (WAV)", kind: "bool" },
      {
        key: "volume",
        label: "Volume (WAV)",
        kind: "select",
        options: [
          { value: "full", label: "Full" },
          { value: "half", label: "Half" },
        ],
      },
    ],
    create: () => ({ type: "play_sound", sound: "blip" }),
    summary: (ev) => `${ev.sound}${ev.loop ? " (loop)" : ""}`,
  }),
  def({
    type: "stop_sound",
    label: "Stop Sound",
    category: "Sound",
    description: "Stop a WAV sound that's playing (e.g. a looping one).",
    fields: [
      {
        key: "channel",
        label: "Channel",
        kind: "select",
        options: [
          { value: "auto", label: "Both channels" },
          { value: "a", label: "Channel A" },
          { value: "b", label: "Channel B" },
        ],
      },
    ],
    create: () => ({ type: "stop_sound", channel: "auto" }),
    summary: (ev) => (ev.channel === "a" ? "channel A" : ev.channel === "b" ? "channel B" : "all WAVs"),
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

  // ---- GB Studio parity events (compile_parity_event() in
  // compiler/build_project.py) ----

  // Control flow
  def({
    type: "if_expression",
    label: "If Expression",
    category: "Control Flow",
    description:
      "Run Then if a math expression is true (not 0). Use variable names (or $name$), + - * / %, == != < <= > >=, " +
      "&& || !, and functions like min, max, abs, rnd(n), actor_x(player), held(a), flag(name).",
    fields: [{ key: "expression", label: "Expression", kind: "expression" }],
    branches: IF_BRANCHES,
    create: (c) => ({ type: "if_expression", expression: c.variables[0] ? `${c.variables[0]} == 0` : "true", then: [], else: [] }),
    summary: (ev) => short(ev.expression) || "(empty)",
  }),
  def({
    type: "loop_while",
    label: "Loop While",
    category: "Control Flow",
    description: "Repeat Events while an expression is true, checking before each run.",
    fields: [{ key: "expression", label: "While", kind: "expression" }],
    branches: [{ key: "body", label: "Events" }],
    create: (c) => ({ type: "loop_while", expression: c.variables[0] ? `${c.variables[0]} < 10` : "false", body: [] }),
    summary: (ev) => short(ev.expression) || "(empty)",
  }),
  def({
    type: "loop_for",
    label: "Loop For",
    category: "Control Flow",
    description: "Set a variable to From, then repeat Events while it compares true to To, stepping it after each run.",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "from", label: "From", kind: "varOrLiteral", min: MIN_I16, max: MAX_I16 },
      { key: "comparison", label: "While", kind: "compareOp" },
      { key: "to", label: "To", kind: "varOrLiteral", min: MIN_I16, max: MAX_I16 },
      { key: "stepOp", label: "Step", kind: "mathOp" },
      { key: "step", label: "By", kind: "varOrLiteral", min: MIN_I16, max: MAX_I16 },
    ],
    branches: [{ key: "body", label: "Events" }],
    create: (c) => ({
      type: "loop_for",
      var: c.variables[0] ?? "",
      from: 0,
      comparison: "<",
      to: 10,
      stepOp: "add",
      step: 1,
      body: [],
    }),
    summary: (ev) =>
      `${ev.var || "?"} = ${valLabel(ev.from)}; ${ev.var || "?"} ${ev.comparison} ${valLabel(ev.to)}; ` +
      `${ev.var || "?"} ${MATH_OP_SYMBOL[ev.stepOp] ?? "+"}= ${valLabel(ev.step)}`,
  }),
  def({
    type: "switch",
    label: "Switch",
    category: "Control Flow",
    description: "Run the case whose value matches a variable, or Else if none does.",
    fields: [{ key: "var", label: "Variable", kind: "variable" }],
    switchCases: true,
    branches: [{ key: "else", label: "Else" }],
    create: (c) => ({
      type: "switch",
      var: c.variables[0] ?? "",
      cases: [
        { value: 0, then: [] },
        { value: 1, then: [] },
      ],
      else: [],
    }),
    summary: (ev) => `${ev.var || "?"}: ${ev.cases.map((c) => c.value).join(", ")}`,
  }),
  def({
    type: "label",
    label: "Label",
    category: "Control Flow",
    description: "Marks a place in this script for Go To Label to jump to.",
    fields: [{ key: "label", label: "Label", kind: "text", placeholder: "name" }],
    create: () => ({ type: "label", label: "start" }),
    summary: (ev) => ev.label || "(unnamed)",
  }),
  def({
    type: "goto",
    label: "Go To Label",
    category: "Control Flow",
    description: "Jump to a Label in this same script (not into or out of a thread, timer or button script).",
    fields: [{ key: "label", label: "Label", kind: "text", placeholder: "name" }],
    create: () => ({ type: "goto", label: "start" }),
    summary: (ev) => ev.label || "(unnamed)",
  }),
  def({
    type: "rate_limit",
    label: "Rate Limit",
    category: "Control Flow",
    description: "Skip Events if they ran less than this many frames ago. The variable stores when they last ran.",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "frames", label: "Frames", kind: "int", min: 1, max: MAX_I16 },
    ],
    branches: [{ key: "body", label: "Events" }],
    create: (c) => ({ type: "rate_limit", var: c.variables[0] ?? "", frames: 30, body: [] }),
    summary: (ev) => `once per ${ev.frames} frames`,
  }),

  // Variables
  def({
    type: "set_var_expression",
    label: "Evaluate Expression",
    category: "Math",
    description: "Set a variable to the result of a math expression, e.g. (score + 5) * 2 or max(hp, 0).",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "expression", label: "Expression", kind: "expression" },
    ],
    create: (c) => ({
      type: "set_var_expression",
      var: c.variables[0] ?? "",
      expression: c.variables[0] ? `${c.variables[0]} + 1` : "0",
    }),
    summary: (ev) => `${ev.var || "?"} = ${short(ev.expression) || "?"}`,
  }),
  def({
    type: "var_inc",
    label: "Increment Variable",
    category: "Variables",
    description: "Add 1 to a variable.",
    fields: [{ key: "var", label: "Variable", kind: "variable" }],
    create: (c) => ({ type: "var_inc", var: c.variables[0] ?? "" }),
    summary: (ev) => `${ev.var || "?"} += 1`,
  }),
  def({
    type: "var_dec",
    label: "Decrement Variable",
    category: "Variables",
    description: "Subtract 1 from a variable.",
    fields: [{ key: "var", label: "Variable", kind: "variable" }],
    create: (c) => ({ type: "var_dec", var: c.variables[0] ?? "" }),
    summary: (ev) => `${ev.var || "?"} -= 1`,
  }),
  def({
    type: "set_var_true",
    label: "Set Variable To True",
    category: "Variables",
    description: "Set a variable to 1.",
    fields: [{ key: "var", label: "Variable", kind: "variable" }],
    create: (c) => ({ type: "set_var_true", var: c.variables[0] ?? "" }),
    summary: (ev) => `${ev.var || "?"} = true`,
  }),
  def({
    type: "set_var_false",
    label: "Set Variable To False",
    category: "Variables",
    description: "Set a variable to 0.",
    fields: [{ key: "var", label: "Variable", kind: "variable" }],
    create: (c) => ({ type: "set_var_false", var: c.variables[0] ?? "" }),
    summary: (ev) => `${ev.var || "?"} = false`,
  }),
  def({
    type: "if_var_true",
    label: "If Variable Is True",
    category: "Variables",
    description: "Run Then if the variable isn't 0.",
    fields: [{ key: "var", label: "Variable", kind: "variable" }],
    branches: IF_BRANCHES,
    create: (c) => ({ type: "if_var_true", var: c.variables[0] ?? "", then: [], else: [] }),
    summary: (ev) => ev.var || "?",
  }),
  def({
    type: "if_var_false",
    label: "If Variable Is False",
    category: "Variables",
    description: "Run Then if the variable is 0.",
    fields: [{ key: "var", label: "Variable", kind: "variable" }],
    branches: IF_BRANCHES,
    create: (c) => ({ type: "if_var_false", var: c.variables[0] ?? "", then: [], else: [] }),
    summary: (ev) => `not ${ev.var || "?"}`,
  }),
  def({
    type: "var_set_flags",
    label: "Set Variable Flags",
    category: "Variables",
    description: "Treat a variable as 16 on/off flags: set it to exactly the chosen flags (all others off).",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "bits", label: "Flags", kind: "bits" },
    ],
    create: (c) => ({ type: "var_set_flags", var: c.variables[0] ?? "", bits: [] }),
    summary: (ev) => `${ev.var || "?"} = ${bitsLabel(ev.bits)}`,
  }),
  def({
    type: "var_add_flags",
    label: "Add Variable Flags",
    category: "Variables",
    description: "Turn the chosen flags of a variable on, leaving the others as they are.",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "bits", label: "Flags", kind: "bits" },
    ],
    create: (c) => ({ type: "var_add_flags", var: c.variables[0] ?? "", bits: [] }),
    summary: (ev) => `${ev.var || "?"} += ${bitsLabel(ev.bits)}`,
  }),
  def({
    type: "var_clear_flags",
    label: "Clear Variable Flags",
    category: "Variables",
    description: "Turn the chosen flags of a variable off, leaving the others as they are.",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "bits", label: "Flags", kind: "bits" },
    ],
    create: (c) => ({ type: "var_clear_flags", var: c.variables[0] ?? "", bits: [] }),
    summary: (ev) => `${ev.var || "?"} -= ${bitsLabel(ev.bits)}`,
  }),
  def({
    type: "if_var_flags",
    label: "If Variable Has Flags",
    category: "Variables",
    description: "Run Then if every chosen flag of the variable is on.",
    fields: [
      { key: "var", label: "Variable", kind: "variable" },
      { key: "bits", label: "Flags", kind: "bits" },
    ],
    branches: IF_BRANCHES,
    create: (c) => ({ type: "if_var_flags", var: c.variables[0] ?? "", bits: [0], then: [], else: [] }),
    summary: (ev) => `${ev.var || "?"} has ${bitsLabel(ev.bits)}`,
  }),
  def({
    type: "vars_reset",
    label: "Reset All Variables",
    category: "Variables",
    description: "Set every variable back to 0.",
    fields: [],
    create: () => ({ type: "vars_reset" }),
    summary: () => "all = 0",
  }),
  def({
    type: "seed_rng",
    label: "Seed Random Numbers",
    category: "Variables",
    description: "Reseed the random number generator from the frame counter and held buttons.",
    fields: [],
    create: () => ({ type: "seed_rng" }),
    summary: () => "",
  }),

  // Actors
  def({
    type: "actor_invoke",
    label: "Invoke Actor Script",
    category: "Actors",
    description: "Run an NPC's On Interact script here, as if the player had talked to it.",
    fields: [{ key: "actor", label: "Actor", kind: "actor" }],
    create: (c) => ({ type: "actor_invoke", actor: c.firstActor ?? "self" }),
    summary: (ev) => actorLabel(ev.actor),
  }),
  def({
    type: "actor_set_position_vars",
    label: "Set Actor Position To Variables",
    category: "Actors",
    description: "Teleport an actor to the position held in two variables.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "varX", label: "X Variable", kind: "variable" },
      { key: "varY", label: "Y Variable", kind: "variable" },
      { key: "units", label: "Units", kind: "units" },
    ],
    create: (c) => ({
      type: "actor_set_position_vars",
      actor: c.firstActor ?? "self",
      varX: c.variables[0] ?? "",
      varY: c.variables[1] ?? c.variables[0] ?? "",
      units: "tiles",
    }),
    summary: (ev) => `${actorLabel(ev.actor)} → ($${ev.varX || "?"}, $${ev.varY || "?"})${unitsLabel(ev.units)}`,
  }),
  def({
    type: "actor_move_to_vars",
    label: "Move Actor To Variables",
    category: "Actors",
    description: "Walk an actor to the position held in two variables. Waits until it arrives.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "varX", label: "X Variable", kind: "variable" },
      { key: "varY", label: "Y Variable", kind: "variable" },
      { key: "units", label: "Units", kind: "units" },
    ],
    create: (c) => ({
      type: "actor_move_to_vars",
      actor: c.firstActor ?? "self",
      varX: c.variables[0] ?? "",
      varY: c.variables[1] ?? c.variables[0] ?? "",
      units: "tiles",
    }),
    summary: (ev) => `${actorLabel(ev.actor)} walks to ($${ev.varX || "?"}, $${ev.varY || "?"})${unitsLabel(ev.units)}`,
  }),
  def({
    type: "actor_set_position_relative",
    label: "Set Actor Position Relative",
    category: "Actors",
    description: "Teleport an actor by an offset from where it is now.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "offset", label: "Offset", kind: "offset" },
      { key: "units", label: "Units", kind: "units" },
    ],
    create: (c) => ({ type: "actor_set_position_relative", actor: c.firstActor ?? "self", x: 0, y: 0, units: "tiles" }),
    summary: (ev) => `${actorLabel(ev.actor)} by (${ev.x}, ${ev.y})${unitsLabel(ev.units)}`,
  }),
  def({
    type: "actor_move_relative",
    label: "Move Actor Relative",
    category: "Actors",
    description: "Walk an actor by an offset from where it is now. Waits until it arrives.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "offset", label: "Offset", kind: "offset" },
      { key: "units", label: "Units", kind: "units" },
    ],
    create: (c) => ({ type: "actor_move_relative", actor: c.firstActor ?? "self", x: 0, y: 0, units: "tiles" }),
    summary: (ev) => `${actorLabel(ev.actor)} walks by (${ev.x}, ${ev.y})${unitsLabel(ev.units)}`,
  }),
  def({
    type: "actor_set_frame_var",
    label: "Set Actor Frame To Variable",
    category: "Actors",
    description: "Show the sprite frame whose index is held in a variable.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "var", label: "Variable", kind: "variable" },
    ],
    create: (c) => ({ type: "actor_set_frame_var", actor: c.firstActor ?? "self", var: c.variables[0] ?? "" }),
    summary: (ev) => `${actorLabel(ev.actor)} → frame $${ev.var || "?"}`,
  }),
  def({
    type: "actor_set_move_speed",
    label: "Set Actor Movement Speed",
    category: "Actors",
    description: "How fast scripted moves walk the actor, in pixels per frame.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "speed", label: "Speed (px/frame)", kind: "int", min: 1, max: 8 },
    ],
    create: (c) => ({ type: "actor_set_move_speed", actor: c.firstActor ?? "self", speed: 1 }),
    summary: (ev) => `${actorLabel(ev.actor)} speed ${ev.speed}`,
  }),
  def({
    type: "actor_set_anim_speed",
    label: "Set Actor Animation Speed",
    category: "Actors",
    description: "Frames each animation frame is shown for. 0 uses the sprite's own speed.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "speed", label: "Frames", kind: "int", min: 0, max: 255 },
    ],
    create: (c) => ({ type: "actor_set_anim_speed", actor: c.firstActor ?? "self", speed: 0 }),
    summary: (ev) => `${actorLabel(ev.actor)} ${ev.speed === 0 ? "default speed" : `${ev.speed} frames/frame`}`,
  }),
  def({
    type: "actor_transform",
    label: "Rotate / Scale Actor",
    category: "Actors",
    description:
      "Turn the actor's sprite (degrees clockwise) and make it bigger or smaller (percent, 25-200). 0 degrees at 100% puts it back to normal. Only the picture changes: collisions stay the same. Up to 32 actors can be rotated at once.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "angle", label: "Angle (degrees)", kind: "varOrLiteral", min: 0, max: 359 },
      { key: "scale_x", label: "Width %", kind: "varOrLiteral", min: 25, max: 200 },
      { key: "scale_y", label: "Height %", kind: "varOrLiteral", min: 25, max: 200 },
    ],
    create: (c) => ({ type: "actor_transform", actor: c.firstActor ?? "self", angle: 0, scale_x: 100, scale_y: 100 }),
    summary: (ev) =>
      `${actorLabel(ev.actor)} ${valLabel(ev.angle)}°` +
      (ev.scale_x !== 100 || ev.scale_y !== 100 ? ` at ${valLabel(ev.scale_x)}% × ${valLabel(ev.scale_y)}%` : ""),
  }),
  def({
    type: "actor_rotate_by",
    label: "Rotate Actor By",
    category: "Actors",
    description:
      "Turn the actor's sprite a further number of degrees (negative turns it the other way). Put it in On Update to keep it spinning.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "degrees", label: "Degrees", kind: "varOrLiteral", min: -359, max: 359 },
    ],
    create: (c) => ({ type: "actor_rotate_by", actor: c.firstActor ?? "self", degrees: 15 }),
    summary: (ev) =>
      `${actorLabel(ev.actor)} ${typeof ev.degrees === "number" && ev.degrees > 0 ? "+" : ""}${valLabel(ev.degrees)}°`,
  }),
  def({
    type: "player_set_sprite",
    label: "Set Player Sprite",
    category: "Actors",
    description:
      "Give the player another sprite sheet, for switching characters or outfits. Its animation states and collision box come with it. Scenes that pick their own player sprite still use theirs.",
    fields: [
      { key: "sprite", label: "Sprite", kind: "sprite" },
      { key: "keep", label: "Keep it in later scenes", kind: "bool", defaultValue: true },
    ],
    create: () => ({ type: "player_set_sprite", sprite: "player", keep: true }),
    summary: (ev) => `${ev.sprite || "?"}${ev.keep === false ? " (this scene)" : ""}`,
  }),
  def({
    type: "actor_scale_by",
    label: "Scale Actor By",
    category: "Actors",
    description:
      "Make the actor's sprite bigger or smaller by a number of percentage points (negative shrinks it). It stays between 25% and 200%. Put it in On Update to grow or shrink it over time.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "x", label: "Width % to add", kind: "varOrLiteral", min: -175, max: 175 },
      { key: "y", label: "Height % to add", kind: "varOrLiteral", min: -175, max: 175 },
    ],
    create: (c) => ({ type: "actor_scale_by", actor: c.firstActor ?? "self", x: 10, y: 10 }),
    summary: (ev) => `${actorLabel(ev.actor)} ${valLabel(ev.x)}% × ${valLabel(ev.y)}%`,
  }),
  def({
    type: "actor_set_collisions",
    label: "Set Actor Collisions",
    category: "Actors",
    description: "Turn collisions off to let an actor walk through walls and other actors.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "enabled", label: "Collisions", kind: "bool" },
    ],
    create: (c) => ({ type: "actor_set_collisions", actor: c.firstActor ?? "self", enabled: false }),
    summary: (ev) => `${actorLabel(ev.actor)} collisions ${ev.enabled ? "on" : "off"}`,
  }),
  def({
    type: "actor_push",
    label: "Push Actor Away From Player",
    category: "Actors",
    description: "Push an actor one step in the direction the player faces. \"Slide\" keeps it going until it hits something.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "continue", label: "Slide", kind: "bool" },
    ],
    create: (c) => ({ type: "actor_push", actor: c.firstActor ?? "self", continue: false }),
    summary: (ev) => `${actorLabel(ev.actor)}${ev.continue ? " (slide)" : ""}`,
  }),
  def({
    type: "if_actor_at_position",
    label: "If Actor At Position",
    category: "Actors",
    description: "Run Then if an actor is exactly at a position.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "pos", label: "Position", kind: "tilePos" },
      { key: "units", label: "Units", kind: "units" },
    ],
    branches: IF_BRANCHES,
    create: (c) => ({ type: "if_actor_at_position", actor: c.firstActor ?? "self", x: 0, y: 0, units: "tiles", then: [], else: [] }),
    summary: (ev) => `${actorLabel(ev.actor)} at (${ev.x}, ${ev.y})${unitsLabel(ev.units)}`,
  }),
  def({
    type: "if_actor_direction",
    label: "If Actor Facing Direction",
    category: "Actors",
    description: "Run Then if an actor faces a direction.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "direction", label: "Facing", kind: "direction" },
    ],
    branches: IF_BRANCHES,
    create: (c) => ({ type: "if_actor_direction", actor: c.firstActor ?? "player", direction: "down", then: [], else: [] }),
    summary: (ev) => `${actorLabel(ev.actor)} faces ${ev.direction}`,
  }),
  def({
    type: "if_actor_distance",
    label: "If Actor Distance From Actor",
    category: "Actors",
    description: "Compare the distance between two actors, in whole tiles.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "op", label: "Distance is", kind: "compareOp" },
      { key: "distance", label: "Tiles", kind: "varOrLiteral", min: 0, max: 255 },
      { key: "other", label: "From", kind: "actor" },
    ],
    branches: IF_BRANCHES,
    create: (c) => ({
      type: "if_actor_distance",
      actor: "player",
      op: "<=",
      distance: 3,
      other: c.firstActor ?? "self",
      then: [],
      else: [],
    }),
    summary: (ev) => `${actorLabel(ev.actor)} ${ev.op} ${valLabel(ev.distance)} tiles from ${actorLabel(ev.other)}`,
  }),
  def({
    type: "if_actor_relative",
    label: "If Actor Relative To Actor",
    category: "Actors",
    description: "Run Then if an actor is above, below, left of or right of another.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "relation", label: "Is", kind: "relation" },
      { key: "other", label: "Other actor", kind: "actor" },
    ],
    branches: IF_BRANCHES,
    create: (c) => ({ type: "if_actor_relative", actor: "player", relation: "up", other: c.firstActor ?? "self", then: [], else: [] }),
    summary: (ev) => `${actorLabel(ev.actor)} ${RELATION_LABEL[ev.relation] ?? ev.relation} ${actorLabel(ev.other)}`,
  }),

  // Scene
  def({
    type: "if_current_scene",
    label: "If Current Scene Is",
    category: "Scene",
    description: "Run Then if the game is in a scene. Useful in custom scripts.",
    fields: [{ key: "scene", label: "Scene", kind: "scene" }],
    branches: IF_BRANCHES,
    create: (c) => ({ type: "if_current_scene", scene: c.sceneNames[0] ?? "", then: [], else: [] }),
    summary: (ev) => ev.scene || "?",
  }),
  def({
    type: "scene_push",
    label: "Store Current Scene",
    category: "Scene",
    description:
      "Remember this scene and the player's position, to return to with Restore Previous Scene. \"Remember everything\" " +
      "also keeps every actor's position, direction and state, running scripts and timers - a real pause: coming back " +
      "carries on exactly where it left off (the scene's On Init doesn't run again).",
    fields: [{ key: "remember_all", label: "Remember everything (real pause)", kind: "bool", defaultValue: false }],
    create: () => ({ type: "scene_push" }),
    summary: () => "",
  }),
  def({
    type: "play_cutscene",
    label: "Play Cutscene",
    category: "Scene",
    description:
      "Play a video cutscene full-screen (make them in the Cutscenes tab), with its sound. Everything waits until it ends; then the scene comes back as it was.",
    fields: [
      { key: "cutscene", label: "Cutscene", kind: "cutscene" },
      { key: "skippable", label: "A / START skips it", kind: "bool", defaultValue: true },
      { key: "stop_music", label: "Stop the music first", kind: "bool", defaultValue: true },
    ],
    create: () => ({ type: "play_cutscene", cutscene: "", skippable: true, stop_music: true }),
    summary: (ev) => `"${(ev as unknown as { cutscene?: string }).cutscene || "?"}"`,
  }),
  def({
    type: "scene_pop",
    label: "Restore Previous Scene",
    category: "Scene",
    description: "Go back to the last stored scene and position. Ends the script.",
    fields: [],
    create: () => ({ type: "scene_pop" }),
    summary: () => "",
  }),
  def({
    type: "scene_pop_all",
    label: "Restore First Scene",
    category: "Scene",
    description: "Go back to the first stored scene and forget the rest. Ends the script.",
    fields: [],
    create: () => ({ type: "scene_pop_all" }),
    summary: () => "",
  }),
  def({
    type: "scene_reset",
    label: "Clear Stored Scenes",
    category: "Scene",
    description: "Forget every stored scene.",
    fields: [],
    create: () => ({ type: "scene_reset" }),
    summary: () => "",
  }),

  // Timing & input
  def({
    type: "idle",
    label: "Idle",
    category: "Timing & Input",
    description: "Wait for one frame.",
    fields: [],
    create: () => ({ type: "idle" }),
    summary: () => "1 frame",
  }),
  def({
    type: "if_input",
    label: "If Button Held",
    category: "Timing & Input",
    description: "Run Then if any of the chosen buttons is held down right now.",
    fields: [{ key: "buttons", label: "Buttons", kind: "buttons" }],
    branches: IF_BRANCHES,
    create: () => ({ type: "if_input", buttons: "a", then: [], else: [] }),
    summary: (ev) => buttonsLabel(ev.buttons),
  }),
  def({
    type: "input_script_set",
    label: "Attach Script To Button",
    category: "Timing & Input",
    description:
      "Run a script when a button is pressed, held, released or tapped, or when a combo is entered, until removed or the scene changes. " +
      "Frames: how long to hold, the longest press that counts as a tap, or the most time between combo buttons. \"Override\" replaces the " +
      "button's normal action (e.g. A = talk). Like GB Studio the script runs alongside play, so the player keeps moving " +
      "(mid-jump attacks work); tick \"Freeze player\" to stop everything until it finishes.",
    fields: [
      {
        key: "trigger",
        label: "When",
        kind: "select",
        defaultValue: "press",
        options: [
          { value: "press", label: "Pressed" },
          { value: "hold", label: "Held (repeats while held)" },
          { value: "long", label: "Held for a time (once)" },
          { value: "release", label: "Released" },
          { value: "tap", label: "Tapped (quick press)" },
          { value: "combo", label: "Combo (buttons in order)" },
        ],
      },
      { key: "buttons", label: "Buttons", kind: "buttons", showIf: (e) => e.trigger !== "combo" },
      {
        key: "combo",
        label: "Combo buttons, in order",
        kind: "text",
        placeholder: "down right a",
        showIf: (e) => e.trigger === "combo",
      },
      {
        key: "frames",
        label: "Frames",
        kind: "int",
        min: 1,
        max: 4095,
        defaultValue: 15,
        showIf: (e) => e.trigger === "long" || e.trigger === "tap" || e.trigger === "combo",
      },
      { key: "override", label: "Override", kind: "bool" },
      { key: "freeze_player", label: "Freeze player while it runs", kind: "bool", defaultValue: false },
    ],
    branches: [{ key: "script", label: "Script" }],
    create: () => ({ type: "input_script_set", buttons: "a", override: false, script: [] }),
    summary: (ev) => {
      const t = ev.trigger ?? "press";
      const what = t === "combo" ? `combo ${Array.isArray(ev.combo) ? ev.combo.join(" ") : ev.combo || "?"}` : buttonsLabel(ev.buttons);
      const when =
        t === "hold" ? " held" : t === "long" ? ` held ${ev.frames ?? 15}f` : t === "release" ? " released" : t === "tap" ? " tapped" : "";
      return `${what}${when}${ev.override ? " (override)" : ""}`;
    },
  }),
  def({
    type: "actor_line_of_sight",
    label: "Line Of Sight",
    category: "Actors",
    description:
      "Run a script when the player steps into an actor's view: the tiles straight in front of it, up to the range. " +
      "The view follows the actor as it moves and turns (like Pokémon trainers). Runs again only after the player " +
      "leaves the view. Lasts until the scene changes.",
    fields: [
      { key: "actor", label: "Actor", kind: "actor" },
      { key: "range", label: "Range (tiles)", kind: "int", min: 1, max: 30 },
      { key: "walls", label: "Solid tiles block the view", kind: "bool" },
    ],
    branches: [{ key: "script", label: "On sight" }],
    create: (c) => ({ type: "actor_line_of_sight", actor: c.firstActor ?? "self", range: 4, walls: true, script: [] }),
    summary: (ev) => `${actorLabel(ev.actor)}, ${ev.range ?? 4} tiles`,
  }),
  def({
    type: "actor_line_of_sight_remove",
    label: "Remove Line Of Sight",
    category: "Actors",
    description: "Stop watching for the player with this actor's Line Of Sight script.",
    fields: [{ key: "actor", label: "Actor", kind: "actor" }],
    create: (c) => ({ type: "actor_line_of_sight_remove", actor: c.firstActor ?? "self" }),
    summary: (ev) => actorLabel(ev.actor),
  }),
  def({
    type: "input_script_remove",
    label: "Remove Button Script",
    category: "Timing & Input",
    description: "Stop running the script attached to these buttons.",
    fields: [{ key: "buttons", label: "Buttons", kind: "buttons" }],
    create: () => ({ type: "input_script_remove", buttons: "a" }),
    summary: (ev) => buttonsLabel(ev.buttons),
  }),
  def({
    type: "timer_script_set",
    label: "Attach Timer Script",
    category: "Timing & Input",
    description: "Run a script every so many frames, in the background, until disabled or the scene changes.",
    fields: [
      { key: "timer", label: "Timer", kind: "int", min: 1, max: 4 },
      { key: "frames", label: "Every (frames)", kind: "int", min: 1, max: MAX_I16 },
    ],
    branches: [{ key: "script", label: "On tick" }],
    create: () => ({ type: "timer_script_set", timer: 1, frames: 60, script: [] }),
    summary: (ev) => `timer ${ev.timer} every ${ev.frames} frames`,
  }),
  def({
    type: "timer_restart",
    label: "Restart Timer",
    category: "Timing & Input",
    description: "Start a timer's countdown over from the beginning.",
    fields: [{ key: "timer", label: "Timer", kind: "int", min: 1, max: 4 }],
    create: () => ({ type: "timer_restart", timer: 1 }),
    summary: (ev) => `timer ${ev.timer}`,
  }),
  def({
    type: "timer_disable",
    label: "Disable Timer",
    category: "Timing & Input",
    description: "Stop a timer's script from running.",
    fields: [{ key: "timer", label: "Timer", kind: "int", min: 1, max: 4 }],
    create: () => ({ type: "timer_disable", timer: 1 }),
    summary: (ev) => `timer ${ev.timer}`,
  }),

  // Scripts
  def({
    type: "thread_start",
    label: "Start Thread",
    category: "Scripts",
    description:
      "Run events in the background while this script carries on. Store the handle in a variable to stop it later. " +
      "Threads end when the scene changes.",
    fields: [{ key: "var", label: "Handle variable", kind: "optionalVariable" }],
    branches: [{ key: "script", label: "Thread" }],
    create: () => ({ type: "thread_start", var: "", script: [] }),
    summary: (ev) => (ev.var ? `handle → ${ev.var}` : ""),
  }),
  def({
    type: "thread_stop",
    label: "Stop Thread",
    category: "Scripts",
    description: "Stop the thread whose handle is stored in a variable.",
    fields: [{ key: "var", label: "Handle variable", kind: "variable" }],
    create: (c) => ({ type: "thread_stop", var: c.variables[0] ?? "" }),
    summary: (ev) => ev.var || "?",
  }),

  // Screen
  def({
    type: "sprites_hide",
    label: "Hide All Sprites",
    category: "Screen",
    description: "Hide every sprite (actors and the player) until Show All Sprites.",
    fields: [],
    create: () => ({ type: "sprites_hide" }),
    summary: () => "",
  }),
  def({
    type: "sprites_show",
    label: "Show All Sprites",
    category: "Screen",
    description: "Show sprites again after Hide All Sprites.",
    fields: [],
    create: () => ({ type: "sprites_show" }),
    summary: () => "",
  }),
  def({
    type: "palette_set",
    label: "Set Palette Color",
    category: "Screen",
    description: "Change one color of a background or sprite palette bank until the next scene load.",
    fields: [
      { key: "target", label: "Palette", kind: "paletteTarget" },
      { key: "bank", label: "Bank", kind: "int", min: 0, max: 15 },
      { key: "index", label: "Color #", kind: "int", min: 0, max: 15 },
      { key: "color", label: "Color", kind: "color" },
    ],
    create: () => ({ type: "palette_set", target: "background", bank: 0, index: 1, color: "#ffffff" }),
    summary: (ev) => `${ev.target} ${ev.bank}:${ev.index} = ${ev.color ?? ev.colors?.join(", ") ?? "?"}`,
  }),
  def({
    type: "replace_tile",
    label: "Replace Tile",
    category: "Screen",
    description: "Copy the tile at the source position onto another tile of this scene's map (until the scene reloads).",
    fields: [
      { key: "pos", label: "Tile", kind: "tilePos" },
      { key: "source", label: "Copy from", kind: "tilePos", xKey: "sourceX", yKey: "sourceY" },
    ],
    create: () => ({ type: "replace_tile", x: 0, y: 0, sourceX: 0, sourceY: 0 }),
    summary: (ev) => `(${ev.x}, ${ev.y}) ← (${ev.sourceX}, ${ev.sourceY})`,
  }),

  // Save data
  def({
    type: "data_save",
    label: "Save Data",
    category: "Save Data",
    description: "Save the game (variables, flags, items, scene and position) to a slot.",
    fields: [{ key: "slot", label: "Slot", kind: "int", min: 0, max: 2 }],
    create: () => ({ type: "data_save", slot: 0 }),
    summary: (ev) => `slot ${ev.slot}`,
  }),
  def({
    type: "data_load",
    label: "Load Data",
    category: "Save Data",
    description: "Load a save slot and go to its scene. Ends the script if the slot has a save; otherwise carries on.",
    fields: [{ key: "slot", label: "Slot", kind: "int", min: 0, max: 2 }],
    create: () => ({ type: "data_load", slot: 0 }),
    summary: (ev) => `slot ${ev.slot}`,
  }),
  def({
    type: "data_clear",
    label: "Clear Data",
    category: "Save Data",
    description: "Delete the save in a slot.",
    fields: [{ key: "slot", label: "Slot", kind: "int", min: 0, max: 2 }],
    create: () => ({ type: "data_clear", slot: 0 }),
    summary: (ev) => `slot ${ev.slot}`,
  }),
  def({
    type: "if_data_saved",
    label: "If Data Saved",
    category: "Save Data",
    description: "Run Then if a save slot holds a save.",
    fields: [{ key: "slot", label: "Slot", kind: "int", min: 0, max: 2 }],
    branches: IF_BRANCHES,
    create: () => ({ type: "if_data_saved", slot: 0, then: [], else: [] }),
    summary: (ev) => `slot ${ev.slot}`,
  }),
  def({
    type: "data_peek",
    label: "Read Variable From Save",
    category: "Save Data",
    description: "Copy a variable's value out of a save slot without loading it (0 if the slot is empty).",
    fields: [
      { key: "slot", label: "Slot", kind: "int", min: 0, max: 2 },
      { key: "source", label: "Saved variable", kind: "variable" },
      { key: "var", label: "Store in", kind: "variable" },
    ],
    create: (c) => ({ type: "data_peek", slot: 0, source: c.variables[0] ?? "", var: c.variables[0] ?? "" }),
    summary: (ev) => `${ev.var || "?"} = slot ${ev.slot}'s ${ev.source || "?"}`,
  }),

  // Sound
  def({
    type: "sound_tone",
    label: "Play Tone",
    category: "Sound",
    description: "Play a square-wave tone on sound channel 1.",
    fields: [
      { key: "frequency", label: "Frequency (Hz)", kind: "int", min: 64, max: 20000 },
      { key: "frames", label: "Frames", kind: "int", min: 1, max: MAX_I16 },
    ],
    create: () => ({ type: "sound_tone", frequency: 440, frames: 30 }),
    summary: (ev) => `${ev.frequency} Hz, ${ev.frames}f`,
  }),
  def({
    type: "sound_beep",
    label: "Play Beep",
    category: "Sound",
    description: "Play a short noise-channel beep (pitch 1-8).",
    fields: [
      { key: "pitch", label: "Pitch", kind: "int", min: 1, max: 8 },
      { key: "frames", label: "Frames", kind: "int", min: 1, max: MAX_I16 },
    ],
    create: () => ({ type: "sound_beep", pitch: 4, frames: 30 }),
    summary: (ev) => `pitch ${ev.pitch}, ${ev.frames}f`,
  }),
  def({
    type: "sound_crash",
    label: "Play Crash",
    category: "Sound",
    description: "Play a noise burst on sound channel 4.",
    fields: [{ key: "frames", label: "Frames", kind: "int", min: 1, max: MAX_I16 }],
    create: () => ({ type: "sound_crash", frames: 30 }),
    summary: (ev) => `${ev.frames}f`,
  }),
  def({
    type: "mute_channel",
    label: "Mute Music Channel",
    category: "Sound",
    description: "Keep a .uge song off one of the four sound channels (e.g. to free it for sound effects).",
    fields: [
      { key: "channel", label: "Channel", kind: "int", min: 1, max: 4 },
      { key: "muted", label: "Muted", kind: "bool" },
    ],
    create: () => ({ type: "mute_channel", channel: 1, muted: true }),
    summary: (ev) => `channel ${ev.channel} ${ev.muted ? "muted" : "unmuted"}`,
  }),
  def({
    type: "music_routine",
    label: "Set Music Routine",
    category: "Sound",
    description: "Run a script whenever the playing .uge song hits effect 6xx with x = this routine number.",
    fields: [{ key: "routine", label: "Routine", kind: "int", min: 0, max: 15 }],
    branches: [{ key: "script", label: "On effect" }],
    create: () => ({ type: "music_routine", routine: 0, script: [] }),
    summary: (ev) => `routine ${ev.routine}`,
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
