/**
 * The scene types' engine settings (Settings > Engine), from the same
 * file the compiler reads: compiler/engine_settings.json. Values in
 * project.json / scene JSON "engine" are in these units: speed/accel in
 * px per frame, frames/pixels/count as whole numbers, bool true/false,
 * button a name ("a", "b"...), choice the option's index.
 */
import table from "../../../compiler/engine_settings.json";

export type SettingUnit = "speed" | "accel" | "frames" | "pixels" | "count" | "bool" | "button" | "choice";
export type EngineValue = number | boolean | string;

export interface EngineSettingDef {
  key: string;
  mode: string;
  group: string;
  label: string;
  unit: SettingUnit;
  default: EngineValue;
  min?: number;
  max?: number;
  options?: string[];
  desc?: string;
  /** Only shown while this other (bool) setting is on. */
  if?: string;
  /** Not in GB Studio - added for Shimmer Engine. */
  extra?: boolean;
}

export interface EngineModeDef {
  id: string;
  label: string;
}

export const ENGINE_MODES: EngineModeDef[] = table.modes.map((m) => ({ id: m.id, label: m.label }));
export const ENGINE_SETTINGS = table.settings as unknown as EngineSettingDef[];
export const ENGINE_BUTTONS: string[] = table.buttons;
export const SETTING_BY_KEY: Record<string, EngineSettingDef> = Object.fromEntries(ENGINE_SETTINGS.map((s) => [s.key, s]));

export function modeLabel(id: string | undefined): string {
  return ENGINE_MODES.find((m) => m.id === (id || "topdown"))?.label ?? id ?? "Top Down 2D";
}

/** Settings a scene of this type uses (its own plus the shared ones). */
export function settingsForMode(mode: string): EngineSettingDef[] {
  return ENGINE_SETTINGS.filter((s) => s.mode === mode || s.mode === "all");
}

/** A setting's value given the overrides in effect (later wins). */
export function settingValue(key: string, ...layers: (Record<string, EngineValue> | undefined)[]): EngineValue {
  for (let i = layers.length - 1; i >= 0; i--) {
    const v = layers[i]?.[key];
    if (v !== undefined) return v;
  }
  return SETTING_BY_KEY[key]?.default ?? 0;
}

/** Is the setting shown (its "if" setting is on)? */
export function settingVisible(def: EngineSettingDef, ...layers: (Record<string, EngineValue> | undefined)[]): boolean {
  if (!def.if) return true;
  const parent = SETTING_BY_KEY[def.if];
  return !!settingValue(def.if, ...layers) && (!parent || settingVisible(parent, ...layers));
}
