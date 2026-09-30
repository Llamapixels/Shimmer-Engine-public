import { useState, type ReactNode } from "react";

import { NAMED_LIST_LIMIT, validateName } from "./common/NamedListSelect";
import FolderTree from "./common/FolderTree";
import PopoverMenu from "./common/PopoverMenu";
import { sceneName, useProjectStore } from "../state/projectStore";
import "./Navigator.css";
import Icon from "./common/Icon";

const COLLAPSE_KEY = "shimmer-engine.sidebar-collapsed";
/** Pre-rename key, still read (never written) so an existing user's
 * collapsed-section state survives the app's rename from Advance Studio. */
const LEGACY_COLLAPSE_KEY = "advance-studio.sidebar-collapsed";

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(COLLAPSE_KEY) ?? localStorage.getItem(LEGACY_COLLAPSE_KEY);
    const v = raw ? JSON.parse(raw) : {};
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

function saveCollapsed(v: Record<string, boolean>) {
  try {
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable - collapse state just won't persist */
  }
}

/** Left sidebar: a stack of collapsible sections (Scenes / Variables /
 * Constants / Scripts / Prefabs), the way GB Studio's own left panel is
 * organized, rather than the single flat scene tree this used to be. */
export default function Navigator() {
  const [collapsed, setCollapsedState] = useState(loadCollapsed);

  const toggle = (id: string) => {
    setCollapsedState((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveCollapsed(next);
      return next;
    });
  };

  return (
    <div className="navigator">
      <Section id="scenes" title="Scenes" collapsed={!!collapsed.scenes} onToggle={toggle} defaultAction={<AddSceneButton />}>
        <ScenesSection />
      </Section>
      <Section id="variables" title="Variables" collapsed={!!collapsed.variables} onToggle={toggle}>
        <NamedListSection kind="variables" refKind="variable" noun="variable" />
      </Section>
      <Section id="constants" title="Constants" collapsed={!!collapsed.constants} onToggle={toggle}>
        <ConstantsSection />
      </Section>
      <Section id="scripts" title="Scripts" collapsed={!!collapsed.scripts} onToggle={toggle} defaultAction={<AddScriptButton />}>
        <ScriptsSection />
      </Section>
      <Section id="palettes" title="Palettes" collapsed={!!collapsed.palettes} onToggle={toggle} defaultAction={<AddPaletteButton />}>
        <PalettesSection />
      </Section>
      <Section id="prefabs" title="Prefabs" collapsed={!!collapsed.prefabs} onToggle={toggle} defaultAction={<AddPrefabButton />}>
        <PrefabsSection />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section shell
// ---------------------------------------------------------------------------

function Section({
  id,
  title,
  collapsed,
  onToggle,
  defaultAction,
  children,
}: {
  id: string;
  title: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
  defaultAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`navigator-section${collapsed ? " navigator-section-collapsed" : ""}`}>
      <div className="navigator-header" onClick={() => onToggle(id)}>
        <span className="navigator-chevron" aria-hidden>
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="navigator-header-title">{title}</span>
        {defaultAction && (
          <span
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {defaultAction}
          </span>
        )}
      </div>
      {!collapsed && <div className="navigator-section-body">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scenes (existing scene tree, unchanged behaviour)
// ---------------------------------------------------------------------------

function AddSceneButton() {
  const scenes = useProjectStore((s) => s.project?.scenes ?? []);
  const addScene = useProjectStore((s) => s.addScene);
  const firstBg = useProjectStore((s) => s.assets?.backgrounds[0]?.relPath);
  return (
    <button
      className="navigator-add-btn"
      title="Add scene"
      onClick={() => {
        let n = scenes.length + 1;
        const names = new Set(scenes.map(sceneName));
        while (names.has(`scene_${n}`)) n += 1;
        void addScene(`scene_${n}`, firstBg ? `../${firstBg}` : undefined);
      }}
    >
      +
    </button>
  );
}

function ScenesSection() {
  const scenes = useProjectStore((s) => s.project?.scenes ?? []);
  const startScene = useProjectStore((s) => s.project?.project.start_scene);
  const activeSceneId = useProjectStore((s) => s.activeSceneId);
  const selection = useProjectStore((s) => s.selection);
  const setActiveScene = useProjectStore((s) => s.setActiveScene);
  const setSelection = useProjectStore((s) => s.setSelection);
  const removeScene = useProjectStore((s) => s.removeScene);
  const renameScene = useProjectStore((s) => s.renameScene);
  const renameSceneFolder = useProjectStore((s) => s.renameSceneFolder);
  const updateProject = useProjectStore((s) => s.updateProject);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; label: string } | null>(null);

  if (scenes.length === 0) return <div className="navigator-empty">No scenes yet.</div>;

  return (
    <div className="navigator-list">
      <FolderTree
        items={scenes}
        getName={sceneName}
        getKey={(s) => s.fileId}
        storageKey="scenes"
        isActive={(s) => s.fileId === activeSceneId}
        onMoveToFolder={(s, folder) => {
          const leaf = sceneName(s).split("/").pop()!;
          renameScene(s.fileId, folder ? `${folder}/${leaf}` : leaf);
        }}
        onRenameFolder={renameSceneFolder}
        renderItem={(scene, leaf) => {
          const label = sceneName(scene);
          const isActive = scene.fileId === activeSceneId;
          const isSelected = selection.kind === "scene" && selection.sceneId === scene.fileId;
          const npcs = scene.data.npcs ?? [];
          const doors = scene.data.doors ?? [];
          return (
            <div key={scene.fileId}>
              <div
                className={`navigator-item${isActive ? " navigator-item-active" : ""}${isSelected ? " navigator-item-selected" : ""}`}
                onClick={() => setActiveScene(scene.fileId)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveScene(scene.fileId);
                  setCtxMenu({ x: e.clientX, y: e.clientY, label });
                }}
              >
                <span className="navigator-item-icon" aria-hidden />
                <span className="navigator-item-label" title={label}>
                  {leaf}
                </span>
                {label === startScene && (
                  <span className="navigator-badge" title="The game starts in this scene (change from the right-click menu)">
                    start
                  </span>
                )}
                <button
                  className="navigator-item-delete"
                  title="Delete scene"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm(`Delete scene "${label}"? This deletes scenes/${scene.fileId}.json and can't be undone.`)) {
                      void removeScene(scene.fileId);
                    }
                  }}
                >
                  ×
                </button>
              </div>

              {isActive && (npcs.length > 0 || doors.length > 0) && (
                <div className="navigator-children">
                  {npcs.map((npc, i) => {
                    const sel = selection.kind === "npc" && selection.sceneId === scene.fileId && selection.index === i;
                    return (
                      <div
                        key={`n${i}`}
                        className={`navigator-child${sel ? " navigator-item-selected" : ""}`}
                        onClick={() => setSelection({ kind: "npc", sceneId: scene.fileId, index: i })}
                      >
                        <span className="navigator-dot navigator-dot-npc" />
                        <span className="navigator-item-label">{npc.name || `NPC #${i}`}</span>
                        {npc.on_interact && <span className="navigator-tag">script</span>}
                      </div>
                    );
                  })}
                  {doors.map((door, i) => {
                    const sel = selection.kind === "door" && selection.sceneId === scene.fileId && selection.index === i;
                    return (
                      <div
                        key={`d${i}`}
                        className={`navigator-child${sel ? " navigator-item-selected" : ""}`}
                        onClick={() => setSelection({ kind: "door", sceneId: scene.fileId, index: i })}
                      >
                        <span className="navigator-dot navigator-dot-door" />
                        <span className="navigator-item-label">{door.events ? `Trigger #${i}` : `Door → ${door.target_scene ?? "?"}`}</span>
                        {door.events && <span className="navigator-tag">script</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        }}
      />

      {ctxMenu && (
        <PopoverMenu
          anchor={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => setCtxMenu(null)}
          items={[
            {
              label: "Set As Starting Scene",
              disabled: ctxMenu.label === startScene,
              onClick: () => {
                updateProject((p) => ({ ...p, start_scene: ctxMenu.label }));
                setCtxMenu(null);
              },
            },
          ]}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Variables (also reused for Flags/Items elsewhere via SettingsView - this
// is a compact inline version scoped to just "variables" for the sidebar,
// using the same rename-everywhere machinery).
// ---------------------------------------------------------------------------

function NamedListSection({
  kind,
  refKind,
  noun,
}: {
  kind: "flags" | "items" | "variables";
  refKind: "flag" | "item" | "variable";
  noun: string;
}) {
  const project = useProjectStore((s) => s.project)!;
  const updateProject = useProjectStore((s) => s.updateProject);
  const renameRef = useProjectStore((s) => s.renameRef);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const list = project.project[kind] ?? [];

  const add = () => {
    const err = validateName(kind, draft, list);
    if (err) {
      setError(err);
      return;
    }
    updateProject((p) => ({ ...p, [kind]: [...(p[kind] ?? []), draft.trim()] }));
    setDraft("");
    setError(null);
  };

  return (
    <div className="navigator-list navigator-named-list">
      {list.length === 0 && <div className="navigator-empty">No {kind} yet.</div>}
      {list.map((name) => (
        <div key={name} className="navigator-named-row">
          <input
            className="navigator-named-input"
            defaultValue={name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v || v === name) {
                e.target.value = name;
                return;
              }
              const err = validateName(kind, v, list.filter((n) => n !== name));
              if (err) {
                e.target.value = name;
                return;
              }
              renameRef(refKind, name, v);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <button
            className="navigator-item-delete navigator-named-delete"
            title={`Remove ${noun}`}
            onClick={() => updateProject((p) => ({ ...p, [kind]: (p[kind] ?? []).filter((n) => n !== name) }))}
          >
            ×
          </button>
        </div>
      ))}
      <div className="navigator-named-row">
        <input
          className="navigator-named-input"
          placeholder={`New ${noun}…`}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="navigator-add-btn navigator-add-btn-inline" title={`Add ${noun}`} onClick={add} disabled={!draft.trim()}>
          +
        </button>
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="navigator-hint">
        {list.length} / {NAMED_LIST_LIMIT[kind]}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Constants - a thin, new, editor-only concept: named numeric values, not
// yet read by the compiler (see ConstantJSON in shared/projectTypes.ts).
// Kept separate from Variables (which are runtime save-game slots) since
// that's how GB Studio's own sidebar distinguishes them.
// ---------------------------------------------------------------------------

function ConstantsSection() {
  const project = useProjectStore((s) => s.project)!;
  const constants = project.project.constants ?? [];
  const addConstant = useProjectStore((s) => s.addConstant);
  const renameConstant = useProjectStore((s) => s.renameConstant);
  const setConstantValue = useProjectStore((s) => s.setConstantValue);
  const removeConstant = useProjectStore((s) => s.removeConstant);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    const name = draft.trim();
    if (!name) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      setError("Names can only use letters, digits and _ (and can't start with a digit).");
      return;
    }
    if (constants.some((c) => c.name === name)) {
      setError(`There's already a constant called "${name}".`);
      return;
    }
    addConstant(name, 0);
    setDraft("");
    setError(null);
  };

  return (
    <div className="navigator-list navigator-named-list">
      {constants.length === 0 && <div className="navigator-empty">No constants yet.</div>}
      {constants.map((c) => (
        <div key={c.name} className="navigator-named-row navigator-constant-row">
          <input
            className="navigator-named-input"
            defaultValue={c.name}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (!v || v === c.name) {
                e.target.value = c.name;
                return;
              }
              if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v) || constants.some((x) => x.name === v)) {
                e.target.value = c.name;
                return;
              }
              renameConstant(c.name, v);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <input
            className="navigator-constant-value"
            type="text"
            inputMode="numeric"
            defaultValue={String(c.value)}
            onBlur={(e) => {
              const n = parseInt(e.target.value, 10);
              if (Number.isFinite(n)) setConstantValue(c.name, n);
              else e.target.value = String(c.value);
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          />
          <button className="navigator-item-delete navigator-named-delete" title="Remove constant" onClick={() => removeConstant(c.name)}>
            ×
          </button>
        </div>
      ))}
      <div className="navigator-named-row">
        <input
          className="navigator-named-input"
          placeholder="New constant…"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onKeyDown={(e) => e.key === "Enter" && add()}
        />
        <button className="navigator-add-btn navigator-add-btn-inline" title="Add constant" onClick={add} disabled={!draft.trim()}>
          +
        </button>
      </div>
      {error && <div className="field-error">{error}</div>}
      <div className="navigator-hint">Not read by the compiler yet - a place to name values used across scripts.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scripts (custom/reusable scripts) - a new concept, authoring-only: see
// CustomScriptJSON. Not yet callable from other scripts.
// ---------------------------------------------------------------------------

function AddScriptButton() {
  const addCustomScript = useProjectStore((s) => s.addCustomScript);
  const scripts = useProjectStore((s) => s.project?.project.customScripts ?? []);
  return (
    <button
      className="navigator-add-btn"
      title="Add script"
      onClick={() => {
        let n = scripts.length + 1;
        const names = new Set(scripts.map((s) => s.name));
        while (names.has(`script_${n}`)) n += 1;
        addCustomScript(`script_${n}`);
      }}
    >
      +
    </button>
  );
}

function ScriptsSection() {
  const scripts = useProjectStore((s) => s.project?.project.customScripts ?? []);
  const selection = useProjectStore((s) => s.selection);
  const setSelection = useProjectStore((s) => s.setSelection);
  const setSection = useProjectStore((s) => s.setSection);
  const removeCustomScript = useProjectStore((s) => s.removeCustomScript);

  if (scripts.length === 0) {
    return <div className="navigator-empty">No scripts yet. Use + to create a reusable script.</div>;
  }

  return (
    <div className="navigator-list">
      <FolderTree
        items={scripts}
        getName={(s) => s.name}
        getKey={(s) => s.id}
        storageKey="scripts"
        renderItem={(s, leaf) => {
          const isSelected = selection.kind === "customScript" && selection.id === s.id;
          return (
            <div
              key={s.id}
              className={`navigator-item${isSelected ? " navigator-item-selected" : ""}`}
              onClick={() => {
                setSection("world");
                setSelection({ kind: "customScript", id: s.id });
              }}
            >
              <span className="navigator-item-icon" aria-hidden />
              <span className="navigator-item-label" title={s.name}>
                {leaf}
              </span>
              <span className="navigator-tag">{s.script.length} ev</span>
              <button
                className="navigator-item-delete"
                title="Delete script"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete script "${s.name}"? This can't be undone.`)) removeCustomScript(s.id);
                }}
              >
                ×
              </button>
            </div>
          );
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prefabs - reusable NPC/door templates (see PrefabJSON). Placing one is a
// one-time copy onto the active scene, not a live-linked instance.
// ---------------------------------------------------------------------------

function AddPrefabButton() {
  const addPrefab = useProjectStore((s) => s.addPrefab);
  const prefabs = useProjectStore((s) => s.project?.project.prefabs ?? []);
  const add = (kind: "npc" | "door") => {
    let n = prefabs.length + 1;
    const names = new Set(prefabs.map((p) => p.name));
    while (names.has(`${kind}_${n}`)) n += 1;
    addPrefab(kind, `${kind}_${n}`);
  };
  return (
    <span className="navigator-add-group">
      <button className="navigator-add-btn" title="Add NPC prefab" onClick={() => add("npc")}>
        <Icon name="actor" />+
      </button>
      <button className="navigator-add-btn" title="Add door prefab" onClick={() => add("door")}>
        <Icon name="trigger" />+
      </button>
    </span>
  );
}

function PrefabsSection() {
  const prefabs = useProjectStore((s) => s.project?.project.prefabs ?? []);
  const selection = useProjectStore((s) => s.selection);
  const setSelection = useProjectStore((s) => s.setSelection);
  const setSection = useProjectStore((s) => s.setSection);
  const removePrefab = useProjectStore((s) => s.removePrefab);

  if (prefabs.length === 0) {
    return <div className="navigator-empty">No prefabs yet. Use + to add a reusable NPC or door template.</div>;
  }

  return (
    <div className="navigator-list">
      <FolderTree
        items={prefabs}
        getName={(p) => p.name}
        getKey={(p) => p.id}
        storageKey="prefabs"
        renderItem={(p, leaf) => {
          const isSelected = selection.kind === "prefab" && selection.id === p.id;
          return (
            <div
              key={p.id}
              className={`navigator-item${isSelected ? " navigator-item-selected" : ""}`}
              onClick={() => {
                setSection("world");
                setSelection({ kind: "prefab", id: p.id });
              }}
            >
              <span className="navigator-item-icon" aria-hidden>
                <Icon name={p.kind === "npc" ? "actor" : "trigger"} />
              </span>
              <span className="navigator-item-label" title={p.name}>
                {leaf}
              </span>
              <button
                className="navigator-item-delete"
                title="Delete prefab"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete prefab "${p.name}"?`)) removePrefab(p.id);
                }}
              >
                ×
              </button>
            </div>
          );
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Palettes - BG palette banks the palette-paint tool assigns to a scene's
// tiles (see PaletteJSON / SceneJSON.palette_map).
// ---------------------------------------------------------------------------

function AddPaletteButton() {
  const addPalette = useProjectStore((s) => s.addPalette);
  const palettes = useProjectStore((s) => s.project?.project.palettes ?? []);
  return (
    <button
      className="navigator-add-btn"
      title="Add palette"
      onClick={() => {
        let n = palettes.length + 1;
        const names = new Set(palettes.map((p) => p.name));
        while (names.has(`palette_${n}`)) n += 1;
        addPalette(`palette_${n}`);
      }}
    >
      +
    </button>
  );
}

function PalettesSection() {
  const palettes = useProjectStore((s) => s.project?.project.palettes ?? []);
  const selection = useProjectStore((s) => s.selection);
  const setSelection = useProjectStore((s) => s.setSelection);
  const setSection = useProjectStore((s) => s.setSection);
  const removePalette = useProjectStore((s) => s.removePalette);

  if (palettes.length === 0) {
    return <div className="navigator-empty">No palettes yet. Use + to add a BG palette to paint onto a scene.</div>;
  }

  return (
    <div className="navigator-list">
      <FolderTree
        items={palettes}
        getName={(p) => p.name}
        getKey={(p) => p.id}
        storageKey="palettes"
        renderItem={(p, leaf) => {
          const isSelected = selection.kind === "palette" && selection.id === p.id;
          return (
            <div
              key={p.id}
              className={`navigator-item${isSelected ? " navigator-item-selected" : ""}`}
              onClick={() => {
                setSection("world");
                setSelection({ kind: "palette", id: p.id });
              }}
            >
              <span className="navigator-palette-swatches" aria-hidden>
                {p.colors.slice(0, 4).map((c, i) => (
                  <span key={i} className="navigator-palette-swatch" style={{ background: c }} />
                ))}
              </span>
              <span className="navigator-item-label" title={p.name}>
                {leaf}
              </span>
              <button
                className="navigator-item-delete"
                title="Delete palette"
                onClick={(e) => {
                  e.stopPropagation();
                  if (window.confirm(`Delete palette "${p.name}"?`)) removePalette(p.id);
                }}
              >
                ×
              </button>
            </div>
          );
        }}
      />
    </div>
  );
}
