"""League of Legends, read from Riot's Live Client Data API (https://127.0.0.1:2999/liveclientdata/allgamedata),
which the game opens on the PC that is in the game or spectating it. Nothing to switch on in the game.

The API only answers on that PC itself, so when the game runs on another PC the League observer client
(/lol-observer.cmd, downloaded on that PC) reads it there and posts it here (/api/lol/feed).

Live data is the table "League"; every finished game is frozen as "LoL Game N" and "LoL Last game" (also in
lol-games.json in the workspace), and a win adds one to the series score in Global (blue = left) when the
winner is known.
"""
import json
import os
import ssl
import threading
import time
import urllib.request
import uuid

from .rocket import _layer, rows

URL = "https://{host}:2999/liveclientdata/allgamedata"
TEAMS = (("ORDER", "Blue"), ("CHAOS", "Red"))
SLOTS = 5
ROLES = {"TOP": 1, "JUNGLE": 2, "MIDDLE": 3, "BOTTOM": 4, "UTILITY": 5}


def clock(secs):
    s = max(0, int(secs or 0))
    return f"{s // 60}:{s % 60:02d}"


def team_of(name, players):
    """ORDER / CHAOS for a player's name (events name the killer by summoner name or Riot ID)."""
    for p in players:
        if name and name in (p.get("summonerName"), p.get("riotIdGameName"), p.get("riotId"), (p.get("riotId") or "").split("#")[0]):
            return p.get("team")
    return None


def fields(d):
    """The Live Client Data JSON -> Field / Value rows for the table "League"."""
    players = d.get("allPlayers") or []
    events = ((d.get("events") or {}).get("Events")) or []
    game = d.get("gameData") or {}
    f = {"Clock": clock(game.get("gameTime")), "Map": game.get("mapName") or "", "Mode": game.get("gameMode") or ""}
    count = {t: {"towers": 0, "inhibs": 0, "dragons": [], "barons": 0, "heralds": 0} for t, _ in TEAMS}
    for e in events:
        n = e.get("EventName")
        if n == "TurretKilled":   # (Turret_T1_... is ORDER's own turret: CHAOS gets it)
            t = "CHAOS" if "_T1_" in str(e.get("TurretKilled")) else "ORDER" if "_T2_" in str(e.get("TurretKilled")) else None
            if t:
                count[t]["towers"] += 1
        elif n == "InhibKilled":
            t = "CHAOS" if "_T1_" in str(e.get("InhibKilled")) else "ORDER" if "_T2_" in str(e.get("InhibKilled")) else None
            if t:
                count[t]["inhibs"] += 1
        elif n in ("DragonKill", "BaronKill", "HeraldKill"):
            t = team_of(e.get("KillerName"), players)
            if t in count:
                if n == "DragonKill":
                    count[t]["dragons"].append(str(e.get("DragonType") or ""))
                else:
                    count[t]["barons" if n == "BaronKill" else "heralds"] += 1
    for team, side in TEAMS:
        mine, rest = [None] * SLOTS, []
        for p in (p for p in players if p.get("team") == team):   # (by role: top 1 ... support 5; no role = first free slot)
            r = ROLES.get(p.get("position") or "")
            if r and mine[r - 1] is None:
                mine[r - 1] = p
            else:
                rest.append(p)
        mine = [p if p is not None else (rest.pop(0) if rest else {}) for p in mine]
        sc = [p.get("scores") or {} for p in mine]
        c = count[team]
        f.update({f"{side} kills": sum(s.get("kills", 0) for s in sc), f"{side} towers": c["towers"], f"{side} inhibitors": c["inhibs"],
                  f"{side} dragons": len(c["dragons"]), f"{side} dragon types": " ".join(c["dragons"]), f"{side} barons": c["barons"],
                  f"{side} heralds": c["heralds"], f"{side} cs": sum(int(s.get("creepScore", 0)) for s in sc)})
        for i in range(SLOTS):
            p, s = mine[i], sc[i]
            k = f"{side} {i + 1}"
            f.update({f"{k} name": p.get("riotIdGameName") or p.get("summonerName") or "", f"{k} champion": p.get("championName") or "",
                      f"{k} level": p.get("level", ""), f"{k} kda": f"{s.get('kills', 0)}/{s.get('deaths', 0)}/{s.get('assists', 0)}" if p else "",
                      f"{k} cs": int(s.get("creepScore", 0)) if p else "", f"{k} dead": ("yes" if p.get("isDead") else "no") if p else "",
                      f"{k} respawn": round(p.get("respawnTimer") or 0) if p.get("isDead") else ""})
    last = next((e for e in reversed(events) if e.get("EventName") in ("ChampionKill", "DragonKill", "BaronKill", "TurretKilled", "InhibKilled", "Ace", "Multikill")), None)
    f["Last event"] = (last or {}).get("EventName", "")
    return f


