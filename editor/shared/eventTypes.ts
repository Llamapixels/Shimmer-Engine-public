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

export type ProjectileTarget = "actors" | "group1" | "group2" | "group3" | "player";

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
  /** Skipped by the compiler, like GB Studio's "Disable Event". */
  __disabled?: boolean;
  /** This event's "else" branch is skipped (GB Studio's "Disable Else"). */
  __disableElse?: boolean;
}

export interface TextEvent extends EventBase {
  type: "text";
  text: string;
  /** Where the box sits (default "bottom"). */
  position?: "bottom" | "top" | "middle";
  /** Text lines in the box, 1-4 (default 2). */
  rows?: number;
  /** false = no frame: just the text, on a see-through background. */
  frame?: boolean;
  focus?: TextFocus;
}

/** Text/choice/menu: dim and/or blur everything but the box while it's open. */
export type TextFocus = "none" | "dim" | "blur" | "dim_blur";

/** Dialogue look from here on (compiler/ui.py): a font/frame name
 * (assets/fonts, assets/frames, or "default"), or frames per character. */
export interface TextSetFontEvent extends EventBase {
  type: "text_set_font";
  font: string;
}

export interface TextSetFrameEvent extends EventBase {
  type: "text_set_frame";
  frame: string;
}

export interface TextSetSpeedEvent extends EventBase {
  type: "text_set_speed";
  speed: number;
}

/** Change a scene type engine setting (compiler/engine_settings.json)
 * for the rest of the scene. */
export interface SetEngineSettingEvent extends EventBase {
  type: "set_engine_setting";
  setting: string;
  value: number | boolean | string;
}

export interface LaunchProjectileEvent extends EventBase {
  type: "launch_projectile";
  sprite: string;
  actor?: ActorRef;
  direction?: "facing" | "up" | "down" | "left" | "right" | "angle";
  /** Degrees, 0 = right, 90 = up. */
  angle?: number;
  /** px per frame */
  speed?: number;
  /** frames, 0 = until it leaves the screen */
  lifetime?: number;
  /** One target, or several (the editor writes a list). */
  hits?: ProjectileTarget | ProjectileTarget[];
  /** Which On Player Hit script runs when it hits the player. */
  group?: number;
  pierce?: boolean;
  through_walls?: boolean;
  /** Drawn in front of the player and actors. */
  front?: boolean;
  offset_x?: number;
  offset_y?: number;
  path?: "straight" | "wave" | "arc_high" | "arc_low" | "boomerang";
  /** wave: px either side, frames per wave */
  wave_size?: number;
  wave_length?: number;
  /** px per frame per frame / px per frame (arcs set their own) */
  gravity?: number;
  lift?: number;
  /** boomerang: frames before it comes back */
  return_after?: number;
  /** wall bounces, or "forever" */
  bounces?: number | "forever";
  bounce_actors?: boolean;
  on_land?: "vanish" | "stick" | "linger";
  linger_frames?: number;
  /** Animation state to switch to when it lands. */
  land_state?: string;
  /** Stays at its offset from the thrower (melee). */
  follow?: boolean;
  /** Offset X flips when fired to the left. */
  mirror_offset?: boolean;
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
  /** A built-in effect, or the name of a WAV in assets/sounds. */
  sound: SoundEffect | string;
  /** WAV only: which Direct Sound channel ("auto" = a free one). */
  channel?: "auto" | "a" | "b";
  loop?: boolean;
  volume?: "full" | "half";
}

