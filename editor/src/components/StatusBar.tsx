import { sceneName, useProjectStore } from "../state/projectStore";
import "./StatusBar.css";

export default function StatusBar() {
  const rootPath = useProjectStore((s) => s.project?.rootPath ?? "");
  const sceneCount = useProjectStore((s) => s.project?.scenes.length ?? 0);
  const saveError = useProjectStore((s) => s.saveError);
  const notice = useProjectStore((s) => s.notice);
  const hoverTile = useProjectStore((s) => s.hoverTile);
  const activeScene = useProjectStore((s) => s.project?.scenes.find((sc) => sc.fileId === s.activeSceneId));

  return (
    <div className="status-bar">
      <span className="status-bar-path" title={rootPath}>{rootPath}</span>
      <span className="status-bar-count">{sceneCount} scene{sceneCount === 1 ? "" : "s"}</span>
      {hoverTile && activeScene && (
        <span className="status-bar-hover" title="Scene and tile under the cursor">
          {sceneName(activeScene)} · X={hoverTile.x} Y={hoverTile.y}
        </span>
      )}
      {notice && <span className="status-bar-notice">{notice}</span>}
      {saveError && <span className="status-bar-error">Couldn't save: {saveError}</span>}
    </div>
  );
}
