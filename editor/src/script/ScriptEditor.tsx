import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";

import type { EventScript, MenuEvent, ScriptEventJSON, SwitchEvent } from "../../shared/eventTypes";
import NumberInput from "../components/common/NumberInput";
import PopoverMenu, { type MenuItem } from "../components/common/PopoverMenu";
import NamePrompt from "../components/common/NamePrompt";
import { sceneName, useProjectStore } from "../state/projectStore";
import AddEventMenu from "./AddEventMenu";
import { useDragState, pathKey } from "./dragState";
import { CATEGORY_COLOR, eventSummary, getEventDef, setCustomScriptNames, setPrefabNames, type CreateContext, type EventDef } from "./eventCatalog";
import { FieldControl, type ScriptEnv } from "./ScriptFields";
import {
  cloneEvent,
  eventKey,
  findByKey,
  getEvent,
  getList,
  insertEvents,
  isInside,
  mapEvents,
  moveEvent,
  removeEvent,
  replaceEvent,
  walkEvents,
  type EventLocation,
  type ListPath,
  type Slot,
} from "./scriptTree";
import "./ScriptEditor.css";
import Chevron from "../components/common/Chevron";

export type ScriptUpdater = (updater: (script: EventScript) => EventScript, coalesceKey?: string) => void;

interface Ctx {
  env: ScriptEnv;
  root: EventScript;
  apply: ScriptUpdater;
  createCtx: () => CreateContext;
}

const EditorContext = createContext<Ctx | null>(null);

function useEditor(): Ctx {
  const c = useContext(EditorContext);
  if (!c) throw new Error("ScriptEditor context missing");
  return c;
}

/** Events holding more than this many events start folded, so a huge
 * script opens at once instead of drawing thousands of blocks. */
const FOLD_OVER = 40;

function foldsByDefault(ev: ScriptEventJSON): boolean {
  let n = 0;
  const walk = (v: unknown): void => {
    if (n > FOLD_OVER) return;
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if ("type" in v) n += 1;
      for (const x of Object.values(v)) if (x && typeof x === "object") walk(x);
    }
  };
  for (const [k, x] of Object.entries(ev)) if (k !== "type" && x && typeof x === "object") walk(x);
  return n > FOLD_OVER;
}

interface Props {
  value: EventScript | undefined;
  onChange: ScriptUpdater;
  env: ScriptEnv;
  emptyHint?: string;
}

/**
 * The visual event-script editor: a vertical stack of event blocks, each
 * with its own fields, nested Then/Else (or per-menu-option) lists
 * inside, "+ Add Event" at the end of every list, and drag-and-drop to
 * reorder or move events in and out of branches (hold Alt/Ctrl while
 * dropping to copy instead). Edits the exact JSON event format the
 * compiler reads - nothing editor-specific is saved.
 */
