"""The VALORANT screen reader: VALORANT gives no live match data, so this reads the spectator / replay screen.

Every frame is scaled to 1920x1080 first, so the positions below work at any resolution. What it reads:
  - the top bar (always on): both scores, the round timer, which players are alive and their health bars;
  - the centre banner: "ROUND n" and the buy phase;
  - the Tab scoreboard, while it's open: names, ultimate points, kills / deaths / assists, credits, weapon and armor, and which
    side (DEF / ATK) each team is on.
Numbers are read by matching each digit's shape against the HUD's own digits (val_glyphs.json, learnt from real
frames: Windows' text recognition is unreliable on lone digits); names and banners by Windows' text recognition.

parse(frame) -> a partial update in the shape /api/val/ingest takes. Reader(engine).run() captures a screen over and
over and feeds the changes in.
"""
import json
import os
import re
import threading
import time

import numpy as np
from PIL import Image, ImageOps

from . import winocr

W, H = 1920, 1080
GW, GH = 16, 24                      # every digit is compared at this size
LEFT_SLOTS = (465, 531, 597, 663, 729)      # top bar agent icons (x centres), teal team
RIGHT_SLOTS = (1191, 1257, 1323, 1389, 1455)  # red team
BAR_Y = 78                                   # health bars under the icons
ROWS_TOP = (356, 390, 424, 458, 492)         # Tab scoreboard rows (y centres), teal team
ROWS_BOTTOM = (586, 620, 654, 688, 722)      # red team
COLS = {"name": (640, 815), "ult": (835, 915), "k": (938, 970), "d": (978, 1010), "a": (1018, 1050), "credits": (1215, 1290)}


# --- digits by shape ---------------------------------------------------------------------------------
def _mask(crop, th=None):
    """Bright text (white / light grey) on whatever is behind it -> bool array."""
    a = np.asarray(crop.convert("L"), dtype=np.int16)
    if th is None:
        hi = int(np.percentile(a, 99.5))
        th = max(120, hi - 70)
    return a >= th


def glyphs(crop, th=None):
    """The characters in a crop, left to right, each as a GWxGH float array (columns of text split by gaps)."""
    m = _mask(crop, th)
    cols = m.any(axis=0)
    out, x = [], 0
    while x < len(cols):
        if not cols[x]:
            x += 1
            continue
        x0 = x
        while x < len(cols) and cols[x]:
            x += 1
        g = m[:, x0:x]
        rows = np.where(g.any(axis=1))[0]
        if len(rows) == 0:
            continue
        g = g[rows[0]:rows[-1] + 1]
        if g.shape[0] < 4:          # (a dot, a speck, the comma's tail)
            continue
        out.append((x0, g.shape[0], np.asarray(Image.fromarray((g * 255).astype(np.uint8)).resize((GW, GH)), dtype=np.float32) / 255))
    if not out:
        return []
    tall = max(h for _, h, _ in out)
    return [a for _, h, a in out if h >= tall * 0.6]   # (a colon or a comma is short: dropped)


_bank = None


def bank():
    global _bank
    if _bank is None:
        p = os.path.join(os.path.dirname(__file__), "val_glyphs.json")
        try:
            with open(p, encoding="utf-8") as f:
                raw = json.load(f)
            _bank = {c: [np.array(t, dtype=np.float32).reshape(GH, GW) for t in ts] for c, ts in raw.items()}
        except (OSError, ValueError):
            _bank = {}
    return _bank


def char(g):
    best, cbest = 9e9, None
    for c, ts in bank().items():
        for t in ts:
            d = float(np.abs(g - t).mean())
            if d < best:
                best, cbest = d, c
    return cbest if best < 0.22 else None


def digits(crop, th=None):
    """The number in a crop ('' if it can't be read)."""
    s = "".join(c or "?" for c in (char(g) for g in glyphs(crop, th))).replace("c", "")   # (c = the credits sign)
    return "" if "?" in s else s


