/**
 * Event-script JSON types, mirroring compiler/build_project.py's
 * compile_events() exactly (see that file's module docstring for the
 * authoritative description of every field). This is the data format
 * on_init / door "events" / NPC "on_interact" / timer "script" lists use.
 *
 * The visual script editor (src/script/) reads and writes exactly these
 * shapes - its per-event field list lives in src/script/eventCatalog.ts.
 */

export type Direction = "down" | "up" | "right" | "left";

export type SoundEffect = "blip" | "door" | "save" | "item";

export type ButtonName =
  | "a"
  | "b"
  | "select"
  | "start"
  | "up"
  | "down"
  | "left"
  | "right"
  | "l"
  | "r";

export type CompareOp = "==" | "!=" | "<" | "<=" | ">" | ">=";

/** set_var/add_var/if_var's "value"/"delta" field: a literal int16, or a
 * reference to another variable (compiles to the *_VAR_VAR_* ops). */
export type VarOrLiteral = number | { var: string };

/** "actor" field on actor_* events: a named actor, an NPC index,
 * "self" (only valid inside that NPC's own on_interact), or "player"
 * (targets the player instead of any NPC - valid everywhere, in every
 * actor_* event and camera_lock_actor). */
export type ActorRef = string | number | "self" | "player";

/** "timer" field on start_timer: a named timer or its index. */
export type TimerRef = string | number;

export interface EventBase {
  type: string;
}

export interface TextEvent extends EventBase {
  type: "text";
  text: string;
}

export interface SetFlagEvent extends EventBase {
  type: "set_flag";
  flag: string;
}

export interface ClearFlagEvent extends EventBase {
  type: "clear_flag";
  flag: string;
}

export interface IfFlagEvent extends EventBase {
  type: "if_flag";
  flag: string;
  then?: EventScript;
  else?: EventScript;
}

export interface GiveItemEvent extends EventBase {
  type: "give_item";
  item: string;
}

export interface IfItemEvent extends EventBase {
  type: "if_item";
  item: string;
  then?: EventScript;
  else?: EventScript;
}

export interface PlaySoundEvent extends EventBase {
  type: "play_sound";
  sound: SoundEffect;
}

export interface WaitEvent extends EventBase {
  type: "wait";
  frames: number;
}

export interface SwitchSceneEvent extends EventBase {
  type: "switch_scene";
  scene: string;
  x?: number;
  y?: number;
}

export interface SetVarEvent extends EventBase {
  type: "set_var";
  var: string;
  value: VarOrLiteral;
}

export interface AddVarEvent extends EventBase {
  type: "add_var";
  var: string;
  delta: VarOrLiteral;
}

export interface IfVarEvent extends EventBase {
  type: "if_var";
  var: string;
  op: CompareOp;
  value: VarOrLiteral;
  then?: EventScript;
  else?: EventScript;
}

export interface RandomVarEvent extends EventBase {
  type: "random_var";
  var: string;
  min: number;
  max: number;
}

export interface ActorShowEvent extends EventBase {
  type: "actor_show";
  actor: ActorRef;
}

export interface ActorHideEvent extends EventBase {
  type: "actor_hide";
  actor: ActorRef;
}

export interface ActorSetPositionEvent extends EventBase {
  type: "actor_set_position";
  actor: ActorRef;
  x: number;
  y: number;
}

export interface ActorSetDirectionEvent extends EventBase {
  type: "actor_set_direction";
  actor: ActorRef;
  direction: Direction;
}

export interface ActorMoveToEvent extends EventBase {
  type: "actor_move_to";
  actor: ActorRef;
  x: number;
  y: number;
}

/** "state" is a name (resolved against the actor's sprite's
 * SpriteSheetJSON.states) or a 0-based index into that list. Compile
 * error if the actor's sprite defines no states at all. */
export interface ActorSetStateEvent extends EventBase {
  type: "actor_set_state";
  actor: ActorRef;
  state: string | number;
}

export interface ActorSetAnimateEvent extends EventBase {
  type: "actor_set_animate";
  actor: ActorRef;
  enabled: boolean;
}

/** Frame index into the actor's sprite sheet (0-7 under the legacy
 * convention; whatever the sheet's compiled frame count is otherwise). */
export interface ActorSetFrameEvent extends EventBase {
  type: "actor_set_frame";
  actor: ActorRef;
  frame: number;
}

/** Same fields as SpriteSheetJSON's collisionBox, but flat on the event
 * (not nested) and settable at runtime. */
