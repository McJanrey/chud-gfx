import io
import os
import struct
import tempfile
import unittest
import zipfile
try:
    from compression import zstd
except ImportError:   # (Python 3.13: the zstandard package)
    import zstandard

    class zstd:
        compress = staticmethod(lambda b: zstandard.ZstdCompressor().compress(b))

from sgfx import figma


# --- a tiny Kiwi writer: a .fig the way Figma saves one (its own schema first, then the document) ---------
def uint(v):
    out = bytearray()
    while True:
        b = v & 127
        v >>= 7
        out.append(b | (128 if v else 0))
        if not v:
            return bytes(out)


def sint(v):
    return uint((v << 1) ^ (v >> 63) if v < 0 else v << 1)


def flt(f):
    if f == 0:
        return b"\x00"
    bits = struct.unpack("<I", struct.pack("<f", f))[0]
    return struct.pack("<I", ((bits << 9) | (bits >> 23)) & 0xFFFFFFFF)


def s(t):
    return t.encode() + b"\x00"


T = {"bool": -1, "byte": -2, "uint": -4, "float": -5, "string": -6}
DEFS = [("NodeType", 0, [("DOCUMENT", 0, 0, 1), ("CANVAS", 0, 0, 2), ("FRAME", 0, 0, 3), ("TEXT", 0, 0, 4), ("RECTANGLE", 0, 0, 5), ("VECTOR", 0, 0, 7)]),
        ("PaintType", 0, [("SOLID", 0, 0, 1), ("IMAGE", 0, 0, 2)]),
        ("GUID", 1, [("sessionID", T["uint"], 0, 1), ("localID", T["uint"], 0, 2)]),
        ("Color", 1, [("r", T["float"], 0, 1), ("g", T["float"], 0, 2), ("b", T["float"], 0, 3), ("a", T["float"], 0, 4)]),
        ("Vector", 1, [("x", T["float"], 0, 1), ("y", T["float"], 0, 2)]),
        ("Matrix", 1, [(k, T["float"], 0, i + 1) for i, k in enumerate(("m00", "m01", "m02", "m10", "m11", "m12"))]),
        ("ParentIndex", 2, [("guid", 2, 0, 1), ("position", T["string"], 0, 2)]),
        ("Image", 2, [("hash", T["byte"], 1, 1)]),
        ("Paint", 2, [("type", 1, 0, 1), ("color", 3, 0, 2), ("opacity", T["float"], 0, 3), ("visible", T["bool"], 0, 4), ("image", 7, 0, 5)]),
        ("TextData", 2, [("characters", T["string"], 0, 1)]),
        ("FontName", 2, [("family", T["string"], 0, 1), ("style", T["string"], 0, 2)]),
        ("NodeChange", 2, [("guid", 2, 0, 1), ("parentIndex", 6, 0, 2), ("type", 0, 0, 3), ("name", T["string"], 0, 4), ("visible", T["bool"], 0, 5),
                           ("opacity", T["float"], 0, 6), ("size", 4, 0, 7), ("transform", 5, 0, 8), ("fillPaints", 8, 1, 9), ("textData", 9, 0, 10),
                           ("fontSize", T["float"], 0, 11), ("fontName", 10, 0, 12), ("cornerRadius", T["float"], 0, 13)]),
        ("Message", 2, [("nodeChanges", 11, 1, 1)])]


def schema():
    out = uint(len(DEFS))
    for name, kind, fields in DEFS:
        out += s(name) + bytes([kind]) + uint(len(fields))
        for fname, ftype, arr, val in fields:
            out += s(fname) + sint(ftype) + bytes([arr]) + uint(val)
    return out


