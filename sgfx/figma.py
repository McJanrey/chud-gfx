"""Figma files (File > Save local copy, .fig) into a HUD: each top-level frame on the first page becomes a part,
scaled to 1920 wide; rectangles, frames and ellipses become boxes (fill, gradient, corners, outline), text stays text,
image fills become pictures (saved in the workspace's assets/figma/). Vector drawings are left out (counted).

A .fig is either a zip (canvas.fig + images/) or the canvas itself: "fig-kiwi", a version, then chunks (a 4-byte
length, then the bytes): the schema, then the document, each compressed (zstd or raw deflate). Both are in the
Kiwi format (github.com/evanw/kiwi): the schema describes the document's messages, so it's read first.
"""
import io
import math
import os
import re
import struct
import uuid
import zipfile
import zlib

# --- Kiwi --------------------------------------------------------------------------------------------
BUILTIN = {-1: "bool", -2: "byte", -3: "int", -4: "uint", -5: "float", -6: "string", -7: "int64", -8: "uint64"}


class Buf:
    def __init__(self, data):
        self.d, self.i = data, 0

    def byte(self):
        if self.i >= len(self.d):
            raise ValueError("The Figma file ends too soon")
        b = self.d[self.i]
        self.i += 1
        return b

    def uint(self):
        v, shift = 0, 0
        while True:
            b = self.byte()
            v |= (b & 127) << shift
            shift += 7
            if not b & 128 or shift >= 70:
                return v

    def int(self):
        v = self.uint()
        return (v >> 1) ^ -(v & 1)

    def float(self):
        b = self.byte()
        if b == 0:
            return 0.0
        if self.i + 3 > len(self.d):
            raise ValueError("The Figma file ends too soon")
        bits = b | (self.d[self.i] << 8) | (self.d[self.i + 1] << 16) | (self.d[self.i + 2] << 24)
        self.i += 3
        bits = ((bits << 23) | (bits >> 9)) & 0xFFFFFFFF
        return struct.unpack("<f", struct.pack("<I", bits))[0]

    def string(self):
        end = self.d.index(0, self.i)
        s = self.d[self.i:end].decode("utf-8", "replace")
        self.i = end + 1
        return s


def read_schema(data):
    b, defs = Buf(data), []
    for _ in range(b.uint()):
        name, kind = b.string(), b.byte()
        fields = []
        for _ in range(b.uint()):
            fname, ftype, arr, value = b.string(), b.int(), b.byte(), b.uint()
            fields.append((fname, ftype, bool(arr), value))
        defs.append({"name": name, "kind": kind, "fields": fields})   # (kind: 0 enum, 1 struct, 2 message)
    return defs


def decode(schema, data, root="Message"):
    by = {d["name"]: d for d in schema}
    b = Buf(data)

    def value(t, arr):
        if arr:
            return [value(t, False) for _ in range(b.uint())]
        if t < 0:
            kind = BUILTIN[t]
            return {"bool": lambda: b.byte() != 0, "byte": b.byte, "int": b.int, "uint": b.uint, "float": b.float, "string": b.string,
                    "int64": b.int, "uint64": b.uint}[kind]()
        d = schema[t]
        if d["kind"] == 0:
            v = b.uint()
            return next((f[0] for f in d["fields"] if f[3] == v), v)
        if d["kind"] == 1:
            return {f[0]: value(f[1], f[2]) for f in d["fields"]}
        out = {}
        while True:
            tag = b.uint()
            if tag == 0:
                return out
            f = next((f for f in d["fields"] if f[3] == tag), None)
            if f is None:
                raise ValueError("The Figma file doesn't match its own schema")
            out[f[0]] = value(f[1], f[2])

    if root not in by:
        raise ValueError("Not a Figma document")
    return value(schema.index(by[root]), False)


# --- the file -------------------------------------------------------------------------------------------
def _inflate(c):
    if c[:4] == b"\x28\xb5\x2f\xfd":
        try:
            from compression import zstd   # (Python 3.14)
            return zstd.decompress(c)
        except ImportError:
            import zstandard   # (the app's Python 3.13)
            return zstandard.ZstdDecompressor().decompressobj().decompress(c)
    try:
        return zlib.decompress(c, -15)
    except zlib.error:
        return zlib.decompress(c)


