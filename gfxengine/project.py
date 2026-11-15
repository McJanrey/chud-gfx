"""The workspace: every graphic (composition), the transitions, the data
sources, and the asset files they use.

    workspace/project.json   compositions, transitions, data sources
    workspace/assets/...     images, video, fonts, Lottie files (served as assets/...)

A composition is a 1920x1080 graphic made of layers, bottom to top:

    {"id", "name", "layer": 0 (stacking on the output: higher is in front),
     "kind": "board" | "lower third" | "overlay" (one board and one lower third on air at a time),
     "layers": [{"id", "name", "type": "image" | "video" | "text" | "rect" | "lottie" | "ticker",
                 "x", "y", "w", "h", "opacity", "rotation", "visible", "blend",
                 "field": "" (the name it's edited by in Control; "" = fixed),
                 "anim": {"in": {"type", "dur", "delay"}, "out": {...}},
                 ...type's own: src, fit, loop (media); text, font, size, color,
                 align, valign, tracking, caps, lineHeight, fit, scroll (text);
                 fill, radius, stroke, strokeWidth (rect)}]}
"""

import copy
import json
import os
import secrets
import shutil
import threading
import time

from .log import log

TRANSITION_TYPES = ("cut", "fade", "dip", "wipe", "animate", "stinger")

DEFAULT_TRANSITIONS = [
    {"id": "cut", "name": "Cut", "type": "cut", "enabled": True},
    {"id": "fade", "name": "Fade", "type": "fade", "dur": 500, "enabled": True},
    {"id": "animate", "name": "Animate", "type": "animate", "enabled": True},
    {"id": "dip", "name": "Dip to black", "type": "dip", "dur": 800, "color": "#000000", "enabled": False},
    {"id": "wipe", "name": "Wipe", "type": "wipe", "dur": 600, "direction": "left", "enabled": False},
]

ANIM_NONE = {"type": "fade", "dur": 300, "delay": 0}


def new_id(prefix=""):
    return prefix + secrets.token_hex(4)


def blank_project():
    return {"name": "My graphics", "compositions": [], "transitions": copy.deepcopy(DEFAULT_TRANSITIONS),
            "default_transition": "fade", "sources": []}


def blank_layer(kind, **extra):
    layer = {"id": new_id("l"), "name": kind.title(), "type": kind, "x": 760, "y": 440, "w": 400, "h": 200,
             "opacity": 1, "rotation": 0, "visible": True, "blend": "normal", "field": "",
             "anim": {"in": dict(ANIM_NONE), "out": dict(ANIM_NONE)}}
    if kind == "text":
        layer.update({"text": "Text", "font": "Inter", "size": 72, "color": "#ffffff", "align": "left",
                      "valign": "top", "tracking": 0, "caps": False, "lineHeight": 1.15, "fit": "shrink",
                      "weight": 700, "italic": False, "scroll": 0, "h": 90})
    elif kind == "rect":
        layer.update({"fill": "#0b6b3a", "radius": 0, "stroke": "#f5c518", "strokeWidth": 0})
    elif kind == "ticker":
        # Scrolling strip of items (picture and/or text), typed here or read from a data source's columns.
        layer.update({"x": 0, "y": 1000, "w": 1920, "h": 70, "items": [{"text": "Follow @SCCSaints", "img": ""}, {"text": "Thanks for watching", "img": ""}],
                      "source": "", "textCol": "", "imgCol": "", "speed": 120, "gap": 60, "sep": "•", "imgSize": 48, "fade": True,
                      "font": "Inter", "size": 36, "color": "#ffffff", "weight": 700, "caps": True, "tracking": 0, "italic": False})
    elif kind == "shape":
        # Any shape (see the Shapes part of runtime.js): its outline, fill (colour, gradient
        # or picture), border and effects (fx: shadow, glow, inner shadow, blur, blur behind).
        layer.update({"shape": "rect", "w": 400, "h": 240, "fill": "#f28c28", "fillType": "solid", "radius": 0,
                      "stroke": "#ffffff", "strokeWidth": 0, "strokeAlign": "center", "dash": "solid"})
    elif kind == "rotator":
        # One item at a time in place (sponsor logos, lines of text), swapping every few seconds.
        layer.update({"x": 1500, "y": 960, "w": 360, "h": 100, "items": [{"text": "", "img": ""}],
                      "source": "", "textCol": "", "imgCol": "", "secs": 8, "swap": "crossfade", "swapMs": 600, "order": "in order",
                      "imgSize": 80, "font": "Inter", "size": 36, "color": "#ffffff", "weight": 700, "caps": False,
                      "tracking": 0, "italic": False})
    elif kind in ("image", "video", "lottie"):
        layer.update({"src": "", "fit": "contain", "loop": True})
    layer.update(extra)
    return layer


