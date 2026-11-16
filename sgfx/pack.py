"""Graphic packs: some graphics (or a whole workspace) with the files they use, in one zip.

A pack: pack.json = {format: "standby-gfx", version: 1, name, compositions, sources, files: [paths]} and
files/<path>. Packs from GFX Baby (.chudgfx: chud-gfx.json, same shape) open too.
"""
import hashlib
import io
import json
import os
import re
import uuid
import zipfile

READ = ("pack.json", "chud-gfx.json")


def _paths(obj, found):
    """Every assets/... path a graphic points at (in any string, also inside {{...}} fallbacks)."""
    if isinstance(obj, dict):
        for v in obj.values():
            _paths(v, found)
    elif isinstance(obj, list):
        for v in obj:
            _paths(v, found)
    elif isinstance(obj, str) and "assets/" in obj:
        for m in re.finditer(r"assets/[^\"'{}|<>]+?\.[A-Za-z0-9]{2,5}\b", obj):
            found.add(m.group(0))
    return found


def export(folder, name, comps, sources=()):
    files = sorted(p for p in _paths(list(comps) + list(sources), set()) if os.path.isfile(os.path.join(folder, p)))
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("pack.json", json.dumps({"format": "standby-gfx", "version": 1, "name": name, "compositions": list(comps),
                                            "sources": list(sources), "files": files}, indent=1))
        for p in files:
            z.write(os.path.join(folder, p), "files/" + p)
    return buf.getvalue()


def _sha(data):
    return hashlib.sha1(data).hexdigest()


def import_pack(data, folder, existing_ids, existing_names):
    """Unpack into a workspace folder. -> (compositions, sources) ready to add (new ids, renamed files rewritten)."""
    z = zipfile.ZipFile(io.BytesIO(data))
    meta_name = next((n for n in READ if n in z.namelist()), None)
    if not meta_name:
        raise ValueError("Not a graphic pack")
    meta = json.loads(z.read(meta_name))
    if meta.get("format") not in ("standby-gfx", "chud-gfx"):
        raise ValueError("Not a graphic pack")
    rename = {}
    base = os.path.realpath(folder)
    for n in z.namelist():
        if not n.startswith("files/assets/") or n.endswith("/"):
            continue
        rel = n[len("files/"):]
        dst = os.path.realpath(os.path.join(folder, rel))
        if not dst.startswith(os.path.join(base, "assets") + os.sep):
            continue   # (a path that climbs out of assets/: skipped)
        blob = z.read(n)
        if os.path.exists(dst):
            with open(dst, "rb") as f:
                if _sha(f.read()) == _sha(blob):
                    continue
            stem, ext = os.path.splitext(dst)
            k = 2
            while os.path.exists(f"{stem}-{k}{ext}"):
                k += 1
            dst = f"{stem}-{k}{ext}"
            rename[rel] = os.path.relpath(dst, base).replace(os.sep, "/")
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        with open(dst, "wb") as f:
            f.write(blob)

    def fix(obj):
        if isinstance(obj, dict):
            return {k: fix(v) for k, v in obj.items()}
        if isinstance(obj, list):
            return [fix(v) for v in obj]
        if isinstance(obj, str):
            for a, b in rename.items():
                obj = obj.replace(a, b)
        return obj

    comps = []
    names = set(n.lower() for n in existing_names)
    for c in meta.get("compositions") or []:
        if not isinstance(c, dict) or not isinstance(c.get("layers"), list):
            continue
        c = fix(c)
        if c.get("id") in existing_ids or not c.get("id"):
            c["id"] = "c" + uuid.uuid4().hex[:8]
        name, k = c.get("name") or "Graphic", 2
        while name.lower() in names:
            name, k = f"{c.get('name') or 'Graphic'} ({k})", k + 1
        c["name"] = name
        names.add(name.lower())
        comps.append(c)
    return comps, [fix(s) for s in meta.get("sources") or [] if isinstance(s, dict)]
