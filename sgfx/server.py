"""The engine's web server (phase 1): outputs, a workspace's files, and the bus actions.

    python -m sgfx --workspace <folder> [--library <folder>] [--port 7800]
"""

import copy
import csv
import json
import mimetypes
import os
import re
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

import time

from . import bracket, tables
from . import ros as rosmod
from . import sources as srcmod
from .stream import Multistream
from . import convert
from . import pack
from . import parts as partsmod
from .net import Net
from .obs import OBS
from .buses import Buses
from . import logs
from . import hudlink
from .logs import log

WEB = os.path.join(getattr(sys, "_MEIPASS", ""), "web") if getattr(sys, "frozen", False) else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")
mimetypes.add_type("text/javascript", ".js")
mimetypes.add_type("font/otf", ".otf")
mimetypes.add_type("font/ttf", ".ttf")
mimetypes.add_type("font/woff2", ".woff2")


def inside(base, rel):
    """base/rel on disk, or None when rel climbs out of base."""
    path = os.path.normpath(os.path.join(base, unquote(rel)))
    return path if path.startswith(os.path.normpath(base) + os.sep) else None


def refresh_secs(v):
    """A source's refresh in seconds: 2 at least, 10 when it isn't a number (a pack or hand edit with "auto")."""
    try:
        return max(2.0, float(v or 10))
    except (TypeError, ValueError):
        return 10.0


# The old starter set's stand-in pictures (Owen's art) -> ours, from MJ's Claude reference folder.
# Swapped in memory when a workspace opens; the workspace's own files are never changed.
PLACEHOLDERS = {"player.png": "placeholders/player.png", "replace with tournament logo.png": "placeholders/logo.png"}


def swap_placeholders(project):
    for comp in project.get("compositions") or []:
        for layer in comp.get("layers") or []:
            # (a picture shown only while there are no headshots is a stand-in player)
            if layer.get("type") == "image" and "no headshots" in str(layer.get("show", "")).lower() and str(layer.get("src", "")).startswith("assets/"):
                    # ("Player graphic (3)" shows three players; anything else, one)
                m = re.search(r"\((\d)\)\s*$", comp.get("name", ""))
                n = max(1, min(5, int(m.group(1)))) if m else 1
                layer["src"] = "placeholders/player.png" if n == 1 else f"placeholders/player-{n}.png"
                layer["fit"], layer["position"] = "contain", "bottom"
            # (any picture of the tournament logo: ours stands in until one is set)
            if layer.get("type") == "image" and "global!tournament logo" in str(layer.get("src", "")).lower().replace(" ", " "):
                layer["placeholder"], layer["fit"], layer["position"] = "placeholders/logo.png", "contain", ""
                continue
            for key in ("src", "placeholder"):
                v = layer.get(key)
                base = os.path.basename(v).lower() if isinstance(v, str) else ""
                if "tournament logo" in base and "replace" in base:
                    base = "replace with tournament logo.png"
                if isinstance(v, str) and v.startswith("assets/") and base in PLACEHOLDERS:
                    v = "assets/" + base
                    layer[key] = PLACEHOLDERS[base]
                    # (ours keep their own shape: a player stands on the box's bottom edge, a logo sits in the middle)
                    layer["fit"], layer["position"] = "contain", "bottom" if base == "player.png" else ""


