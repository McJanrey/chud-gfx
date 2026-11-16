"""HUD Builder designs into Composer: each HUD becomes a graphic in the open workspace.

The HUD Builder kept its HUDs in huds/<id>/hud.json (layers in Composer's own format)
with their pictures in huds/<id>/assets/. Importing copies them; the originals stay.
{{HUD!name}} becomes a field called name (set from Control, like any graphic's).
"""

import copy
import json
import os
import re
import shutil

from . import config
from . import fonts as fontnames
from .project import blank_comp, new_id

HUD_TOKEN = re.compile(r"\{\{\s*HUD!([^{}]+?)\s*\}\}")
CONTENT = {"text": "text", "rect": "fill", "shape": "fill", "image": "src", "video": "src"}


def huds_dir():
    # (the HUD Builder ran inside GFX Baby with its data beside the app; from source, in its own folder)
    return os.path.join(config.DATA_DIR, "huds") if config.FROZEN else os.path.join(config.ROOT, "apps", "hudbuilder", "huds")


def list_huds(folder=None):
    folder = folder or huds_dir()
    out = []
    for hid in sorted(os.listdir(folder)) if os.path.isdir(folder) else []:
        try:
            with open(os.path.join(folder, hid, "hud.json"), encoding="utf-8") as f:
                hud = json.load(f)
        except (OSError, ValueError):
            continue
        if isinstance(hud, dict) and isinstance(hud.get("layers"), list):
            hud.setdefault("id", hid)
            out.append(hud)
    return out


def _value(hud, name):
    values = hud.get("values") or {}
    if name in values and values[name] not in (None, ""):
        return str(values[name])
    var = next((v for v in hud.get("vars") or [] if v.get("name") == name), None)
    return str(var.get("value", "")) if var else ""


def convert(hud, ws, library_dir, hud_folder):
    """The HUD as a Composer graphic (pictures copied into the workspace)."""
    comp = blank_comp(hud.get("name") or "HUD")
    comp.update(kind="overlay", from_hud=hud["id"])
    copied = {}

    def asset(src):
        if src in copied:
            return copied[src]
        path = os.path.normpath(os.path.join(hud_folder, src))
        if not path.startswith(os.path.normpath(hud_folder) + os.sep) or not os.path.isfile(path):
            return src
        if fontnames.is_font(path) and library_dir:
            os.makedirs(os.path.join(library_dir, "fonts"), exist_ok=True)
            dest = os.path.join(library_dir, "fonts", os.path.basename(path))
            if not os.path.exists(dest):
                shutil.copy(path, dest)
            copied[src] = "library/fonts/" + os.path.basename(path)
            return copied[src]
        rel, dest = ws.unique_asset(os.path.basename(path), sub=comp["name"])
        shutil.copy(path, dest)
        copied[src] = rel
        return rel

    for src in sorted(os.listdir(os.path.join(hud_folder, "assets"))) if os.path.isdir(os.path.join(hud_folder, "assets")) else []:
        if fontnames.is_font(src):
            asset("assets/" + src)   # (fonts the design uses come along to the shared library)

    for layer in hud["layers"]:
        if layer.get("reference"):
            continue   # (shown only while editing a HUD, never on air)
        l = copy.deepcopy(layer)
        l["id"] = new_id("l")
        key = CONTENT.get(l.get("type"))
        whole = HUD_TOKEN.fullmatch(str(l.get(key) or "").strip()) if key else None
        if whole:
            l["field"] = whole.group(1)
            l[key] = _value(hud, whole.group(1))
        for k, v in list(l.items()):
            if isinstance(v, str):
                v = HUD_TOKEN.sub(lambda m: _value(hud, m.group(1)), v)
                if v.startswith("assets/"):
                    v = asset(v)
                l[k] = v
        comp["layers"].append(l)
    return comp


def import_all(ws, library_dir=None, folder=None):
    """Every HUD not imported yet, as a graphic. Returns the new graphics' names."""
    folder = folder or huds_dir()
    have = {c.get("from_hud") for c in ws.get()["compositions"]}
    names = []
    for hud in list_huds(folder):
        if hud["id"] in have:
            continue
        comp = convert(hud, ws, library_dir, os.path.join(folder, hud["id"]))
        ws.add_comp(comp)
        names.append(comp["name"])
    if names:
        ws.touch_assets()
    return names
