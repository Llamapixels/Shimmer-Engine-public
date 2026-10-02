"""
Builds docs/shimmer-wiki.html: the user wiki, as one self-contained HTML
file (for Google Sites "Embed code", itch.io or any static host).

The guide text lives in docs/wiki_template.html; the events and engine
settings references are filled in from the editor's own event list
(editor/src/script/eventCatalog.ts) and compiler/engine_settings.json,
so they never drift from the app. Run from the repo root:

    python tools/make_wiki.py
"""
import base64
import json
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    with tempfile.TemporaryDirectory() as tmp:
        bundle = Path(tmp) / "dump.cjs"
        events = Path(tmp) / "events.json"
        npx = "npx.cmd" if subprocess.os.name == "nt" else "npx"
        subprocess.run([npx, "esbuild", str(ROOT / "tools" / "wiki_dump.ts"), "--bundle", "--platform=node",
                        f"--outfile={bundle}", "--log-level=error"], cwd=ROOT / "editor", check=True)
        subprocess.run(["node", str(bundle), str(events)], check=True)
        event_data = json.loads(events.read_text(encoding="utf-8"))
    settings = json.loads((ROOT / "compiler" / "engine_settings.json").read_text(encoding="utf-8"))
    settings = {"modes": settings["modes"], "settings": settings["settings"]}
    logo = base64.b64encode((ROOT / "editor" / "src" / "assets" / "logo.png").read_bytes()).decode()

    html = (ROOT / "docs" / "wiki_template.html").read_text(encoding="utf-8")
    html = html.replace("/*EVENTS*/[]", json.dumps(event_data, ensure_ascii=False).replace("</", r"<\/"))
    html = html.replace("/*SETTINGS*/{}", json.dumps(settings, ensure_ascii=False).replace("</", r"<\/"))
    html = html.replace("/*LOGO*/", "data:image/png;base64," + logo)
    out = ROOT / "docs" / "shimmer-wiki.html"
    out.write_text(html, encoding="utf-8")
    print(f"Wrote {out} ({len(html) // 1024} KB, {len(event_data)} events, {len(settings['settings'])} settings)")


if __name__ == "__main__":
    main()
