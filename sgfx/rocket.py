"""Rocket League, read straight from the game: Psyonix's Stats API (a local socket the game opens).

Turn it on in <Rocket League>\\TAGame\\Config\\TAStatsAPI.ini (or DefaultStatsAPI.ini), before starting the game:
    [TAGame.MatchStatsExporter_TA]
    PacketSendRate=30
    Port=49123

The game sends {"Event": ..., "Data": {...}} messages. Live ones become the table "Rocket League"; every
finished game is frozen as "RL Game N" (and "RL Last game") the moment it ends, so a player who quits
straight away still has their final line. A player's last known stats are kept for the whole game, even after
they leave. Finished games are also written to rl-games.json in the workspace, so a restart keeps them.
"""
import json
import logging
import os
import socket
import threading
import time

log = logging.getLogger("sgfx.rocket")
PORT = 49123
TEAMS = ("Blue", "Orange")
STATS = ("Score", "Goals", "Assists", "Saves", "Shots", "Demos", "Touches")
SLOTS = 4   # (players per team the tables give room for)


def clock(secs, overtime=False):
    s = max(0, int(secs or 0))
    return ("+" if overtime else "") + f"{s // 60}:{s % 60:02d}"


def kph(uu):   # (the game's Unreal units a second -> km/h)
    try:
        return str(round(float(uu) * 0.036))
    except (TypeError, ValueError):
        return ""


class Match:
    """One game as it happens: teams, clock, and every player seen (kept after they leave)."""
    def __init__(self, guid=""):
        self.guid, self.players, self.order = guid, {}, []
        self.teams = [{"Name": "Blue", "Score": 0}, {"Name": "Orange", "Score": 0}]
        self.time, self.overtime, self.winner, self.arena = 300, False, "", ""
        self.last_goal, self.target = {}, {}
        self.saved = False   # (frozen already: one snapshot a game)

    def key(self, p):
        return p.get("PrimaryId") or p.get("Name") or ""

    def update(self, d):
        seen = set()
        for p in d.get("Players") or []:
            if not isinstance(p, dict) or not self.key(p):
                continue
            k = self.key(p)
            seen.add(k)
            if k not in self.players:
                self.order.append(k)
            row = self.players.setdefault(k, {})
            row.update({s: p.get(s, row.get(s, 0)) for s in STATS})
            row.update(Name=p.get("Name", row.get("Name", "")), TeamNum=p.get("TeamNum", row.get("TeamNum", 0)), Boost=p.get("Boost", ""), Left=False)
        for k, row in self.players.items():   # (gone from the list: they left; their numbers stay)
            if k not in seen and d.get("Players") is not None:
                row["Left"], row["Boost"] = True, ""
        g = d.get("Game") or {}
        for t in g.get("Teams") or []:
            n = t.get("TeamNum")
            if n in (0, 1):
                self.teams[n] = {"Name": t.get("Name") or TEAMS[n], "Score": t.get("Score", 0)}
        if "TimeSeconds" in g:
            self.time = g["TimeSeconds"]
        self.overtime = bool(g.get("bOvertime", self.overtime))
        self.arena = g.get("Arena", self.arena)
        if g.get("bHasWinner"):
            self.winner = g.get("Winner") or self.winner
        self.target = (g.get("Target") or {}) if g.get("bHasTarget") else {}

    def left(self, d):
        k = d.get("PrimaryId") or d.get("PlayerName")
        if k in self.players:
            self.players[k]["Left"] = True

    def winner_num(self):
        names = [t["Name"] for t in self.teams]
        if self.winner in names:
            return names.index(self.winner)
        if self.winner in TEAMS:
            return TEAMS.index(self.winner)
        return None

    def fields(self):
        """Field / Value rows: team scores, the clock, and Blue 1..4 / Orange 1..4 player lines (join order)."""
        f = {}
        for n, side in enumerate(TEAMS):
            f[f"{side} name"], f[f"{side} score"] = self.teams[n]["Name"], self.teams[n]["Score"]
        f.update({"Clock": clock(self.time, self.overtime), "Overtime": "yes" if self.overtime else "no", "Winner": self.winner, "Arena": self.arena,
                  "Last goal": self.last_goal.get("scorer", ""), "Last goal assist": self.last_goal.get("assist", ""), "Last goal speed": self.last_goal.get("kph", ""),
                  "Watching": self.target.get("Name", "")})
        w = self.target.get("Name")
        if w:
            row = next((r for r in self.players.values() if r.get("Name") == w), {})
            f["Watching boost"] = row.get("Boost", "")
        for n, side in enumerate(TEAMS):
            team = [self.players[k] for k in self.order if self.players[k].get("TeamNum") == n]
            for i in range(SLOTS):
                p = team[i] if i < len(team) else {}
                f[f"{side} {i + 1} name"] = p.get("Name", "")
                for s in STATS:
                    f[f"{side} {i + 1} {s.lower()}"] = p.get(s, "") if p else ""
                f[f"{side} {i + 1} boost"] = p.get("Boost", "") if p else ""
                f[f"{side} {i + 1} left"] = ("yes" if p.get("Left") else "no") if p else ""
        return f