export interface ActorSetCollisionBoxEvent extends EventBase {
  type: "actor_set_collision_box";
  actor: ActorRef;
  x?: number;
  y?: number;
  width: number;
  height: number;
}

export interface WaitButtonEvent extends EventBase {
  type: "wait_button";
  buttons: ButtonName | ButtonName[];
}

export interface ChoiceEvent extends EventBase {
  type: "choice";
  prompt: string;
  options: [string, string];
  then?: EventScript;
  else?: EventScript;
}

export interface MenuOption {
  label: string;
  then?: EventScript;
}

export interface MenuEvent extends EventBase {
  type: "menu";
  options: MenuOption[];
}

export interface StartTimerEvent extends EventBase {
  type: "start_timer";
  timer: TimerRef;
}

export interface CameraLockActorEvent extends EventBase {
  type: "camera_lock_actor";
  actor: ActorRef;
}

export interface CameraLockPointEvent extends EventBase {
  type: "camera_lock_point";
  x: number;
  y: number;
}

export interface CameraMoveToEvent extends EventBase {
  type: "camera_move_to";
  x: number;
  y: number;
}

export interface CameraReleaseEvent extends EventBase {
  type: "camera_release";
}

/** Inline-expands to a copy of project.customScripts[].script (matched by
 * stable id) at compile time - a macro/include, not a real call/return, so
 * it needs no new VM opcode or call stack. The compiler detects and errors
 * on a cycle (a script that calls itself, directly or transitively)
 * instead of infinite-looping. "script" is a CustomScriptJSON id, or the
 * DELETED_REF sentinel ("(deleted)") if its target was removed - see
 * scriptRefs.ts. */
export interface CallScriptEvent extends EventBase {
  type: "call_script";
  script: string;
}

/** Pure editor organization, no runtime effect - the compiler inline-
 * splices its children (if any survive - "comment" has none) straight
 * into the surrounding script, same as "group" below. */
export interface CommentEvent extends EventBase {
  type: "comment";
  text: string;
}

/** Visually collapses a block of events under a label - no runtime
 * effect, the compiler inline-splices "children" in place (like a
 * transparent wrapper), not a branch/jump. */
export interface GroupEvent extends EventBase {
  type: "group";
  label?: string;
  children?: EventScript;
}

/** Runs "body" forever (jumps back to its start once it finishes) -
 * exit via Stop Script, a scene change, or an event inside the body
 * that stops the script some other way. An empty body loops forever
 * doing nothing, same as GB Studio's. */
export interface LoopEvent extends EventBase {
  type: "loop";
  body?: EventScript;
}

/** Halts the whole script immediately, wherever it appears (including
 * nested inside a branch) - compiles straight to a SCRIPT_END. */
export interface StopScriptEvent extends EventBase {
  type: "stop_script"; }

export type MathOp = "add" | "sub" | "mul" | "div" | "mod";

/** Generalizes add_var to all 5 arithmetic ops ("add" duplicates
 * add_var's own SCRIPT_ADD_VAR(_VAR); kept as a separate event type
 * from add_var rather than replacing it, so existing projects keep
 * compiling unchanged). Division/modulo by 0 sets the variable to 0
 * rather than crashing - see script.c. */
export interface MathEvent extends EventBase {
  type: "math";
  var: string;
  op: MathOp;
  value: VarOrLiteral;
}

/** Reads an actor's current position (in pixels) into two variables. */
export interface ActorGetPositionEvent extends EventBase {
  type: "actor_get_position";
  actor: ActorRef;
  varX: string;
  varY: string;
}

/** Reads an actor's current facing direction into a variable, as a
 * Direction ordinal (0=down,1=up,2=right,3=left - see entity.h). */
export interface ActorGetDirectionEvent extends EventBase {
  type: "actor_get_direction";
  actor: ActorRef;
  var: string;
}

/** Shakes the camera (background scroll + every on-screen sprite move
 * together) for a number of frames, then settles back to wherever it
 * would otherwise be. Doesn't block the script - it plays out in the
 * background over the next `frames` frames. */
export interface CameraShakeEvent extends EventBase {
  type: "camera_shake";
  frames: number;
  magnitude: number;
}

export type ArrayVarMathOp = MathOp | "get" | "set";

