import { useState } from "react";

import { useProjectStore } from "../state/projectStore";
import "./WelcomeScreen.css";

interface Props {
  loading: boolean;
}

function folderName(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

export default function WelcomeScreen({ loading }: Props) {
  const openProjectDialog = useProjectStore((s) => s.openProjectDialog);
  const openProjectAtPath = useProjectStore((s) => s.openProjectAtPath);
  const newProject = useProjectStore((s) => s.newProject);
  const recent = useProjectStore((s) => s.recentProjects);
  const error = useProjectStore((s) => s.error);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("My Game");

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-mark" aria-hidden>
          SE
        </div>
        <h1>Shimmer Engine</h1>
        <p className="welcome-subtitle">Build GBA games with scenes, actors, and event scripts.</p>

        {creating ? (
          <div className="welcome-new">
            <label>
              Project name
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && name.trim()) void newProject(name);
                  if (e.key === "Escape") setCreating(false);
                }}
              />
            </label>
            <p className="welcome-hint">
              Next you'll pick a folder to create it in. To build it with <code>./build.sh</code>, put it inside your Advance
              Studio folder — e.g. in <code>examples/</code>.
            </p>
            <div className="welcome-actions">
              <button className="welcome-open-btn" disabled={!name.trim() || loading} onClick={() => newProject(name)}>
                {loading ? "Creating…" : "Choose folder & create"}
              </button>
              <button className="welcome-secondary-btn" onClick={() => setCreating(false)}>
                Back
              </button>
            </div>
          </div>
        ) : (
          <div className="welcome-actions">
            <button className="welcome-open-btn" onClick={() => setCreating(true)} disabled={loading}>
              New Project
            </button>
            <button className="welcome-secondary-btn" onClick={() => openProjectDialog()} disabled={loading}>
              {loading ? "Opening…" : "Open Project…"}
            </button>
          </div>
        )}

        {error && <p className="welcome-error">{error}</p>}

        {!creating && recent.length > 0 && (
          <div className="welcome-recent">
            <div className="welcome-recent-title">Recent</div>
            {recent.map((p) => (
              <button key={p} className="welcome-recent-item" onClick={() => openProjectAtPath(p)} title={p} disabled={loading}>
                <span className="welcome-recent-name">{folderName(p)}</span>
                <span className="welcome-recent-path">{p}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