def read(blob):
    """(document, {image hash hex: bytes}) from a .fig file's bytes."""
    images = {}
    if blob[:2] == b"PK":
        try:
            z = zipfile.ZipFile(io.BytesIO(blob))
        except zipfile.BadZipFile:
            raise ValueError("That Figma file is damaged")
        names = z.namelist()
        canvas = next((n for n in names if n.endswith("canvas.fig")), None)
        if not canvas:
            raise ValueError("No canvas in that Figma file")
        for n in names:
            m = re.match(r"(?:.*/)?images/([0-9a-f]{40})$", n)
            if m and z.getinfo(n).file_size < 40 << 20:
                images[m.group(1)] = z.read(n)
        blob = z.read(canvas)
    if not (blob[:8] == b"fig-kiwi" or blob[:8] == b"fig-jam."):
        raise ValueError("That isn't a Figma file (save it with File > Save local copy)")
    i, chunks = 12, []
    while i + 4 <= len(blob) and len(chunks) < 2:
        n = struct.unpack("<I", blob[i:i + 4])[0]
        chunks.append(blob[i + 4:i + 4 + n])
        i += 4 + n
    if len(chunks) < 2:
        raise ValueError("That Figma file is damaged")
    return decode(read_schema(_inflate(chunks[0])), _inflate(chunks[1])), images


# --- into layers ---------------------------------------------------------------------------------------
def _gid(g):
    return f"{(g or {}).get('sessionID', 0)}:{(g or {}).get('localID', 0)}"


def _mul(a, b):   # 2x3 affine: a after b
    return (a[0] * b[0] + a[1] * b[3], a[0] * b[1] + a[1] * b[4], a[0] * b[2] + a[1] * b[5] + a[2],
            a[3] * b[0] + a[4] * b[3], a[3] * b[1] + a[4] * b[4], a[3] * b[2] + a[4] * b[5] + a[5])


def _mat(t):
    t = t or {}
    return (t.get("m00", 1), t.get("m01", 0), t.get("m02", 0), t.get("m10", 0), t.get("m11", 1), t.get("m12", 0))


def _css(c, op=1.0):
    c = c or {}
    a = max(0.0, min(1.0, c.get("a", 1) * op))
    r, g, b = (max(0, min(255, round(c.get(k, 0) * 255))) for k in "rgb")
    return f"#{r:02x}{g:02x}{b:02x}" if a >= 0.999 else f"rgba({r},{g},{b},{a:.3f})"


def _paint(p):
    """A Figma paint as a CSS colour / gradient, or ("image", hash), or None."""
    if not p or p.get("visible") is False:
        return None
    op = p.get("opacity", 1)
    t = p.get("type")
    if t == "SOLID":
        return _css(p.get("color"), op)
    if t and t.startswith("GRADIENT"):
        stops = sorted(p.get("stops") or [], key=lambda s: s.get("position", 0))
        if not stops:
            return None
        m = _mat(p.get("transform"))
        # (the paint's transform maps the box to gradient space; its first row's direction gives the angle)
        ang = (math.degrees(math.atan2(m[1], m[0])) + 90) % 360
        body = ", ".join(f"{_css(s.get('color'), op)} {s.get('position', 0) * 100:.1f}%" for s in stops)
        return f"radial-gradient(ellipse at center, {body})" if t == "GRADIENT_RADIAL" else f"linear-gradient({ang:.0f}deg, {body})"
    if t == "IMAGE":
        h = (p.get("image") or {}).get("hash")
        if isinstance(h, list) and h:
            return ("image", bytes(h).hex())
    return None


WEIGHT = {"thin": 100, "extralight": 200, "light": 300, "regular": 400, "medium": 500, "semibold": 600, "bold": 700, "extrabold": 800, "black": 900, "heavy": 900}


def _weight(style):
    s = re.sub(r"[\s-]", "", str(style or "").lower())
    for k in sorted(WEIGHT, key=len, reverse=True):
        if k in s:
            return WEIGHT[k]
    return 400


