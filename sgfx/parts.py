"""Parts: a group of layers made once (a name plate, a score box) and used in any graphic.

project["parts"] = [{id, name, w, h, layers}] with the layers placed from (0, 0). A copy in a graphic is
its layers with "part": <part id> and "part_at": <copy id>. Updating a part from one copy rewrites every
copy in every graphic, each staying where it is.
"""
import copy
import uuid


def _bbox(layers):
    x0 = min(l.get("x", 0) for l in layers)
    y0 = min(l.get("y", 0) for l in layers)
    x1 = max(l.get("x", 0) + l.get("w", 0) for l in layers)
    y1 = max(l.get("y", 0) + l.get("h", 0) for l in layers)
    return x0, y0, x1 - x0, y1 - y0


def _strip(layers):
    """Layers moved to (0, 0), without ids or copy tags."""
    x0, y0, w, h = _bbox(layers)
    out = []
    for l in layers:
        l = copy.deepcopy(l)
        for k in ("id", "part", "part_at"):
            l.pop(k, None)
        l["x"], l["y"] = l.get("x", 0) - x0, l.get("y", 0) - y0
        out.append(l)
    return out, w, h


def make(name, layers):
    if not layers:
        raise ValueError("Pick the layers to make the part from")
    body, w, h = _strip(layers)
    return {"id": "p" + uuid.uuid4().hex[:8], "name": str(name or "Part")[:60], "w": w, "h": h, "layers": body}


def place(part, x, y, inst=None):
    """The part's layers for a new copy at (x, y)."""
    inst = inst or "i" + uuid.uuid4().hex[:8]
    out = []
    for l in part["layers"]:
        l = copy.deepcopy(l)
        l["id"] = "l" + uuid.uuid4().hex[:8]
        l["x"], l["y"] = l.get("x", 0) + x, l.get("y", 0) + y
        l["part"], l["part_at"] = part["id"], inst
        out.append(l)
    return out


def update(project, part_id, comp_id, inst):
    """The part becomes copy `inst` of graphic `comp_id`; every other copy follows. -> number of copies."""
    parts = project.setdefault("parts", [])
    part = next((p for p in parts if p.get("id") == part_id), None)
    if not part:
        raise KeyError("No such part")
    comps = project.get("compositions") or []
    src = next((c for c in comps if c.get("id") == comp_id), None)
    mine = [l for l in (src or {}).get("layers") or [] if l.get("part") == part_id and l.get("part_at") == inst]
    if not mine:
        raise KeyError("That copy isn't in the graphic")
    part["layers"], part["w"], part["h"] = _strip(mine)
    n = 0
    for c in comps:
        layers = c.get("layers") or []
        copies = {}
        for l in layers:
            if l.get("part") == part_id:
                copies.setdefault(l.get("part_at"), []).append(l)
        if not copies:
            continue
        out, done = [], set()
        for l in layers:
            key = l.get("part_at") if l.get("part") == part_id else None
            if key is None:
                out.append(l)
            elif key not in done:
                x0, y0, _, _ = _bbox(copies[key])
                out.extend(place(part, x0, y0, key))
                done.add(key)
                n += 1
        c["layers"] = out
    return n