class Engine:
    def __init__(self, workspace, library=None):
        self.library = library
        self.version, self.cond = 0, threading.Condition()
        self.lock = threading.RLock()   # (requests, the playlist, OBS and data threads all change the project: one at a time)
        self.import_lock = threading.Lock()   # (one pack import at a time: two must not hand out the same ids or file names)
        self._load(workspace)
        self.playing = None   # {id, i, on, until}: a playlist running on Program (on: the graphic it put up)
        threading.Thread(target=self._playlist_loop, daemon=True).start()
        self._remote = {}
        threading.Thread(target=self._fetch_loop, daemon=True).start()
        self.stream = Multistream(library or os.path.dirname(os.path.abspath(workspace)))
        self.stream.on_change = self._bump
        self.jobs = convert.Jobs(self._bump)
        self.obs = OBS(library or os.path.dirname(os.path.abspath(workspace)))
        self.obs.on_change = self._bump
        self.obs.on_scene = self._obs_scene
        self._was_on = set(self.buses.state["program"]["on"])

    def _load(self, workspace):
        with open(os.path.join(workspace, "project.json"), encoding="utf-8") as f:
            project = json.load(f)
        swap_placeholders(project)
        saved = {}
        try:
            with open(os.path.join(workspace, "live.json"), encoding="utf-8") as f:
                saved = json.load(f)
        except (OSError, ValueError):
            pass
        self.folder, self.project, self._backed = workspace, project, 0
        self.buses = Buses(lambda: {c["id"]: c.get("kind") for c in self.project["compositions"]}, saved)
        self.__dict__.pop("_csv", None)

    def check_update(self):
        from . import updater, __version__
        if getattr(self, "update", {}).get("state") == "installing":
            return
        before = dict(getattr(self, "update", {}))
        try:
            self.update = {**updater.check(), "state": "ready"}
        except Exception as e:   # (offline, no release yet: the app works the same; a found update stays offered)
            if not getattr(self, "update", {}).get("update"):
                self.update = {"current": __version__, "state": "error", "detail": str(e)[:120]}
            log.info("Update check failed: %s", e)
        if self.update != before:   # (every 30 s: only a real change goes out to the pages)
            self._bump()

    def watch_updates(self, every=30):
        """Checks now, then every 30 seconds: a release made while the app is open shows up straight away."""
        while True:
            self.check_update()
            time.sleep(every)

    def install_update(self):
        from . import updater
        info = getattr(self, "update", {})
        if not info.get("update"):
            raise ValueError("No update to install")
        if self.buses.state["program"]["on"]:
            raise ValueError("Something is on air: clear Program first, then update")
        def prog(done, total):
            p = int(done * 100 / total) if total else 0
            if p != self.update.get("progress"):
                self.update["progress"] = p
                self._bump()
        def go():
            self.update["state"] = "installing"
            self._bump()
            try:
                updater.install(info, prog)
            except Exception as e:
                self.update.update(state="error", detail=str(e)[:160])
                self._bump()
        threading.Thread(target=go, daemon=True).start()

    def _bump(self):
        with self.cond:
            self.version += 1
            self.cond.notify_all()

    def fonts(self):
        """[{"name", "url"}]: every font file in the library and the workspace, known by its file name."""
        out = []
        for base, prefix in ((self.library, "library"), (os.path.join(self.folder, "assets"), "assets")):
            for folder, _, files in os.walk(base) if base and os.path.isdir(base) else []:
                for f in files:
                    if f.lower().endswith((".otf", ".ttf", ".woff", ".woff2")):
                        rel = os.path.relpath(os.path.join(folder, f), base).replace(os.sep, "/")
                        out.append({"name": os.path.splitext(f)[0], "url": f"/{prefix}/{rel}"})
        return out

    def sources(self):
        """Data sources as tables: files re-read when they change, web ones from the fetch loop."""
        out, cache = {}, self.__dict__.setdefault("_csv", {})
        status = self.__dict__.setdefault("source_status", {})
        for src in self.project.get("sources") or []:
            name = src.get("name")
            if not name:
                continue
            if src.get("type", "file") != "file":
                got = getattr(self, "_remote", {}).get(src.get("id"))
                if got:
                    out[name] = got
                continue
            path = inside(self.folder, src.get("path", "")) or (src.get("path") if os.path.isabs(src.get("path") or "") else None)
            try:
                stamp = os.path.getmtime(path)
                if cache.get(path, (None,))[0] != stamp:
                    with open(path, "rb") as f:
                        cache[path] = (stamp, srcmod.parse(f.read(), path, src.get("tab", "")))
                    status[src.get("id") or name] = {"at": time.time(), "error": ""}
                out[name] = cache[path][1]
            except Exception as e:   # (locked, mid-sync or corrupt workbook: the last good table stays on air)
                status[src.get("id") or name] = {"at": time.time(), "error": str(e) or "Can't read the file"}
                if path in cache:
                    out[name] = cache[path][1]
        return out

    def _fetch_loop(self):
        """Web addresses and Google Sheets, each read every `refresh` seconds (2 at least)."""
        self._remote, due = {}, {}
        while True:
            time.sleep(0.5)
            for src in list(self.project.get("sources") or []):
                sid = src.get("id")
                if src.get("type", "file") == "file" or not sid or time.time() < due.get(sid, 0):
                    continue
                due[sid] = time.time() + refresh_secs(src.get("refresh"))
                try:
                    self.read_source(sid)
                except Exception as e:   # (one bad source must not stop the others for good)
                    log.warning("Source %s: %s", sid, e)

    def read_source(self, sid):
        src = next((x for x in self.project.get("sources") or [] if x.get("id") == sid), None)
        if not src:
            raise KeyError("No such source")
        status = self.__dict__.setdefault("source_status", {})
        if src.get("type", "file") == "file":
            with self.lock:
                self._reread_files()
                self.sources()
        else:
            try:
                rows = srcmod.fetch(src)
                status[sid] = {"at": time.time(), "error": ""}
                if self._remote.get(sid) != rows:
                    with self.lock:
                        self._remote[sid] = rows
                        self.changed()
            except Exception as e:   # (network, bad sheet: shown on the Data page, the old table stays)
                status[sid] = {"at": time.time(), "error": str(e)[:200] or "Couldn't read it"}

    def _reread_files(self):
        """Files read again on the next look, the last good tables kept (a locked workbook doesn't blank them)."""
        cache = self.__dict__.get("_csv", {})
        for k in cache:
            cache[k] = (None, cache[k][1])

    def ingest(self, name, body):
        """A game HUD (or anything) sends its live fields: {"fields": {...}, "score": [left, right]?}.
        They become the table <name>; a score goes into Global."""
        name = re.sub(r"[{}!]", "", str(name or "")).strip()[:60]
        if not name:
            raise ValueError("Needs a name")
        fields = body.get("fields") if isinstance(body.get("fields"), dict) else {k: v for k, v in body.items() if k not in ("score", "name")}
        hud = self.__dict__.setdefault("_hud", {})
        hud[name] = {"rows": srcmod.from_json(fields), "at": time.time()}
        sc = body.get("score")
        if isinstance(sc, (list, tuple)) and len(sc) == 2:
            g = self.project.setdefault("global", {})
            if [str((g.get("left") or {}).get("score", "")), str((g.get("right") or {}).get("score", ""))] != [str(sc[0]), str(sc[1])]:
                self.set_global({"left": {"score": sc[0]}, "right": {"score": sc[1]}})

    def set_sources(self, items):
        out = []
        for x in items if isinstance(items, list) else []:
            if not isinstance(x, dict):
                continue
            t = x.get("type") if x.get("type") in ("file", "url", "sheet") else "file"
            name = re.sub(r"[{}!]", "", str(x.get("name") or "Data")).strip()[:60] or "Data"
            out.append({"id": x.get("id") or "s" + os.urandom(4).hex(), "name": name, "type": t, "path": str(x.get("path", "")),
                        "url": str(x.get("url", "")), "tab": str(x.get("tab", "")), "refresh": refresh_secs(x.get("refresh"))})
        self.project["sources"] = out
        self._reread_files()
        self.save_project()

    def state(self):
        live = dict(self.buses.state)
        live["cut"] = self.buses.cut
        g = self.project.get("global") or {}
        teams = self.teams()
        found = {"Global": tables.global_rows(g), "Sponsors": tables.sponsor_rows(g), "Schedule": tables.schedule_rows(g, teams),
                 "Roster": tables.roster_rows(g, teams), "Standings": tables.standings_rows(g, teams), "Tournament": bracket.tournament_rows(g, teams),
                 "Stats": tables.stats_rows(), "Teams": tables.teams_rows(teams), "HUDs": [["Field", "Value"]]}
        found.update(self.sources())
        hud = getattr(self, "_hud", {})
        found["HUDs"] = [["Field", "Value"]] + [[n, "on" if time.time() - h["at"] < 10 else "off"] for n, h in hud.items()]
        for n, h in hud.items():
            found[n] = h["rows"]
        data = {"tables": found}
        return {"project": self.project, "live": live, "data": data, "fonts": self.fonts(), "now": time.time(),
                "outputs": dict(getattr(self, "outputs", {})), "teams": self.teams(), "ros": self.ros_state(), "playing": self.playing,
                "workspaces": self.workspaces(), "backups": self.backups(), "source_status": dict(getattr(self, "source_status", {})), "cam_status": dict(getattr(self, "cam_status", {})),
                "stream": self.stream.public() if hasattr(self, "stream") else None,
                "jobs": self.jobs.public() if hasattr(self, "jobs") else [],
                "obs": self.obs.public() if hasattr(self, "obs") else None,
                "update": {k: v for k, v in getattr(self, "update", {}).items() if k in ("current", "version", "update", "state", "detail", "progress")},
                "trash": [{"id": t["comp"]["id"], "name": t["comp"].get("name", ""), "at": t.get("at", 0)} for t in self.project.get("trash") or []], "app": {"version": __import__("sgfx").__version__, "port": self.port, "addresses": self.addresses(), "network": dict(self.net.cfg) if hasattr(self, "net") else {}}}

    def _obs_scene(self, scene):
        """OBS switched scene: the rules for it take graphics in / out."""
        with self.lock:
            self._obs_rules(scene)

    def _obs_rules(self, scene):
        ids = {c["id"] for c in self.comps()}
        hit = False
        for r in self.obs.cfg.get("rules") or []:
            if r.get("scene") == scene and r.get("comp") in ids:
                self.buses.program(r["comp"], r.get("action") != "out", self.transition(None))
                hit = True
        if hit:
            self.changed()

    def _on_air_scenes(self):
        """A graphic that just went on air with an OBS scene picked switches OBS to it."""
        now = set(self.buses.state["program"]["on"])
        new, self._was_on = now - getattr(self, "_was_on", set()), now
        if not new or not getattr(self, "obs", None) or not self.obs.ws:
            return
        for c in self.comps():
            if c["id"] in new and c.get("obs_scene") and c["obs_scene"] != self.obs.status.get("scene"):
                threading.Thread(target=lambda sc=c["obs_scene"]: self._safe(self.obs.request, "SetCurrentProgramScene", {"sceneName": sc}), daemon=True).start()
                break

    @staticmethod
    def _safe(fn, *a):
        try:
            fn(*a)
        except ValueError:
            pass

    def changed(self):
        with self.lock:
            self._on_air_scenes()
            path = os.path.join(self.folder, "live.json")
            with open(path + ".tmp", "w", encoding="utf-8") as f:
                json.dump(self.buses.saved(), f)
            os.replace(path + ".tmp", path)
        with self.cond:
            self.version += 1
            self.cond.notify_all()

    # --- saving: project.json written whole and atomically; a copy kept every 10 minutes while it changes ---
    BACKUP_EVERY, BACKUP_KEEP = 600, 50

    port = 7820

    def addresses(self):
        """This PC's network addresses (what other PCs use to reach the outputs)."""
        import socket
        found = set()
        try:
            for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
                ip = info[4][0]
                if not ip.startswith("127."):
                    found.add(ip)
        except OSError:
            pass
        return sorted(found)

    def save_project(self):
        with self.lock:
            self._save_project()

    def _save_project(self):
        text = json.dumps(self.project, indent=1)
        path = os.path.join(self.folder, "project.json")
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(path + ".tmp", path)
        now = time.time()
        if now - getattr(self, "_backed", 0) >= self.BACKUP_EVERY:
            self._backed = now
            folder = os.path.join(self.folder, "backups")
            os.makedirs(folder, exist_ok=True)
            with open(os.path.join(folder, time.strftime("%Y-%m-%d_%H-%M-%S") + ".json"), "w", encoding="utf-8") as f:
                f.write(text)
            for old in sorted(n for n in os.listdir(folder) if n.endswith(".json"))[:-self.BACKUP_KEEP]:
                os.remove(os.path.join(folder, old))

    MEDIA = {".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".gif": "image", ".svg": "image",
             ".mp4": "video", ".webm": "video", ".mov": "video", ".otf": "font", ".ttf": "font", ".woff": "font", ".woff2": "font",
             ".csv": "data", ".json": "data", ".tsv": "data", ".txt": "data", ".xlsx": "data"}

    def assets(self):
        """Every file under assets/: [{"path", "kind", "size"}]."""
        base, out = os.path.join(self.folder, "assets"), []
        for folder, dirs, files in os.walk(base):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            for f in sorted(files):
                kind = None if f.startswith(".") else self.MEDIA.get(os.path.splitext(f)[1].lower())
                if kind:
                    full = os.path.join(folder, f)
                    out.append({"path": "assets/" + os.path.relpath(full, base).replace(os.sep, "/"), "kind": kind, "size": os.path.getsize(full)})
        return out

    def upload(self, name, data, sub=""):
        """A file into assets/<sub>/ (a free name: -2, -3 ... when taken)."""
        stem, ext = os.path.splitext(os.path.basename(name.replace("\\", "/")))
        if ext.lower() not in self.MEDIA:
            raise ValueError("That kind of file isn't supported")
        stem = "".join(c if c.isalnum() or c in " -_.()" else "_" for c in stem).strip() or "file"
        folder = inside(os.path.join(self.folder, "assets"), sub) if sub else os.path.join(self.folder, "assets")
        if not folder:
            raise ValueError("Bad folder")
        os.makedirs(folder, exist_ok=True)
        n, cand = 1, stem + ext.lower()
        while os.path.exists(os.path.join(folder, cand)):
            n += 1
            cand = f"{stem}-{n}{ext.lower()}"
        with open(os.path.join(folder, cand), "wb") as f:
            f.write(data)
        rel = "assets/" + os.path.relpath(os.path.join(folder, cand), os.path.join(self.folder, "assets")).replace(os.sep, "/")
        self.changed()
        return rel

    def convert_upload(self, name, data, sub="", fps=30):
        """A video to make web-ready (or a zip of PNG frames): converted in the background into assets/<sub>/."""
        stem, ext = os.path.splitext(os.path.basename(name.replace("\\", "/")))
        ext = ext.lower()
        stem = "".join(c if c.isalnum() or c in " -_.()" else "_" for c in stem).strip() or "video"
        inbox = os.path.join(self.folder, ".incoming")
        os.makedirs(inbox, exist_ok=True)
        src = os.path.join(inbox, os.urandom(6).hex() + ext)
        with open(src, "wb") as f:
            f.write(data)
        folder = inside(os.path.join(self.folder, "assets"), sub or "video")
        if not folder:
            raise ValueError("Bad folder")
        os.makedirs(folder, exist_ok=True)
        pending = self.__dict__.setdefault("_converting", set())
        base, n = os.path.join(folder, stem), 2
        while os.path.normcase(base) in pending or any(os.path.exists(base + e) for e in (".webm", ".mp4")):
            base, n = os.path.join(folder, f"{stem}-{n}"), n + 1
        pending.add(os.path.normcase(base))   # (taken until its job ends: ffmpeg makes the file only later)

        def run(progress):
            try:
                out = convert.png_sequence(src, base, fps, progress) if ext == ".zip" else convert.video(src, base, progress)
            finally:
                pending.discard(os.path.normcase(base))
                try:
                    os.remove(src)
                except OSError:
                    pass
            self.changed()
            return "assets/" + os.path.relpath(out, os.path.join(self.folder, "assets")).replace(os.sep, "/")
        return self.jobs.add(name, run)

    def pack_export(self, ids=None):
        with self.lock:   # (only the copy: zipping big videos must not hold up a TAKE)
            comps = copy.deepcopy([c for c in self.comps() if not ids or c["id"] in ids])
            name = comps[0]["name"] if len(comps) == 1 else self.project.get("name") or "Graphics"
            srcs = copy.deepcopy(self.project.get("sources") or [] if not ids else [])
            folder = self.folder
        return name, pack.export(folder, name, comps, srcs)

    BUILTIN_FONTS = [("Inter", "Inter.ttf", "100 900"), ("Anton", "Anton-Regular.ttf", ""), ("Bebas Neue", "BebasNeue.ttf", ""), ("Permanent Marker", "PermanentMarker-Regular.ttf", ""),
                     ("Montserrat", "Montserrat-400.woff2", "400"), ("Montserrat", "Montserrat-500.woff2", "500"), ("Montserrat", "Montserrat-700.woff2", "700"),
                     ("Montserrat", "Montserrat-800.woff2", "800"), ("Montserrat", "Montserrat-900.woff2", "900"), ("Barlow Condensed", "BarlowCondensed-500.woff2", "500"),
                     ("Barlow Condensed", "BarlowCondensed-600.woff2", "600"), ("Barlow Condensed", "BarlowCondensed-700.woff2", "700"),
                     ("Vazirmatn", "Vazirmatn-700.woff2", "700"), ("Vazirmatn", "Vazirmatn-900.woff2", "900")]

    def html_export(self, ids=None):
        """A zip that plays the graphics without the engine: index.html (play / stop / next / update / remove for
        CasparCG and SPX), the player, the files and fonts they use, and a snapshot of the data."""
        import io
        import zipfile
        with self.lock:   # (only the copy: zipping big videos must not hold up a TAKE)
            comps = copy.deepcopy([c for c in self.comps() if not ids or c["id"] in ids])
            if not comps:
                raise KeyError("No graphics picked")
            data = copy.deepcopy(self.state()["data"])
            transitions = copy.deepcopy(self.project.get("transitions") or [])
            folder, found = self.folder, self.fonts()
        used = {l.get("font", "").lower() for c in comps for l in c.get("layers") or []}
        fonts = [{"name": n, "url": "fonts/" + f, "weight": w} for n, f, w in self.BUILTIN_FONTS]
        files = {}
        for f in found:
            if f["name"].lower() in used:
                src = inside(self.library, f["url"][len("/library/"):]) if f["url"].startswith("/library/") and self.library else inside(folder, f["url"][1:])
                if src and os.path.isfile(src):
                    files["fonts/lib/" + os.path.basename(src)] = src
                    fonts.append({"name": f["name"], "url": "fonts/lib/" + os.path.basename(src)})
        for p in pack._paths([comps, data["tables"]], set()):   # (the graphics' files and the data's: logos, sponsors)
            full = os.path.join(folder, p)
            if os.path.isfile(full):
                files[p] = full
        snap = {"project": {"compositions": comps, "transitions": transitions}, "data": data, "fonts": fonts}
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(os.path.join(WEB, "player.html"), "index.html")
            z.writestr("state.json", json.dumps(snap))
            for sub in ("engine", "vendor", "placeholders", "loops"):
                for folder, _, names in os.walk(os.path.join(WEB, sub)):
                    for n in names:
                        full = os.path.join(folder, n)
                        z.write(full, os.path.relpath(full, WEB).replace(os.sep, "/"))
            for _, f, _ in self.BUILTIN_FONTS:
                z.write(os.path.join(WEB, "fonts", f), "fonts/" + f)
            for arc, full in files.items():
                z.write(full, arc)
        name = comps[0]["name"] if len(comps) == 1 else self.project.get("name") or "graphics"
        return name, buf.getvalue()

    def pack_import(self, data):
        with self.import_lock:
            return self._pack_import(data)

    def _pack_import(self, data):
        with self.lock:
            folder, ids, names = self.folder, {c["id"] for c in self.comps()}, [c.get("name", "") for c in self.comps()]
        comps, srcs = pack.import_pack(data, folder, ids, names)   # (unzipping outside the lock: a TAKE doesn't wait for it)
        with self.lock:
            if self.folder != folder:
                raise ValueError("The workspace changed while importing: import it again")
            have = {x.get("name") for x in self.project.get("sources") or []}
            # (through set_sources: an imported refresh like "auto" is cleaned like a typed one)
            self.set_sources((self.project.get("sources") or []) + [x for x in srcs if x.get("name") not in have])
            for c in comps:
                self.comps().append(c)
            self.save_project()
        self.changed()
        return comps

    def import_psd(self, name, data):
        """A Photoshop file becomes a new graphic; its pictures go in assets/<file name>/."""
        try:
            from . import psd
        except ImportError:
            raise ValueError("PSD import needs psd-tools (pip install psd-tools)")
        stem = os.path.splitext(os.path.basename(name.replace("\\", "/")))[0]
        folder = re.sub(r"[^\w ()-]+", "_", stem).strip() or "PSD"
        def save(fname, png):
            with self.lock:   # (the lock per picture only: the layers' render must not hold up a TAKE)
                return self.upload(fname, png, folder)
        try:
            comp = psd.convert(data, stem, save)
        except ImportError:
            raise ValueError("PSD import needs psd-tools (pip install psd-tools)")
        except Exception as e:
            raise ValueError(f"Couldn't read that Photoshop file ({e.__class__.__name__})")
        with self.lock:
            return self.comp_put(comp)

    def asset_remove(self, rel):
        """Out of assets/ into .trash/ (kept, not deleted)."""
        rel = str(rel or "")
        # (checked against assets/ itself: "assets/../project.json" is refused)
        path = inside(os.path.join(self.folder, "assets"), rel[len("assets/"):]) if rel.startswith("assets/") else None
        if not path or not os.path.isfile(path):
            raise KeyError("No such file")
        dst = os.path.join(self.folder, ".trash", time.strftime("%Y%m%d-%H%M%S-") + os.path.basename(path))
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        os.replace(path, dst)

    # --- teams: one list for every workspace (library/teams.json) ---
    def teams(self):
        try:
            with open(os.path.join(self.library or self.folder, "teams.json"), encoding="utf-8") as f:
                return [t for t in json.load(f).get("teams", []) if isinstance(t, dict)]
        except (OSError, ValueError):
            return []

    def set_teams(self, teams):
        clean = []
        for t in teams if isinstance(teams, list) else []:
            if isinstance(t, dict) and (t.get("name") or "").strip():
                players = [{k: str(p.get(k, ""))[:120] for k in ("tag", "name", "id", "country", "flag", "photo")}
                           for p in t.get("players") or [] if isinstance(p, dict)]
                clean.append({"id": t.get("id") or "tm" + os.urandom(4).hex(), "name": t["name"].strip()[:80],
                              "short": str(t.get("short", ""))[:12], "logo": str(t.get("logo", "")), "color": str(t.get("color", "")),
                              "game": str(t.get("game", "")), "players": players})
        base = self.library or self.folder
        os.makedirs(base, exist_ok=True)
        with open(os.path.join(base, "teams.json.tmp"), "w", encoding="utf-8") as f:
            json.dump({"teams": clean}, f, indent=1)
        os.replace(os.path.join(base, "teams.json.tmp"), os.path.join(base, "teams.json"))
        with self.cond:
            self.version += 1
            self.cond.notify_all()

    # --- workspaces: sibling folders of the open one, each with its own project.json ---
    def _root(self):
        return os.path.dirname(os.path.abspath(self.folder))

    def workspaces(self):
        out = []
        root = self._root()
        for name in sorted(os.listdir(root)):
            path = os.path.join(root, name)
            try:
                with open(os.path.join(path, "project.json"), encoding="utf-8") as f:
                    p = json.load(f)
            except (OSError, ValueError):
                continue
            out.append({"folder": name, "name": p.get("name") or name, "graphics": len(p.get("compositions") or []),
                        "changed": os.path.getmtime(os.path.join(path, "project.json")),
                        "open": os.path.abspath(path) == os.path.abspath(self.folder)})
        return out

    def _ws_path(self, folder):
        name = os.path.basename(str(folder or ""))
        path = os.path.join(self._root(), name)
        if not name or name.startswith(".") or not os.path.isfile(os.path.join(path, "project.json")):
            raise KeyError("No such workspace")
        return path

    def _free(self, name):
        base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "workspace"
        slug, n = base, 2
        while os.path.exists(os.path.join(self._root(), slug)):
            slug, n = f"{base}-{n}", n + 1
        return os.path.join(self._root(), slug)

    def ws_open(self, folder):
        self.playlist_stop(quiet=True)
        self._load(self._ws_path(folder))

    def ws_new(self, name):
        name = (str(name or "").strip() or "New workspace")[:80]
        path = self._free(name)
        os.makedirs(os.path.join(path, "assets"))
        blank = {"name": name, "compositions": [], "transitions": [{"id": "cut", "name": "Cut", "type": "cut", "enabled": True},
                 {"id": "fade", "name": "Fade", "type": "fade", "dur": 500, "enabled": True}], "default_transition": "fade",
                 "sources": [], "global": {}, "playlists": []}
        with open(os.path.join(path, "project.json"), "w", encoding="utf-8") as f:
            json.dump(blank, f, indent=1)
        return os.path.basename(path)

    def ws_copy(self, folder):
        import shutil
        src = self._ws_path(folder)
        with open(os.path.join(src, "project.json"), encoding="utf-8") as f:
            name = (json.load(f).get("name") or "Workspace") + " copy"
        dst = self._free(name)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("backups", "live.json"))
        with open(os.path.join(dst, "project.json"), encoding="utf-8") as f:
            p = json.load(f)
        p["name"] = name
        with open(os.path.join(dst, "project.json"), "w", encoding="utf-8") as f:
            json.dump(p, f, indent=1)
        return os.path.basename(dst)

    def ws_rename(self, folder, name):
        path = self._ws_path(folder)
        if os.path.abspath(path) == os.path.abspath(self.folder):
            self.project["name"] = str(name)[:80]
            return self.save_project()
        with open(os.path.join(path, "project.json"), encoding="utf-8") as f:
            p = json.load(f)
        p["name"] = str(name)[:80]
        with open(os.path.join(path, "project.json"), "w", encoding="utf-8") as f:
            json.dump(p, f, indent=1)

    def ws_remove(self, folder):
        """Moved to <root>/.removed (kept, not deleted). The open workspace can't be removed."""
        path = self._ws_path(folder)
        if os.path.abspath(path) == os.path.abspath(self.folder):
            raise ValueError("Open another workspace first")
        bin_ = os.path.join(self._root(), ".removed")
        os.makedirs(bin_, exist_ok=True)
        os.replace(path, os.path.join(bin_, os.path.basename(path) + time.strftime("-%Y%m%d-%H%M%S")))

    def timer(self, body):
        """The Global timer: secs = time counted so far, started = when it began running (0: stopped), from = where Reset goes."""
        t = dict((self.project.get("global") or {}).get("timer") or {})
        t.setdefault("secs", 0); t.setdefault("from", 0); t.setdefault("down", False); t.setdefault("started", 0)
        now, a = time.time(), body.get("action")
        ran = max(0.0, now - t["started"]) if t["started"] else 0.0
        current = max(0.0, t["secs"] - ran) if t["down"] else t["secs"] + ran
        if a == "start" and not t["started"]:
            t["started"] = now
        elif a == "pause" and t["started"]:
            t["secs"], t["started"] = round(current, 3), 0
        elif a == "reset":
            t["secs"], t["started"] = t["from"], 0
        elif a == "down":
            t["secs"], t["down"] = round(current, 3), bool(body.get("down"))
            t["started"] = now if t["started"] else 0
        elif a == "from":
            parts = [int(p) for p in re.findall(r"\d+", str(body.get("from", "")))][-3:] or [0]
            secs = 0
            for p in parts:
                secs = secs * 60 + p
            t["from"] = secs
            if not t["started"]:
                t["secs"] = secs
        else:
            raise ValueError("start, pause, reset, down or from")
        self.set_global({"timer": t})

    # --- cameras: VDO.Ninja guests (each slot: a stream id; the guest pushes, the outputs view) ---
    LOOK_KEYS = ("bright", "contrast", "sat", "warm")

    def set_cams(self, cams):
        out = []
        for c in cams if isinstance(cams, list) else []:
            if not isinstance(c, dict):
                continue
            link = str(c.get("link") or "").strip()
            if link and not re.match(r"https://", link):
                raise ValueError("A camera link starts with https://")
            n = lambda k, d, lo, hi: max(lo, min(hi, float(c.get(k) if c.get(k) not in (None, "") else d)))
            out.append({"id": c.get("id") or "cam" + os.urandom(3).hex(), "name": str(c.get("name") or "Camera")[:40],
                        "stream": re.sub(r"[^A-Za-z0-9_]", "", str(c.get("stream") or os.urandom(5).hex()))[:40], "link": link,
                        "bright": n("bright", 100, 0, 200), "contrast": n("contrast", 100, 0, 200), "sat": n("sat", 100, 0, 200), "warm": n("warm", 0, -100, 100),
                        "zoom": n("zoom", 1, 1, 4), "x": n("x", 0, -100, 100), "y": n("y", 0, -100, 100), "mirror": bool(c.get("mirror"))})
        self.project["cams"] = out
        self.project.setdefault("cam_password", os.urandom(6).hex())
        self.save_project()

    def cam_look(self, body):
        """Looks: every camera's colour settings under a name; recall puts them back."""
        looks = self.project.setdefault("cam_looks", [])
        name = str(body.get("name") or "").strip()[:40]
        if body.get("action") == "save":
            if not name:
                raise ValueError("Name the look")
            looks[:] = [l for l in looks if l["name"] != name] + [{"name": name, "cams": {c["id"]: {k: c[k] for k in self.LOOK_KEYS} for c in self.project.get("cams") or []}}]
        elif body.get("action") == "delete":
            looks[:] = [l for l in looks if l["name"] != name]
        elif body.get("action") == "recall":
            look = next((l for l in looks if l["name"] == name), None)
            if not look:
                raise KeyError("No such look")
            for c in self.project.get("cams") or []:
                c.update(look["cams"].get(c["id"], {}))
        else:
            raise ValueError("save, recall or delete")
        self.save_project()

    STAND_INS = {"inter", "montserrat", "barlow condensed", "bebas neue", "anton", "permanent marker", "vazirmatn"}

    def show_check(self):
        """What could go wrong on air, worst first: [{level: "stop" | "warn" | "ok", text, page}]."""
        out = []
        add = lambda level, text, page="": out.append({"level": level, "text": text, "page": page})
        missing = set()
        for c in self.comps():
            for p in sorted(pack._paths(c, set())):
                if not os.path.isfile(os.path.join(self.folder, p)):
                    missing.add((c.get("name", ""), p))
        for name, p in sorted(missing)[:12]:
            add("stop", f"\"{name}\" uses {p}, which isn't in the workspace", "assets")
        have = {f["name"].lower() for f in self.fonts()} | self.STAND_INS
        fonts = sorted({l.get("font") for c in self.comps() for l in c.get("layers") or [] if l.get("font") and l["font"].lower() not in have})
        if fonts:
            add("warn", "Fonts not added (similar ones stand in): " + ", ".join(fonts), "assets")
        for t in self.project.get("transitions") or []:
            if t.get("type") == "stinger" and t.get("enabled", True) and not os.path.isfile(os.path.join(self.folder, t.get("src") or "-")):
                add("stop", f'The stinger "{t.get("name")}" has no video', "transitions")
        for sid, st in getattr(self, "source_status", {}).items():
            if st.get("error"):
                name = next((x.get("name") for x in self.project.get("sources") or [] if x.get("id") == sid), sid)
                add("warn", f"Data \"{name}\" can't be read: {st['error']}", "data")
        outs = getattr(self, "outputs", {})
        add("ok" if outs.get("program") else "warn", "Program is shown in OBS / vMix" if outs.get("program") else "Program isn't open anywhere (add the Program link as a browser source)", "outputs")
        if self.obs.cfg.get("on") and self.obs.status.get("state") != "on":
            add("warn", "OBS is turned on here but not connected", "outputs")
        if self.stream.cfg.get("on") and self.stream.status.get("state") == "error":
            add("stop", "Multistream: " + self.stream.status.get("detail", ""), "stream")
        status = getattr(self, "cam_status", {})
        for c in self.project.get("cams") or []:
            st = (status.get(c["id"]) or {}).get("state")
            if st != "live":
                add("stop" if st == "lost" else "warn", f"Camera \"{c['name']}\": " + ("connection lost" if st == "lost" else "the guest isn't connected yet (or the control page isn't open)"), "cams")
        g = self.project.get("global") or {}
        for side in ("left", "right"):
            if not (g.get(side) or {}).get("name"):
                add("warn", f"No {side} team name in Global", "global")
        errs = logs.errors_since(1800)
        if errs:
            add("warn", f"{len(errs)} error{'s' if len(errs) != 1 else ''} in the last 30 minutes (newest: {errs[-1][:120]}). Open the Error log for details", "log")
        if not any(o["level"] != "ok" for o in out):
            add("ok", "Nothing to fix", "")
        rank = {"stop": 0, "warn": 1, "ok": 2}
        return sorted(out, key=lambda o: rank[o["level"]])

    # --- backups of the open workspace ---
    def backups(self):
        folder = os.path.join(self.folder, "backups")
        names = sorted((n for n in os.listdir(folder) if n.endswith(".json")), reverse=True) if os.path.isdir(folder) else []
        return [{"name": n, "size": os.path.getsize(os.path.join(folder, n))} for n in names]

    def backup_restore(self, name):
        path = os.path.join(self.folder, "backups", os.path.basename(str(name or "")))
        with open(path, encoding="utf-8") as f:
            restored = json.load(f)
        if not isinstance(restored, dict) or "compositions" not in restored:
            raise ValueError("Not a backup")
        self._backed = 0
        self.save_project()          # (what's there now is kept as a backup first)
        self.project = restored
        swap_placeholders(self.project)
        self._backed = time.time()
        self.save_project()

    # --- run of show (library/run-of-show.json, for every workspace) ---
    def _ros_path(self):
        return os.path.join(self.library or self.folder, "run-of-show.json")

    def ros(self):
        if not hasattr(self, "_ros"):
            try:
                with open(self._ros_path(), encoding="utf-8") as f:
                    self._ros = json.load(f)
            except (OSError, ValueError):
                self._ros = {}
            self._ros.setdefault("templates", [])
            self._ros.setdefault("show", None)
            self._ros.setdefault("auto", True)
        return self._ros

    def _ros_save(self):
        base = self.library or self.folder
        os.makedirs(base, exist_ok=True)
        with open(self._ros_path() + ".tmp", "w", encoding="utf-8") as f:
            json.dump(self.ros(), f, indent=1)
        os.replace(self._ros_path() + ".tmp", self._ros_path())

    def _scores(self):
        g = self.project.get("global") or {}
        num = lambda v: int(float(v)) if str(v).strip().replace(".", "", 1).isdigit() else 0
        return num((g.get("left") or {}).get("score") or 0), num((g.get("right") or {}).get("score") or 0)

    def _show_done(self):
        show = self.ros().get("show") or {}
        return bool(show.get("segments")) and show.get("current", -1) >= len(show["segments"])

    def _next_match(self):
        """The next Schedule match; once a show has run to its end, the one after it (a LAN day's second match)."""
        skip = set(self.ros().get("finished") or [])
        if self._show_done():
            skip.add(self.ros()["show"].get("match_key"))
        return rosmod.next_match((self.project.get("global") or {}).get("schedule"), skip=skip)

    def _ros_replace(self, show):
        """A new show; a finished one's match is remembered (the next match stays next after it's gone)."""
        r = self.ros()
        if self._show_done():
            r["finished"] = ((r.get("finished") or []) + [r["show"].get("match_key")])[-50:]
        r["show"] = show
        self._ros_save()

    def ros_auto(self):
        """Auto-apply: tonight's next Schedule match builds the show from the template for its game."""
        r = self.ros()
        if not r.get("auto"):
            return
        m = self._next_match()
        show = r.get("show") or {}
        done = self._show_done()
        if not m or show.get("match_key") == rosmod.match_key(m) or (show.get("current", -1) >= 0 and not done):
            return
        # (the match was edited before the show started: a hand-picked template stays, if it's for this game)
        t = next((x for x in r["templates"] if x.get("id") == show.get("template_id")), None) if show.get("picked") and not done else None
        if t and (t.get("game") or "") not in ("", rosmod.game_key(m.get("game", ""))):
            t = None
        picked = bool(t)
        t = t or rosmod.pick_template(r["templates"], m, (self.project.get("global") or {}).get("best_of"))
        if t:
            self._ros_replace(dict(rosmod.build(t, dict(m, best_of=t.get("best_of"))), picked=picked))

    def ros_state(self):
        self.ros_auto()
        r = self.ros()
        show = r.get("show")
        left, right = self._scores()
        return {"templates": r["templates"], "auto": r.get("auto", True), "show": show,
                "next_match": self._next_match(),
                "games": [[k, n] for k, n, _ in rosmod.GAMES],
                "timeline": rosmod.timeline(show, left=left, right=right) if show else []}

    def ros_put(self, body):
        r = self.ros()
        if "templates" in body:
            r["templates"] = [t for t in body["templates"] if isinstance(t, dict) and t.get("id")]
        if "auto" in body:
            r["auto"] = bool(body["auto"])
        self._ros_save()

    def ros_build(self, tid, match=None):
        r = self.ros()
        t = next((t for t in r["templates"] if t.get("id") == tid), None)
        if not t:
            raise KeyError("No such template")
        m = match or self._next_match() or {}
        self._ros_replace(dict(rosmod.build(t, dict(m, best_of=m.get("best_of") or t.get("best_of"))), picked=True))

    def ros_step(self, by):
        show = self.ros().get("show")
        if not show:
            return
        rosmod.step(show, by, skip=rosmod.dropped(show, *self._scores()))
        i = show["current"]
        if by > 0 and 0 <= i < len(show["segments"]):
            # the new segment's graphics go to Preview, ready to take
            # (by name; a short name picks the first graphic it starts, e.g. "Scorebug" -> "Scorebug & footer")
            for g in show["segments"][i].get("graphics") or []:
                g = g.strip().lower()
                named = [c for c in self.comps() if (c.get("name") or "").strip().lower() == g] or                     [c for c in self.comps() if (c.get("name") or "").strip().lower().startswith(g)][:1]
                for c in named:
                    self.buses.cue(c["id"], True)
        self._ros_save()

    # --- playlists: graphics on Program in turn, each for its seconds ---
    def playlist_play(self, pid):
        pl = next((p for p in self.project.get("playlists") or [] if p.get("id") == pid), None)
        if not pl or not pl.get("items"):
            raise KeyError("No such playlist")
        old = self.playing
        self.playlist_stop(quiet=True)
        # (the old graphic is handed on: the first step takes it off, unless it's the new first item, so no flicker)
        self.playing = {"id": pid, "i": -1, "until": 0, "on": (old or {}).get("on")}

    def _playlist_items(self, pid):
        pl = next((x for x in self.project.get("playlists") or [] if x.get("id") == pid), None)
        ids = {c.get("id") for c in self.comps()}
        return pl, [it for it in (pl or {}).get("items") or [] if it.get("comp") in ids]

    def playlist_stop(self, quiet=False):
        p, self.playing = self.playing, None
        # (by the id it put up, not its place in the list: the list may have been edited since)
        if p and not quiet and p.get("on") in self.buses.state["program"]["on"]:
            self.buses.program(p["on"], False, self.transition(None))

    def _playlist_loop(self):
        while True:
            time.sleep(0.25)
            p = self.playing
            if not p or time.time() < p["until"]:
                continue
            try:
                with self.lock:
                    self._playlist_next(p)
            except Exception as e:   # (a bad item must not stop playlists for good)
                log.exception("Playlist stopped: %s", e)
                self.playing = None

    def _playlist_next(self, p):
        if self.playing is not p:
            return
        pl, items = self._playlist_items(p["id"])
        nxt = p["i"] + 1
        if not items or (nxt >= len(items) and not pl.get("loop")):
            self.playlist_stop()   # (also when it was deleted or emptied: its graphic comes off)
            self.changed()
            return
        nxt %= len(items)
        tr = self.transition(None)
        if p.get("on") in self.buses.state["program"]["on"] and p["on"] != items[nxt]["comp"]:
            self.buses.program(p["on"], False, tr)
        self.buses.program(items[nxt]["comp"], True, tr)
        p["i"], p["on"], p["until"] = nxt, items[nxt]["comp"], time.time() + max(1.0, float(items[nxt].get("secs") or 5))
        self.changed()

    def set_playlists(self, pls):
        out = []
        for p in pls if isinstance(pls, list) else []:
            if isinstance(p, dict):
                out.append({"id": p.get("id") or "p" + os.urandom(4).hex(), "name": str(p.get("name", "Playlist"))[:80], "loop": bool(p.get("loop")),
                            "items": [{"comp": str(i.get("comp")), "secs": float(i.get("secs") or 5)} for i in p.get("items") or [] if isinstance(i, dict)]})
        self.project["playlists"] = out
        self.save_project()

    # --- graphics (compositions) ---
    def comps(self):
        return self.project.setdefault("compositions", [])

    def comp_put(self, comp):
        """Save a graphic (replaced whole, kept where it is; new ones go at the end)."""
        if not isinstance(comp, dict) or not isinstance(comp.get("layers"), list):
            raise ValueError("Not a graphic")
        comp.setdefault("id", "c" + os.urandom(4).hex())
        comp["name"] = str(comp.get("name") or "New graphic")[:80]
        cs = self.comps()
        i = next((i for i, c in enumerate(cs) if c["id"] == comp["id"]), None)
        if i is None:
            cs.append(comp)
        else:
            cs[i] = comp
        self.save_project()
        return comp

    def comp_delete(self, cid):
        """Off the list into the bin (the last 30, newest first), and off the buses."""
        cs = self.comps()
        i = next((i for i, c in enumerate(cs) if c["id"] == cid), None)
        if i is None:
            raise KeyError("No such graphic")
        comp = cs.pop(i)
        trash = self.project.setdefault("trash", [])
        trash.insert(0, {"comp": comp, "at": time.time(), "index": i})
        del trash[30:]
        self.buses.forget(cid)
        self.save_project()

    def comp_restore(self, cid=None):
        trash = self.project.get("trash") or []
        k = next((k for k, t in enumerate(trash) if cid in (None, t["comp"]["id"])), None)
        if k is None:
            raise KeyError("Nothing to bring back")
        t = trash.pop(k)
        self.comps().insert(min(t.get("index", 0), len(self.comps())), t["comp"])
        self.save_project()
        return t["comp"]

    def comp_order(self, ids):
        by = {c["id"]: c for c in self.comps()}
        if sorted(ids) != sorted(by):
            raise ValueError("The list doesn't match")
        self.project["compositions"] = [by[i] for i in ids]
        self.save_project()

    def set_global(self, change):
        """Merge a change into the Global settings (dicts merge one level, the rest replaces)."""
        if not isinstance(change, dict):
            raise ValueError("Global change must be a set of fields")
        g = self.project.setdefault("global", {})
        for k, v in change.items():   # (a part that is a set of fields or a list stays one: a bad send can't break every page)
            kind = dict if isinstance(g.get(k), dict) or k in self.GLOBAL_DICTS else list if isinstance(g.get(k), list) or k in self.GLOBAL_LISTS else None
            if kind and not isinstance(v, kind):
                raise ValueError(f"Global {k} must be a {'set of fields' if kind is dict else 'list'}")
        for k, v in change.items():
            g[k] = {**g[k], **v} if isinstance(v, dict) and isinstance(g.get(k), dict) else v
        self.save_project()

    GLOBAL_DICTS = ("left", "right", "bgloop", "tournament", "schedule", "standings", "clock", "timer", "caster", "pictures")
    GLOBAL_LISTS = ("custom", "sponsors", "ticker", "outputs_on")

    TYPES = ("cut", "fade", "animate", "dip", "wipe", "stinger", "delay", "merge")

    def set_transitions(self, items, default=None):
        clean = []
        for t in items if isinstance(items, list) else []:
            if isinstance(t, dict) and t.get("type") in self.TYPES:
                t = dict(t)
                t.setdefault("id", "t" + os.urandom(4).hex())
                t.setdefault("name", t["type"].title())
                clean.append(t)
        if not clean:
            raise ValueError("Keep at least one transition")
        self.project["transitions"] = clean
        ids = [t["id"] for t in clean]
        if default in ids or default == "animate":
            self.project["default_transition"] = default
        elif self.project.get("default_transition") not in ids + ["animate"]:
            self.project["default_transition"] = ids[0]
        self.save_project()

    # --- outputs watching: {"program": 2, "comp:<id>": 1} while connected ---
    def output_seen(self, kind, n):
        with self.cond:
            outs = self.__dict__.setdefault("outputs", {})
            outs[kind] = outs.get(kind, 0) + n
            if outs[kind] <= 0:
                del outs[kind]
            self.version += 1
            self.cond.notify_all()

    def transition(self, tid):
        ts = self.project.get("transitions") or []
        if tid == "animate":   # (TAKE with no chip lit: each graphic's own In / Out animations)
            return next((t for t in ts if t.get("type") == "animate"), {"id": "animate", "type": "animate"})
        tid = tid or self.project.get("default_transition")
        return next((t for t in ts if t.get("id") == tid), {"id": "cut", "type": "cut"})

    def act(self, path, body):
        b, cid, result = self.buses, body.get("id"), None
        if path == "/api/cue":
            b.cue(cid, bool(body.get("on", True)))
        elif path == "/api/take":
            b.take(self.transition(body.get("transition")))
        elif path == "/api/program":
            b.program(cid, bool(body.get("on")), self.transition(body.get("transition")) if body.get("transition") else None)
        elif path == "/api/clear":
            b.clear(body.get("bus", "program"))
        elif path == "/api/undo":
            b.undo()
        elif path == "/api/values":
            b.set_values(cid, body.get("values") or {}, body.get("bus", "preview"))
        elif path == "/api/send":
            b.send_values(cid)
        elif path == "/api/global":
            self.set_global(body.get("global") or {})
        elif path == "/api/comp":
            result = {"comp": self.comp_put(body.get("comp"))}
        elif path == "/api/comp/delete":
            self.comp_delete(body.get("id"))
        elif path == "/api/comp/restore":
            result = {"comp": self.comp_restore(body.get("id"))}
        elif path == "/api/comp/order":
            self.comp_order(body.get("ids") or [])
        elif path == "/api/teams":
            self.set_teams(body.get("teams"))
        elif path == "/api/teams/import":
            merged, added, updated = tables.teams_from_csv(str(body.get("csv") or ""), self.teams())
            self.set_teams(merged)
            result = {"added": added, "updated": updated}
        elif path == "/api/workspace/open":
            self.ws_open(body.get("folder"))
        elif path == "/api/workspace/new":
            result = {"folder": self.ws_new(body.get("name"))}
        elif path == "/api/workspace/copy":
            result = {"folder": self.ws_copy(body.get("folder"))}
        elif path == "/api/workspace/rename":
            self.ws_rename(body.get("folder"), body.get("name"))
        elif path == "/api/workspace/remove":
            self.ws_remove(body.get("folder"))
        elif path == "/api/part/make":
            part = partsmod.make(body.get("name"), body.get("layers") or [])
            self.project.setdefault("parts", []).append(part)
            self.save_project()
            result = {"part": part}
        elif path == "/api/part/update":
            result = {"copies": partsmod.update(self.project, body.get("id"), body.get("comp"), body.get("inst"))}
            self.save_project()
        elif path == "/api/parts":
            self.project["parts"] = [p for p in body.get("parts") or [] if isinstance(p, dict) and p.get("id") and isinstance(p.get("layers"), list)]
            self.save_project()
        elif path == "/api/timer":
            self.timer(body)
        elif path == "/api/cams":
            self.set_cams(body.get("cams"))
        elif path == "/api/cams/status":
            self.__dict__.setdefault("cam_status", {})[str(body.get("id"))] = {"state": str(body.get("state")), "at": time.time()}
        elif path == "/api/cams/look":
            self.cam_look(body)
        elif path == "/api/log":
            logs.page_error(body)
        elif path == "/api/log/read":
            result = {"text": logs.tail(400), "file": logs.path or ""}
        elif path == "/api/check":
            result = {"items": self.show_check()}
        elif path == "/api/backup/restore":
            self.backup_restore(body.get("name"))
        elif path == "/api/asset/remove":
            self.asset_remove(body.get("path"))
        elif path.startswith("/api/ingest/"):
            self.ingest(unquote(path[len("/api/ingest/"):]), body)
        elif path == "/api/stream/set":
            self.stream.set(body)
        elif path == "/api/stream/on":
            self.stream.turn(body.get("on"))
        elif path == "/api/stinger/cut":
            full = inside(self.folder, body.get("src", ""))
            if not full or not os.path.isfile(full):
                raise KeyError("No such video")
            ms = convert.stinger_cut(full)
            if ms is None:
                raise ValueError("It never covers the whole screen (or has no see-through parts): set the point by hand")
            result = {"cut": ms}
        elif path == "/api/network":
            self.net.save(body)
            if "network" in body:
                self.stream.relisten()   # (the RTMP relay listens on this PC only unless sharing is on)
        elif path == "/api/network/scan":
            result = {"engines": self.net.scan()}
        elif path == "/api/obs":
            self.obs.save(body)
        elif path == "/api/obs/scene":
            self.obs.request("SetCurrentProgramScene", {"sceneName": str(body.get("scene", ""))})
        elif path == "/api/obs/add":
            host = "127.0.0.1" if self.obs.cfg["host"] in ("127.0.0.1", "localhost") else (self.net.cfg.get("bind") or (self.addresses() or ["127.0.0.1"])[0])
            base = f"http://{host}:{self.port}/output"
            want = [("StandBy GFX Program", base)] + ([("StandBy GFX Preview", base + "?bus=preview")] if body.get("preview") else [])
            result = {"added": self.obs.add_sources(body.get("scene") or self.obs.status.get("scene") or "StandBy GFX", want)}
        elif path == "/api/update/install":
            self.install_update()
        elif path == "/api/sources":
            self.set_sources(body.get("sources"))
        elif path == "/api/source/read":
            self.read_source(body.get("id"))
        elif path == "/api/ros":
            self.ros_put(body)
        elif path == "/api/ros/build":
            self.ros_build(body.get("template"), body.get("match"))
        elif path == "/api/ros/step":
            self.ros_step(1 if int(body.get("by", 1)) > 0 else -1)
        elif path == "/api/playlists":
            self.set_playlists(body.get("playlists"))
        elif path == "/api/playlist/play":
            self.playlist_play(body.get("id"))
        elif path == "/api/playlist/stop":
            self.playlist_stop()
        elif path == "/api/transitions":
            self.set_transitions(body.get("transitions"), body.get("default"))
        else:
            raise KeyError(path)
        self.changed()
        return result