/** Save events as a named snippet (Add Event > Snippets). */
function saveSnippet(name: string, events: EventScript) {
  const id = `snip_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  useProjectStore.getState().updateProject((p) => ({ ...p, snippets: [...(p.snippets ?? []), { id, name, events: events.map(cloneEvent) }] }));
}

export default function ScriptEditor({ value, onChange, env, emptyHint }: Props) {
  const root = value ?? [];
  const project = useProjectStore((s) => s.project);
  const assets = useProjectStore((s) => s.assets);
  // Spawn Prefab summaries show the prefab's name.
  setPrefabNames(Object.fromEntries((project?.project.prefabs ?? []).map((p) => [p.id, p.name])));
  setCustomScriptNames(Object.fromEntries((project?.project.customScripts ?? []).map((s) => [s.id, s.name])));
  const clipboard = useProjectStore((s) => s.scriptClipboard);
  const setClipboard = useProjectStore((s) => s.setScriptClipboard);
  const [snippetAt, setSnippetAt] = useState<{ x: number; y: number } | null>(null);
  /** Folding is saved on the events ("__collapsed"), so it's still how
   * you left it after reopening the project. */
  const foldAll = (collapsed: boolean) =>
    onChange((r) => mapEvents(r, (ev) => (ev.__collapsed === collapsed ? ev : { ...ev, __collapsed: collapsed })) ?? r);

  const createCtx = useCallback((): CreateContext => {
    const npcs = env.scene.npcs ?? [];
    const timers = env.scene.timers ?? [];
    return {
      flags: project?.project.flags ?? [],
      items: project?.project.items ?? [],
      variables: project?.project.variables ?? [],
      sceneNames: (project?.scenes ?? []).map(sceneName),
      firstActor: env.allowSelf
        ? "self"
        : env.params?.some((p) => p.kind === "actor")
          ? `@${env.params.find((p) => p.kind === "actor")!.name}`
          : npcs.length
            ? npcs[0].name || 0
            : null,
      firstTimer: timers.length ? timers[0].name || 0 : null,
      firstCustomScript: project?.project.customScripts?.[0]?.id ?? null,
      firstActorPrefab: project?.project.prefabs?.find((p) => p.kind === "npc")?.id ?? null,
      firstMusicTrack: assets?.music?.[0]?.name ?? null,
      firstSprite: assets?.sprites?.find((a) => a.name !== "player")?.name ?? null,
    };
  }, [env, project, assets]);

  const ctx = useMemo<Ctx>(() => ({ env, root, apply: onChange, createCtx }), [env, root, onChange, createCtx]);

  let total = 0;
  walkEvents(root, () => (total += 1));

  return (
    <EditorContext.Provider value={ctx}>
      <div className="script-editor">
        <div className="script-editor-bar">
          <span className="script-editor-count">
            {total} event{total === 1 ? "" : "s"}
          </span>
          <button className="link-btn" disabled={total === 0} onClick={() => foldAll(true)}>
            Collapse all
          </button>
          <button className="link-btn" disabled={total === 0} onClick={() => foldAll(false)}>
            Expand all
          </button>
          <button
            className="link-btn"
            disabled={root.length === 0}
            onClick={() => setClipboard(root.map(cloneEvent))}
            title="Copy every event in this script"
          >
            Copy all
          </button>
          <button
            className="link-btn"
            disabled={root.length === 0}
            onClick={(e) => setSnippetAt({ x: e.clientX, y: e.clientY })}
            title="Save every event in this script as a snippet, to drop in anywhere from Add Event > Snippets"
          >
            Save as snippet
          </button>
          {snippetAt && (
            <NamePrompt
              at={snippetAt}
              title="Name the snippet"
              onDone={(name) => saveSnippet(name, root)}
              onClose={() => setSnippetAt(null)}
            />
          )}
          <button
            className="link-btn link-btn-danger"
            disabled={root.length === 0}
            onClick={() => {
              if (window.confirm("Remove every event from this script?")) onChange(() => []);
            }}
          >
            Clear
          </button>
        </div>
        {root.length === 0 && emptyHint && <div className="script-empty-hint">{emptyHint}</div>}
        <EventList path={[]} list={root} />
        {clipboard && clipboard.length > 0 && (
          <div className="script-clipboard-note">
            {clipboard.length} event{clipboard.length === 1 ? "" : "s"} on the clipboard
            <button className="link-btn" onClick={() => setClipboard(null)}>
              clear
            </button>
          </div>
        )}
      </div>
    </EditorContext.Provider>
  );
}

// ---------------------------------------------------------------------------

function EventList({ path, list }: { path: ListPath; list: EventScript }) {
  const { env, apply, createCtx } = useEditor();
  const target = useDragState((s) => s.target);
  const source = useDragState((s) => s.dimmed);
  const clipboard = useProjectStore((s) => s.scriptClipboard);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const lineAt =
    source && target && target.rootId === env.rootId && pathKey(target.path) === pathKey(path) ? target.index : -1;

  const endDragOver = (e: DragEvent) => {
    const src = useDragState.getState().source;
    if (!src || src.rootId !== env.rootId || isInside(src.from, path)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.altKey || e.ctrlKey ? "copy" : "move";
    useDragState.getState().setTarget({ rootId: env.rootId, path, index: list.length });
  };

  const add = (def: EventDef) => {
    setMenuAnchor(null);
    const ev = def.create(createCtx());
    apply((root) => insertEvents(root, path, getList(root, path).length, [ev]));
  };

  return (
    <div className={`event-list${path.length ? " event-list-nested" : ""}`}>
      {list.map((ev, i) => (
        <div key={eventKey(ev)}>
          {lineAt === i && <div className="drop-line" />}
          <EventBlock ev={ev} loc={{ path, index: i }} />
        </div>
      ))}
      {lineAt === list.length && <div className="drop-line" />}
      <div className="event-list-end" onDragOver={endDragOver} onDrop={(e) => performDrop(e, env.rootId, apply)}>
        <button className="add-event-btn" onClick={(e) => setMenuAnchor(e.currentTarget)}>
          + Add Event
        </button>
        {clipboard && clipboard.length > 0 && (
          <button
            className="add-event-btn add-event-btn-paste"
            onClick={() => apply((root) => insertEvents(root, path, getList(root, path).length, clipboard.map(cloneEvent)))}
            title="Paste copied events here"
          >
            Paste
          </button>
        )}
        {list.length === 0 && source?.rootId === env.rootId && <span className="drop-hint">drop here</span>}
      </div>
      {menuAnchor && (
        <AddEventMenu
          anchor={menuAnchor}
          onPick={add}
          onPickEvents={(events) => {
            setMenuAnchor(null);
            apply((root) => insertEvents(root, path, getList(root, path).length, events));
          }}
          onClose={() => setMenuAnchor(null)}
        />
      )}
    </div>
  );
}

function performDrop(e: DragEvent, rootId: string, apply: ScriptUpdater) {
  const { source, target, end } = useDragState.getState();
  e.preventDefault();
  e.stopPropagation();
  if (!source || !target || source.rootId !== rootId || target.rootId !== rootId) {
    end();
    return;
  }
  const copy = e.altKey || e.ctrlKey;
  apply((root) => moveEvent(root, source.from, target.path, target.index, copy) ?? root);
  end();
}

// ---------------------------------------------------------------------------

const EventBlock = memo(function EventBlock({ ev, loc }: { ev: ScriptEventJSON; loc: EventLocation }) {
  const { env, apply, createCtx } = useEditor();
  const key = eventKey(ev);

  const bigByDefault = useMemo(() => foldsByDefault(ev), [ev]);
  const collapsed = ev.__collapsed ?? bigByDefault;
  const tint = typeof ev.__color === "string" ? ev.__color : undefined;
  const setCollapsed = (c: boolean) => patch({ __collapsed: c });
  const [colorAt, setColorAt] = useState<{ x: number; y: number } | null>(null);
  const [snippetAt, setSnippetAt] = useState<{ x: number; y: number } | null>(null);
  const dragging = useDragState(
    (s) => s.dimmed?.rootId === env.rootId && s.dimmed.from.index === loc.index && pathKey(s.dimmed.from.path) === pathKey(loc.path),
  );
  const clipboard = useProjectStore((s) => s.scriptClipboard);
  const setClipboard = useProjectStore((s) => s.setScriptClipboard);
  const [menu, setMenu] = useState<HTMLElement | { x: number; y: number } | null>(null);
  const [addAt, setAddAt] = useState<{ anchor: HTMLElement; index: number } | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const def = getEventDef(ev.type);
  const hasChildren = !!def?.branches || !!def?.menuOptions || !!def?.switchCases;
  const color = def ? CATEGORY_COLOR[def.category] : "#666";
  const disabled = !!ev.__disabled;
  const hasElse = !!def?.branches?.some((b) => b.key === "else");
  const disabledElse = hasElse && !!ev.__disableElse;

  /** Merge changes into this event, reading the *latest* script so a
   * delayed call (e.g. a tile pick) never writes over newer edits. */
  const patch = (changes: Record<string, unknown>, coalesce?: boolean) => {
    apply(
      (root) => {
        const at = findByKey(root, key);
        const cur = at && getEvent(root, at);
        if (!at || !cur) return root;
        return replaceEvent(root, at, { ...cur, ...changes } as ScriptEventJSON);
      },
      coalesce ? `${key}:${Object.keys(changes).join(",")}` : undefined,
    );
  };

  const menuItems: MenuItem[] = [
    { label: "Add event above", onClick: () => headerRef.current && setAddAt({ anchor: headerRef.current, index: loc.index }) },
    { label: "Add event below", onClick: () => headerRef.current && setAddAt({ anchor: headerRef.current, index: loc.index + 1 }) },
    "separator",
    {
      label: "Duplicate",
      onClick: () =>
        apply((root) => {
          const cur = getEvent(root, loc);
          return cur ? insertEvents(root, loc.path, loc.index + 1, [cloneEvent(cur)]) : root;
        }),
    },
    { label: "Copy", onClick: () => setClipboard([cloneEvent(ev)]) },
    {
      label: "Save as snippet…",
      onClick: () => {
        const r = headerRef.current?.getBoundingClientRect();
        setSnippetAt(menu && !(menu instanceof HTMLElement) ? menu : { x: r?.left ?? 100, y: r?.bottom ?? 100 });
      },
    },
    {
      label: "Paste above",
      disabled: !clipboard?.length,
      onClick: () => clipboard && apply((root) => insertEvents(root, loc.path, loc.index, clipboard.map(cloneEvent))),
    },
    {
      label: "Paste below",
      disabled: !clipboard?.length,
      onClick: () => clipboard && apply((root) => insertEvents(root, loc.path, loc.index + 1, clipboard.map(cloneEvent))),
    },
    "separator",
    {
      label: tint ? "Change colour…" : "Colour…",
      onClick: () => {
        const r = headerRef.current?.getBoundingClientRect();
        setColorAt(menu && !(menu instanceof HTMLElement) ? menu : { x: r?.left ?? 100, y: r?.bottom ?? 100 });
      },
    },
    ...(tint ? [{ label: "Remove colour", onClick: () => patch({ __color: undefined }) }] : []),
    "separator",
    // Mirrors GB Studio: a disabled event stays in the script but the
    // compiler skips it (and everything inside it).
    { label: disabled ? "Enable event" : "Disable event", onClick: () => patch({ __disabled: disabled ? undefined : true }) },
    ...(hasElse
      ? [{ label: disabledElse ? "Enable else" : "Disable else", onClick: () => patch({ __disableElse: disabledElse ? undefined : true }) }]
      : []),
    "separator",
    {
      label: "Move up",
      disabled: loc.index === 0,
      onClick: () => apply((root) => moveEvent(root, loc, loc.path, loc.index - 1) ?? root),
    },
    {
      label: "Move down",
      onClick: () =>
        apply((root) => (loc.index + 1 < getList(root, loc.path).length ? (moveEvent(root, loc, loc.path, loc.index + 2) ?? root) : root)),
    },
    "separator",
    { label: "Delete", danger: true, onClick: () => apply((root) => removeEvent(root, loc)) },
  ];

  const onHeaderDragOver = (e: DragEvent<HTMLDivElement>) => {
    const src = useDragState.getState().source;
    if (!src || src.rootId !== env.rootId || isInside(src.from, loc.path)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.altKey || e.ctrlKey ? "copy" : "move";
    const r = e.currentTarget.getBoundingClientRect();
    // An expanded block with branches has its "after" position far below
    // (past all its children), so its header only ever means "before" -
    // the next block / the list's end zone covers "after".
    const before = (hasChildren && !collapsed) || e.clientY < r.top + r.height / 2;
    useDragState.getState().setTarget({ rootId: env.rootId, path: loc.path, index: before ? loc.index : loc.index + 1 });
  };

  return (
    <div
      className={`event-block${dragging ? " event-block-dragging" : ""}${def ? "" : " event-block-unknown"}${disabled ? " event-block-disabled" : ""}${tint ? " event-block-tinted" : ""}`}
      style={{ ["--cat" as string]: tint ?? color, ...(tint ? { ["--tint" as string]: tint } : {}) }}
    >
      <div
        ref={headerRef}
        className="event-header"
        draggable
        onDragStart={(e) => {
          e.stopPropagation();
          e.dataTransfer.effectAllowed = "copyMove";
          e.dataTransfer.setData("text/plain", def?.label ?? ev.type);
          useDragState.getState().start(env.rootId, loc);
        }}
        onDragEnd={() => useDragState.getState().end()}
        onDragOver={onHeaderDragOver}
        onDrop={(e) => performDrop(e, env.rootId, apply)}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onDoubleClick={() => setCollapsed(!collapsed)}
      >
        <span className="event-grip" aria-hidden>
          ⠿
        </span>
        <button
          className="event-caret"
          onClick={() => setCollapsed(!collapsed)}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          <Chevron open={!collapsed} />
        </button>
        <span className="event-title">{def?.label ?? `Unknown event "${ev.type}"`}</span>
        {(collapsed || disabled || ev.type === "call_script") && <span className="event-summary">{eventSummary(ev)}</span>}
        {disabled && <span className="event-disabled-tag">Disabled</span>}
        <button
          className="event-menu-btn"
          aria-label="Event menu"
          onClick={(e) => {
            e.stopPropagation();
            setMenu(e.currentTarget);
          }}
        >
          ⋯
        </button>
      </div>

      {!collapsed && !disabled && (
        <div className="event-body">
          {!def && (
            <pre className="event-unknown-json">{JSON.stringify(ev, null, 2)}</pre>
          )}
          {def?.fields.filter((f) => !f.showIf || f.showIf(ev as unknown as Record<string, unknown>)).map((f) => (
            <div key={f.key} className={`event-field${WIDE_FIELDS.has(f.kind) ? " event-field-wide" : ""}`}>
              <span className="event-field-label">{f.label}</span>
              <div className="event-field-control">
                <FieldControl field={f} ev={ev} env={env} patch={patch} />
              </div>
            </div>
          ))}
          {def?.switchCases && ev.type === "switch" && <SwitchCases ev={ev} loc={loc} />}
          {def?.branches?.map((b) => {
            const list = (ev as unknown as Record<string, EventScript | undefined>)[b.key] ?? [];
            const off = b.key === "else" && disabledElse;
            return (
              <div key={b.key} className={`event-branch${off ? " event-branch-disabled" : ""}`}>
                <div className="event-branch-label">
                  {b.label}
                  {off && <span className="event-disabled-tag">Disabled</span>}
                </div>
                {!off && <EventList path={[...loc.path, { index: loc.index, slot: b.key as Slot }]} list={list} />}
              </div>
            );
          })}
          {def?.menuOptions && ev.type === "menu" && <MenuOptions ev={ev} loc={loc} />}
        </div>
      )}

      {menu && <PopoverMenu anchor={menu} items={menuItems} onClose={() => setMenu(null)} />}
      {snippetAt && (
        <NamePrompt
          at={snippetAt}
          title="Name the snippet"
          initial={def?.label ?? ""}
          onDone={(name) => saveSnippet(name, [ev])}
          onClose={() => setSnippetAt(null)}
        />
      )}
      {colorAt && (
        <ColorPopover
          at={colorAt}
          value={tint}
          onChange={(c) => patch({ __color: c }, true)}
          onClose={() => setColorAt(null)}
        />
      )}
      {addAt && (
        <AddEventMenu
          anchor={addAt.anchor}
          onClose={() => setAddAt(null)}
          onPick={(d) => {
            const index = addAt.index;
            setAddAt(null);
            const created = d.create(createCtx());
            apply((root) => insertEvents(root, loc.path, index, [created]));
          }}
          onPickEvents={(events) => {
            const index = addAt.index;
            setAddAt(null);
            apply((root) => insertEvents(root, loc.path, index, events));
          }}
        />
      )}
    </div>
  );
});

/** Block colours: a row of presets, any RGB colour, or none. */
const BLOCK_COLORS = [
  "#e5484d", "#f76b15", "#f2b84b", "#3dd68c", "#2fb8a6", "#40c8dc",
  "#4f8cff", "#7a8cff", "#b58cff", "#e05bb5", "#a0805a", "#9aa0ae",
];

export function ColorPopover({ at, value, onChange, onClose }: {
  at: { x: number; y: number };
  value: string | undefined;
  onChange: (c: string | undefined) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState(value ?? "");
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [onClose]);
  const set = (c: string | undefined) => {
    setHex(c ?? "");
    onChange(c);
  };
  const left = Math.max(8, Math.min(at.x, window.innerWidth - 228));
  const top = Math.max(8, Math.min(at.y, window.innerHeight - 170));
  return createPortal(
    <div ref={ref} className="block-color-pop" style={{ left, top }}>
      <div className="block-color-swatches">
        {BLOCK_COLORS.map((c) => (
          <button
            key={c}
            className={`block-color-swatch${value === c ? " block-color-swatch-on" : ""}`}
            style={{ background: c }}
            title={c}
            onClick={() => set(c)}
          />
        ))}
      </div>
      <div className="block-color-row">
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(hex) ? hex : "#4f8cff"} onChange={(e) => set(e.target.value)} title="Pick any colour" />
        <input
          className="block-color-hex"
          value={hex}
          placeholder="#rrggbb"
          onChange={(e) => {
            setHex(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value)) onChange(e.target.value.toLowerCase());
          }}
        />
        <button className="btn btn-small" onClick={() => set(undefined)}>
          None
        </button>
      </div>
    </div>,
    document.body,
  );
}

const WIDE_FIELDS = new Set(["multiline", "buttons", "expression", "bits", "scriptArgs", "combo"]);

const MAX_MENU_OPTIONS = 4;
const MIN_MENU_OPTIONS = 2;
const MIN_SWITCH_CASES = 1;
const MAX_SWITCH_CASES = 16;

type Entry = { then?: EventScript };

/**
 * A list of { then } entries, each with its own nested event list - a
 * menu's options or a switch's cases (the numeric slots in
 * scriptTree.ts). `head` renders the per-entry field (label or value).
 */
function BranchEntries<T extends Entry>({
  ev,
  loc,
  listKey,
  entries,
  noun,
  min,
  max,
  head,
  describe,
  create,
}: {
  ev: ScriptEventJSON;
  loc: EventLocation;
  listKey: "options" | "cases";
  entries: T[];
  noun: string;
  min: number;
  max: number;
  head: (entry: T, i: number, edit: (fn: (e: T) => T, coalesce?: string) => void) => React.ReactNode;
  describe: (entry: T) => string;
  create: (entries: T[]) => T;
}) {
  const { apply } = useEditor();

  const editEntries = (fn: (entries: T[]) => T[], coalesceField?: string) =>
    apply(
      (root) => {
        const at = findByKey(root, eventKey(ev));
        const cur = at && getEvent(root, at);
        if (!at || !cur || cur.type !== ev.type) return root;
        const list = (cur as unknown as Record<string, T[]>)[listKey] ?? [];
        return replaceEvent(root, at, { ...cur, [listKey]: fn(list) } as ScriptEventJSON);
      },
      coalesceField ? `${eventKey(ev)}:${coalesceField}` : undefined,
    );

  return (
    <div className="menu-options">
      {entries.map((entry, i) => (
        <div key={i} className="event-branch">
          <div className="menu-option-head">
            <span className="event-branch-label">
              {noun} {i + 1}
            </span>
            {head(entry, i, (fn, coalesce) =>
              editEntries((list) => list.map((e, j) => (j === i ? fn(e) : e)), coalesce && `${coalesce}${i}`),
            )}
            <button
              className="icon-btn"
              title={`Move ${noun.toLowerCase()} up`}
              disabled={i === 0}
              onClick={() =>
                editEntries((list) => {
                  const c = list.slice();
                  [c[i - 1], c[i]] = [c[i], c[i - 1]];
                  return c;
                })
              }
            >
              ↑
            </button>
            <button
              className="icon-btn"
              title={`Remove ${noun.toLowerCase()}`}
              disabled={entries.length <= min}
              onClick={() => {
                if ((entry.then?.length ?? 0) > 0 && !window.confirm(`Remove ${describe(entry)} and its events?`)) return;
                editEntries((list) => list.filter((_, j) => j !== i));
              }}
            >
              ×
            </button>
          </div>
          <EventList path={[...loc.path, { index: loc.index, slot: i }]} list={entry.then ?? []} />
        </div>
      ))}
      <button className="link-btn" disabled={entries.length >= max} onClick={() => editEntries((list) => [...list, create(list)])}>
        + Add {noun.toLowerCase()} {entries.length >= max ? `(max ${max})` : ""}
      </button>
    </div>
  );
}

type MenuOption = MenuEvent["options"][number];

function MenuOptions({ ev, loc }: { ev: MenuEvent; loc: EventLocation }) {
  return (
    <BranchEntries<MenuOption>
      ev={ev}
      loc={loc}
      listKey="options"
      entries={ev.options}
      noun="Option"
      min={MIN_MENU_OPTIONS}
      max={MAX_MENU_OPTIONS}
      describe={(o) => `"${o.label}"`}
      create={(opts) => ({ label: `Option ${opts.length + 1}`, then: [] })}
      head={(opt, _i, edit) => (
        <input
          className="menu-option-label"
          value={opt.label}
          onChange={(e) => {
            const label = e.target.value;
            edit((o) => ({ ...o, label }), "label");
          }}
        />
      )}
    />
  );
}

type SwitchCase = SwitchEvent["cases"][number];

function SwitchCases({ ev, loc }: { ev: SwitchEvent; loc: EventLocation }) {
  const values = ev.cases.map((c) => c.value);
  return (
    <BranchEntries<SwitchCase>
      ev={ev}
      loc={loc}
      listKey="cases"
      entries={ev.cases}
      noun="Case"
      min={MIN_SWITCH_CASES}
      max={MAX_SWITCH_CASES}
      describe={(c) => `the case for ${c.value}`}
      create={(cases) => ({ value: cases.length ? Math.max(...cases.map((c) => c.value)) + 1 : 0, then: [] })}
      head={(c, i, edit) => (
        <span className={`switch-case-value${values.indexOf(c.value) !== i ? " switch-case-dup" : ""}`}>
          <span className="pos-label">=</span>
          <NumberInput
            className="menu-option-label"
            value={c.value}
            min={-32768}
            max={32767}
            onChange={(value) => edit((x) => ({ ...x, value }), "value")}
          />
        </span>
      )}
    />
  );
}
