"""VALORANT: live match data from any reader (Chud Hud, a screen reader, or someone typing), into tables.

A reader POSTs partial JSON to /api/val/ingest as often as it likes; only what it sends changes:
    {"teams": [{"name": "Saints", "score": 7, "timeouts": 1}, {...}],   # left team first
     "round": 15, "phase": "buy" | "combat" | "end", "spike": "planted" | "defused" | "", "map": "Ascent",
     "first_attack": 0,                     # which team attacked in round 1 (sides are worked out from it)
     "players": [{"team": 0, "slot": 1, "name": "Kai", "agent": "Jett", "alive": true, "health": 100,
                  "shields": 50, "credits": 3900, "weapon": "Vandal", "ult": 5, "ult_max": 7,
                  "kills": 12, "deaths": 9, "assists": 4, "spike": false}],
     "event": "round_end", "winner": 0, "how": "elimination" | "spike" | "defuse" | "time"
       or "event": "map_end", "winner": 0}

Live data is the table "VALORANT". Every finished round is kept as "VAL Last round"; every finished map is frozen as
"VAL Map N" and "VAL Last map" (also written to val-maps.json in the workspace, so a restart keeps them), and a
map win adds one to that side's series score in Global (left team = first team), unless that's switched off.
"""
import json
import os
import threading
import time
import urllib.request
import uuid

from .rocket import _layer, rows

SIDES = ("Left", "Right")
SLOTS = 5
PLAYER = ("name", "agent", "agent_id", "alive", "health", "shields", "credits", "weapon", "ult", "ult_max", "kills", "deaths", "assists", "spike")
HOW = {"elimination": "Elimination", "spike": "Spike detonated", "defuse": "Spike defused", "time": "Time ran out"}


def attackers(rnd, first=0):
    """Which team attacks in this round: sides swap at round 13, then every round in overtime (from 25)."""
    if rnd <= 12:
        return first
    if rnd <= 24:
        return 1 - first
    return first if (rnd - 25) % 2 == 0 else 1 - first


def yes(v):
    return "yes" if v is True else "no" if v is False else ("" if v is None else str(v))


class Match:
    def __init__(self, names=("", "")):
        self.teams = [{"name": names[0], "score": 0, "timeouts": 2}, {"name": names[1], "score": 0, "timeouts": 2}]
        self.round, self.phase, self.spike, self.map, self.first, self.timer = 1, "", "", "", 0, ""
        self.players = {}   # (team, slot) -> fields
        self.history = []   # [{"round", "winner", "how"}]

    def merge(self, b):
        for i, t in enumerate((b.get("teams") or [])[:2]):
            if isinstance(t, dict):
                for k in ("name", "score", "timeouts"):
                    if k in t:
                        self.teams[i][k] = t[k]
        if "round" in b:
            self.round = max(1, int(b["round"] or 1))
        for k, a in (("phase", "phase"), ("spike", "spike"), ("map", "map"), ("timer", "timer")):
            if k in b:
                setattr(self, a, str(b[k] or ""))
        if b.get("first_attack") in (0, 1):
            self.first = b["first_attack"]
        for p in b.get("players") or []:
            if isinstance(p, dict) and p.get("team") in (0, 1) and 1 <= int(p.get("slot") or 0) <= SLOTS:
                row = self.players.setdefault((p["team"], int(p["slot"])), {})
                row.update({k: p[k] for k in PLAYER if k in p})
                if p.get("ult_ready") and row.get("ult_max"):   # (the scoreboard says READY instead of "7 / 7")
                    row["ult"] = row["ult_max"]

    def fields(self):
        a = attackers(self.round, self.first)
        f = {}
        for i, s in enumerate(SIDES):
            t = self.teams[i]
            f.update({f"{s} name": t["name"], f"{s} score": t["score"], f"{s} side": "ATK" if a == i else "DEF",
                      f"{s} timeouts": t["timeouts"], f"{s} history": " ".join("W" if h["winner"] == i else "L" for h in self.history[-24:])})
        f.update({"Round": self.round, "Half": "Overtime" if self.round > 24 else "Second half" if self.round > 12 else "First half",
                  "Phase": self.phase, "Timer": self.timer, "Spike": self.spike, "Map": self.map, "Attackers": self.teams[a]["name"]})
        for i, s in enumerate(SIDES):
            for n in range(1, SLOTS + 1):
                p = self.players.get((i, n), {})
                for k in PLAYER:
                    v = p.get(k)
                    f[f"{s} {n} {k.replace('_', ' ')}"] = yes(v) if k in ("alive", "spike") else ("" if v is None else v)
                k, d = p.get("kills"), p.get("deaths")
                f[f"{s} {n} kd"] = f"{k}/{d}/{p.get('assists', 0)}" if k is not None and d is not None else ""
        return f


