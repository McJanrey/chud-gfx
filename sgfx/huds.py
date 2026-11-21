"""HUDs (the HUD Builder): a game's broadcast HUD, kept apart from the show's graphics.

A HUD is {id, name, game, parts: [{id, name, on, layers}]}, in project["huds"]. Its parts are drawn by the same engine
as graphics, but a HUD is never TAKEn: its browser source (/hud/<id>) shows every part that's on, all the time,
and each layer shows itself from the game's live data ("Show only while"). Edited on the HUD Builder page.
"""
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


def ensure(engine, key, name, game, parts):
    """The built-in HUD for a game (added once; one you deleted stays deleted). Any of its parts made as graphics
    before the HUD Builder existed are moved in, so they leave the composer."""
    done = engine.project.setdefault("hud_pages", [])
    if key in done:
        return None
    done.append(key)
    comps = engine.comps()
    for c in [c for c in comps if str(c.get("hud_page", "")).startswith(key + ":")]:
        comps.remove(c)
    hud = {"id": key, "key": key, "name": name, "game": game,
           "parts": [{"id": pk.split(":")[-1], "name": pn, "on": True, "layers": layers} for pk, pn, _, layers in parts]}
    old = find(engine, key)
    if not old:
        huds(engine).append(hud)
    engine.save_project()
    return hud
