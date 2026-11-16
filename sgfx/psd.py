"""Photoshop file -> a graphic. Every visible layer keeps its place: text layers stay live text (font,
size, colour, tracking, alignment), every other layer becomes a PNG (with its layer effects).
Groups are flattened, keeping their visibility and opacity. Layers with Photoshop's default names
("Layer 3", "Rectangle 5 copy") are fixed; named ones ("TEAM LEFT") become fields set from Control.
Needs psd-tools (pip install psd-tools).
"""
import io
import os
import re
import uuid

DEFAULT = re.compile(r"^(layer|rectangle|rounded rectangle|ellipse|line|shape|polygon|star|triangle|gradient fill|color fill|colour fill|"
                     r"pattern fill|group|vector smart object|path|background|curves|levels|hue/saturation|brightness/contrast)"
                     r"\s*\d*( copy( \d+)?)?(-\d+)?$", re.I)
SKIP = {"brightnesscontrast", "curves", "levels", "huesaturation", "colorbalance", "exposure", "vibrance", "blackandwhite",
        "photofilter", "channelmixer", "invert", "posterize", "threshold", "selectivecolor", "gradientmap", "colorlookup"}
BLEND = {"NORMAL": "normal", "MULTIPLY": "multiply", "SCREEN": "screen", "OVERLAY": "overlay", "DARKEN": "darken", "LIGHTEN": "lighten",
         "SOFT_LIGHT": "soft-light", "DIFFERENCE": "difference", "COLOR_DODGE": "color-dodge", "COLOR_BURN": "color-burn"}


def is_default(name):
    return bool(DEFAULT.match((name or "").strip()))


def safe(name):
    return "".join(c if c.isalnum() or c in " -_()" else "_" for c in (name or "layer")).strip() or "layer"


def font_name(postscript):
    """PostScript name -> family as the font files are known here (e.g. "Gotham-Bold" stays, "MyriadPro-Regular" -> "MyriadPro-Regular")."""
    return (postscript or "Inter").strip()


def _text(layer, ox, oy):
    ed, rs = layer.engine_dict, layer.resource_dict
    style = ed["StyleRun"]["RunArray"][0]["StyleSheet"]["StyleSheetData"]
    para = ed["ParagraphRun"]["RunArray"][0]["ParagraphSheet"]["Properties"]
    fonts = [f["Name"] for f in rs["FontSet"]]
    font = font_name(str(fonts[int(style.get("Font", 0))]).strip("'\""))
    scale = abs(float(layer.transform[3])) if layer.transform else 1.0
    size = float(style.get("FontSize", 24)) * scale
    fill = style.get("FillColor", {}).get("Values", [1, 1, 1, 1])
    color = "#%02x%02x%02x" % tuple(int(round(float(v) * 255)) for v in list(fill)[1:4])
    x1, y1, x2, y2 = layer.bbox
    pad = round(size * 0.25)
    out = {"type": "text", "text": str(layer.text).replace("\r", "\n").replace("\x03", "\n"), "font": font, "size": round(size, 1), "color": color,
           "tracking": int(style.get("Tracking", 0) or 0), "align": {0: "left", 1: "right", 2: "center"}.get(int(para.get("Justification", 0)), "left"),
           "valign": "middle", "fit": "shrink", "caps": bool(style.get("FontCaps") == 2),
           "x": x1 - ox - pad, "y": y1 - oy - pad, "w": x2 - x1 + 2 * pad, "h": y2 - y1 + 2 * pad}
    if out["align"] == "left":
        out["x"] += pad
    if style.get("Leading") and not style.get("AutoLeading", True):
        out["lineHeight"] = round(float(style["Leading"]) * scale / size, 2)
    return out


def convert(data, name, save_png):
    """(psd bytes, graphic name, save_png(rel_name, png_bytes) -> asset path) -> composition dict."""
    from psd_tools import PSDImage
    psd = PSDImage.open(io.BytesIO(data))
    ox = oy = 0
    boards = [l for l in psd if l.kind == "artboard"]
    if len(boards) == 1:
        ox, oy = boards[0].bbox[0], boards[0].bbox[1]
    W, H = (boards[0].width, boards[0].height) if len(boards) == 1 else (psd.width, psd.height)
    layers, used = [], set()

    def add(layer, visible, opacity):
        kind = layer.kind
        vis = visible and layer.visible
        op = opacity * (layer.opacity / 255.0)
        if kind in ("group", "artboard"):
            for child in layer:
                add(child, vis, op)
            return
        if kind in SKIP or layer.width <= 0 or layer.height <= 0:
            return
        lname = layer.name or "Layer"
        base = {"id": "l" + uuid.uuid4().hex[:8], "name": lname, "opacity": round(op, 3), "rotation": 0, "visible": vis,
                "blend": BLEND.get(getattr(layer.blend_mode, "name", "NORMAL"), "normal"), "field": "" if is_default(lname) else lname,
                "anim": {"in": {"type": "fade", "dur": 400, "delay": 0}, "out": {"type": "fade", "dur": 300, "delay": 0}}}
        if kind == "type":
            try:
                layers.append({**base, **_text(layer, ox, oy)})
                return
            except (KeyError, IndexError, TypeError, ValueError):
                pass   # (an odd text layer: kept as a picture)
        img = layer.composite()
        if img is None:
            return
        fname, n = safe(lname), 2
        while fname.lower() in used:
            fname, n = f"{safe(lname)}-{n}", n + 1
        used.add(fname.lower())
        buf = io.BytesIO()
        img.save(buf, "PNG", optimize=True)
        x1, y1 = layer.bbox[0], layer.bbox[1]
        layers.append({**base, "type": "image", "src": save_png(fname + ".png", buf.getvalue()), "fit": "fill",
                       "x": x1 - ox, "y": y1 - oy, "w": img.width, "h": img.height})

    for top in psd:
        add(top, True, 1.0)
    comp = {"name": name, "kind": "overlay", "layers": layers}
    if (W, H) != (1920, 1080) and W and H:   # (another size: scaled to fit the 1920 x 1080 page)
        k = min(1920 / W, 1080 / H)
        for l in layers:
            for key in ("x", "y", "w", "h"):
                l[key] = round(l[key] * k)
            if l["type"] == "text":
                l["size"] = round(l["size"] * k, 1)
    return comp