def number(crop, th=None):
    s = digits(crop, th).replace("/", "")
    return int(s) if s.isdigit() else None


# --- the screen ----------------------------------------------------------------------------------------
def normalise(img):
    img = img.convert("RGB")
    if img.size == (W, H):
        return img
    k = H / img.height                     # (the spectator HUD scales with the height, centred)
    img = img.resize((round(img.width * k), H))
    x0 = (img.width - W) // 2
    return img.crop((x0, 0, x0 + W, H)) if x0 >= 0 else img.resize((W, H))


def _bar(img, x, y=BAR_Y):
    """A health bar under an icon: None if there's none (dead), else how full it is (0-100)."""
    a = np.asarray(img.crop((x - 26, y - 3, x + 26, y + 3)).convert("L"), dtype=np.int16)
    lit = (a > 150).any(axis=0)
    n = int(lit.sum())
    return None if n < 4 else min(100, round(n / 42 * 100))


def _text(img, box, scale=2):
    try:
        return winocr.text(img.crop(box), scale)
    except Exception:
        return ""


def _icon(img, box):
    """An agent portrait as a small grey patch, normalised (so a greyed-out dead portrait still matches)."""
    a = np.asarray(img.crop(box).convert("L").resize((20, 20)), dtype=np.float32)
    return (a - a.mean()) / (a.std() + 1e-3)


def match_slots(img, team, rows_y):
    """Which top-bar slot (1-5) each scoreboard row is, by comparing its agent portrait with the top bar's."""
    slots = LEFT_SLOTS if team == 0 else RIGHT_SLOTS
    tops = [_icon(img, (x - 20, 32, x + 20, 70)) for x in slots]
    rows = [_icon(img, (574, y - 15, 604, y + 15)) for y in rows_y]
    score = np.array([[float((r * t).mean()) for t in tops] for r in rows])
    out, used = {}, set()
    for _ in range(len(rows)):   # (greedy: the surest pair first)
        i, j = np.unravel_index(np.argmax(np.where(np.isin(np.arange(5), list(used))[None, :] | np.isin(np.arange(len(rows)), list(out))[:, None], -9, score)), score.shape)
        out[int(i)], _ = int(j) + 1, used.add(int(j))
    return out


# --- agents: official icons from valorant-api.com, kept on this PC ---------------------------------------
AGENT_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "StandBy GFX", "val-agents")
_agents = None


def _norm(im):
    a = np.asarray(im.convert("RGB").resize((32, 32)), dtype=np.float32)
    a = a - a.mean((0, 1))
    return a / (a.std() + 1e-3)


def agents():
    """[(name, uuid, normalised icon)] for every playable agent (fetched once, then from the folder)."""
    global _agents
    if _agents is not None:
        return _agents
    import urllib.request
    os.makedirs(AGENT_DIR, exist_ok=True)
    lst = os.path.join(AGENT_DIR, "agents.json")
    get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "StandBy GFX"}), timeout=15).read()
    try:
        if not os.path.isfile(lst) or time.time() - os.path.getmtime(lst) > 3 * 86400:   # (new agents show up)
            data = json.loads(get("https://valorant-api.com/v1/agents?isPlayableCharacter=true"))["data"]
            with open(lst, "w", encoding="utf-8") as f:
                json.dump([[a["uuid"], a["displayName"]] for a in data], f)
    except Exception:
        pass
    out = []
    try:
        with open(lst, encoding="utf-8") as f:
            items = json.load(f)
    except (OSError, ValueError):
        items = []
    for uid, name in items:
        pic = os.path.join(AGENT_DIR, uid + ".png")
        try:
            if not os.path.isfile(pic):
                with open(pic, "wb") as f:
                    f.write(get(f"https://media.valorant-api.com/agents/{uid}/displayicon.png"))
            icon = Image.open(pic).convert("RGBA")
        except Exception:
            continue
        for bg in ((60, 60, 60), (30, 120, 110), (150, 50, 50)):   # (the top bar's teal / red / grey behind the portrait)
            b = Image.new("RGBA", icon.size, bg + (255,))
            b.alpha_composite(icon)
            out.append((name, uid, _norm(b)))
    _agents = out if out else None
    return out


