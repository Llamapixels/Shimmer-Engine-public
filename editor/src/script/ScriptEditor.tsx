import { createContext, memo, useCallback, useContext, useMemo, useRef, useState, type DragEvent } from "react";
import { create } from "zustand";

import type { EventScript, MenuEvent, ScriptEventJSON } from "../../shared/eventTypes";
import PopoverMenu, { type MenuItem } from "../components/common/PopoverMenu";
import { sceneName, useProjectStore } from "../state/projectStore";
import AddEventMenu from "./AddEventMenu";
import { useDragState, pathKey } from "./dragState";
import { CATEGORY_COLOR, eventSummary, getEventDef, type CreateContext, type EventDef } from "./eventCatalog";
import { FieldControl, type ScriptEnv } from "./ScriptFields";
import {
  cloneEvent,
  eventKey,
  findByKey,
  getEvent,
  getList,
  insertEvents,
  isInside,
  moveEvent,
  removeEvent,
  replaceEvent,
  walkEvents,
  type EventLocation,
  type ListPath,
  type Slot,
} from "./scriptTree";
import "./ScriptEditor.css";

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

/** Which blocks are collapsed, by their session-stable key. */
const useCollapsed = create<{ keys: Record<string, true>; set: (keys: string[], collapsed: boolean) => void }>((set) => ({
  keys: {},
  set: (keys, collapsed) =>
    set((s) => {
      const next = { ...s.keys };
      for (const k of keys) {
        if (collapsed) next[k] = true;
        else delete next[k];
      }
      return { keys: next };
    }),
}));

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
export default function ScriptEditor({ value, onChange, env, emptyHint }: Props) {
  const root = value ?? [];
  const project = useProjectStore((s) => s.project);
  const assets = useProjectStore((s) => s.assets);
  const clipboard = useProjectStore((s) => s.scriptClipboard);
  const setClipboard = useProjectStore((s) => s.setScriptClipboard);
  const setCollapsed = useCollapsed((s) => s.set);

  const createCtx = useCallback((): CreateContext => {
    const npcs = env.scene.npcs ?? [];
    const timers = env.scene.timers ?? [];
    return {
      flags: project?.project.flags ?? [],
      items: project?.project.items ?? [],
      variables: project?.project.variables ?? [],
      sceneNames: (project?.scenes ?? []).map(sceneName),
      firstActor: env.allowSelf ? "self" : npcs.length ? npcs[0].name || 0 : null,
      firstTimer: timers.length ? timers[0].name || 0 : null,
      firstCustomScript: project?.project.customScripts?.[0]?.id ?? null,
      firstMusicTrack: assets?.music?.[0]?.name ?? null,
    };
  }, [env, project, assets]);

  const ctx = useMemo<Ctx>(() => ({ env, root, apply: onChange, createCtx }), [env, root, onChange, createCtx]);

  const allKeys = () => {
    const keys: string[] = [];
    walkEvents(root, (ev) => keys.push(eventKey(ev)));
    return keys;
  };

  let total = 0;
  walkEvents(root, () => (total += 1));

  return (
    <EditorContext.Provider value={ctx}>
      <div className="script-editor">
        <div className="script-editor-bar">
          <span className="script-editor-count">
            {total} event{total === 1 ? "" : "s"}
          </span>
          <button className="link-btn" disabled={total === 0} onClick={() => setCollapsed(allKeys(), true)}>
            Collapse all
          </button>
          <button className="link-btn" disabled={total === 0} onClick={() => setCollapsed(allKeys(), false)}>
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
          ＋ Add Event
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
      {menuAnchor && <AddEventMenu anchor={menuAnchor} onPick={add} onClose={() => setMenuAnchor(null)} />}
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
  const collapsed = useCollapsed((s) => !!s.keys[key]);
  const setCollapsed = useCollapsed((s) => s.set);
  const dragging = useDragState(
    (s) => s.dimmed?.rootId === env.rootId && s.dimmed.from.index === loc.index && pathKey(s.dimmed.from.path) === pathKey(loc.path),
  );
  const clipboard = useProjectStore((s) => s.scriptClipboard);
  const setClipboard = useProjectStore((s) => s.setScriptClipboard);
  const [menu, setMenu] = useState<HTMLElement | { x: number; y: number } | null>(null);
  const [addAt, setAddAt] = useState<{ anchor: HTMLElement; index: number } | null>(null);
  const headerRef = useRef<HTMLDivElement>(null);

  const def = getEventDef(ev.type);
  const hasChildren = !!def?.branches || !!def?.menuOptions;
  const color = def ? CATEGORY_COLOR[def.category] : "#666";

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
      className={`event-block${dragging ? " event-block-dragging" : ""}${def ? "" : " event-block-unknown"}`}
      style={{ ["--cat" as string]: color }}
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
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onDoubleClick={() => setCollapsed([key], !collapsed)}
      >
        <span className="event-grip" aria-hidden>
          ⠿
        </span>
        <button
          className={`event-caret${collapsed ? "" : " event-caret-open"}`}
          onClick={() => setCollapsed([key], !collapsed)}
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          ▸
        </button>
        <span className="event-title">{def?.label ?? `Unknown event "${ev.type}"`}</span>
        {collapsed && <span className="event-summary">{eventSummary(ev)}</span>}
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

      {!collapsed && (
        <div className="event-body">
          {!def && (
            <pre className="event-unknown-json">{JSON.stringify(ev, null, 2)}</pre>
          )}
          {def?.fields.map((f) => (
            <div key={f.key} className={`event-field${f.kind === "multiline" || f.kind === "buttons" ? " event-field-wide" : ""}`}>
              <span className="event-field-label">{f.label}</span>
              <div className="event-field-control">
                <FieldControl field={f} ev={ev} env={env} patch={patch} />
              </div>
            </div>
          ))}
          {def?.branches?.map((b) => {
            const list = (ev as unknown as Record<string, EventScript | undefined>)[b.key] ?? [];
            return (
              <div key={b.key} className="event-branch">
                <div className="event-branch-label">{b.label}</div>
                <EventList path={[...loc.path, { index: loc.index, slot: b.key as Slot }]} list={list} />
              </div>
            );
          })}
          {def?.menuOptions && ev.type === "menu" && <MenuOptions ev={ev} loc={loc} />}
        </div>
      )}

      {menu && <PopoverMenu anchor={menu} items={menuItems} onClose={() => setMenu(null)} />}
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
        />
      )}
    </div>
  );
});