/** Treats a contiguous run of named variables as a list/array: "array" is
 * the variable at the array's own first slot, and "index" is ANOTHER
 * variable holding the runtime offset into it - array[index] is the
 * variable at (array's index + index's current value). "get" copies
 * array[index] into "output"; "set" writes "value" into array[index]
 * outright; every other op applies that MathOp to array[index] in place
 * using "value" as the right-hand side, exactly like MathEvent. A literal
 * (compile-time-constant) index doesn't need this event at all - Set
 * Variable/Math already reach any fixed slot directly; this is only for
 * when the slot itself is picked at runtime. Out-of-range reads/writes
 * are a safe no-op/0 (see var_get()/var_set() in state.h) since there's
 * no compile-time bounds check on a runtime index. */
export interface ArrayVarMathEvent extends EventBase {
  type: "array_var_math";
  array: string;
  index: string;
  op: ArrayVarMathOp;
  /** Used for every op except "get". */
  value?: VarOrLiteral;
  /** Used only for "get". */
  output?: string;
}

export type FadeColor = "black" | "white";

/** Fades the screen to black or white over "frames" frames, using the
 * GBA's hardware brightness blend (see transition.h). "wait" (default
 * true) pauses the script until the fade finishes; false starts it and
 * carries straight on, like CameraShakeEvent. */
export interface FadeOutEvent extends EventBase {
  type: "fade_out";
  color: FadeColor;
  frames: number;
  wait?: boolean;
}

/** Fades the screen back in from black or white over "frames" frames -
 * "color" should match whichever color the screen is currently faded to.
 * "wait" (default true) pauses the script until the fade finishes. */
export interface FadeInEvent extends EventBase {
  type: "fade_in";
  color: FadeColor;
  frames: number;
  wait?: boolean;
}

/** Starts (or restarts) a music track by name (an engine/music/*.mod-
 * style asset, same names the MusicSelect picker/scene "music" property
 * use) - the script-authorable counterpart to a scene's own "music"
 * property, for changing music from an On Init/door/NPC/timer script
 * instead of only on scene load. "loop" (default true) repeats it
 * forever; false plays it once and stops. Playing the SAME track that's
 * already playing is a safe no-op (see engine/source/music.c's
 * music_current_track()) - it won't restart from the beginning. */
export interface PlayMusicEvent extends EventBase {
  type: "play_music";
  track: string;
  loop?: boolean;
}

/** Silences whatever music is currently playing (from a scene's "music"
 * property OR a prior play_music event). No effect if nothing is
 * playing. */
export interface StopMusicEvent extends EventBase {
  type: "stop_music";
}

export type ScriptEventJSON =
  | TextEvent
  | SetFlagEvent
  | ClearFlagEvent
  | IfFlagEvent
  | GiveItemEvent
  | IfItemEvent
  | PlaySoundEvent
  | WaitEvent
  | SwitchSceneEvent
  | SetVarEvent
  | AddVarEvent
  | IfVarEvent
  | RandomVarEvent
  | ActorShowEvent
  | ActorHideEvent
  | ActorSetPositionEvent
  | ActorSetDirectionEvent
  | ActorMoveToEvent
  | ActorSetStateEvent
  | ActorSetAnimateEvent
  | ActorSetFrameEvent
  | ActorSetCollisionBoxEvent
  | WaitButtonEvent
  | ChoiceEvent
  | MenuEvent
  | StartTimerEvent
  | CameraLockActorEvent
  | CameraLockPointEvent
  | CameraMoveToEvent
  | CameraReleaseEvent
  | CallScriptEvent
  | CommentEvent
  | GroupEvent
  | LoopEvent
  | StopScriptEvent
  | MathEvent
  | ActorGetPositionEvent
  | ActorGetDirectionEvent
  | CameraShakeEvent
  | ArrayVarMathEvent
  | FadeOutEvent
  | FadeInEvent
  | PlayMusicEvent
  | StopMusicEvent;

export type EventScript = ScriptEventJSON[];

/** Counts every event in a script, recursing into then/else/option
 * branches - used where the UI just needs to say "N events" rather than
 * render them (see the properties panel's placeholder script summary). */
export function countEvents(script: EventScript | undefined): number {
  if (!script) return 0;
  let n = 0;
  for (const ev of script) {
    n += 1;
    if ("then" in ev && ev.then) n += countEvents(ev.then);
    if ("else" in ev && ev.else) n += countEvents(ev.else);
    if (ev.type === "menu") {
      for (const opt of ev.options) n += countEvents(opt.then);
    }
    if ("body" in ev && ev.body) n += countEvents(ev.body);
    if ("children" in ev && ev.children) n += countEvents(ev.children);
  }
  return n;
}