/** Stop WAV playback on a channel ("auto" = both). */
export interface StopSoundEvent extends EventBase {
  type: "stop_sound";
  channel?: "auto" | "a" | "b";
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
  /** Default "fade_black". */
  transition?: "fade_black" | "fade_white" | "none" | "flash" | "mosaic" | "box" | "bars" | "wipe";
  /** Length of the fade out (and of the fade in), default 8. */
  transition_frames?: number;
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

/** "state" is a state name of the actor's sprite ("Default" for the
 * first) or a 0-based index into its states. */
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

/** Frame (0-based) of the actor's current animation; animation stops
 * until re-enabled or the actor turns or starts/stops moving. */
export interface ActorSetFrameEvent extends EventBase {
  type: "actor_set_frame";
  actor: ActorRef;
  frame: number;
}

/** Like a sprite's bounds (relative to the actor's 16x16 footprint), but
 * set at runtime. */
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
  focus?: TextFocus;
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
  focus?: TextFocus;
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
  /** px per frame, 1-16 (default 1) */
  speed?: number;
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

/** Starts (or restarts) a song by name (a .uge file in the project's
 * assets/music folder, same names the MusicSelect picker/scene "music"
 * property use) - the script-authorable counterpart to a scene's own "music"
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

// ---- GB Studio parity events (compiler/build_project.py's
// compile_parity_event()) ----

/** Position fields are in tiles unless units is "pixels". */
export type PositionUnits = "tiles" | "pixels";

/** A math expression string - see compiler/expr.py for the syntax
 * ($name$ or bare variable names, C operators, min/max/abs/rnd/isqrt,
 * actor_x/actor_y/actor_dir, held/pressed, flag/item, saved/peek,
 * scene, time). */
export type Expression = string;

export interface IfExpressionEvent extends EventBase {
  type: "if_expression";
  expression: Expression;
  then?: EventScript;
  else?: EventScript;
}

export interface SetVarExpressionEvent extends EventBase {
  type: "set_var_expression";
  var: string;
  expression: Expression;
}

export interface LoopWhileEvent extends EventBase {
  type: "loop_while";
  expression: Expression;
  body?: EventScript;
}

/** var = from; while (var comparison to) { body; var stepOp= step } */
export interface LoopForEvent extends EventBase {
  type: "loop_for";
  var: string;
  from: VarOrLiteral;
  comparison: CompareOp;
  to: VarOrLiteral;
  stepOp: MathOp;
  step: VarOrLiteral;
  body?: EventScript;
}

export interface SetVarTrueEvent extends EventBase {
  type: "set_var_true";
  var: string;
}

export interface SetVarFalseEvent extends EventBase {
  type: "set_var_false";
  var: string;
}

export interface VarIncEvent extends EventBase {
  type: "var_inc";
  var: string;
}

export interface VarDecEvent extends EventBase {
  type: "var_dec";
  var: string;
}

export interface IfVarTrueEvent extends EventBase {
  type: "if_var_true";
  var: string;
  then?: EventScript;
  else?: EventScript;
}

export interface IfVarFalseEvent extends EventBase {
  type: "if_var_false";
  var: string;
  then?: EventScript;
  else?: EventScript;
}

/** Bit flags on a variable: "bits" are bit numbers 0-15. set replaces
 * the value with just those bits, add ORs them in, clear removes them. */
export interface VarSetFlagsEvent extends EventBase {
  type: "var_set_flags";
  var: string;
  bits: number[];
}

export interface VarAddFlagsEvent extends EventBase {
  type: "var_add_flags";
  var: string;
  bits: number[];
}

export interface VarClearFlagsEvent extends EventBase {
  type: "var_clear_flags";
  var: string;
  bits: number[];
}

/** True when every listed bit is set. */
export interface IfVarFlagsEvent extends EventBase {
  type: "if_var_flags";
  var: string;
  bits: number[];
  then?: EventScript;
  else?: EventScript;
}

export interface VarsResetEvent extends EventBase {
  type: "vars_reset";
}

export interface SeedRngEvent extends EventBase {
  type: "seed_rng";
}

/** Waits one frame. */
export interface IdleEvent extends EventBase {
  type: "idle";
}

/** Skips "body" if it ran less than "frames" frames ago; "var" stores
 * when it last ran. */
export interface RateLimitEvent extends EventBase {
  type: "rate_limit";
  var: string;
  frames: number;
  body?: EventScript;
}

export interface LabelEvent extends EventBase {
  type: "label";
  label: string;
}

/** Jumps to a Label in the same script. */
export interface GotoEvent extends EventBase {
  type: "goto";
  label: string;
}

export interface SwitchCase {
  value: number;
  then?: EventScript;
}

export interface SwitchEvent extends EventBase {
  type: "switch";
  var: string;
  cases: SwitchCase[];
  else?: EventScript;
}

/** Runs an NPC's on_interact script here (inlined at compile time). */
export interface ActorInvokeEvent extends EventBase {
  type: "actor_invoke";
  actor: ActorRef;
}

/** Runs "script" in the background alongside this one. "var" (optional,
 * "" = none) receives the thread's handle, for Stop Thread. */
export interface ThreadStartEvent extends EventBase {
  type: "thread_start";
  var?: string;
  script?: EventScript;
}

export interface ThreadStopEvent extends EventBase {
  type: "thread_stop";
  var: string;
}

/** Timer 1-4: runs "script" every "frames" frames until disabled or
 * the scene changes. Separate from the scene's own "timers" list. */
export interface TimerScriptSetEvent extends EventBase {
  type: "timer_script_set";
  timer: number;
  frames: number;
  script?: EventScript;
}

export interface TimerRestartEvent extends EventBase {
  type: "timer_restart";
  timer: number;
}

export interface TimerDisableEvent extends EventBase {
  type: "timer_disable";
  timer: number;
}

/** Runs "script" whenever one of the buttons is pressed. "override"
 * replaces the button's normal action (A = talk). */
export interface InputScriptSetEvent extends EventBase {
  type: "input_script_set";
  buttons: ButtonName | ButtonName[];
  override?: boolean;
  /** Default "press". */
  trigger?: "press" | "hold" | "long" | "release" | "tap" | "combo";
  /** long: frames to hold; tap: most frames held; combo: most frames
   * between steps. Default 15. */
  frames?: number;
  /** trigger "combo": the buttons in order, e.g. "down right a". */
  combo?: string | ButtonName[];
  script?: EventScript;
}

export interface ActorLineOfSightEvent extends EventBase {
  type: "actor_line_of_sight";
  actor: ActorRef;
  /** tiles */
  range?: number;
  /** Solid tiles block the view (default true). */
  walls?: boolean;
  script?: EventScript;
}

export interface ActorLineOfSightRemoveEvent extends EventBase {
  type: "actor_line_of_sight_remove";
  actor: ActorRef;
}

export interface InputScriptRemoveEvent extends EventBase {
  type: "input_script_remove";
  buttons: ButtonName | ButtonName[];
}

/** Runs "script" whenever the playing .uge song hits effect 6xx with
 * x = routine. */
export interface MusicRoutineEvent extends EventBase {
  type: "music_routine";
  routine: number;
  script?: EventScript;
}

export interface ActorSetPositionVarsEvent extends EventBase {
  type: "actor_set_position_vars";
  actor: ActorRef;
  varX: string;
  varY: string;
  units?: PositionUnits;
}

export interface ActorMoveToVarsEvent extends EventBase {
  type: "actor_move_to_vars";
  actor: ActorRef;
  varX: string;
  varY: string;
  units?: PositionUnits;
}

export interface ActorSetPositionRelativeEvent extends EventBase {
  type: "actor_set_position_relative";
  actor: ActorRef;
  x: number;
  y: number;
  units?: PositionUnits;
}

export interface ActorMoveRelativeEvent extends EventBase {
  type: "actor_move_relative";
  actor: ActorRef;
  x: number;
  y: number;
  units?: PositionUnits;
}

export interface ActorSetFrameVarEvent extends EventBase {
  type: "actor_set_frame_var";
  actor: ActorRef;
  var: string;
}

/** Scripted-move speed in pixels per frame (1-8). */
export interface ActorSetMoveSpeedEvent extends EventBase {
  type: "actor_set_move_speed";
  actor: ActorRef;
  speed: number;
}

/** Frames per animation frame (0 = the sprite's own speed). */
export interface ActorSetAnimSpeedEvent extends EventBase {
  type: "actor_set_anim_speed";
  actor: ActorRef;
  speed: number;
}

/** Rotates (degrees clockwise) and scales (percent) the actor's sprite. */
export interface ActorTransformEvent extends EventBase {
  type: "actor_transform";
  actor: ActorRef;
  angle: VarOrLiteral;
  scale_x: VarOrLiteral;
  scale_y: VarOrLiteral;
}

/** Turns the actor's sprite a further number of degrees. */
export interface ActorRotateByEvent extends EventBase {
  type: "actor_rotate_by";
  actor: ActorRef;
  degrees: VarOrLiteral;
}

/** Recall (fly back to the thrower) or remove projectiles. */
export interface ProjectileRecallEvent extends EventBase {
  type: "projectile_recall";
  /** A sprite name, or "all". */
  sprite: string;
}

export interface ProjectileRemoveEvent extends EventBase {
  type: "projectile_remove";
  /** A sprite name, or "all". */
  sprite: string;
}

/** Text on screen, apart from the dialogue box. */
export interface TextDrawEvent extends EventBase {
  type: "text_draw";
  slot: number;
  x: number;
  y: number;
  text: string;
  frame?: boolean;
  /** Cleared after this many frames; 0 = stays. */
  frames?: number;
}

export interface TextClearEvent extends EventBase {
  type: "text_clear";
  slot: number | "all" | "area";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Gives the player another sprite. */
export interface PlayerSetSpriteEvent extends EventBase {
  type: "player_set_sprite";
  sprite: string;
  /** Also in later scenes (default true). */
  keep?: boolean;
}

/** Adds percentage points to the actor's width/height scale. */
export interface ActorScaleByEvent extends EventBase {
  type: "actor_scale_by";
  actor: ActorRef;
  x: VarOrLiteral;
  y: VarOrLiteral;
}

export interface ActorSetCollisionsEvent extends EventBase {
  type: "actor_set_collisions";
  actor: ActorRef;
  enabled: boolean;
}

/** Pushes the actor away from the player; "continue" slides it until it
 * hits something. */
export interface ActorPushEvent extends EventBase {
  type: "actor_push";
  actor: ActorRef;
  continue?: boolean;
}

export interface IfActorAtPositionEvent extends EventBase {
  type: "if_actor_at_position";
  actor: ActorRef;
  x: number;
  y: number;
  units?: PositionUnits;
  then?: EventScript;
  else?: EventScript;
}

export interface IfActorDirectionEvent extends EventBase {
  type: "if_actor_direction";
  actor: ActorRef;
  direction: Direction;
  then?: EventScript;
  else?: EventScript;
}

/** Distance in whole tiles (Euclidean), like GB Studio's. */
export interface IfActorDistanceEvent extends EventBase {
  type: "if_actor_distance";
  actor: ActorRef;
  other: ActorRef;
  op: CompareOp;
  distance: VarOrLiteral;
  then?: EventScript;
  else?: EventScript;
}

/** "up" = actor is above other, and so on. */
export type ActorRelation = "up" | "down" | "left" | "right";

export interface IfActorRelativeEvent extends EventBase {
  type: "if_actor_relative";
  actor: ActorRef;
  other: ActorRef;
  relation: ActorRelation;
  then?: EventScript;
  else?: EventScript;
}

/** True while any of the buttons is held. */
export interface IfInputEvent extends EventBase {
  type: "if_input";
  buttons: ButtonName | ButtonName[];
  then?: EventScript;
  else?: EventScript;
}

export interface IfCurrentSceneEvent extends EventBase {
  type: "if_current_scene";
  scene: string;
  then?: EventScript;
  else?: EventScript;
}

/** Remembers the current scene and player position. */
/** Play a video cutscene (assets/cutscenes, compiler/cutscenes.py). */
export interface PlayCutsceneEvent extends EventBase {
  type: "play_cutscene";
  cutscene: string;
  /** A / START ends it early (default true). */
  skippable?: boolean;
  /** Stop the .uge music first (default true). */
  stop_music?: boolean;
}

export interface ScenePushEvent extends EventBase {
  type: "scene_push";
}

/** Returns to the last remembered scene. */
export interface ScenePopEvent extends EventBase {
  type: "scene_pop";
}

/** Returns to the first remembered scene and forgets the rest. */
export interface ScenePopAllEvent extends EventBase {
  type: "scene_pop_all";
}

export interface SceneResetEvent extends EventBase {
  type: "scene_reset";
}

/** Save slot 0-2. */
export interface DataSaveEvent extends EventBase {
  type: "data_save";
  slot: number;
}

export interface DataLoadEvent extends EventBase {
  type: "data_load";
  slot: number;
}

export interface DataClearEvent extends EventBase {
  type: "data_clear";
  slot: number;
}

export interface IfDataSavedEvent extends EventBase {
  type: "if_data_saved";
  slot: number;
  then?: EventScript;
  else?: EventScript;
}

/** Reads variable "source" out of a save slot into "var". */
export interface DataPeekEvent extends EventBase {
  type: "data_peek";
  slot: number;
  source: string;
  var: string;
}

export interface SpritesShowEvent extends EventBase {
  type: "sprites_show";
}

export interface SpritesHideEvent extends EventBase {
  type: "sprites_hide";
}

export type PaletteTarget = "background" | "sprite";

/** Sets palette colors starting at "index" of bank "bank". The editor
 * writes one "color"; hand-written JSON may give a "colors" list. */
export interface PaletteSetEvent extends EventBase {
  type: "palette_set";
  target: PaletteTarget;
  bank: number;
  index: number;
  color?: string;
  colors?: string[];
}

/** Copies the map entry at tile (sourceX, sourceY) onto tile (x, y). */
export interface ReplaceTileEvent extends EventBase {
  type: "replace_tile";
  x: number;
  y: number;
  sourceX: number;
  sourceY: number;
}

export interface SoundToneEvent extends EventBase {
  type: "sound_tone";
  frequency: number;
  frames: number;
}

export interface SoundBeepEvent extends EventBase {
  type: "sound_beep";
  pitch: number;
  frames: number;
}

export interface SoundCrashEvent extends EventBase {
  type: "sound_crash";
  frames: number;
}

/** Channel 1-4 (the GBA's Game Boy sound channels). */
export interface MuteChannelEvent extends EventBase {
  type: "mute_channel";
  channel: number;
  muted: boolean;
}

export type ScriptEventJSON =
  | TextEvent
  | TextSetFontEvent
  | TextSetFrameEvent
  | TextSetSpeedEvent
  | SetEngineSettingEvent
  | LaunchProjectileEvent
  | SetFlagEvent
  | ClearFlagEvent
  | IfFlagEvent
  | GiveItemEvent
  | IfItemEvent
  | PlaySoundEvent
  | StopSoundEvent
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
  | StopMusicEvent
  | IfExpressionEvent
  | SetVarExpressionEvent
  | LoopWhileEvent
  | LoopForEvent
  | SetVarTrueEvent
  | SetVarFalseEvent
  | VarIncEvent
  | VarDecEvent
  | IfVarTrueEvent
  | IfVarFalseEvent
  | VarSetFlagsEvent
  | VarAddFlagsEvent
  | VarClearFlagsEvent
  | IfVarFlagsEvent
  | VarsResetEvent
  | SeedRngEvent
  | IdleEvent
  | RateLimitEvent
  | LabelEvent
  | GotoEvent
  | SwitchEvent
  | ActorInvokeEvent
  | ThreadStartEvent
  | ThreadStopEvent
  | TimerScriptSetEvent
  | TimerRestartEvent
  | TimerDisableEvent
  | InputScriptSetEvent
  | InputScriptRemoveEvent
  | ActorLineOfSightEvent
  | ActorLineOfSightRemoveEvent
  | MusicRoutineEvent
  | ActorSetPositionVarsEvent
  | ActorMoveToVarsEvent
  | ActorSetPositionRelativeEvent
  | ActorMoveRelativeEvent
  | ActorSetFrameVarEvent
  | ActorSetMoveSpeedEvent
  | ActorSetAnimSpeedEvent
  | ActorTransformEvent
  | ActorRotateByEvent
  | ActorScaleByEvent
  | PlayerSetSpriteEvent
  | TextDrawEvent
  | ProjectileRecallEvent
  | ProjectileRemoveEvent
  | TextClearEvent
  | ActorSetCollisionsEvent
  | ActorPushEvent
  | IfActorAtPositionEvent
  | IfActorDirectionEvent
  | IfActorDistanceEvent
  | IfActorRelativeEvent
  | IfInputEvent
  | IfCurrentSceneEvent
  | ScenePushEvent
  | PlayCutsceneEvent
  | ScenePopEvent
  | ScenePopAllEvent
  | SceneResetEvent
  | DataSaveEvent
  | DataLoadEvent
  | DataClearEvent
  | IfDataSavedEvent
  | DataPeekEvent
  | SpritesShowEvent
  | SpritesHideEvent
  | PaletteSetEvent
  | ReplaceTileEvent
  | SoundToneEvent
  | SoundBeepEvent
  | SoundCrashEvent
  | MuteChannelEvent;

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
    if (ev.type === "switch") {
      for (const c of ev.cases) n += countEvents(c.then);
    }
    if ("script" in ev && Array.isArray(ev.script)) n += countEvents(ev.script);
    if ("body" in ev && ev.body) n += countEvents(ev.body);
    if ("children" in ev && ev.children) n += countEvents(ev.children);
  }
  return n;
}
