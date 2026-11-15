"""The pre-show check: what could go wrong on air, found before the show.

check(engine) -> [{"id", "level": "ok" | "warn" | "bad", "label", "detail"}], worst first.
"""

import os
import shutil

# Fonts every output has without the workspace adding them (web/runtime.js BUILTIN).
BUILTIN_FONTS = {"inter", "montserrat", "barlow condensed", "bebas neue", "anton", "permanent marker", "vazirmatn"}
LOW_DISK = 2 << 30


def _names(items, n=4):
    items = sorted(set(items))
    return ", ".join(items[:n]) + (f" and {len(items) - n} more" if len(items) > n else "")


def check(engine):
    ws = engine.ws
    project = ws.get()
    comps = project["compositions"]
    out = []

    def add(id, level, label, detail=""):
        out.append({"id": id, "level": level, "label": label, "detail": detail})

    # Program really shown somewhere (an OBS browser source, vMix...)
    outs = getattr(engine, "outputs", {}) or {}
    if outs.get("program"):
        add("program", "ok", "Program output connected", f"{outs['program']} connected")
    else:
        add("program", "bad", "Program output not connected",
            "Add the Program link (Outputs page) to OBS as a browser source, 1920 x 1080")

    # Pictures and videos the graphics use, on disk
    missing = {}
    for c in comps:
        for l in c.get("layers", []):
            src = l.get("src")
            if isinstance(src, str) and src.startswith("assets/"):
                path = ws.asset_path(src)
                if not path or not os.path.isfile(path):
                    missing.setdefault(c.get("name", "?"), []).append(os.path.basename(src))
    if missing:
        n = sum(len(v) for v in missing.values())
        add("files", "bad", f"{n} missing picture or video file{'s' if n != 1 else ''}",
            "In " + _names(missing) + ": " + _names([f for v in missing.values() for f in v]))
    else:
        add("files", "ok", "Every picture and video is there")

    # Stingers that are turned on
    gone = [t.get("name") or "Stinger" for t in project.get("transitions", [])
            if t.get("type") == "stinger" and t.get("enabled", True) is not False
            and not (t.get("src") and ws.asset_path(t["src"]) and os.path.isfile(ws.asset_path(t["src"])))]
    if gone:
        add("stingers", "bad", "Stinger video missing", _names(gone))
    elif any(t.get("type") == "stinger" for t in project.get("transitions", [])):
        add("stingers", "ok", "Stingers ready")

    # Fonts: not in the workspace and not built in, they show in a stand-in
    have = set(BUILTIN_FONTS)
    try:
        for f in engine.assets.fonts():
            have.update(a.lower() for a in (f.get("aliases") or []) if a)
            if f.get("family"):
                have.add(f["family"].lower())
    except Exception:
        pass
    no_font = {l["font"] for c in comps for l in c.get("layers", [])
               if l.get("type") == "text" and isinstance(l.get("font"), str) and l["font"].lower() not in have
               and l["font"].lower().split("-")[0] not in BUILTIN_FONTS}   # ("Anton-Regular": the built-in Anton)
    if no_font:
        add("fonts", "warn", f"{len(no_font)} font{'s' if len(no_font) != 1 else ''} not in this workspace",
            _names(no_font) + ". They show only on a PC that has them installed: add the font files under Assets")
    else:
        add("fonts", "ok", "Every font is in the workspace")

    # Teams set up
    g = project.get("global") or {}
    teams = [g.get("left") or {}, g.get("right") or {}]
    if not all((t.get("name") or "").strip() for t in teams):
        add("teams", "warn", "A team has no name", "Set both teams on the Global page")
    else:
        add("teams", "ok", f"{teams[0].get('name')} vs {teams[1].get('name')}")

    # OBS, when it's meant to be connected
    obs = engine.obs.public()
    if obs.get("enabled"):
        if obs.get("connected"):
            add("obs", "ok", "OBS connected")
        else:
            add("obs", "warn", "OBS not connected", obs.get("error") or "Check OBS is open (Outputs page)")

    # Disk space for recordings and caches
    try:
        free = shutil.disk_usage(ws.folder).free
        if free < LOW_DISK:
            add("disk", "warn", f"Low disk space: {free / (1 << 30):.1f} GB free", "Recordings and videos need room")
        else:
            add("disk", "ok", f"{free / (1 << 30):.0f} GB free")
    except OSError:
        pass

    # An update waiting: put it on before the show, not during it
    up = engine.updater.info()
    if up.get("available"):
        add("update", "warn", f"Update {up.get('latest')} waiting", "Update before the show starts, not during it")

    rank = {"bad": 0, "warn": 1, "ok": 2}
    return sorted(out, key=lambda r: rank[r["level"]])