def agent_at(img, team, slot):
    """(name, uuid) of the agent in a top-bar slot (the right team's portraits face left: mirrored back first)."""
    refs = agents()
    if not refs:
        return None
    x = (LEFT_SLOTS if team == 0 else RIGHT_SLOTS)[slot - 1]
    c = img.crop((x - 22, 30, x + 22, 72))
    q = _norm(ImageOps.mirror(c) if team else c)
    score, name, uid = max((float((q * r).mean()), n, u) for n, u, r in refs)
    return (name, uid) if score > 0.35 else None


# --- loadout: official weapon and armor silhouettes from valorant-api.com, kept on this PC -----------------------
GEAR_DIR = os.path.join(os.path.dirname(AGENT_DIR), "val-gear")
ARMOR = {"heavy": "822bcab2-40a2-324e-c137-e09195ad7692", "light": "4dec83d5-4902-9ab3-bed6-a7a390761157", "regen": "b1b9086d-41bd-a516-5d29-e3b34a6f1644"}
WEAPON_BOX, ARMOR_BOX = (1065, 1165), (1170, 1215)   # Tab scoreboard loadout column (x), per row
_gear = None


def _shape(mask, size):
    """A white silhouette cut to its own outline and scaled to one size, plus its width / height."""
    ys, xs = np.where(mask)
    if len(xs) < 20:
        return None
    m = Image.fromarray((mask[ys.min():ys.max() + 1, xs.min():xs.max() + 1] * 255).astype(np.uint8)).resize(size)
    return np.asarray(m) > 127, (xs.max() - xs.min() + 1) / (ys.max() - ys.min() + 1)


def _iou(a, b):
    return float(np.logical_and(a, b).sum() / max(1, np.logical_or(a, b).sum()))


def gear():
    """{"weapons": [(name, uuid, silhouette, aspect)], "armor": [(kind, silhouette)]} (fetched once, then from the folder)."""
    global _gear
    if _gear is not None:
        return _gear
    import urllib.request
    os.makedirs(GEAR_DIR, exist_ok=True)
    get = lambda u: urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "StandBy GFX"}), timeout=15).read()
    lst = os.path.join(GEAR_DIR, "weapons.json")
    try:
        if not os.path.isfile(lst) or time.time() - os.path.getmtime(lst) > 7 * 86400:
            data = json.loads(get("https://valorant-api.com/v1/weapons"))["data"]
            with open(lst, "w", encoding="utf-8") as f:
                json.dump([[w["uuid"], w["displayName"]] for w in data], f)
        with open(lst, encoding="utf-8") as f:
            items = json.load(f)
    except (OSError, ValueError):
        items = []

    def pic(url, name):
        path = os.path.join(GEAR_DIR, name)
        if not os.path.isfile(path):
            with open(path, "wb") as f:
                f.write(get(url))
        return np.asarray(Image.open(path).convert("RGBA"))[..., 3] > 100
    out = {"weapons": [], "armor": []}
    for uid, name in items:
        try:
            sh = _shape(pic(f"https://media.valorant-api.com/weapons/{uid}/killstreamicon.png", uid + ".png"), (64, 20))
        except Exception:
            continue
        if sh:
            out["weapons"].append((name, uid, *sh))
    for kind, uid in ARMOR.items():
        try:
            sh = _shape(pic(f"https://media.valorant-api.com/gear/{uid}/displayicon.png", "armor-" + uid + ".png"), (24, 24))
        except Exception:
            continue
        if sh:
            out["armor"].append((kind, sh[0]))
    _gear = out if out["weapons"] else None
    return out


