"""VALORANT: live match data from any reader (Chud Hud, a screen reader, or someone typing), into tables.

A reader POSTs partial JSON to /api/val/ingest as often as it likes; only what it sends changes:
    {"teams": [{"name": "Saints", "score": 7, "timeouts": 1}, {...}],   # left team first
     "round": 15, "phase": "buy" | "combat" | "end", "spike": "planted" | "defused" | "", "map": "Ascent",
     "first_attack": 0,                     # which team attacked in round 1 (sides are worked out from it)
     "players": [{"team": 0, "slot": 1, "name": "Kai", "agent": "Jett", "alive": true, "health": 100,
                  "shields": 50, "armor": "heavy" | "light" | "regen" | "", "credits": 3900, "weapon": "Vandal",
                  "weapon_id": "<valorant-api uuid>", "ult": 5, "ult_max": 7, "abilities": {"C": [1, 2], "Q": [0, 1], "E": [1, 1]},
                  "kills": 12, "deaths": 9, "assists": 4, "spike": false}],
     "kills": [{"killer": "Kai", "killer_team": 0, "victim": "Onyx", "victim_team": 1, "weapon": "Vandal",
                "weapon_id": "<uuid>", "headshot": true}],   # (each kill once, as it happens)
     "event": "round_end", "winner": 0, "how": "elimination" | "spike" | "defuse" | "time"
       or "event": "map_end", "winner": 0}
A reader that only sends scores (the screen reader) still gets its rounds: a score one up on one side alone is taken as
that round's end, won by spike / defuse if the spike was down, else by elimination.

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
PLAYER = ("name", "agent", "agent_id", "alive", "health", "shields", "armor", "credits", "weapon", "weapon_id", "ult", "ult_max", "kills", "deaths", "assists", "spike")
UUID = __import__("re").compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
IMG_DIR = os.path.join(os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "StandBy GFX", "val-img")
ABILITY = ("ability1", "ability2", "grenade", "ultimate")
PICS = {"agent": ("displayicon", "killfeedportrait", "fullportrait") + ABILITY, "weapon": ("killstreamicon",), "map": ("splash", "listviewicon")}


def image(kind, uid, part):
    """An official picture (valorant-api.com's media), fetched once and kept on this PC: the file's path, or None."""
    if kind not in PICS or part not in PICS[kind] or not UUID.match(uid or ""):
        return None
    path = os.path.join(IMG_DIR, kind, uid, part + ".png")
    if not os.path.isfile(path):
        base = f"https://media.valorant-api.com/{ {'agent': 'agents', 'weapon': 'weapons', 'map': 'maps'}[kind] }/{uid}"
        url = f"{base}/abilities/{part}/displayicon.png" if part in ABILITY else f"{base}/{part}.png"
        try:
            data = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "StandBy GFX"}), timeout=10).read()
        except Exception:
            return None
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".tmp", "wb") as f:
            f.write(data)
        os.replace(path + ".tmp", path)
    return path


_catalog = None


def catalog():
    """{"agents": [{id, name, role}], "maps": [{id, name}]} from valorant-api.com (fetched once a week, kept on this PC)."""
    global _catalog
    if _catalog is not None:
        return _catalog
    path = os.path.join(IMG_DIR, "catalog.json")
    try:
        if not os.path.isfile(path) or time.time() - os.path.getmtime(path) > 7 * 86400:
            get = lambda u: json.loads(urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": "StandBy GFX"}), timeout=15).read())["data"]
            cat = {"agents": sorted(({"id": a["uuid"], "name": a["displayName"], "role": (a.get("role") or {}).get("displayName", "")}
                                     for a in get("https://valorant-api.com/v1/agents?isPlayableCharacter=true")), key=lambda a: a["name"]),
                   "maps": sorted(({"id": m["uuid"], "name": m["displayName"]} for m in get("https://valorant-api.com/v1/maps")
                                   if m.get("splash") and m.get("tacticalDescription")), key=lambda m: m["name"])}
            os.makedirs(IMG_DIR, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                json.dump(cat, f)
        with open(path, encoding="utf-8") as f:
            _catalog = json.load(f)
    except (OSError, ValueError, KeyError):
        return {"agents": [], "maps": []}   # (offline: try again next time)
    return _catalog


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
        self.feed = []      # the latest kills, newest last: [{"killer", "victim", ..., "t"}]
        self.banner, self.banner_side = "", None   # the line under the top bar (a timeout, a tech pause): set from the control page
        self.select = {"on": False, "timer": "", "map_id": ""}   # agent select (players' "pick" / "locked" hold their choices)

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
        if isinstance(b.get("select"), dict):
            s = b["select"]
            if "on" in s:
                self.select["on"] = bool(s["on"])
            if "timer" in s:
                self.select["timer"] = str(s["timer"] or "")[:8]
            if "map_id" in s and (not s["map_id"] or UUID.match(str(s["map_id"]))):
                self.select["map_id"] = str(s["map_id"] or "")
            if s.get("reset"):   # (a new map's agent select: every choice cleared)
                for p in self.players.values():
                    p.pop("pick", None), p.pop("locked", None)
        if "banner" in b:
            self.banner = str(b.get("banner") or "")[:60]
            self.banner_side = b.get("banner_side") if b.get("banner_side") in (0, 1) else None
        if b.get("first_attack") in (0, 1):
            self.first = b["first_attack"]
        for k in b.get("kills") or []:
            if isinstance(k, dict) and k.get("killer_team") in (0, 1) and k.get("victim_team") in (0, 1):
                self.feed = (self.feed + [{"killer": str(k.get("killer") or "")[:40], "victim": str(k.get("victim") or "")[:40],
                                           "killer_team": k["killer_team"], "victim_team": k["victim_team"], "weapon": str(k.get("weapon") or "")[:30],
                                           "weapon_id": str(k.get("weapon_id") or "")[:40], "headshot": bool(k.get("headshot")), "t": time.time()}])[-8:]
        for p in b.get("players") or []:
            if isinstance(p, dict) and p.get("team") in (0, 1) and 1 <= int(p.get("slot") or 0) <= SLOTS:
                row = self.players.setdefault((p["team"], int(p["slot"])), {})
                row.update({k: p[k] for k in PLAYER if k in p})
                if "pick" in p and (not p["pick"] or UUID.match(str(p["pick"]))):
                    row["pick"] = str(p["pick"] or "")
                if "locked" in p:
                    row["locked"] = bool(p["locked"])
                if isinstance(p.get("abilities"), dict):
                    row["abilities"] = {k: [int(x) for x in v[:2]] for k, v in p["abilities"].items() if k in ("C", "Q", "E") and isinstance(v, (list, tuple)) and len(v) >= 2}
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
        for n in range(1, 6):   # (Kill 1 = the newest)
            k = self.feed[-n] if len(self.feed) >= n else {}
            f.update({f"Kill {n} killer": k.get("killer", ""), f"Kill {n} victim": k.get("victim", ""), f"Kill {n} weapon": k.get("weapon", ""),
                      f"Kill {n} headshot": yes(k.get("headshot")) if k else "", f"Kill {n} killer side": SIDES[k["killer_team"]] if k else ""})
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
        base = getattr(self.match, "base", None)   # (the last score pair taken as true: a misread never moves it)
        spike, atk = self.match.spike, attackers(self.match.round, self.match.first)
        self.match.merge(body)
        ev, w = body.get("event"), body.get("winner")
        if not ev and "teams" in body:   # (scores only: a round won is a score one up on one side alone)
            after = [int(t["score"] or 0) for t in self.match.teams]
            if base is None:   # (joined mid-match: the first scores seen are the start)
                self.match.base = after
            up = [i for i in (0, 1) if base and after[i] == base[i] + 1 and after[1 - i] == base[1 - i]]
            if up:
                self.match.base, ev, w = after, "round_end", up[0]
                body = dict(body, how=("spike" if w == atk else "defuse") if spike == "planted" else "elimination", auto=True)
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
        sc = [int(t["score"] or 0) for t in self.match.teams]
        if body.get("auto") and max(sc) >= 13 and abs(sc[0] - sc[1]) >= 2:   # (first to 13, two clear in overtime)
            return self.ingest({"event": "map_end", "winner": 0 if sc[0] > sc[1] else 1}, ip)
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
        vals, n = {"valPhase": m.phase, "valSpike": m.spike, "valRound": m.round,
                   "valHistory": " ".join(f"{h['winner']}{h['how'][:1] or 'e'}" for h in m.history)}, 0   # ("0e 1s 0d": winner, how)
        for (team, slot), p in sorted(m.players.items()):
            if not p.get("name"):
                continue
            n += 1
            for key, k in (("Name", "name"), ("Agent", "agent_id"), ("Ult", "ult"), ("UltMax", "ult_max"), ("Cr", "credits"), ("Hp", "health"), ("K", "kills"), ("D", "deaths"), ("A", "assists"), ("Gun", "weapon_id"), ("Armor", "armor")):
                if p.get(k) is not None:
                    vals[f"val{key}{n}"] = p[k]
            if p.get("alive") is not None:
                vals[f"valAlive{n}"] = 1 if p["alive"] else 0
            if p.get("spike") is not None:
                vals[f"valBomb{n}"] = 1 if p["spike"] else 0
            for k, (have, most) in (p.get("abilities") or {}).items():
                vals[f"valAb{k}{n}"], vals[f"valAbMax{k}{n}"] = have, most
        agent = {(t, p.get("name")): p.get("agent_id") or "" for (t, _), p in m.players.items()}
        vals["valFeed"] = [{"k": k["killer"], "ka": agent.get((k["killer_team"], k["killer"]), ""), "ks": k["killer_team"], "v": k["victim"],
                            "va": agent.get((k["victim_team"], k["victim"]), ""), "vs": k["victim_team"], "gun": k["weapon_id"], "hs": k["headshot"],
                            "t": int(k["t"] * 1000)} for k in m.feed if time.time() - k["t"] < 10]   # (Chud Hud's own kill-feed rows)
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
        win = {"elimination": "Elimination", "spike": "Detonation", "defuse": "Deactivation", "time": "Time"}
        match["rounds"] = [{"winner": sides[h["winner"]], "win_type": win.get(h["how"], "Elimination")} for h in m.history]
        if m.history and m.phase == "end":
            match["round_winner"], match["win_type"] = match["rounds"][-1]["winner"], match["rounds"][-1]["win_type"]
        carrier = next(((t, s) for (t, s), p in m.players.items() if p.get("spike") is True), None)
        if carrier and not m.spike:
            match["spike"] = {"state": "carried", "carrier": [sides[carrier[0]], carrier[1]]}
        if mm:
            match["timer"] = int(mm.group(1)) * 60 + int(mm.group(2))
        players = []
        for (team, slot), p in sorted(m.players.items()):
            q = {"team": sides[team], "slot": slot}
            for k, o in (("name", "name"), ("agent", "agent"), ("alive", "alive"), ("health", "health"), ("credits", "credits"),
                         ("kills", "kills"), ("deaths", "deaths"), ("assists", "assists"), ("ult", "ult_points"), ("ult_max", "ult_max"), ("weapon", "weapon")):
                if p.get(k) is not None:
                    q[o] = p[k]
            if p.get("armor") is not None:   # (light armor 25, heavy 50; the regen shield is its own flag)
                q["shield"], q["regen_shield"] = {"heavy": 50, "light": 25}.get(p["armor"], 0), p["armor"] == "regen"
            elif p.get("shields") is not None:
                q["shield"] = p["shields"]
            if p.get("spike") is not None:
                q["spike"] = bool(p["spike"])
            if p.get("abilities"):
                q["abilities"] = p["abilities"]
            players.append(q)
        return {"match": match, "players": players}

    def forward(self):
        c = self.cfg()
        target = c.get("target", "owen" if c.get("chud_on", True) else "off")
        if target == "off" or time.time() - getattr(self, "_sent", 0) < 0.4:
            return
        if target == "owen":   # (the default: the SCC Broadcast Engine's VAL HUD draws it until our own HUD is built)
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

    # --- our own VAL HUD (web/val-hud.html) reads this ---
    def hud(self):
        m, g = self.match, self.engine.project.get("global") or {}
        atk = attackers(m.round, m.first)
        teams = []
        for i, side in enumerate(("left", "right")):
            t, gt = m.teams[i], g.get(side) or {}
            teams.append({"name": gt.get("name") or t["name"] or ("Team A", "Team B")[i], "short": gt.get("short") or "", "logo": gt.get("logo") or "",
                          "color": gt.get("color") or ("#21c7b0", "#ff4f5e")[i], "score": int(t["score"] or 0), "side": "ATK" if atk == i else "DEF",
                          "series": gt.get("score") or 0, "timeouts": int(t.get("timeouts") if t.get("timeouts") is not None else 2)})
        players = [[], []]
        for (team, slot), p in sorted(m.players.items()):
            players[team].append(dict({k: p.get(k) for k in PLAYER}, slot=slot, abilities=p.get("abilities") or {}))
        return {"live": self.live(), "teams": teams, "round": m.round, "phase": m.phase, "timer": m.timer, "spike": m.spike, "map": m.map,
                "best_of": g.get("best_of") or 3, "history": [{"winner": h["winner"], "how": h["how"]} for h in m.history],
                "last": self.last_round, "players": players, "feed": [dict(k, age=round(time.time() - k["t"], 1)) for k in m.feed if time.time() - k["t"] < 8]}

    # --- for the engine state ---
    def live(self):
        return time.time() - self.at < 15

    def tables(self):
        out = {}
        if not self.cfg().get("on", True):
            return out
        if self.at:
            from . import valhud
            out["VALORANT"] = rows(dict(self.match.fields(), **valhud.fields(self.match, self.engine.project.get("global") or {}), Status="on" if self.live() else "waiting"))
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
                "chud": {"target": c.get("target", "owen" if c.get("chud_on", True) else "off"), "url": c.get("chud") or (self.CHUD if c.get("target") == "chud" else self.OWEN),
                         "ok": time.time() - getattr(self, "chud_ok", 0) < 5},
                "source": self.source, "ago": round(time.time() - self.at) if self.at else None,
                "maps": [{"n": i + 1, "map": m.get("map", ""), "winner": m.get("winner"),
                          "score": [m["fields"].get("Left score"), m["fields"].get("Right score")]} for i, m in enumerate(self.maps())]}

    # --- ready-made graphics, added once each (one deleted stays gone) ---
    def add_hud(self):
        done = self.engine.project.setdefault("hud_pages", [])
        from . import huds, valhud
        if huds.ensure(self.engine, "val27", "VAL HUD (SCC 2027)", "valorant", huds.builtin("val27")):
            self.engine.changed()
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