class Val:
    def __init__(self, engine):
        self.engine, self.match, self.at, self.source = engine, Match(), 0, ""
        self.last_round = None
        self._maps, self._folder = [], None

    def cfg(self):
        c = self.engine.project.get("val")
        return c if isinstance(c, dict) else {}

    def set(self, body):
        c = dict(self.cfg())
        for k in ("on", "series", "chud_on"):
            if k in body:
                c[k] = bool(body[k])
        if "chud" in body:
            c["chud"] = str(body.get("chud") or "").strip()[:200]
        if body.get("target") in ("chud", "owen", "off"):   # (which HUD draws it: Chud Hud, or the SCC Broadcast Engine's VAL HUD)
            c["target"] = body["target"]
            c["chud"] = ""
        self.engine.project["val"] = c
        self.engine.save_project()

    # --- finished maps (val-maps.json in the workspace) ---
    def _path(self):
        return os.path.join(self.engine.folder, "val-maps.json")

    def maps(self):
        if self._folder != self.engine.folder:
            self._folder = self.engine.folder
            try:
                with open(self._path(), encoding="utf-8") as f:
                    m = json.load(f)
                self._maps = m if isinstance(m, list) else []
            except (OSError, ValueError):
                self._maps = []
        return self._maps

    def _write(self):
        tmp = self._path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._maps, f, indent=1)
        os.replace(tmp, self._path())

    def clear(self):
        """A new series: the finished maps are put aside (val-maps-<time>.json), not deleted."""
        if self.maps():
            os.replace(self._path(), self._path()[:-5] + time.strftime("-%Y%m%d-%H%M%S") + ".json")
        self._maps = []
        self.engine.changed()

    # --- one send from a reader ---
    def ingest(self, body, ip=""):
        if not self.cfg().get("on", True):
            raise ValueError("VALORANT is switched off on the Outputs page")
        if not isinstance(body, dict):
            raise ValueError("Send a set of fields")
        first = not self.at
        self.at, self.source = time.time(), ip
        self.match.merge(body)
        ev, w = body.get("event"), body.get("winner")
        if ev == "round_end" and w in (0, 1):
            m = self.match
            m.history.append({"round": m.round, "winner": w, "how": str(body.get("how") or "")})
            self.last_round = {"Round": m.round, "Winner": m.teams[w]["name"], "Winner side": SIDES[w],
                               "How": HOW.get(body.get("how"), str(body.get("how") or "")),
                               "Left score": m.teams[0]["score"], "Right score": m.teams[1]["score"]}
        elif ev == "map_end" and w in (0, 1):
            m = self.match
            fields = dict(m.fields(), Winner=m.teams[w]["name"])
            self.maps().append({"at": time.time(), "map": m.map, "winner": w, "fields": fields})
            self._write()
            if self.cfg().get("series", True) and "series" not in body:   # (a reader that keeps the series itself already sent it)
                side = ("left", "right")[w]
                try:
                    cur = int(((self.engine.project.get("global") or {}).get(side) or {}).get("score") or 0)
                except (TypeError, ValueError):
                    cur = 0
                self.engine.set_global({side: {"score": cur + 1}})
            self.match, self.last_round = Match((m.teams[0]["name"], m.teams[1]["name"])), None
        if first:
            self.add_hud()
        self.engine.changed()
        self.forward()

    # --- Chud Hud: its own VALORANT HUD draws what's read here ---
    CHUD = "http://127.0.0.1:7777/api/ingest"

    def chud_messages(self):
        """The match as Chud Hud's intake takes it: an UpdateState (scores, clock) and a ValOcr (each player, by name)."""
        m = self.match
        game = {"Teams": [{"TeamNum": i, "Score": int(t["score"] or 0), **({"Name": t["name"]} if t["name"] else {})} for i, t in enumerate(m.teams)]}
        mm = __import__("re").fullmatch(r"(\d+):(\d\d)", m.timer or "")
        if mm:
            game["TimeSeconds"] = int(mm.group(1)) * 60 + int(mm.group(2))
        vals, n = {"valPhase": m.phase, "valSpike": m.spike, "valRound": m.round}, 0
        for (team, slot), p in sorted(m.players.items()):
            if not p.get("name"):
                continue
            n += 1
            for key, k in (("Name", "name"), ("Agent", "agent_id"), ("Ult", "ult"), ("UltMax", "ult_max"), ("Cr", "credits"), ("Hp", "health"), ("K", "kills"), ("D", "deaths"), ("A", "assists")):
                if p.get(k) is not None:
                    vals[f"val{key}{n}"] = p[k]
            if p.get("alive") is not None:
                vals[f"valAlive{n}"] = 1 if p["alive"] else 0
        return [{"Event": "UpdateState", "Data": {"Game": game}}, {"Event": "ValOcr", "Data": {"values": vals}}]

    OWEN = "http://127.0.0.1:8778/api/ingest"

    def owen_update(self):
        """The match as the SCC Broadcast Engine's VAL HUD takes it ({"match", "players"}, teams "left" / "right")."""
        m, sides = self.match, ("left", "right")
        mm = __import__("re").fullmatch(r"(\d+):(\d\d)", m.timer or "")
        match = {"round": m.round, "phase": m.phase, "score": {"left": int(m.teams[0]["score"] or 0), "right": int(m.teams[1]["score"] or 0)},
                 "attackers": sides[attackers(m.round, m.first)], "spike": {"state": m.spike or ""}}
        if m.map:
            match["map"] = m.map
        if mm:
            match["timer"] = int(mm.group(1)) * 60 + int(mm.group(2))
        players = []
        for (team, slot), p in sorted(m.players.items()):
            q = {"team": sides[team], "slot": slot}
            for k, o in (("name", "name"), ("agent", "agent"), ("alive", "alive"), ("health", "health"), ("credits", "credits"),
                         ("kills", "kills"), ("deaths", "deaths"), ("assists", "assists"), ("ult", "ult_points"), ("ult_max", "ult_max"), ("weapon", "weapon")):
                if p.get(k) is not None:
                    q[o] = p[k]
            players.append(q)
        return {"match": match, "players": players}

    def forward(self):
        c = self.cfg()
        target = c.get("target", "chud" if c.get("chud_on", True) else "off")
        if target == "off" or time.time() - getattr(self, "_sent", 0) < 0.4:
            return
        if target == "owen":
            self._sent, url, body = time.time(), c.get("chud") or self.OWEN, json.dumps(self.owen_update()).encode()
        else:
            self._sent, url, body = time.time(), c.get("chud") or self.CHUD, json.dumps(self.chud_messages()).encode()

        def go():   # (in the background: Chud Hud closed or slow never holds up the engine)
            try:
                urllib.request.urlopen(urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}), timeout=1.5).read()
                self.chud_ok = time.time()
            except Exception:
                pass
        threading.Thread(target=go, daemon=True).start()

    # --- for the engine state ---
    def live(self):
        return time.time() - self.at < 15

    def tables(self):
        out = {}
        if not self.cfg().get("on", True):
            return out
        if self.at:
            out["VALORANT"] = rows(dict(self.match.fields(), Status="on" if self.live() else "waiting"))
        if self.last_round:
            out["VAL Last round"] = rows(self.last_round)
        maps = self.maps()
        for i, m in enumerate(maps):
            out[f"VAL Map {i + 1}"] = rows(m.get("fields") or {})
        if maps:
            out["VAL Last map"] = rows(maps[-1].get("fields") or {})
        return out

    def public(self):
        c = self.cfg()
        r = getattr(self.engine, "valreader", None)
        return {"on": c.get("on", True), "series": c.get("series", True), "status": "on" if self.live() else "waiting" if self.at else "off",
                "reader": {"on": r.on, "screen": r.screen, "status": r.status} if r else None,
                "demo": bool(getattr(getattr(self.engine, "valdemo", None), "on", False)),
                "chud": {"target": c.get("target", "chud" if c.get("chud_on", True) else "off"), "url": c.get("chud") or (self.OWEN if c.get("target") == "owen" else self.CHUD),
                         "ok": time.time() - getattr(self, "chud_ok", 0) < 5},
                "source": self.source, "ago": round(time.time() - self.at) if self.at else None,
                "maps": [{"n": i + 1, "map": m.get("map", ""), "winner": m.get("winner"),
                          "score": [m["fields"].get("Left score"), m["fields"].get("Right score")]} for i, m in enumerate(self.maps())]}

    # --- ready-made graphics, added once each (one deleted stays gone) ---
    def add_hud(self):
        done = self.engine.project.setdefault("hud_pages", [])
        new = [x for x in hud_comps() if x[0] not in done]
        for key, name, kind, layers in new:
            done.append(key)
            self.engine.comps().append({"id": "c" + uuid.uuid4().hex[:8], "name": name, "hud_page": key, "group": "Game HUD",
                                        "kind": kind, "layer": 0, "layers": layers, "slots": {}})
        if new:
            self.engine.save_project()


