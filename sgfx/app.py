"""Desktop entry: StandBy GFX in its own window (pywebview; the browser when that's missing).

Data lives in %LOCALAPPDATA%\\StandBy GFX: workspaces\\<one per show>, library (fonts, teams, run of show,
settings). The last workspace opened opens again. --smoke-test (CI) starts the engine, fetches the
pages and state, and exits.
"""
import argparse
import json
import shutil
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
from . import logs, updater

log = logging.getLogger("sgfx")
PORTS = range(7820, 7830)


def data_dir():
    """The installed app keeps its data next to itself (C:/Chud GFX Baby/workspaces, library), where GFX Baby kept
    it, so an update opens the same shows; run from source, in %LOCALAPPDATA%/StandBy GFX."""
    d = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(os.environ.get("LOCALAPPDATA") or tempfile.gettempdir(), "StandBy GFX")
    (d / "workspaces").mkdir(parents=True, exist_ok=True)
    (d / "library").mkdir(parents=True, exist_ok=True)
    return d


STARTER = Path(getattr(sys, "_MEIPASS", "")) / "starter" if getattr(sys, "frozen", False) else Path(__file__).resolve().parent.parent / "starter"


def seed(d, starter=STARTER):
    """The shows built into the app (starter/): each workspace and library file copied in once, the first time
    this folder sees it. Never over the user's own, and never again after they delete it (starter.json)."""
    if not starter.is_dir():
        return
    mark = d / "starter.json"
    try:
        done = set(json.loads(mark.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        done = set()
    items = [("workspaces", p) for p in sorted((starter / "workspaces").iterdir())] if (starter / "workspaces").is_dir() else []
    items += [("library", p) for p in sorted((starter / "library").iterdir())] if (starter / "library").is_dir() else []
    for kind, p in items:
        key, dest = f"{kind}/{p.name}", d / kind / p.name
        if key in done:
            continue
        if not dest.exists():
            try:
                shutil.copytree(p, dest) if p.is_dir() else shutil.copy2(p, dest)
            except OSError as e:
                log.warning("starter %s not copied: %s", key, e)
                continue
        done.add(key)
    mark.write_text(json.dumps(sorted(done)), encoding="utf-8")


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


def one_instance(d):
    """A mutex named after the data folder, held while the app runs. None = a copy is already running (a second
    launch would open the same show on the next port, miss OBS's sources and save over the first one's edits)."""
    if os.name != "nt":
        return True
    import ctypes
    import hashlib
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateMutexW.restype = ctypes.c_void_p
    h = k32.CreateMutexW(None, False, "Local\\StandByGFX-" + hashlib.sha1(str(d).lower().encode()).hexdigest()[:16])
    if h and ctypes.get_last_error() == 183:   # (ERROR_ALREADY_EXISTS)
        k32.CloseHandle(ctypes.c_void_p(h))
        return None
    return h or True   # (no mutex at all: start anyway rather than never)


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
        from . import huds   # (files the app reads at run time are packed in: the built-in VALORANT HUD, the starter shows)
        assert len(huds.builtin("val27") or []) >= 6, "val27_owen.json missing"
        assert STARTER.is_dir() and any(STARTER.iterdir()), "starter missing"
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
    logs.setup(str(d))
    held = one_instance(d)
    if not held:
        log.info("StandBy GFX is already running: this second launch closes")
        return 0
    migrate(d)
    seed(d)
    port = free_port(old_settings(d).get("http_port"))   # (GFX Baby's port first: OBS sources pointing at it keep working)
    if not port:
        print("No free port (7820-7829).")
        return 1
    ws = Path(args.workspace) if args.workspace else pick_workspace(d)
    engine, srv = make_server(str(ws), str(d / "library"), port)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    threading.Thread(target=engine.watch_updates, daemon=True, name="updates").start()

    def remember():   # (which workspace to open next time)
        try:
            (d / "last.json").write_text(json.dumps({"workspace": Path(engine.folder).name}), encoding="utf-8")
        except OSError:
            pass

    def bye():   # (ffmpeg would outlive the app: still relaying, or holding the RTMP port)
        remember()
        engine.stream.stop()
    updater.before_exit.append(bye)   # (an update ends with os._exit, which skips the finally below)
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
            webview.settings["ALLOW_DOWNLOADS"] = True   # (Export pack / HTML / CSV links save a file: the window blocks downloads unless told)
            webview.create_window(f"StandBy GFX", url, width=1440, height=900, min_size=(1024, 640), background_color="#0A0A0B", text_select=True)
            webview.start()
        else:
            webbrowser.open(url)
            threading.Event().wait()
    finally:
        bye()
        srv.shutdown()
    return 0


if __name__ == "__main__":
    sys.exit(main())
