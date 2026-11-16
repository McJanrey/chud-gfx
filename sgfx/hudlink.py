"""Game HUDs (League, VALORANT, Rocket League, CoD, Smash): the engine side of the link the HUDs already speak.

A HUD finds this engine (GET /api/hello, or the UDP announcement on 7791), connects, and about once a second
POSTs /api/ingest: {source, game, fields, series, hud, engine, hud_id}. Its fields become a data table named
after it ({{League HUD!KILLS LEFT}}), its series score goes into Global, and its own pages (hud.graphics, e.g.
VALORANT's agent select) are added once to the graphics. The reply carries Global, which the HUD follows
(teams, tournament logo, sponsors: GET /api/global gives the same, with full addresses for the pictures).

A HUD is paired with one engine (its id): an engine that isn't that one answers {"code": "wrong_engine"}, and
a second copy of the same HUD (another hud_id while the first is still sending) gets {"code": "taken"}.
"""
import json
import os
import socket
import threading
import time
import uuid
from urllib.parse import quote

APP = "chud-gfx"
DISCOVERY_PORT = 7791
FRESH = 10   # (seconds: a HUD that sent within this is "on")


class Refused(Exception):
    """The HUD is turned away: {"error", "code"} with a 409."""
    def __init__(self, msg, code):
        super().__init__(msg)
        self.code = code


def engine_id(net):
    """This engine's id: made once and kept with the network settings."""
    if not net.cfg.get("id"):
        net.cfg["id"] = uuid.uuid4().hex[:16]
        net.save({})
    return net.cfg["id"]


def hello(engine):
    from . import __version__
    return {"app": APP, "name": engine.net.cfg.get("name") or socket.gethostname(), "version": __version__, "port": engine.port, "id": engine_id(engine.net)}


def check_engine(engine, body_or_id):
    want = body_or_id.get("engine") if isinstance(body_or_id, dict) else body_or_id
    if want and want != engine_id(engine.net):
        raise Refused("This isn't the GFX Baby that HUD connected to", "wrong_engine")


def _url(base, path):
    if not path:
        return ""
    if "://" in str(path) or str(path).startswith("data:"):
        return str(path)
    return base + "/" + quote(str(path).lstrip("/"))


def global_for_hud(engine, base):
    """Global with full addresses for its pictures (the HUD downloads the logos)."""
    g = json.loads(json.dumps(engine.project.get("global") or {}))
    for side in ("left", "right"):
        t = g.get(side) if isinstance(g.get(side), dict) else {}
        t["logo_url"] = _url(base, t.get("logo"))
        g[side] = t
    g["tournament_logo_url"] = _url(base, g.get("tournament_logo"))
    g["sponsors"] = [dict(s, logo_url=_url(base, s.get("logo"))) for s in g.get("sponsors") or [] if isinstance(s, dict) and s.get("logo")]
    return {"id": engine_id(engine.net), "name": hello(engine)["name"], "global": g}


def ingest(engine, body, client_ip, base):
    """One send from a HUD. Returns the reply ({id, name, global})."""
    check_engine(engine, body)
    source = str(body.get("source") or "").strip()[:60]
    if not source:
        raise ValueError("Needs a source (the HUD's name)")
    huds = engine.__dict__.setdefault("_hud_ids", {})
    hid, now = str(body.get("hud_id") or ""), time.time()
    seen = huds.get(source)
    if hid and seen and seen[0] != hid and now - seen[1] < FRESH:
        raise Refused(f"Another {source} is already sending to this GFX Baby", "taken")
    if hid:
        huds[source] = (hid, now)
    fields = body.get("fields") if isinstance(body.get("fields"), dict) else {}
    engine.ingest(source, {"fields": fields})
    engine._hud_game = dict(getattr(engine, "_hud_game", {}), **{source: str(body.get("game") or "")})
    # the series score (never the HUD's team names: Global has those)
    s = body.get("series") if isinstance(body.get("series"), dict) else {}
    g, change = engine.project.get("global") or {}, {}
    for side in ("left", "right"):
        sc = (s.get(side) or {}).get("score") if isinstance(s.get(side), dict) else None
        if sc not in (None, "") and str((g.get(side) or {}).get("score", "")) != str(sc):
            change[side] = {"score": sc}
    if s.get("best_of") and str(g.get("best_of", "")) != str(s["best_of"]):
        try:
            change["best_of"] = int(s["best_of"])
        except (TypeError, ValueError):
            pass
    if change:
        engine.set_global(change)
    add_hud_pages(engine, source, body.get("hud"), client_ip)
    engine.changed()
    return global_for_hud(engine, base)


def add_hud_pages(engine, source, hud, client_ip):
    """The HUD's own pages become graphics (a web page layer filling the screen), once each: one deleted stays gone."""
    if not isinstance(hud, dict) or not isinstance(hud.get("graphics"), list) or not hud.get("port"):
        return
    host = "127.0.0.1" if client_ip.startswith("127.") or client_ip == "::1" else client_ip
    done = engine.project.setdefault("hud_pages", [])
    added = False
    for p in hud["graphics"]:
        if not isinstance(p, dict) or not p.get("id"):
            continue
        key = f"{source}:{p['id']}"
        url = f"http://{host}:{int(hud['port'])}/{str(p.get('path') or '').lstrip('/')}"
        have = next((c for c in engine.comps() if c.get("hud_page") == key), None)
        if have:   # (the HUD moved to another PC or port: its page follows)
            for l in have.get("layers") or []:
                if l.get("type") == "web" and l.get("url") != url:
                    l["url"], added = url, True
            continue
        if key in done:
            continue
        done.append(key)
        engine.comps().append({"id": "c" + uuid.uuid4().hex[:8], "name": str(p.get("name") or p["id"])[:80], "hud_page": key, "group": "Game HUD",
                               "kind": "board" if p.get("kind") == "board" else "overlay",
                               "layers": [{"id": "l" + uuid.uuid4().hex[:8], "type": "web", "name": "HUD page", "url": url, "x": 0, "y": 0, "w": 1920, "h": 1080, "opacity": 1, "visible": True}]})
        added = True
    if added:
        engine.save_project()


def status(engine):
    """[{name, game, on, seconds since}] of the HUDs that have sent."""
    now, games = time.time(), getattr(engine, "_hud_game", {})
    return [{"name": n, "game": games.get(n, ""), "on": now - h["at"] < FRESH, "ago": round(now - h["at"])} for n, h in getattr(engine, "_hud", {}).items()]


def announce(engine):
    """Every 2 s: {"app", "name", "port", "version", "id"} to the network (when shared) and to this PC."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    while True:
        try:
            msg = json.dumps(hello(engine)).encode()
            targets = ["127.0.0.1"] + (["255.255.255.255"] if engine.net.cfg.get("network") else [])
            for t in targets:
                try:
                    s.sendto(msg, (t, DISCOVERY_PORT))
                except OSError:
                    pass
        except Exception:
            pass
        time.sleep(2)


def start(engine):
    threading.Thread(target=announce, args=(engine,), daemon=True, name="hud-announce").start()