UNLOCKED = ("/api/obs", "/api/network/scan", "/api/stream/", "/api/source/read", "/api/stinger/cut")


def good_host(host):
    """The Host a page used: an IP address, localhost, or this PC's own name. Anything else is a page from
    another site that got its name pointed at this PC (DNS rebinding), so it is refused."""
    if not host:
        return True
    name = urlparse("//" + host).hostname or ""
    if "." not in name or name.endswith((".localhost", ".local", ".lan", ".home.arpa", ".internal")):
        return True   # (localhost, a PC's own name on the network: rebinding needs a real internet domain)
    try:
        import ipaddress
        ipaddress.ip_address(name)
        return True
    except ValueError:
        pass
    import socket
    me = socket.gethostname().lower()
    return name.lower() in (me, me + ".local", me + ".lan")


def handler(engine):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body, ctype="application/json"):
            data = body if isinstance(body, bytes) else body.encode()
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def _file(self, path):
            """A file, the browser allowed to keep it (it asks again with its tag and gets "not changed" back,
            a few bytes), and parts of it on request (videos are read in pieces). Without this, every TAKE had
            every output re-download each video and picture, and the page's requests queued behind them."""
            if not path or not os.path.isfile(path):
                return self._send(404, b"not found", "text/plain")
            st = os.stat(path)
            tag = f'"{int(st.st_mtime)}-{st.st_size}"'
            ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
            if self.headers.get("If-None-Match") == tag:
                self.send_response(304)
                self.send_header("ETag", tag)
                self.send_header("Cache-Control", "no-cache")
                return self.end_headers()
            size, start, end = st.st_size, 0, st.st_size - 1
            m = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range") or "")
            if m and (m.group(1) or m.group(2)):
                if m.group(1):
                    start, end = int(m.group(1)), min(int(m.group(2) or size - 1), size - 1)
                else:   # (the last N bytes)
                    start = max(0, size - int(m.group(2)))
                if start > end or start >= size:
                    self.send_response(416)
                    self.send_header("Content-Range", f"bytes */{size}")
                    return self.end_headers()
                self.send_response(206)
                self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
            else:
                self.send_response(200)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(end - start + 1))
            self.send_header("Accept-Ranges", "bytes")
            self.send_header("ETag", tag)
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            with open(path, "rb") as f:
                f.seek(start)
                left = end - start + 1
                while left > 0:
                    chunk = f.read(min(left, 1 << 16))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    left -= len(chunk)

        def _base(self):
            """This engine's address as the asker reached it (for full picture addresses)."""
            return "http://" + (self.headers.get("Host") or f"127.0.0.1:{engine.port}")

        def _refused(self):
            """Another PC while this engine isn't shared (or on another network than the picked one), or a page
            reaching it under some other site's name (DNS rebinding: Host is then that site's name)."""
            if not good_host(self.headers.get("Host")):
                self._send(403, b'{"error": "Open the engine by its address (127.0.0.1 or this PC IP address)"}')
                return True
            if engine.net.allowed(self.client_address[0], self.connection.getsockname()[0]):
                return False
            self._send(403, b'{"error": "This engine is not shared on the network (Outputs > Network)"}')
            return True

        def do_GET(self):
            try:
                self._get()
            except (ConnectionError, OSError):
                pass   # (the page went away mid-answer)
            except Exception:
                log.exception("GET %s failed", self.path)
                try:
                    self._send(500, b'{"error": "Something failed here: see the Error log"}')
                except OSError:
                    pass

        def _get(self):
            if self._refused():
                return
            path = urlparse(self.path).path
            if path == "/api/hello":
                return self._send(200, json.dumps(hudlink.hello(engine)))
            if path == "/api/global":
                try:
                    hudlink.check_engine(engine, (parse_qs(urlparse(self.path).query).get("engine") or [""])[0])
                except hudlink.Refused as e:
                    return self._send(409, json.dumps({"error": str(e), "code": e.code}))
                with engine.lock:
                    g = json.dumps(hudlink.global_for_hud(engine, self._base()))
                return self._send(200, g)
            if path == "/api/teams.csv":
                data = tables.teams_csv(engine.teams()).encode("utf-8-sig")
                self.send_response(200)
                self.send_header("Content-Type", "text/csv; charset=utf-8")
                self.send_header("Content-Disposition", 'attachment; filename="teams.csv"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                return self.wfile.write(data)
            if path == "/api/assets":
                return self._send(200, json.dumps({"assets": engine.assets()}))
            if path == "/api/state":
                with engine.lock:
                    st = json.dumps(engine.state())
                return self._send(200, st)
            if path == "/api/stream":
                return self._stream()
            if path == "/api/export/html":
                ids = [i for i in (parse_qs(urlparse(self.path).query).get("ids") or [""])[0].split(",") if i]
                try:
                    name, data = engine.html_export(ids)   # (takes the lock only for its copy)
                except (KeyError, ValueError, OSError) as e:
                    return self._send(400, json.dumps({"error": str(e)}))
                fname = re.sub(r"[^\w ()-]+", "_", name).strip() or "graphics"
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", f'attachment; filename="{fname} (HTML).zip"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                return self.wfile.write(data)
            if path == "/api/export":
                ids = [i for i in (parse_qs(urlparse(self.path).query).get("ids") or [""])[0].split(",") if i]
                name, data = engine.pack_export(ids)   # (takes the lock only for its copy)
                fname = re.sub(r"[^\w ()-]+", "_", name).strip() or "graphics"
                self.send_response(200)
                self.send_header("Content-Type", "application/zip")
                self.send_header("Content-Disposition", f'attachment; filename="{fname}.sgfx"')
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                return self.wfile.write(data)
            if path == "/output":
                return self._file(os.path.join(WEB, "output.html"))
            if path == "/cam":
                return self._file(os.path.join(WEB, "cam.html"))
            if path in ("/", "/control"):
                return self._file(os.path.join(WEB, "control.html"))
            if path.startswith("/assets/"):
                return self._file(inside(engine.folder, path[1:]))
            if path.startswith("/library/") and engine.library:
                return self._file(inside(engine.library, path[len("/library/"):]))
            return self._file(inside(WEB, path[1:]))

        def do_POST(self):
            if self._refused():
                return
            # (pages on this engine only: a web page elsewhere can't press TAKE)
            origin = self.headers.get("Origin")
            if origin and urlparse(origin).netloc != self.headers.get("Host"):
                return self._send(403, b'{"error": "other site"}')
            try:
                if urlparse(self.path).path == "/api/upload":
                    q = parse_qs(urlparse(self.path).query)
                    length = int(self.headers.get("Content-Length") or 0)
                    if length > 400 << 20:
                        raise ValueError("That file is too big (400 MB at most)")
                    name = unquote((q.get("name") or [""])[0])
                    data = self.rfile.read(length)
                    return self._upload(q, name, data)
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
                path = urlparse(self.path).path
                if path == "/api/ingest":   # (a game HUD's send)
                    with engine.lock:
                        reply = hudlink.ingest(engine, body, self.client_address[0], self._base())
                    return self._send(200, json.dumps(reply))
                if path == "/api/global" and body.get("engine"):
                    hudlink.check_engine(engine, body)
                if path.startswith(UNLOCKED):   # (these wait on OBS or the network: they keep their own locks, and must not hold up a TAKE)
                    result = engine.act(path, body)
                else:
                    with engine.lock:
                        result = engine.act(path, body)
                self._send(200, json.dumps(result or {"ok": True}))
            except hudlink.Refused as e:
                self._send(409, json.dumps({"error": str(e), "code": e.code}))
            except (KeyError, ValueError) as e:
                log.warning("POST %s refused: %s", self.path, e)
                self._send(400, json.dumps({"error": str(e)}))
            except Exception as e:
                log.exception("POST %s failed", self.path)
                self._send(500, json.dumps({"error": f"Something failed here ({e.__class__.__name__}): {str(e)[:160]}"}))

        def _upload(self, q, name, data):
            if name.lower().endswith(convert.NEEDS + (".zip",)):
                fps = max(1.0, min(120.0, float((q.get("fps") or ["30"])[0] or 30)))
                with engine.lock:
                    job = engine.convert_upload(name, data, (q.get("folder") or [""])[0], fps)
                return self._send(200, json.dumps({"job": job}))
            if name.lower().endswith((".chudgfx", ".sgfx")):
                got = engine.pack_import(data)
                return self._send(200, json.dumps({"comps": [{"id": c["id"], "name": c["name"]} for c in got]}))
            if name.lower().endswith(".psd"):
                return self._send(200, json.dumps({"comp": engine.import_psd(name, data)}))
            with engine.lock:
                rel = engine.upload(name, data, (q.get("folder") or [""])[0])
            return self._send(200, json.dumps({"path": rel}))

        def _stream(self):
            out = (parse_qs(urlparse(self.path).query).get("out") or [""])[0][:60]
            if out:
                engine.output_seen(out, 1)
            try:
                self._stream_loop()
            finally:
                if out:
                    engine.output_seen(out, -1)

        def _stream_loop(self):
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            seen, had = None, {}
            try:
                while True:
                    with engine.cond:
                        if seen == engine.version:
                            engine.cond.wait(2)   # (a ping every 2 s: a closed page frees its connection quickly)
                        now = engine.version
                    if now == seen:
                        self.wfile.write(b": ping\n\n")
                    else:
                        seen = now
                        # only the parts that changed (a TAKE is the buses, not the whole workspace)
                        with engine.lock:
                            parts = {k: json.dumps(v) for k, v in engine.state().items()}
                        changed = {k: v for k, v in parts.items() if had.get(k) != v}
                        had = parts
                        if changed:
                            self.wfile.write(b"data: {" + ",".join(json.dumps(k) + ":" + v for k, v in changed.items()).encode() + b"}\n\n")
                    self.wfile.flush()
            except (ConnectionError, OSError):
                pass
    return H


def make_server(workspace, library=None, port=7800):
    engine = Engine(workspace, library)
    server = ThreadingHTTPServer(("0.0.0.0", port), handler(engine))
    server.daemon_threads = True
    engine.port = server.server_address[1]
    engine.net = Net(library or os.path.dirname(os.path.abspath(workspace)), engine.port)
    hudlink.start(engine)
    return engine, server


def serve(workspace, library=None, port=7800):
    logs.setup(library or os.path.dirname(os.path.abspath(workspace)))
    engine, server = make_server(workspace, library, port)
    print(f"StandBy GFX on http://127.0.0.1:{engine.port}/output", flush=True)
    server.serve_forever()
