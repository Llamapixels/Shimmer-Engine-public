import { useRef, useState } from "react";

import { useBuildStore } from "../state/buildStore";
import { useProjectStore, type Section } from "../state/projectStore";
import PopoverMenu from "./common/PopoverMenu";
import Logo from "./Logo";
import "./Toolbar.css";
import Icon from "./common/Icon";

/** The sections GB Studio splits its world into - World / Sprites /
 * Backgrounds / Music / Settings - now picked from a single dropdown
 * ("Game World ▾") in the top-left, GB-Studio-style, instead of a row of
 * tabs. */
const SECTIONS: { id: Section; label: string }[] = [
  { id: "world", label: "Game World" },
  { id: "sprites", label: "Sprites" },
  { id: "backgrounds", label: "Backgrounds" },
  { id: "music", label: "Music" },
  { id: "settings", label: "Settings" },
];

/** How long the "Reloaded ✓" confirmation stays on the Asset Reload
 * button before reverting to "Asset Reload" - just long enough to
 * notice without having to dismiss anything. */
const RELOAD_CONFIRM_MS = 1500;

export default function Toolbar() {
  const projectName = useProjectStore((s) => s.project?.project.name ?? "");
  const rootPath = useProjectStore((s) => s.project?.rootPath ?? null);
  const section = useProjectStore((s) => s.section);
  const setSection = useProjectStore((s) => s.setSection);
  const canUndo = useProjectStore((s) => s.past.length > 0);
  const canRedo = useProjectStore((s) => s.future.length > 0);
  const undo = useProjectStore((s) => s.undo);
  const redo = useProjectStore((s) => s.redo);
  const closeProject = useProjectStore((s) => s.closeProject);
  const refreshAssets = useProjectStore((s) => s.refreshAssets);
  const buildStatus = useBuildStore((s) => s.status);
  const startBuild = useBuildStore((s) => s.startBuild);
  const building = buildStatus === "running";
  const [menuOpen, setMenuOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [reloadState, setReloadState] = useState<"idle" | "reloading" | "done">("idle");

  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  const doReloadAssets = async () => {
    setReloadState("reloading");
    await refreshAssets();
    setReloadState("done");
    setTimeout(() => setReloadState("idle"), RELOAD_CONFIRM_MS);
  };

  return (
    <div className="toolbar">
      <Logo size={30} className="toolbar-mark" />
      <div className="toolbar-project-name" title={projectName}>
        {projectName}
      </div>

      <button
        className="toolbar-section-select"
        onClick={() => void doReloadAssets()}
        disabled={!rootPath || reloadState === "reloading"}
        title="Re-read project.json, every scene file, and re-scan asset folders - picks up files added or changed on disk without closing and reopening the project."
      >
        <span>
          {reloadState === "reloading" ? "Reloading…" : reloadState === "done" ? "Reloaded ✓" : "Asset Reload"}
        </span>
      </button>

      <button
        className="toolbar-section-select"
        onClick={() => rootPath && void window.api.openProjectFolder({ rootPath })}
        disabled={!rootPath}
        title="Open this project's folder in your file manager"
      >
        <span>
          <Icon name="folder" /> Open Folder
        </span>
      </button>

      <button ref={btnRef} className="toolbar-section-select" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
        <span>{current.label}</span>
        <span className="toolbar-section-select-chevron" aria-hidden>
          ▾
        </span>
      </button>
      {menuOpen && btnRef.current && (
        <PopoverMenu
          anchor={btnRef.current}
          onClose={() => setMenuOpen(false)}
          items={SECTIONS.map((s) => ({
            label: s.label,
            onClick: () => setSection(s.id),
            shortcut: s.id === section ? "●" : undefined,
          }))}
        />
      )}

      <div className="toolbar-right">
        <button className="toolbar-icon-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)">
          <Icon name="undo" size={14} />
        </button>
        <button className="toolbar-icon-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)">
          <Icon name="redo" size={14} />
        </button>
        <button
          className="toolbar-open-btn toolbar-play-btn"
          disabled={!rootPath || building}
          onClick={() => {
            if (!rootPath || building) return;
            void startBuild(rootPath, true);
          }}
          title="Build the ROM and open it in your GBA emulator"
          data-testid="play-btn"
        >
          <Icon name="play" /> Play
        </button>
        <button
          className="toolbar-build-btn"
          disabled={!rootPath || building}
          onClick={() => {
            if (!rootPath || building) return;
            void startBuild(rootPath);
          }}
          title={building ? "A build is already running" : "Compile this project and build the ROM"}
        >
          {building ? "Building…" : "Build ROM"}
        </button>
        <button className="toolbar-open-btn" onClick={closeProject} title="Back to the start screen to open or create another project">
          Projects…
        </button>
      </div>
    </div>
  );
}
