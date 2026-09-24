import { useEffect, useRef, useState } from "react";

import { useProjectStore } from "./state/projectStore";
import BuildRomPanel from "./components/BuildRomPanel";
import Toolbar from "./components/Toolbar";
import Navigator from "./components/Navigator";
import SceneCanvas from "./components/SceneCanvas";
import PropertiesPanel from "./components/PropertiesPanel";
import StatusBar from "./components/StatusBar";
import WelcomeScreen from "./components/WelcomeScreen";
import BackgroundsView from "./components/views/BackgroundsView";
import SpritesView from "./components/views/SpritesView";
import MusicView from "./components/views/MusicView";
import SettingsView from "./components/views/SettingsView";
import "./App.css";

const PANEL_KEY = "shimmer-engine.panel-width";
/** Pre-rename key, still read (never written) so an existing user's saved
 * width survives the app's rename from Advance Studio. */
const LEGACY_PANEL_KEY = "advance-studio.panel-width";

function loadPanelWidth(): number {
  try {
    const raw = localStorage.getItem(PANEL_KEY) ?? localStorage.getItem(LEGACY_PANEL_KEY);
    const v = Number(raw);
    return v >= 300 && v <= 900 ? v : 400;
  } catch {
    return 400;
  }
}

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export default function App() {
  const project = useProjectStore((s) => s.project);
  const loading = useProjectStore((s) => s.loading);
  const section = useProjectStore((s) => s.section);
  const [panelWidth, setPanelWidth] = useState(loadPanelWidth);
  const resizing = useRef(false);
  const panelWidthRef = useRef(panelWidth);
  panelWidthRef.current = panelWidth;

  // Global shortcuts: undo/redo and Delete. Left to the browser while
  // typing in a field, so text fields keep their own native undo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!useProjectStore.getState().project) return;
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z" && !e.shiftKey) {
        e.preventDefault();
        useProjectStore.getState().undo();
      } else if (mod && (k === "y" || (k === "z" && e.shiftKey))) {
        e.preventDefault();
        useProjectStore.getState().redo();
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        useProjectStore.getState().section === "world" &&
        (e.target === document.body || (e.target as HTMLElement).tagName === "CANVAS")
      ) {
        const sel = useProjectStore.getState().selection;
        if (sel.kind === "door" || sel.kind === "npc") {
          e.preventDefault();
          useProjectStore.getState().deleteSelected();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.max(300, Math.min(900, window.innerWidth - e.clientX));
      setPanelWidth(w);
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.classList.remove("col-resizing");
      try {
        localStorage.setItem(PANEL_KEY, String(Math.round(panelWidthRef.current)));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);
  if (!project) {
    return <WelcomeScreen loading={loading} />;
  }

  return (
    <div className="app-shell">
      <Toolbar />
      {section === "world" ? (
        <div className="app-body" style={{ gridTemplateColumns: `240px 1fr 5px ${panelWidth}px` }}>
          <Navigator />
          <SceneCanvas />
          <div
            className="col-resizer"
            onMouseDown={(e) => {
              e.preventDefault();
              resizing.current = true;
              document.body.classList.add("col-resizing");
            }}
            onDoubleClick={() => setPanelWidth(400)}
            title="Drag to resize"
          />
          <PropertiesPanel />
        </div>
      ) : (
        <div className="app-body app-body-single">
          {section === "backgrounds" && <BackgroundsView />}
          {section === "sprites" && <SpritesView />}
          {section === "music" && <MusicView />}
          {section === "settings" && <SettingsView />}
        </div>
      )}
      <StatusBar />
      <BuildRomPanel />
    </div>
  );
}