def winner(d):
    """0 (blue) / 1 (red) once the game has ended and it can be told, else None."""
    events = ((d.get("events") or {}).get("Events")) or []
    end = next((e for e in events if e.get("EventName") == "GameEnd"), None)
    if not end:
        return None
    me = d.get("activePlayer") or {}
    team = team_of(me.get("riotIdGameName") or me.get("summonerName"), d.get("allPlayers") or [])
    if team and end.get("Result") in ("Win", "Lose"):
        won = team if end["Result"] == "Win" else ("CHAOS" if team == "ORDER" else "ORDER")
        return 0 if won == "ORDER" else 1
    return None


class League:
    def __init__(self, engine):
        self.engine, self.data, self.at, self.status, self.detail = engine, None, 0, "off", ""
        self._games, self._folder, self._saved = [], None, False

    def cfg(self):
        c = self.engine.project.get("lol")
        return c if isinstance(c, dict) else {}

    def set(self, body):
        c = dict(self.cfg())
        for k in ("on", "series"):
            if k in body:
                c[k] = bool(body[k])
        self.engine.project["lol"] = c
        self.engine.save_project()

    # --- finished games (lol-games.json) ---
    def _path(self):
        return os.path.join(self.engine.folder, "lol-games.json")

    def games(self):
        if self._folder != self.engine.folder:
            self._folder = self.engine.folder
            try:
                with open(self._path(), encoding="utf-8") as f:
                    g = json.load(f)
                self._games = g if isinstance(g, list) else []
            except (OSError, ValueError):
                self._games = []
        return self._games

    def _write(self):
        tmp = self._path() + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(self._games, f, indent=1)
        os.replace(tmp, self._path())

    def snapshot(self, why="end", won=None):
        with self.engine.lock:
            if not self.data:
                return None
            f = fields(self.data)
            f["Winner"] = ("Blue", "Red")[won] if won in (0, 1) else ""
            self.games().append({"at": time.time(), "why": why, "winner": won, "fields": f})
            self._write()
            if won in (0, 1) and why != "manual" and self.cfg().get("series", True):
                side = ("left", "right")[won]
                try:
                    cur = int(((self.engine.project.get("global") or {}).get(side) or {}).get("score") or 0)
                except (TypeError, ValueError):
                    cur = 0
                self.engine.set_global({side: {"score": cur + 1}})
            self.engine.changed()
            return len(self._games)

    def clear(self):
        if self.games():
            os.replace(self._path(), self._path()[:-5] + time.strftime("-%Y%m%d-%H%M%S") + ".json")
        self._games = []
        self.engine.changed()

    # --- data in (polled here, or posted by the observer client) ---
    def feed(self, d, where="this PC"):
        if not isinstance(d, dict) or "allPlayers" not in d:
            raise ValueError("Not League live data")
        first = self.data is None
        ended = any(e.get("EventName") == "GameEnd" for e in ((d.get("events") or {}).get("Events") or []))
        if not ended:
            self._saved = False
        self.data, self.at, self.status, self.detail = d, time.time(), "on", f"Reading League from {where}"
        if ended and not self._saved:
            self._saved = True
            self.snapshot("end", winner(d))
        if first:
            self.add_hud()
        self.engine.changed()

    def run(self):
        ctx = ssl.create_default_context()
        ctx.check_hostname, ctx.verify_mode = False, ssl.CERT_NONE   # (the game's own self-signed certificate, this PC only)
        while True:
            if not self.cfg().get("on", True) or time.time() - self.at < 3 and self.detail.startswith("Reading League from the observer"):
                time.sleep(1)
                continue
            try:
                with urllib.request.urlopen(URL.format(host="127.0.0.1"), context=ctx, timeout=2) as r:
                    self.feed(json.loads(r.read().decode("utf-8")))
            except Exception:
                if self.status != "waiting" and time.time() - self.at > 5:
                    self.status, self.detail = "waiting", "Waiting for a League game on this PC (or the observer client)"
                    self.engine._bump()
            time.sleep(1)

    def tables(self):
        out = {}
        if self.data and self.cfg().get("on", True):
            out["League"] = rows(dict(fields(self.data), Status=self.status))
        g = self.games()
        for i, x in enumerate(g):
            out[f"LoL Game {i + 1}"] = rows(x.get("fields") or {})
        if g:
            out["LoL Last game"] = rows(g[-1].get("fields") or {})
        return out

    def public(self):
        c = self.cfg()
        return {"on": c.get("on", True), "series": c.get("series", True), "status": self.status, "detail": self.detail,
                "games": [{"n": i + 1, "winner": x.get("winner"), "kills": [x["fields"].get("Blue kills"), x["fields"].get("Red kills")]} for i, x in enumerate(self.games())]}

    def add_hud(self):
        done = self.engine.project.setdefault("hud_pages", [])
        from . import huds   # (in the HUD Builder as a HUD of their own, never among the show's graphics)
        if huds.ready_made(self.engine, "lol", "League graphics", "league", hud_comps()):
            self.engine.changed()


