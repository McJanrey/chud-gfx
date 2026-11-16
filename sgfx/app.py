"""Desktop entry: StandBy GFX in its own window (pywebview; the browser when that's missing).

Data lives in %LOCALAPPDATA%\\StandBy GFX: workspaces\\<one per show>, library (fonts, teams, run of show,
settings). The last workspace opened opens again. --smoke-test (CI) starts the engine, fetches the
pages and state, and exits.
"""
import argparse
import json
import logging
import os
import socket
import sys
import tempfile
import threading
import urllib.request
import webbrowser
from pathlib import Path

from . import __version__
from .server import make_server, WEB

log = logging.getLogger("sgfx")
PORTS = range(7820, 7830)


def data_dir():
    """The installed app keeps its data next to itself (C:/Chud GFX Baby/workspaces, library), where GFX Baby kept
    it, so an update opens the same shows; run from source, in %LOCALAPPDATA%/StandBy GFX."""
    d = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(), "StandBy GFX")
    (d / "workspaces").mkdir(parents=True, exist_ok=True)
    (d / "library").mkdir(parents=True, exist_ok=True)
    return d


def old_settings(d):
    """GFX Baby's settings.json (its port and last workspace), if this folder had GFX Baby."""
    try:
        return json.loads((d / "settings.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def migrate(d):
    """Things GFX Baby kept in other places (its run of show sat beside the app), and a copy of every workspace
    exactly as GFX Baby left it, made once, before the new app saves anything."""
    old, new = d / "run-of-show.json", d / "library" / "run-of-show.json"
    if old.is_file() and not new.exists():
        new.write_bytes(old.read_bytes())
    for ws in (d / "workspaces").iterdir() if (d / "workspaces").is_dir() else []:
        src, keep = ws / "project.json", ws / "backups" / "before-standby-gfx.json"
        if src.is_file() and not keep.exists():
            keep.parent.mkdir(exist_ok=True)
            keep.write_bytes(src.read_bytes())


def pick_workspace(d):
    """The one opened last (here, or in GFX Baby), else the first, else a new blank one."""
    ws = d / "workspaces"
    for last in (lambda: json.loads((d / "last.json").read_text(encoding="utf-8")).get("workspace"), lambda: old_settings(d).get("workspace")):
        try:
            name = last()
            if name and (ws / name / "project.json").is_file():
                return ws / name
        except (OSError, ValueError):
            pass
    for f in sorted(ws.iterdir()):
        if (f / "project.json").is_file():
            return f
    first = ws / "my-show"
    (first / "assets").mkdir(parents=True, exist_ok=True)
    (first / "project.json").write_text(json.dumps({
        "name": "My show", "compositions": [], "sources": [], "global": {}, "playlists": [], "default_transition": "fade",
        "transitions": [{"id": "cut", "name": "Cut", "type": "cut", "enabled": True}, {"id": "fade", "name": "Fade", "type": "fade", "dur": 500, "enabled": True}]}, indent=1), encoding="utf-8")
    return first


def free_port(first=None):
    for p in ([first] if first else []) + list(PORTS):
        with socket.socket() as s:
            try:
                s.bind(("0.0.0.0", p))
                return p
            except OSError:
                continue
    return 0


def get(port, path):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}", timeout=10) as r:
        return r.read()


def smoke_test():
    d = Path(tempfile.mkdtemp())
    ws = pick_workspace_in(d)
    engine, srv = make_server(str(ws), str(d / "library"), 0)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        st = json.loads(get(engine.port, "/api/state"))
        assert st["project"]["name"] == "My show"
        for page in ("/control", "/output", "/ui/control.js", "/engine/stage.js", "/ui/app.css"):
            assert get(engine.port, page), page
        print(f"smoke test ok: StandBy GFX {__version__} on port {engine.port}")
        return 0
    finally:
        srv.shutdown()


def pick_workspace_in(d):
    (d / "workspaces").mkdir(parents=True, exist_ok=True)
    return pick_workspace(d)


def main(argv=None):
    p = argparse.ArgumentParser(prog="StandByGFX")
    p.add_argument("--smoke-test", action="store_true")
    p.add_argument("--browser", action="store_true", help="open in the browser instead of a window")
    p.add_argument("--workspace")
    args = p.parse_args(argv)
    if args.smoke_test:
        return smoke_test()
    d = data_dir()
    logging.basicConfig(filename=d / "standby-gfx.log", level=logging.INFO, encoding="utf-8", format="%(asctime)s %(levelname)s %(message)s")
    migrate(d)
    port = free_port(old_settings(d).get("http_port"))   # (GFX Baby's port first: OBS sources pointing at it keep working)
    if not port:
        print("No free port (7820-7829).")
        return 1
    ws = Path(args.workspace) if args.workspace else pick_workspace(d)
    engine, srv = make_server(str(ws), str(d / "library"), port)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=engine.check_update, daemon=True).start()

    def remember():   # (which workspace to open next time)
        try:
            (d / "last.json").write_text(json.dumps({"workspace": Path(engine.folder).name}), encoding="utf-8")
        except OSError:
            pass
    url = f"http://127.0.0.1:{port}/control"
    log.info("StandBy GFX %s on %s, workspace %s", __version__, url, ws)
    try:
        webview = None
        if not args.browser:
            try:
                import webview
            except ImportError:
                log.warning("pywebview missing, using the browser")
        if webview:
            webview.create_window(f"StandBy GFX", url, width=1440, height=900, min_size=(1024, 640), background_color="#0A0A0B", text_select=True)
            webview.start()
        else:
            webbrowser.open(url)
            threading.Event().wait()
    finally:
        remember()
        srv.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