TEAL, CORAL, INK, PAPER = "#14b8a6", "#f2715a", "#0e1117", "#f5f5f0"


def hud_comps():
    t, r = "VALORANT", "VAL Last round"
    v = lambda tbl, f: f"{{{{{tbl}!{f}}}}}"
    bug = [
        _layer("rect", "Left bar", 560, 20, 300, 60, fill=TEAL, radius=4),
        _layer("text", "Left name", 576, 20, 220, 60, text=v(t, "Left name"), size=32, align="left"),
        _layer("text", "Left side", 790, 20, 60, 60, text=v(t, "Left side"), size=18, color=INK),
        _layer("rect", "Score box", 860, 20, 200, 60, fill=INK),
        _layer("text", "Left score", 860, 20, 70, 60, text=v(t, "Left score"), size=40),
        _layer("rect", "Timer box", 910, 80, 100, 44, fill=INK, radius=4),
        _layer("text", "Timer", 910, 80, 100, 30, text=v(t, "Timer"), size=26),
        _layer("text", "Spike", 910, 80, 100, 30, text=v(t, "Spike"), size=22, color=CORAL),
        _layer("text", "Round", 910, 106, 100, 18, text="Round " + v(t, "Round"), size=13, color="#9aa4b2", caps=False),
        _layer("text", "Right score", 990, 20, 70, 60, text=v(t, "Right score"), size=40),
        _layer("rect", "Right bar", 1060, 20, 300, 60, fill=CORAL, radius=4),
        _layer("text", "Right side", 1070, 20, 60, 60, text=v(t, "Right side"), size=18, color=INK),
        _layer("text", "Right name", 1124, 20, 220, 60, text=v(t, "Right name"), size=32, align="right"),
    ]
    win = [
        _layer("rect", "Banner", 0, 440, 1920, 200, fill=INK, opacity=0.9),
        _layer("text", "Winner", 0, 460, 1920, 110, text=v(r, "Winner") + " wins round " + v(r, "Round"), size=72),
        _layer("text", "How", 0, 560, 1920, 60, text=v(r, "How"), size=32, color=TEAL, caps=False),
    ]
    card = lambda name, title, color: [
        _layer("rect", f"{name} card", 710, 140, 500, 90, fill=color, radius=6),
        _layer("text", f"{name} text", 710, 140, 500, 90, text=title, size=44, color=INK),
    ]
    spike = card("Spike", "Spike planted", CORAL)
    timeout = card("Timeout", "Timeout", TEAL) + [_layer("text", "Timeout team", 710, 232, 500, 50, text=v(t, "Attackers"), size=26)]
    pause = card("Tech pause", "Technical pause", "#e8b94a")
    board = [_layer("rect", "Backdrop", 160, 120, 1600, 840, fill=INK, opacity=0.94, radius=8),
             _layer("text", "Title", 160, 140, 1600, 70, text="Round " + v(t, "Round") + " · buy phase", size=40, color="#9aa4b2")]
    for i, s in enumerate(SIDES):
        x0 = 200 + i * 780
        board.append(_layer("text", f"{s} team", x0, 220, 740, 60, text=v(t, f"{s} name") + "  " + v(t, f"{s} score"), size=36, color=(TEAL, CORAL)[i], align="left"))
        for h, off, w in (("Player", 0, 200), ("Agent", 200, 140), ("Credits", 340, 110), ("Ult", 450, 80), ("K/D/A", 530, 150)):
            board.append(_layer("text", f"{s} head {h}", x0 + off, 290, w, 40, text=h, size=20, color="#9aa4b2", align="left", font="Inter"))
        for n in range(1, SLOTS + 1):
            y, x = 340 + (n - 1) * 110, x0
            for f, w, size in (("name", 200, 30), ("agent", 140, 26), ("credits", 110, 26), ("ult", 80, 26), ("kd", 150, 26)):
                board.append(_layer("text", f"{s} {n} {f}", x, y, w, 60, text=v(t, f"{s} {n} {f}") + ("/" + v(t, f"{s} {n} ult max") if f == "ult" else ""), size=size, align="left", caps=False))
                x += w
    return [("val:scorebug", "VAL Scorebug", "overlay", bug), ("val:round", "VAL Round win", "overlay", win),
            ("val:spike", "VAL Spike planted", "overlay", spike), ("val:timeout", "VAL Timeout", "overlay", timeout),
            ("val:pause", "VAL Tech pause", "overlay", pause), ("val:buy", "VAL Buy-phase scoreboard", "board", board)]


def start(engine):
    engine.val = Val(engine)