BLUE, RED, INK = "#2f6fdc", "#d8453a", "#0d1117"


def hud_comps():
    t, g = "League", "LoL Last game"
    v = lambda tbl, f: f"{{{{{tbl}!{f}}}}}"
    bug = [
        _layer("rect", "Blue bar", 600, 18, 300, 56, fill=BLUE, radius=4),
        _layer("text", "Blue kills", 600, 18, 90, 56, text=v(t, "Blue kills"), size=40),
        _layer("text", "Blue objectives", 690, 18, 200, 56, text="T " + v(t, "Blue towers") + "  D " + v(t, "Blue dragons") + "  B " + v(t, "Blue barons"), size=20, caps=False),
        _layer("rect", "Clock box", 900, 18, 120, 56, fill=INK),
        _layer("text", "Clock", 900, 18, 120, 56, text=v(t, "Clock"), size=30),
        _layer("rect", "Red bar", 1020, 18, 300, 56, fill=RED, radius=4),
        _layer("text", "Red objectives", 1030, 18, 200, 56, text="T " + v(t, "Red towers") + "  D " + v(t, "Red dragons") + "  B " + v(t, "Red barons"), size=20, caps=False),
        _layer("text", "Red kills", 1230, 18, 90, 56, text=v(t, "Red kills"), size=40),
    ]
    board = [_layer("rect", "Backdrop", 160, 120, 1600, 840, fill=INK, opacity=0.94, radius=8),
             _layer("text", "Title", 160, 140, 1600, 70, text="Game over · " + v(g, "Winner") + " wins · " + v(g, "Clock"), size=40, color="#9aa4b2")]
    for i, side in enumerate(("Blue", "Red")):
        x0 = 200 + i * 780
        board.append(_layer("text", f"{side} total", x0, 220, 740, 60, text=f"{side}  " + v(g, f"{side} kills") + " kills · " + v(g, f"{side} towers") + " towers", size=32, color=(BLUE, RED)[i], align="left"))
        for n in range(1, SLOTS + 1):
            y, x = 300 + (n - 1) * 120, x0
            for f, w in (("champion", 220), ("name", 260), ("kda", 140), ("cs", 100)):
                board.append(_layer("text", f"{side} {n} {f}", x, y, w, 60, text=v(g, f"{side} {n} {f}"), size=28, align="left", caps=False))
                x += w
    return [("lol:scorebug", "LoL Scorebug", "overlay", bug), ("lol:final", "LoL Final scoreboard", "board", board)]


def start(engine):
    engine.lol = League(engine)
    threading.Thread(target=engine.lol.run, daemon=True, name="league").start()
