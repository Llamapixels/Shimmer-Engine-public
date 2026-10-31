import type { ScriptParam, SpriteSheetJSON } from "../../shared/projectTypes";

/** Stable actor inputs that callers bind to actors from their own scene. */
export function nextActorInputName(params: ScriptParam[]): string {
  const used = new Set(params.map((p) => p.name));
  for (let i = 0; ; i++) {
    const name = i < 26 ? `actor${String.fromCharCode(65 + i)}` : `actor${i + 1}`;
    if (!used.has(name)) return name;
  }
}

/** Named states are portable across scenes and sprite-sheet changes. */
export function projectStateNames(sheets: SpriteSheetJSON[]): string[] {
  const names = new Set<string>();
  for (const sheet of sheets) for (const state of sheet.states ?? []) {
    if (state.name && state.name.toLowerCase() !== "default") names.add(state.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}