def loadout(img, y):
    """(weapon (name, uuid) or None, armor kind or None) in one scoreboard row; a dead player's row is empty."""
    g = gear() or {"weapons": [], "armor": []}
    grey = img.convert("L")
    weapon = armor = None
    q = _shape(np.asarray(grey.crop((WEAPON_BOX[0], y - 14, WEAPON_BOX[1], y + 14))) > 200, (64, 20))
    if q and g["weapons"]:
        score, name, uid = max((_iou(q[0], r) - 0.15 * abs(np.log(q[1] / ar)), n, u) for n, u, r, ar in g["weapons"])
        weapon = (name, uid) if score > 0.6 else None
    q = _shape(np.asarray(grey.crop((ARMOR_BOX[0], y - 14, ARMOR_BOX[1], y + 14))) > 200, (24, 24))
    if q and g["armor"]:
        score, kind = max((_iou(q[0], r), k) for k, r in g["armor"])
        armor = kind if score > 0.6 else None
    return weapon, armor


def spike_planted(img):
    """While the spike is planted the round timer is replaced by a red spike icon."""
    a = np.asarray(img.crop((915, 18, 1005, 92)), dtype=np.int16)
    red = (a[..., 0] > 170) & (a[..., 1] < 90) & (a[..., 2] < 90)
    return red.mean() > 0.12


def scoreboard_open(img):
    return "ULTIMATE" in _text(img, (572, 312, 1348, 334)).upper()


def parse(img):
    """One frame -> a partial update for /api/val/ingest (only what could be read)."""
    img = normalise(img)
    out = {}
    teams = [{}, {}]
    for i, box in enumerate(((795, 28, 850, 72), (1070, 28, 1125, 72))):
        n = number(img.crop(box), 243)   # (pure white digits on a see-through, sometimes light, panel)
        if n is None:
            n = number(img.crop(box))
        if n is not None and n < 30:
            teams[i]["score"] = n
    if spike_planted(img):
        out["spike"], out["phase"] = "planted", "combat"
    else:
        out["spike"] = ""
        t = _text(img, (895, 22, 1025, 78), 3)
        m = re.search(r"(\d{1,2})[:.](\d\d)", t)
        d = digits(img.crop((895, 22, 1025, 78)))
        if m:
            out["timer"] = f"{int(m.group(1))}:{m.group(2)}"
        elif re.fullmatch(r"\d{3}", d or ""):    # (the colon is too small to be a glyph: "137" = 1:37)
            out["timer"] = f"{d[0]}:{d[1:]}"
    banner = _text(img, (560, 110, 1360, 320)).upper()
    m = re.search(r"ROUND\s*([0-9IL]{1,2})", banner)
    if m:
        out["round"] = int(m.group(1).replace("I", "1").replace("L", "1"))
    if "BUY PHASE" in banner:
        out["phase"] = "buy"
    elif out.get("timer") and "phase" not in out:
        out["phase"] = "combat"
    players = []
    for team, slots in ((0, LEFT_SLOTS), (1, RIGHT_SLOTS)):
        for s, x in enumerate(slots, 1):
            hp = _bar(img, x)
            p = {"team": team, "slot": s, "alive": hp is not None, **({"health": hp} if hp is not None else {})}
            if hp is not None:   # (a dead player's portrait is greyed out: only read alive ones)
                a = agent_at(img, team, s)
                if a:
                    p["agent"], p["agent_id"] = a
            players.append(p)
    if scoreboard_open(img):
        names = {}
        for team, rows in ((0, ROWS_TOP), (1, ROWS_BOTTOM)):
            slot_of = match_slots(img, team, rows)
            for ri, y in enumerate(rows):
                cell = lambda k: img.crop((COLS[k][0], y - 14, COLS[k][1], y + 14))
                name = _text(img, (COLS["name"][0], y - 14, COLS["name"][1], y + 14), 3).strip()
                if not name:
                    continue
                ult = digits(cell("ult"))
                row = {"name": name, "slot": slot_of.get(ri), "kills": number(cell("k")), "deaths": number(cell("d")), "assists": number(cell("a")),
                       "credits": number(cell("credits"))}
                weapon, armor = loadout(img, y)
                row["weapon"], row["weapon_id"] = weapon or ("", "")
                row["armor"] = armor or ""
                if re.fullmatch(r"\d+/\d+", ult or ""):
                    row["ult"], row["ult_max"] = (int(v) for v in ult.split("/"))
                elif "READY" in _text(img, (COLS["ult"][0], y - 14, COLS["ult"][1], y + 14), 3).upper():
                    row["ult_ready"] = True
                names.setdefault(team, []).append({k: v for k, v in row.items() if v is not None})
        out["roster"] = names   # (by team; the slot is matched by name in Reader, the scoreboard sorts by score)
        side = _text(img, (575, 512, 610, 565)).upper()
        if side.startswith("DEF"):
            out["sides"] = ["DEF", "ATK"]
        elif side.startswith("ATK"):
            out["sides"] = ["ATK", "DEF"]
    if any(teams):
        out["teams"] = teams
    out["players"] = players
    return out


