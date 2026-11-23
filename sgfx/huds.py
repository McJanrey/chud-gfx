"""HUDs (the HUD Builder): a game's broadcast HUD, kept apart from the show's graphics.

A HUD is {id, name, game, parts: [{id, name, on, layers}]}, in project["huds"]. Its parts are drawn by the same engine
as graphics, but a HUD is never TAKEn: its browser source (/hud/<id>) shows every part that's on, all the time,
and each layer shows itself from the game's live data ("Show only while"). Edited on the HUD Builder page.
"""
import os
import json
import re
import uuid

GAMES = ("valorant", "league", "rocketleague", "other")


def _id():
    return uuid.uuid4().hex[:8]


def huds(engine):
    h = engine.project.setdefault("huds", [])
    return h if isinstance(h, list) else []


def find(engine, hid):
    return next((h for h in huds(engine) if h.get("id") == hid), None)


def clean_layers(layers):
    out = []
    for l in layers if isinstance(layers, list) else []:
        if isinstance(l, dict) and l.get("type") in ("rect", "text", "image", "shape", "video", "web", "lottie"):
            l = dict(l)
            l["id"] = str(l.get("id") or "l" + _id())[:40]
            l["name"] = str(l.get("name") or l["type"])[:80]
            out.append(l)
    return out


def save(engine, body):
    """Adds or replaces a HUD (the whole HUD: its name, game and parts)."""
    if not isinstance(body, dict):
        raise ValueError("Send a HUD")
    hid = str(body.get("id") or "")
    if hid and not re.fullmatch(r"[a-z0-9-]{1,40}", hid):
        raise ValueError("That HUD id isn't valid")
    parts = []
    for p in body.get("parts") or []:
        if isinstance(p, dict):
            parts.append({"id": str(p.get("id") or _id())[:40], "name": str(p.get("name") or "Part")[:80], "on": p.get("on", True) is not False,
                          "layers": clean_layers(p.get("layers"))})
    hud = {"id": hid or _id(), "name": str(body.get("name") or "HUD")[:80], "game": body.get("game") if body.get("game") in GAMES else "other", "parts": parts}
    if isinstance(body.get("built"), list):
        hud["built"] = [str(x)[:40] for x in body["built"]][:50]
    if body.get("key"):
        hud["key"] = str(body["key"])[:40]
    lst = huds(engine)
    old = find(engine, hud["id"])
    if old:
        hud.setdefault("key", old.get("key"))
        lst[lst.index(old)] = hud
    else:
        lst.append(hud)
    engine.save_project()
    engine.changed()
    return hud


def delete(engine, hid):
    """Puts a HUD aside in the trash (the project's bin), not deleted."""
    h = find(engine, hid)
    if not h:
        raise ValueError("No such HUD")
    huds(engine).remove(h)
    engine.project.setdefault("hud_bin", []).append(h)
    engine.save_project()
    engine.changed()


def builtin(key):
    """The built-in parts for a built-in HUD's key, or None."""
    if key == "val27":   # (Owen's SCC 2027 HUD as layers: every part read from his page, val27_owen.json; agent select is ours)
        from . import valhud
        with open(os.path.join(os.path.dirname(__file__), "val27_owen.json"), encoding="utf-8") as f:
            owen = [(f"val27:{p['id']}", p["name"], "hud", p["layers"]) for p in json.load(f)]
        return owen + [(k, n.replace("VAL HUD · ", ""), kd, l) for k, n, kd, l in valhud.comps() if "agent select" in n.lower()]
    return None


def rebuild(engine, hid):
    """A built-in HUD back to its built-in look (which parts are on is kept; the old one goes to the bin)."""
    h = find(engine, hid)
    parts = builtin((h or {}).get("key"))
    if not h or not parts:
        raise ValueError("Only a built-in HUD can be reset")
    engine.project.setdefault("hud_bin", []).append(dict(h))
    on = {p["id"]: p.get("on", True) for p in h.get("parts") or []}
    h["parts"] = [{"id": pk.split(":")[-1], "name": pn, "on": on.get(pk.split(":")[-1], True), "layers": layers} for pk, pn, _, layers in parts]
    h["built"] = [p["id"] for p in h["parts"]]
    engine.save_project()
    engine.changed()
    return h


def upgrade_val27(engine):
    """VAL HUD (SCC 2027) made before it was rebuilt from Owen's page: its parts become his (Agent select kept). Once."""
    h = find(engine, "val27")
    if not h or "owtop" in (h.get("built") or []):
        return False
    new = builtin("val27")
    keep = [p for p in h.get("parts") or [] if "agent select" in str(p.get("name", "")).lower()]
    h["parts"] = [{"id": k.split(":")[-1], "name": n, "on": True, "layers": l} for k, n, _, l in new if "agent select" not in n.lower()] + keep
    h["built"] = sorted(set((h.get("built") or []) + [k.split(":")[-1] for k, _, _, _ in new] + [p["id"] for p in keep]))
    engine.save_project()
    return True


def ensure(engine, key, name, game, parts):
    """The built-in HUD for a game (added once; one you deleted stays deleted). Any of its parts made as graphics
    before the HUD Builder existed are moved in, so they leave the composer."""
    done = engine.project.setdefault("hud_pages", [])
    if key in done:   # (made already: a built-in part added since then is added once; one you deleted stays deleted)
        h = find(engine, key)
        if not h:
            return None
        built = h.setdefault("built", [p["id"] for p in h.get("parts") or []])
        new = [(pk.split(":")[-1], pn, layers) for pk, pn, _, layers in parts if pk.split(":")[-1] not in built]
        for pid, pn, layers in new:
            h["parts"].append({"id": pid, "name": pn, "on": True, "layers": layers})
            built.append(pid)
        if new:
            engine.save_project()
        return h if new else None
    done.append(key)
    comps = engine.comps()
    for c in [c for c in comps if str(c.get("hud_page", "")).startswith(key + ":")]:
        comps.remove(c)
    hud = {"id": key, "key": key, "name": name, "game": game, "built": [pk.split(":")[-1] for pk, _, _, _ in parts],
           "parts": [{"id": pk.split(":")[-1], "name": pn, "on": True, "layers": layers} for pk, pn, _, layers in parts]}
    old = find(engine, key)
    if not old:
        huds(engine).append(hud)
    engine.save_project()
    return hud


def ready_made(engine, key, name, game, parts):
    """A game's ready-made graphics (scorebug, round win, timeout...) kept as a HUD of their own, never in the show's
    graphics: each part starts off (switch it on in the HUD Builder). Ones made as graphics before are moved in with
    their changes; one deleted stays deleted. Returns the HUD when something was added."""
    done = engine.project.setdefault("hud_pages", [])
    comps = engine.comps()
    moved = {c["hud_page"]: c for c in comps if str(c.get("hud_page", "")).startswith(key + ":")}
    hud = find(engine, key)
    added = False
    for pk, pn, _kind, layers in parts:
        pid = pk.split(":", 1)[1]
        if hud and any(p["id"] == pid for p in hud["parts"]):
            continue
        if pk in done and pk not in moved:
            continue   # (deleted once: stays gone)
        if not hud:
            hud = {"id": key, "name": name, "game": game, "parts": []}
            huds(engine).append(hud)
        hud["parts"].append({"id": pid, "name": pn, "on": False, "layers": clean_layers((moved.get(pk) or {}).get("layers") or layers)})
        if pk not in done:
            done.append(pk)
        added = True
    for c in moved.values():
        comps.remove(c)
    if added or moved:
        engine.save_project()
    return hud if added else None