def enc(tname, v):
    if tname in T:
        t = T[tname]
        return {-1: lambda: bytes([1 if v else 0]), -2: lambda: bytes([v]), -4: lambda: uint(v), -5: lambda: flt(v), -6: lambda: s(v)}[t]()
    d = next(x for x in DEFS if x[0] == tname)
    name_of = lambda t: next(k for k, n in T.items() if n == t) if t < 0 else DEFS[t][0]
    if d[1] == 0:
        return uint(next(f[3] for f in d[2] if f[0] == v))
    if d[1] == 1:
        return b"".join(enc(name_of(f[1]), v[f[0]]) for f in d[2])
    out = b""
    for f in d[2]:
        if f[0] in v:
            out += uint(f[3]) + (uint(len(v[f[0]])) + b"".join(enc(name_of(f[1]), x) for x in v[f[0]]) if f[2] else enc(name_of(f[1]), v[f[0]]))
    return out + uint(0)


def node(i, parent, typ, name, x=0, y=0, w=0, h=0, **kw):
    n = {"guid": {"sessionID": 1, "localID": i}, "type": typ, "name": name, "size": {"x": w, "y": h},
         "transform": {"m00": 1, "m01": 0, "m02": x, "m10": 0, "m11": 1, "m12": y}}
    if parent is not None:
        n["parentIndex"] = {"guid": {"sessionID": 1, "localID": parent}, "position": chr(33 + i)}
    n.update(kw)
    return n


HASH = bytes(range(20))


def fig_file():
    nodes = [node(0, None, "DOCUMENT", "Doc"), node(1, 0, "CANVAS", "Page 1"),
             node(2, 1, "FRAME", "Scorebug", 500, 300, 960, 540),
             node(3, 2, "RECTANGLE", "Red box", 10, 20, 100, 50, cornerRadius=5.0,
                  fillPaints=[{"type": "SOLID", "color": {"r": 1.0, "g": 0.0, "b": 0.0, "a": 1.0}, "opacity": 1.0, "visible": True}]),
             node(4, 2, "TEXT", "Score", 200, 10, 80, 30, textData={"characters": "SCORE"}, fontSize=20.0, fontName={"family": "Inter", "style": "Bold"},
                  fillPaints=[{"type": "SOLID", "color": {"r": 1.0, "g": 1.0, "b": 1.0, "a": 1.0}, "opacity": 1.0, "visible": True}]),
             node(5, 2, "RECTANGLE", "Logo", 300, 100, 64, 64, fillPaints=[{"type": "IMAGE", "image": {"hash": list(HASH)}, "opacity": 1.0, "visible": True}]),
             node(6, 2, "VECTOR", "Swoosh", 0, 0, 10, 10)]
    canvas = b"fig-kiwi" + struct.pack("<I", 15)
    for chunk in (zstd.compress(schema()), zstd.compress(enc("Message", {"nodeChanges": nodes}))):
        canvas += struct.pack("<I", len(chunk)) + chunk
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("canvas.fig", canvas)
        f.writestr("images/" + HASH.hex(), b"\x89PNG fake")
    return z.getvalue()


class Figma(unittest.TestCase):
    def test_frame_becomes_a_part_scaled_to_1920(self):
        class E:
            folder = tempfile.mkdtemp()
        hud = {"parts": []}
        parts, layers, skipped = figma.import_into(E, hud, fig_file())
        self.assertEqual((parts, layers, skipped), (1, 3, 1))
        p = hud["parts"][0]
        self.assertEqual(p["name"], "Scorebug")
        box, text, logo = p["layers"]
        self.assertEqual((box["type"], box["x"], box["y"], box["w"], box["h"], box["radius"], box["fill"]), ("rect", 20, 40, 200, 100, 10, "#ff0000"))
        self.assertEqual((text["type"], text["text"], text["size"], text["weight"], text["color"], text["x"]), ("text", "SCORE", 40, 700, "#ffffff", 400))
        self.assertEqual((logo["type"], logo["src"]), ("image", "assets/figma/" + HASH.hex()[:16] + ".png"))
        self.assertTrue(os.path.isfile(os.path.join(E.folder, "assets", "figma", HASH.hex()[:16] + ".png")))

    def test_not_a_figma_file(self):
        with self.assertRaises(ValueError):
            figma.read(b"hello")
