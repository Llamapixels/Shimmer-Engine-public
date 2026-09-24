import { useState } from "react";

import { sceneName, useProjectStore } from "../../state/projectStore";
import { formatBytes } from "./assetImages";
import "./views.css";

export default function MusicView() {
  const project = useProjectStore((s) => s.project)!;
  const assets = useProjectStore((s) => s.assets);
  const [error, setError] = useState<string | null>(null);
  const tracks = assets?.music ?? [];

  const doImport = async () => {
    setError(null);
    const r = await window.api.importAssets({ rootPath: project.rootPath, kind: "music" });
    if (!r.ok) setError(r.error);
    else if (r.value) useProjectStore.setState({ assets: r.value });
  };

  return (
    <div className="view view-single">
      <div className="view-main">
        <div className="view-head">
          <div className="view-title">
            Music <span className="view-sub">engine/music · {tracks.length}</span>
          </div>
          <button className="btn btn-primary" onClick={doImport} disabled={!assets?.engineRoot}>
            Import track…
          </button>
        </div>
        <div className="view-scroll">
          <p className="view-note">
            GB Studio / hUGETracker songs (<code>.uge</code>) and tracker modules (<code>.mod</code>, <code>.xm</code>, <code>.s3m</code>, <code>.it</code>) in the engine's{" "}
            <code>music</code> folder (.uge plays on the Game Boy sound channels, modules through maxmod). A scene plays a track when it loads if its Music property is
            set; leave it unset to keep whatever is already playing. Tracks are shared by every project in this Shimmer Engine
            folder. (No in-editor playback yet — play them in OpenMPT or similar.)
          </p>
          {!assets?.engineRoot && (
            <p className="field-error">
              Couldn't find the engine folder above this project, so music can't be listed. Projects need to live inside the
              Shimmer Engine folder (e.g. next to examples/demo) to build.
            </p>
          )}
          {error && <p className="field-error">{error}</p>}
          {tracks.length === 0 ? (
            <div className="view-empty">No tracks yet.</div>
          ) : (
            <table className="music-table">
              <thead>
                <tr>
                  <th>Track</th>
                  <th>File</th>
                  <th>Size</th>
                  <th>Played by</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {tracks.map((t) => {
                  const scenes = project.scenes.filter((s) => s.data.music === t.name).map(sceneName);
                  return (
                    <tr key={t.relPath}>
                      <td>{t.name}</td>
                      <td>{t.fileName}</td>
                      <td>{formatBytes(t.bytes)}</td>
                      <td>{scenes.length ? scenes.join(", ") : "—"}</td>
                      <td>
                        <button
                          className="link-btn"
                          onClick={() => window.api.revealInFolder({ rootPath: project.rootPath, relPath: t.relPath, base: t.base })}
                        >
                          Show in folder
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