const MAX_MENU_OPTIONS = 4;
const MIN_MENU_OPTIONS = 2;

function MenuOptions({ ev, loc }: { ev: MenuEvent; loc: EventLocation }) {
  const { apply } = useEditor();

  const editOptions = (fn: (opts: MenuEvent["options"]) => MenuEvent["options"], coalesceField?: string) =>
    apply(
      (root) => {
        const at = findByKey(root, eventKey(ev));
        const cur = at && getEvent(root, at);
        if (!at || !cur || cur.type !== "menu") return root;
        return replaceEvent(root, at, { ...cur, options: fn(cur.options) });
      },
      coalesceField ? `${eventKey(ev)}:${coalesceField}` : undefined,
    );

  return (
    <div className="menu-options">
      {ev.options.map((opt, i) => (
        <div key={i} className="event-branch">
          <div className="menu-option-head">
            <span className="event-branch-label">Option {i + 1}</span>
            <input
              className="menu-option-label"
              value={opt.label}
              onChange={(e) => {
                const label = e.target.value;
                editOptions((opts) => opts.map((o, j) => (j === i ? { ...o, label } : o)), `label${i}`);
              }}
            />
            <button
              className="icon-btn"
              title="Move option up"
              disabled={i === 0}
              onClick={() =>
                editOptions((opts) => {
                  const c = opts.slice();
                  [c[i - 1], c[i]] = [c[i], c[i - 1]];
                  return c;
                })
              }
            >
              ↑
            </button>
            <button
              className="icon-btn"
              title="Remove option"
              disabled={ev.options.length <= MIN_MENU_OPTIONS}
              onClick={() => {
                if ((opt.then?.length ?? 0) > 0 && !window.confirm(`Remove "${opt.label}" and its events?`)) return;
                editOptions((opts) => opts.filter((_, j) => j !== i));
              }}
            >
              ×
            </button>
          </div>
          <EventList path={[...loc.path, { index: loc.index, slot: i }]} list={opt.then ?? []} />
        </div>
      ))}
      <button
        className="link-btn"
        disabled={ev.options.length >= MAX_MENU_OPTIONS}
        onClick={() => editOptions((opts) => [...opts, { label: `Option ${opts.length + 1}`, then: [] }])}
      >
        ＋ Add option {ev.options.length >= MAX_MENU_OPTIONS ? "(max 4)" : ""}
      </button>
    </div>
  );
}