def blank_comp(name="New graphic"):
    return {"id": new_id("c"), "name": name, "layer": 0, "layers": []}


class Workspace:
    def __init__(self, folder, starter=None):
        self.folder = folder
        self.assets_dir = os.path.join(folder, "assets")
        self.path = os.path.join(folder, "project.json")
        self.lock = threading.RLock()
        self.rev = 0
        self.listeners = []
        os.makedirs(self.assets_dir, exist_ok=True)
        if not os.path.exists(self.path) and starter and os.path.isfile(os.path.join(starter, "project.json")):
            # First run: start with the example graphics.
            shutil.copytree(starter, folder, dirs_exist_ok=True)
            log("Created the workspace from the example graphics")
        self.data = blank_project()
        if os.path.exists(self.path):
            with open(self.path, encoding="utf-8") as f:
                self.data.update(json.load(f))
        self._timer = None

    # --- reading -------------------------------------------------------

    def get(self):
        with self.lock:
            return copy.deepcopy(self.data)

    def snapshot(self):
        """Like get(), but the same copy until the project changes: read it,
        never change it (the outputs' state is made from it many times a second)."""
        with self.lock:
            if getattr(self, "_snap_rev", None) != self.rev:
                self._snap, self._snap_rev = copy.deepcopy(self.data), self.rev
            return self._snap

    def comp(self, cid):
        with self.lock:
            c = next((c for c in self.data["compositions"] if c["id"] == cid), None)
            return copy.deepcopy(c) if c else None

    def transition(self, tid):
        with self.lock:
            t = next((t for t in self.data["transitions"] if t["id"] == tid), None)
            return copy.deepcopy(t) if t else None

    # --- changing ------------------------------------------------------

    def changed(self):
        """Call with the lock held after changing self.data."""
        self.rev += 1
        if self._timer:
            self._timer.cancel()
        # Saves are batched: dragging a layer changes it many times a second.
        self._timer = threading.Timer(0.4, self.save)
        self._timer.daemon = True
        self._timer.start()
        for fn in list(self.listeners):
            fn()

    def close(self):
        """Saves now (and not again later)."""
        if self._timer:
            self._timer.cancel()
        self.save()

    def save(self):
        with self.lock:
            text = json.dumps(self.data, indent=1)
        tmp = self.path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, self.path)

    def add_comp(self, comp=None, after=None):
        comp = comp or blank_comp()
        comp.setdefault("id", new_id("c"))
        with self.lock:
            comps = self.data["compositions"]
            if any(c["id"] == comp["id"] for c in comps):
                comp["id"] = new_id("c")
            idx = next((i + 1 for i, c in enumerate(comps) if c["id"] == after), len(comps))
            comps.insert(idx, comp)
            self.changed()
        return comp

    def put_comp(self, comp):
        with self.lock:
            comps = self.data["compositions"]
            for i, c in enumerate(comps):
                if c["id"] == comp.get("id"):
                    comps[i] = comp
                    self.changed()
                    return comp
        raise KeyError("No such graphic")

    def duplicate_comp(self, cid):
        comp = self.comp(cid)
        if not comp:
            raise KeyError("No such graphic")
        comp["id"] = new_id("c")
        comp["name"] += " copy"
        for layer in comp["layers"]:
            layer["id"] = new_id("l")
        return self.add_comp(comp, after=cid)

    def delete_comp(self, cid):
        """Into the bin (trash.json, the last 30), so a graphic deleted by mistake can be brought back."""
        with self.lock:
            comps = self.data["compositions"]
            i = next((i for i, c in enumerate(comps) if c["id"] == cid), None)
            if i is None:
                return
            gone = comps.pop(i)
            after = comps[i - 1]["id"] if i else None
            trash = [t for t in self.trash() if t["comp"]["id"] != cid]
            trash.insert(0, {"comp": gone, "after": after, "at": time.time()})
            self._write_trash(trash[:30])
            self.changed()

    def _trash_path(self):
        return os.path.join(self.folder, "trash.json")

    def trash(self):
        """[{"comp", "after" (the graphic it was under), "at"}], newest first."""
        if getattr(self, "_trash", None) is not None:
            return list(self._trash)
        try:
            with open(self._trash_path(), encoding="utf-8") as f:
                t = json.load(f)
            self._trash = t if isinstance(t, list) else []
        except (OSError, ValueError):
            self._trash = []
        return list(self._trash)

    def _write_trash(self, trash):
        tmp = self._trash_path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(trash, f)
        os.replace(tmp, self._trash_path())
        self._trash = list(trash)
        self.trash_rev = getattr(self, "trash_rev", 0) + 1

    def restore_comp(self, cid=None):
        """Brings a deleted graphic back where it was (the last one deleted when no id is given)."""
        with self.lock:
            trash = self.trash()
            t = next((t for t in trash if cid is None or t["comp"]["id"] == cid), None)
            if not t:
                raise KeyError("Nothing to bring back")
            trash.remove(t)
            self._write_trash(trash)
            comps = self.data["compositions"]
            idx = 0 if t["after"] is None else next((i + 1 for i, c in enumerate(comps) if c["id"] == t["after"]), len(comps))
            comp = t["comp"]
            if any(c["id"] == comp["id"] for c in comps):
                comp["id"] = new_id("c")
            comps.insert(idx, comp)
            self.changed()
            return comp

    def rename_comp(self, cid, name):
        name = str(name or "").strip()[:80]
        if not name:
            raise ValueError("A graphic needs a name")
        with self.lock:
            c = next((c for c in self.data["compositions"] if c["id"] == cid), None)
            if not c:
                raise KeyError("No such graphic")
            c["name"] = name
            self.changed()

    # --- parts: reusable pieces of graphics ------------------------------------
    # {"id", "name", "w", "h", "layers"} (layers placed from the part's top left).
    # A copy in a graphic is its layers with "part" (the id) and one "group".

    def set_parts(self, parts):
        clean = []
        for p in parts if isinstance(parts, list) else []:
            if isinstance(p, dict) and p.get("id") and isinstance(p.get("layers"), list):
                clean.append({"id": str(p["id"])[:20], "name": str(p.get("name") or "Part")[:60], "w": float(p.get("w") or 1),
                              "h": float(p.get("h") or 1), "layers": p["layers"]})
        with self.lock:
            self.data["parts"] = clean
            self.changed()

    def update_part(self, part, keep=None):
        """A part changed: its saved copy, and every copy in every graphic redrawn from it
        where it sits (keep: {"comp", "group"}, the copy it was changed from, left as it is).
        Returns how many copies changed."""
        pid = part.get("id")
        with self.lock:
            parts = self.data.get("parts") or []
            old = next((p for p in parts if p["id"] == pid), None)
            if not old:
                raise KeyError("No such part")
            old.update({"name": str(part.get("name") or old["name"])[:60], "w": float(part.get("w") or old["w"]),
                        "h": float(part.get("h") or old["h"]), "layers": part.get("layers") or old["layers"]})
            n = 0
            for comp in self.data["compositions"]:
                copies = {}
                for i, l in enumerate(comp["layers"]):
                    if l.get("part") == pid and l.get("group"):
                        copies.setdefault(l["group"], []).append(i)
                for gid, idx in copies.items():
                    if keep and keep.get("comp") == comp["id"] and keep.get("group") == gid:
                        continue
                    was = [comp["layers"][i] for i in idx]
                    x0, y0 = min(l["x"] for l in was), min(l["y"] for l in was)
                    fields = {l.get("name"): l.get("field") for l in was if l.get("field")}
                    made = []
                    for src in old["layers"]:
                        l = copy.deepcopy(src)
                        l.update(id=new_id("l"), x=l["x"] + x0, y=l["y"] + y0, group=gid, part=pid)
                        if l.get("name") in fields:   # (the copy's own field names, so Control keeps working)
                            l["field"] = fields[l["name"]]
                        made.append(l)
                    first = idx[0]
                    comp["layers"] = [l for j, l in enumerate(comp["layers"]) if j not in set(idx)]
                    comp["layers"][first:first] = made
                    n += 1
            self.changed()
            return n

    def set_playlists(self, playlists):
        with self.lock:
            self.data["playlists"] = playlists
            self.changed()

    def order_comps(self, ids):
        with self.lock:
            by_id = {c["id"]: c for c in self.data["compositions"]}
            ordered = [by_id.pop(i) for i in ids if i in by_id]
            self.data["compositions"] = ordered + list(by_id.values())
            self.changed()

    def set_transitions(self, transitions, default=None):
        clean = []
        for t in transitions:
            if t.get("type") not in TRANSITION_TYPES:
                raise ValueError(f"Unknown transition type {t.get('type')!r}")
            t = dict(t)
            t.setdefault("id", new_id("t"))
            t.setdefault("name", t["type"].title())
            clean.append(t)
        if clean and not any(t.get("enabled", True) for t in clean):
            clean[0]["enabled"] = True
        with self.lock:
            self.data["transitions"] = clean
            if default is not None:
                self.data["default_transition"] = default
            if not any(t["id"] == self.data["default_transition"] for t in clean) and clean:
                self.data["default_transition"] = clean[0]["id"]
            self.changed()

    def set_global(self, g):
        with self.lock:
            self.data["global"] = g
            self.changed()

    def set_picture(self, name):
        with self.lock:
            self.data["picture"] = name
            self.changed()

    def set_sources(self, sources):
        with self.lock:
            self.data["sources"] = sources
            self.changed()

    def rename(self, name):
        with self.lock:
            self.data["name"] = str(name)[:80]
            self.changed()

    def set_stinger_delay(self, ms):
        """How long after a stinger TAKE the new graphics start their intro
        animations (ms; 0 = they cut in under the stinger, unanimated)."""
        try:
            ms = int(float(ms or 0))
        except (TypeError, ValueError):
            raise ValueError("The delay must be a number of milliseconds")
        with self.lock:
            self.data["stinger_anim_delay"] = max(0, min(ms, 60000))
            self.changed()

    # --- assets --------------------------------------------------------

    def asset_path(self, rel):
        """workspace/assets/... on disk for "assets/...", or None."""
        rel = rel.replace("\\", "/")
        if not rel.startswith("assets/"):
            return None
        path = os.path.normpath(os.path.join(self.folder, rel))
        root = os.path.normpath(self.assets_dir) + os.sep
        return path if path.startswith(root) else None

    def unique_asset(self, name, sub=""):
        """A free "assets/<sub>/<name>" (adds -2, -3 ... if taken) and its path on disk."""
        base, ext = os.path.splitext(os.path.basename(name.replace("\\", "/")))
        base = "".join(ch if ch.isalnum() or ch in " -_.()" else "_" for ch in base).strip() or "file"
        folder = os.path.join(self.assets_dir, sub) if sub else self.assets_dir
        os.makedirs(folder, exist_ok=True)
        n, candidate = 1, base + ext.lower()
        while os.path.exists(os.path.join(folder, candidate)):
            n += 1
            candidate = f"{base}-{n}{ext.lower()}"
        rel = "/".join(p for p in ("assets", sub.replace(os.sep, "/"), candidate) if p)
        return rel, os.path.join(folder, candidate)

    def touch_assets(self):
        """Files were added or changed: tell the pages."""
        with self.lock:
            self.changed()

    def delete_asset(self, rel):
        path = self.asset_path(rel)
        if not path or not os.path.exists(path):
            raise KeyError("No such file")
        if os.path.isdir(path):
            shutil.rmtree(path)
        else:
            os.remove(path)
        with self.lock:
            self.changed()

    def used_assets(self):
        """Every "assets/..." the project refers to."""
        found = set()

        def walk(v):
            if isinstance(v, dict):
                for x in v.values():
                    walk(x)
            elif isinstance(v, list):
                for x in v:
                    walk(x)
            elif isinstance(v, str) and v.startswith("assets/"):
                found.add(v)
        with self.lock:
            walk(self.data)
        return found