class Reader:
    """Captures a screen over and over and feeds what changed into the VALORANT module (engine.val)."""

    def __init__(self, engine):
        self.engine, self.on, self.screen, self.status, self.last = engine, False, 1, "off", {}
        self.names = [[None] * 5, [None] * 5]   # (team, slot) -> name, learnt from the scoreboard
        self.votes = {}                          # (team, slot) -> {agent: times seen}: an agent is locked in once seen 3 times

    def frame(self):
        import mss
        with mss.MSS() as s:
            mons = s.monitors[1:] or s.monitors
            m = mons[min(max(self.screen, 1), len(mons)) - 1]
            g = s.grab(m)
            return Image.frombytes("RGB", g.size, g.rgb)

    def update(self, d):
        """Turn a parse() result into an ingest body, placing scoreboard rows into slots by name."""
        body = {k: d[k] for k in ("teams", "round", "phase", "spike", "timer") if k in d}
        players = d.get("players", [])
        for team, rows in (d.get("roster") or {}).items():
            team = int(team)
            for row in rows:
                slot = row.pop("slot", None)
                if not slot:
                    continue
                self.names[team][slot - 1] = row["name"]   # (the top bar's alive / health is by slot: kept with its name)
                players.append({"team": team, "slot": slot, **row})
        for p in players:   # (agents don't change mid-match: a slot keeps the agent it was seen as most)
            key = (p["team"], p["slot"])
            if p.get("agent"):
                v = self.votes.setdefault(key, {})
                v[(p["agent"], p["agent_id"])] = v.get((p["agent"], p["agent_id"]), 0) + 1
            best = max(self.votes.get(key, {}).items(), key=lambda kv: kv[1], default=None)
            p.pop("agent", None), p.pop("agent_id", None)
            if best and best[1] >= 3:
                p["agent"], p["agent_id"] = best[0]
        body["players"] = players
        if d.get("sides"):
            body["first_attack"] = None   # (sides come from the round number; kept for later)
            body.pop("first_attack")
        return body

    def run(self):
        while True:
            if not self.on:
                time.sleep(1)
                continue
            try:
                d = parse(self.frame())
                if d.get("timer") or d.get("roster"):
                    self.engine.val.ingest(self.update(d))
                    self.status = "reading"
                else:
                    self.status = "no VALORANT HUD on that screen"
            except Exception as e:
                self.status = f"error: {e}"
            time.sleep(0.5)


def start(engine):
    engine.valreader = Reader(engine)
    threading.Thread(target=engine.valreader.run, daemon=True, name="val-reader").start()
