import { Fragment, useState, type DragEvent, type ReactNode } from "react";

/**
 * A list grouped into folders by "/" in its names: "Forest/Cave 1" shows
 * as "Cave 1" inside a "Forest" folder. The names themselves are left as
 * typed. Lists without any "/" render exactly as before.
 */

/** "Forest/Cave 1" -> folders ["Forest"], leaf "Cave 1". */
export function splitFolders(name: string): { folders: string[]; leaf: string } {
  const parts = name.split("/").map((p) => p.trim());
  const leaf = parts.pop() || name;
  return { folders: parts.filter(Boolean), leaf };
}

interface Node<T> {
  folders: Map<string, Node<T>>;
  items: { item: T; label: string }[];
}

function build<T>(items: T[], getName: (t: T) => string): Node<T> {
  const root: Node<T> = { folders: new Map(), items: [] };
  for (const item of items) {
    const { folders, leaf } = splitFolders(getName(item));
    let node = root;
    for (const f of folders) {
      let next = node.folders.get(f);
      if (!next) {
        next = { folders: new Map(), items: [] };
        node.folders.set(f, next);
      }
      node = next;
    }
    node.items.push({ item, label: leaf });
  }
  return root;
}

function countItems<T>(node: Node<T>): number {
  let n = node.items.length;
  for (const child of node.folders.values()) n += countItems(child);
  return n;
}

function loadOpen(key: string): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(`folders:${key}`) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export default function FolderTree<T>({
  items,
  getName,
  getKey = getName,
  renderItem,
  storageKey,
  isActive,
  onMoveToFolder,
  onRenameFolder,
}: {
  items: T[];
  getName: (t: T) => string;
  /** React key per item (default: its name). */
  getKey?: (t: T) => string;
  /** One row; `label` is the name without its folders. */
  renderItem: (item: T, label: string) => ReactNode;
  /** Remembers which folders are closed, per list. */
  storageKey: string;
  /** A folder holding an active item opens itself. */
  isActive?: (t: T) => boolean;
  /** GB Studio-style moving: drag an item onto a folder ("" = the top
   * level, dropped on the list's own empty space). */
  onMoveToFolder?: (item: T, folder: string) => void;
  /** Double-click a folder to rename it ("Forest" -> "Woods", or with a
   * "/" to nest it). */
  onRenameFolder?: (from: string, to: string) => void;
}) {
  const [closed, setClosed] = useState<Record<string, boolean>>(() => loadOpen(storageKey));
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const dragType = `application/x-folder-tree-${storageKey}`;

  const draggable = (item: T, node: ReactNode) =>
    onMoveToFolder ? (
      <div
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(dragType, getKey(item));
          e.dataTransfer.effectAllowed = "move";
        }}
      >
        {node}
      </div>
    ) : (
      node
    );
  const dropProps = (folder: string) =>
    onMoveToFolder
      ? {
          onDragOver: (e: DragEvent) => {
            if (!e.dataTransfer.types.includes(dragType)) return;
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(folder);
          },
          onDragLeave: () => setDropTarget((t) => (t === folder ? null : t)),
          onDrop: (e: DragEvent) => {
            const key = e.dataTransfer.getData(dragType);
            if (!key) return;
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(null);
            const item = items.find((t) => getKey(t) === key);
            if (item) onMoveToFolder(item, folder);
          },
        }
      : {};

  if (!items.some((t) => getName(t).includes("/")))
    return (
      <div className={`folder-tree${dropTarget === "" ? " folder-tree-drop" : ""}`} {...dropProps("")}>
        {items.map((t) => (
          <Fragment key={getKey(t)}>{draggable(t, renderItem(t, getName(t)))}</Fragment>
        ))}
      </div>
    );

  const toggle = (path: string) =>
    setClosed((prev) => {
      const next = { ...prev, [path]: !prev[path] };
      try {
        localStorage.setItem(`folders:${storageKey}`, JSON.stringify(next));
      } catch {
        // storage unavailable: just don't remember it
      }
      return next;
    });

  const holdsActive = (node: Node<T>): boolean =>
    !!isActive && (node.items.some((e) => isActive(e.item)) || [...node.folders.values()].some(holdsActive));

  const renderNode = (node: Node<T>, path: string, depth: number): ReactNode => (
    <>
      {[...node.folders.entries()]
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
        .map(([name, child]) => {
          const p = path ? `${path}/${name}` : name;
          const open = !closed[p] || holdsActive(child);
          return (
            <div key={`folder:${p}`} className="folder-tree-folder">
              <div
                className={`navigator-item folder-tree-row${dropTarget === p ? " folder-tree-drop" : ""}`}
                style={{ paddingLeft: 6 + depth * 12 }}
                onClick={() => toggle(p)}
                onDoubleClick={(e) => {
                  if (!onRenameFolder) return;
                  e.stopPropagation();
                  setRenaming(p);
                }}
                title={onRenameFolder ? "Double-click to rename" : undefined}
                {...dropProps(p)}
              >
                <span className="folder-tree-chevron" aria-hidden>
                  {open ? "▾" : "▸"}
                </span>
                <span className="folder-tree-icon" aria-hidden>
                  📁
                </span>
                {renaming === p ? (
                  <input
                    className="folder-tree-rename"
                    autoFocus
                    defaultValue={p}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      const to = e.currentTarget.value.trim().replace(/^\/+|\/+$/g, "");
                      setRenaming(null);
                      if (to !== p) onRenameFolder?.(p, to);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      if (e.key === "Escape") {
                        e.currentTarget.value = p;
                        e.currentTarget.blur();
                      }
                    }}
                  />
                ) : (
                  <span className="navigator-item-label" title={p}>
                    {name}
                  </span>
                )}
                <span className="navigator-tag">{countItems(child)}</span>
              </div>
              {open && <div className="folder-tree-children">{renderNode(child, p, depth + 1)}</div>}
            </div>
          );
        })}
      {node.items.map(({ item, label }) => (
        <div key={`item:${getKey(item)}`} style={depth ? { paddingLeft: depth * 12 } : undefined}>
          {draggable(item, renderItem(item, label))}
        </div>
      ))}
    </>
  );

  return (
    <div className={`folder-tree${dropTarget === "" ? " folder-tree-drop" : ""}`} {...dropProps("")}>
      {renderNode(build(items, getName), "", 0)}
    </div>
  );
}