def rows(fields):
    return [["Field", "Value"]] + [[k, "" if v is None else str(v)] for k, v in fields.items()]


class Rocket:
    def __init__(self, engine):
        self.engine, self.match = engine, Match()
        self.status, self.detail, self.at = "off", "", 0
        self._games, self._folder = [], None
        self._sock = None

    # --- settings (per workspace, in the project) ---
    def cfg(self):
        c = self.engine.project.get("rl")
        return c if isinstance(c, dict) else {}

    def set(self, body):
        c = dict(self.cfg())
        for k in ("on", "series"):
            if k in body:
                c[k] = bool(body[k])
        if "port" in body:
            c["port"] = max(1, min(65535, int(body.get("port") or PORT)))
        self.engine.project["rl"] = c
        self.engine.save_project()
        self._drop()   # (reconnect with the new settings)

    # --- finished games (rl-games.json in the workspace) ---
    def _path(self):
        return os.path.join(self.engine.folder, "rl-games.json")

    def games(self):
        if self._folder != self.engine.folder:   # (another workspace opened: its own games)
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

    def snapshot(self, why="end", winner=None):
        """Freeze the game as it stands: the next RL Game N. Returns its number (None if nothing to save)."""
        with self.engine.lock:
            m = self.match
            if not m.players and not any(t["Score"] for t in m.teams):
                return None
            if winner is not None and winner in (0, 1):
                m.winner = m.teams[winner]["Name"]
            games = self.games()
            games.append({"at": time.time(), "guid": m.guid, "why": why, "winner": m.winner_num(), "fields": m.fields()})
            self._write()
            m.saved = m.saved or why != "manual"   # (a hand save mid-game must not stop the real end from saving)
            if self.cfg().get("series", True) and why != "manual":
                self._series(m.winner_num())
            self.engine.changed()
            return len(games)

    def _series(self, n):
        """Blue is the left team, Orange the right: a win adds one to that side's series score."""
        if n not in (0, 1):
            return
        side = ("left", "right")[n]
        g = self.engine.project.get("global") or {}
        try:
            cur = int((g.get(side) or {}).get("score") or 0)
        except (TypeError, ValueError):
            cur = 0
        self.engine.set_global({side: {"score": cur + 1}})

    def clear(self):
        """A new series: the finished games are put aside (rl-games-<time>.json), not deleted."""
        with self.engine.lock:
            if self.games():
                os.replace(self._path(), self._path()[:-5] + time.strftime("-%Y%m%d-%H%M%S") + ".json")
            self._games = []
            self.engine.changed()

    # --- tables for the engine state ---
    def tables(self):
        out = {}
        if self.cfg().get("on", True):
            out["Rocket League"] = rows(dict(self.match.fields(), Status=self.status))
        games = self.games()
        for i, g in enumerate(games):
            out[f"RL Game {i + 1}"] = rows(g.get("fields") or {})
        if games:
            out["RL Last game"] = rows(games[-1].get("fields") or {})
        return out

    def public(self):
        c = self.cfg()
        return {"on": c.get("on", True), "port": c.get("port", PORT), "series": c.get("series", True), "status": self.status, "detail": self.detail,
                "games": [{"n": i + 1, "winner": g.get("winner"), "score": [g["fields"].get("Blue score"), g["fields"].get("Orange score")], "why": g.get("why", "")} for i, g in enumerate(self.games())]}

    # --- one message from the game ---
    def handle(self, msg):
        ev, d = msg.get("Event"), msg.get("Data")
        if isinstance(d, str):   # (some builds send Data as a JSON string)
            try:
                d = json.loads(d)
            except ValueError:
                d = {}
        d = d if isinstance(d, dict) else {}
        m = self.match
        guid = d.get("MatchGuid") or ""
        if ev == "MatchCreated" or (ev == "MatchInitialized" and (m.saved or (guid and guid != m.guid))):
            self.match = m = Match(guid)
        elif guid and m.guid and guid != m.guid and ev == "UpdateState":
            self.match = m = Match(guid)   # (a new match started without a MatchCreated reaching us)
        elif guid and not m.guid:
            m.guid = guid
        if ev == "UpdateState":
            m.update(d)
            if (d.get("Game") or {}).get("bHasWinner") and not m.saved:   # (the backup: the winner is known even if MatchEnded is missed)
                self.snapshot("winner")
        elif ev == "PlayerLeft":
            m.left(d)
        elif ev == "GoalScored":
            sc, a = d.get("Scorer") or {}, d.get("Assister") or {}
            m.last_goal = {"scorer": sc.get("Name", ""), "assist": a.get("Name", ""), "kph": kph(d.get("GoalSpeed"))}
        elif ev == "ClockUpdatedSeconds":
            m.time, m.overtime = d.get("TimeSeconds", m.time), bool(d.get("bOvertime", m.overtime))
        elif ev == "MatchEnded" and not m.saved:
            self.snapshot("end", d.get("WinnerTeamNum"))
            return
        else:
            return
        self.engine._bump()

    # --- the socket ---
    def _drop(self):
        s, self._sock = self._sock, None
        if s:
            try:
                s.close()
            except OSError:
                pass

    def _set(self, status, detail=""):
        if (status, detail) != (self.status, self.detail):
            self.status, self.detail = status, detail
            self.engine._bump()

    def run(self):
        while True:
            c = self.cfg()
            if not c.get("on", True):
                self._set("off")
                time.sleep(2)
                continue
            port = c.get("port", PORT)
            try:
                s = socket.create_connection(("127.0.0.1", port), timeout=2)
            except OSError:
                self._set("waiting", f"Waiting for Rocket League on port {port}")
                time.sleep(3)
                continue
            self._sock = s
            s.settimeout(5)
            self._set("on", f"Reading Rocket League on port {port}")
            try:
                self.read(s)
            except Exception as e:   # (the game closed, or a bad message: start over)
                log.info("rocket league socket: %s", e)
            self._drop()
            self._set("waiting", f"Waiting for Rocket League on port {port}")
            time.sleep(1)

    def read(self, s):
        dec, buf = json.JSONDecoder(), ""
        while self._sock is s:
            try:
                chunk = s.recv(65536)
            except socket.timeout:
                continue   # (between games the socket is quiet)
            if not chunk:
                return
            buf += chunk.decode("utf-8", "replace")
            buf = self.feed(dec, buf)
            if len(buf) > 4 << 20:   # (never valid JSON: don't grow forever)
                buf = ""

    def feed(self, dec, buf):
        """Take every whole JSON message off the front of buf (they come back to back); return the rest."""
        while True:
            i = buf.find("{")
            if i < 0:
                return ""
            try:
                msg, end = dec.raw_decode(buf, i)
            except ValueError:
                return buf[i:]   # (the rest of it hasn't arrived yet)
            buf = buf[end:]
            if isinstance(msg, dict):
                try:
                    self.handle(msg)
                except Exception:
                    log.exception("rocket league message")


def start(engine):
    engine.rl = Rocket(engine)
    threading.Thread(target=engine.rl.run, daemon=True, name="rocket-league").start()