def layers_of(doc, save_image):
    """[(frame name, [layers])] for each top-level frame on the first page; plus how many vector shapes were left out."""
    nodes = [n for n in doc.get("nodeChanges") or [] if isinstance(n, dict) and n.get("guid")]
    kids = {}
    for n in nodes:
        p = n.get("parentIndex")
        if p:
            kids.setdefault(_gid(p.get("guid")), []).append(n)
    for lst in kids.values():
        lst.sort(key=lambda n: str((n.get("parentIndex") or {}).get("position", "")))
    doc_node = next((n for n in nodes if n.get("type") == "DOCUMENT"), None)
    pages = kids.get(_gid(doc_node["guid"]), []) if doc_node else [n for n in nodes if n.get("type") == "CANVAS"]
    page = next((p for p in pages if p.get("type") == "CANVAS" and p.get("visible") is not False), None)
    if not page:
        raise ValueError("No page in that Figma file")
    frames = [f for f in kids.get(_gid(page["guid"]), []) if f.get("type") in ("FRAME", "SECTION", "COMPONENT") and f.get("visible") is not False]
    if not frames:
        raise ValueError("No frames on the first page of that Figma file")
    skipped, out = 0, []
    for fr in frames:
        size = fr.get("size") or {}
        k = 1920 / max(1.0, size.get("x", 1920))
        layers = []
        base = (1, 0, 0, 0, 1, 0)   # (a child's transform is already relative to its parent: the frame is 0, 0)

        def walk(n, m, op):
            nonlocal skipped
            if n.get("visible") is False:
                return
            mm = _mul(m, _mat(n.get("transform")))
            op2 = op * n.get("opacity", 1)
            sz = n.get("size") or {}
            w, h = sz.get("x", 0) * k, sz.get("y", 0) * k
            x, y = mm[2] * k, mm[5] * k
            rot = math.degrees(math.atan2(mm[3], mm[0]))
            t, name = n.get("type"), str(n.get("name") or n.get("type") or "")[:80]
            common = {"id": "l" + uuid.uuid4().hex[:8], "name": name, "x": round(x, 1), "y": round(y, 1), "w": round(w, 1), "h": round(h, 1),
                      "opacity": round(op2, 3), "rotation": round(rot, 2) if abs(rot) > 0.05 else 0, "visible": True, "blend": "normal"}
            if t == "TEXT":
                td = n.get("textData") or {}
                fills = [f for f in (_paint(p) for p in n.get("fillPaints") or []) if isinstance(f, str)]
                fn = n.get("fontName") or {}
                align = {"LEFT": "left", "CENTER": "center", "RIGHT": "right", "JUSTIFIED": "left"}.get(n.get("textAlignHorizontal"), "left")
                layers.append(dict(common, type="text", text=str(td.get("characters") or ""), font=fn.get("family") or "Inter", weight=_weight(fn.get("style")),
                                   size=round((n.get("fontSize") or 16) * k, 1), color=fills[-1] if fills else "#000000", align=align, valign="middle",
                                   caps=n.get("textCase") == "UPPER", fit="none", lineHeight=1.15, italic="italic" in str(fn.get("style", "")).lower()))
            elif t in ("RECTANGLE", "ROUNDED_RECTANGLE", "FRAME", "ELLIPSE", "COMPONENT", "INSTANCE", "GROUP", "SECTION"):
                if t != "GROUP":
                    radius = 9999 if t == "ELLIPSE" else round((n.get("cornerRadius") or 0) * k, 1)
                    corners = [n.get(f"rectangle{c}CornerRadius") for c in ("TopLeft", "TopRight", "BottomRight", "BottomLeft")]
                    if t != "ELLIPSE" and any(c is not None for c in corners) and n.get("rectangleCornerRadiiIndependent"):
                        radius = " ".join(str(round((c or 0) * k, 1)) for c in corners)
                    strokes = [s for s in (_paint(p) for p in n.get("strokePaints") or []) if isinstance(s, str)]
                    sw = round((n.get("strokeWeight") or 0) * k, 1) if strokes else 0
                    for p in n.get("fillPaints") or []:
                        f = _paint(p)
                        if isinstance(f, tuple):
                            src = save_image(f[1])
                            if src:
                                fit = {"FILL": "cover", "FIT": "contain", "STRETCH": "fill"}.get(p.get("imageScaleMode"), "cover")
                                layers.append(dict(common, id="l" + uuid.uuid4().hex[:8], type="image", src=src, fit=fit, radius=radius if radius else 0))
                        elif f:
                            layers.append(dict(common, id="l" + uuid.uuid4().hex[:8], type="rect", fill=f, radius=radius, stroke=strokes[-1] if strokes else "#000000", strokeWidth=sw))
                            sw = 0   # (the outline once)
                    if sw:
                        layers.append(dict(common, type="rect", fill="transparent", radius=radius, stroke=strokes[-1], strokeWidth=sw))
                for c in kids.get(_gid(n["guid"]), []):
                    walk(c, mm, op2)
            elif t in ("VECTOR", "STAR", "LINE", "REGULAR_POLYGON", "BOOLEAN_OPERATION"):
                skipped += 1

        for c in kids.get(_gid(fr["guid"]), []):
            walk(c, base, 1.0)
        out.append((str(fr.get("name") or "Frame")[:80], layers))
    return out, skipped


def import_into(engine, hud, blob):
    """Adds a part per frame to the HUD (a dict from huds.find). Returns (parts, layers, vectors left out)."""
    doc, images = read(blob)
    folder = os.path.join(engine.folder, "assets", "figma")

    def save_image(h):
        data = images.get(h)
        if not data:
            return ""
        ext = ".png" if data[:4] == b"\x89PNG" else ".jpg" if data[:2] == b"\xff\xd8" else ".gif" if data[:3] == b"GIF" else ".png"
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, h[:16] + ext)
        if not os.path.isfile(path):
            with open(path, "wb") as f:
                f.write(data)
        return f"assets/figma/{h[:16]}{ext}"

    frames, skipped = layers_of(doc, save_image)
    n = 0
    for name, layers in frames:
        hud["parts"].append({"id": uuid.uuid4().hex[:8], "name": name, "on": True, "layers": layers})
        n += len(layers)
    return len(frames), n, skipped
