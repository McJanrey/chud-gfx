"""This PC's screens (for screen readers: which one the game is on), and a small live picture of each."""
import io


def listing():
    """[{"n": 1.., "w", "h", "x", "y", "main"}], numbered the way the readers count them."""
    import mss
    with mss.MSS() as s:
        mons = s.monitors[1:] or s.monitors
        return [{"n": i, "w": m["width"], "h": m["height"], "x": m["left"], "y": m["top"], "main": m["left"] == 0 and m["top"] == 0}
                for i, m in enumerate(mons, 1)]


def thumb(n, width=360):
    """A JPEG of screen n, `width` wide (None: no such screen)."""
    import mss
    from PIL import Image
    with mss.MSS() as s:
        mons = s.monitors[1:] or s.monitors
        if not 1 <= n <= len(mons):
            return None
        g = s.grab(mons[n - 1])
        im = Image.frombytes("RGB", g.size, g.rgb)
    im.thumbnail((width, width))
    out = io.BytesIO()
    im.save(out, "JPEG", quality=70)
    return out.getvalue()
