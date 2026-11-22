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
import re
import socket
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

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
        self._obs_lock, self._obs_ip, self._obs_at, self._obs_buf, self._obs_dec = threading.Lock(), None, 0, "", json.JSONDecoder()

    # --- settings (per workspace, in the project) ---
    def cfg(self):
        c = self.engine.project.get("rl")
        return c if isinstance(c, dict) else {}

    def set(self, body):
        c = dict(self.cfg())
        for k in ("on", "series"):
            if k in body:
                c[k] = bool(body[k])
        if "host" in body:   # (blank: find the game on this PC or the local network by itself)
            c["host"] = str(body.get("host") or "").strip()[:100]
            self._found = None
        if "port" in body:
            port = max(1, min(65535, int(body.get("port") or PORT)))
            if port == getattr(self.engine, "port", None) and not c.get("host"):
                raise ValueError(f"{port} is this app's own port. Rocket League's Stats API uses {PORT}.")
            c["port"] = port
        self.engine.project["rl"] = c
        self.engine.save_project()
        self._drop()   # (reconnect with the new settings)

    # --- finished games (rl-games.json in the workspace) ---
    def _path(self):
        return os.path.join(self.engine.folder, "rl-games.json")

    def games(self):
        if self._folder != self.engine.folder:   # (another workspace opened: its own games)
            self._folder = self.engine.folder
            got = self.engine.store.read_json("rl-games.json", [])
            self._games = got if isinstance(got, list) else []
        return self._games

    def _write(self):
        self.engine.store.write_json("rl-games.json", self._games)

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
                self.engine.store.put_aside("rl-games.json")
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
        return {"on": c.get("on", True), "port": c.get("port", PORT), "host": c.get("host", ""), "found": getattr(self, "_found", None) or "", "series": c.get("series", True), "status": self.status, "detail": self.detail,
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
        if ev and self.status != "on":   # (only real game messages count as reading)
            self._set("on", f"Reading Rocket League from {getattr(self, '_port', PORT)}")
            self.add_hud()
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

    def add_hud(self):
        """The ready-made graphics, added once each to the workspace (one deleted stays gone)."""
        done = self.engine.project.setdefault("hud_pages", [])
        new = [x for x in hud_comps() if x[0] not in done]
        for key, name, kind, layers in new:
            done.append(key)
            self.engine.comps().append({"id": "c" + uuid.uuid4().hex[:8], "name": name, "hud_page": key, "group": "Game HUD",
                                        "kind": kind, "layer": 0, "layers": layers, "slots": {}})
        if new:
            self.engine.save_project()
            self.engine.changed()

    def _set(self, status, detail=""):
        if (status, detail) != (self.status, self.detail):
            self.status, self.detail = status, detail
            self.engine._bump()

    def run(self):
        while True:
            c = self.cfg()
            if self.observer_live():   # (the observer client is sending: it owns the status)
                time.sleep(2)
                continue
            if not c.get("on", True):
                self._set("off")
                time.sleep(2)
                continue
            port, host = c.get("port", PORT), c.get("host", "")
            if port == getattr(self.engine, "port", None) and host in ("", "127.0.0.1", "localhost"):   # (it would read this app itself)
                self._set("waiting", f"Port {port} is this app's own port. Set the port to {PORT}, the game's Stats API port")
                time.sleep(3)
                continue
            s = self._connect(host, port)
            if self.observer_live():   # (the observer client started sending during the search)
                if s:
                    s.close()
                continue
            if not s:
                where = host or "this PC or the network"
                self._set("waiting", f"Looking for Rocket League on {where} (port {port})")
                time.sleep(3)
                continue
            self._sock = s
            s.settimeout(5)
            self._port = f"{s.getpeername()[0]}:{port}"
            self._set("waiting", f"Connected to {self._port}. Waiting for game data: start or spectate a match")
            try:
                self.read(s)
            except Exception as e:   # (the game closed, or a bad message: start over)
                log.info("rocket league socket: %s", e)
            self._drop()
            if not self.observer_live():
                self._set("waiting", f"Waiting for Rocket League on port {port}")
            time.sleep(1)

    def feed_raw(self, data, ip):
        """Bytes of the game's stream from the observer client on the game PC (it reads the game there and posts here)."""
        if not self.cfg().get("on", True):
            return
        with self._obs_lock:
            if ip != self._obs_ip or time.time() - self._obs_at > 30:
                self._obs_dec, self._obs_buf = json.JSONDecoder(), ""
            self._obs_ip, self._obs_at, self._port = ip, time.time(), f"the observer client on {ip}"
            if data:
                self._obs_buf = self.feed(self._obs_dec, self._obs_buf + data.decode("utf-8", "replace"))
                if len(self._obs_buf) > 4 << 20:
                    self._obs_buf = ""
            elif self.status != "on":
                self._set("waiting", f"Observer client on {ip} is running. Waiting for game data: start or spectate a match")

    def observer_live(self):
        return time.time() - self._obs_at < 10

    def _connect(self, host, port):
        """A socket to the game: the set Game PC, else this PC, the last place it was found, then a sweep of
        the local network (every 20 s at most) for a PC with the Stats API port open."""
        tries = [host] if host else ["127.0.0.1"] + ([self._found] if getattr(self, "_found", None) else [])
        for h in tries:
            try:
                return socket.create_connection((h, port), timeout=2)
            except OSError:
                pass
        if host or time.time() - getattr(self, "_swept", 0) < 20:
            return None
        self._swept = time.time()
        hit = sweep(self.engine.addresses(), port)
        if hit:
            self._found = hit
            try:
                return socket.create_connection((hit, port), timeout=2)
            except OSError:
                pass
        return None

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


OBSERVER = r"""@echo off
title RL Observer for StandBy GFX
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex (((Get-Content -LiteralPath '%~f0' -Raw) -split '#PS#')[2])"
pause
exit /b
#PS#
$gfx = '__GFX__'
$port = __PORT__
Write-Host "RL Observer: reads Rocket League on this PC and sends it to StandBy GFX at $gfx"
Write-Host 'Keep this window open during the show. Close it to stop.'
$enc = [Text.Encoding]::UTF8
function Enable-StatsApi {
  $dirs = @()
  $man = Join-Path $env:ProgramData 'Epic\EpicGamesLauncher\Data\Manifests'
  if (Test-Path $man) { Get-ChildItem $man -Filter *.item | ForEach-Object { try { $j = Get-Content $_.FullName -Raw | ConvertFrom-Json; if ($j.DisplayName -like '*Rocket*') { $dirs += $j.InstallLocation } } catch {} } }
  $steam = Join-Path ${env:ProgramFiles(x86)} 'Steam'
  $libs = @($steam)
  $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
  if (Test-Path $vdf) { [regex]::Matches((Get-Content $vdf -Raw), '"path"\s+"([^"]+)"') | ForEach-Object { $libs += $_.Groups[1].Value.Replace('\', '\') } }
  $libs | ForEach-Object { $dirs += (Join-Path $_ 'steamapps\common\rocketleague') }
  $dirs += 'C:\Program Files\Epic Games\rocketleague'
  $changed = 0
  foreach ($d in ($dirs | Select-Object -Unique)) {
    $cfg = Join-Path $d 'TAGame\Config'
    if (-not (Test-Path $cfg)) { continue }
    foreach ($n in @('DefaultStatsAPI.ini', 'TAStatsAPI.ini')) {
      $f = Join-Path $cfg $n
      if ($n -eq 'TAStatsAPI.ini' -and -not (Test-Path $f)) { continue }
      $old = ''; if (Test-Path $f) { $old = Get-Content $f -Raw; if ($old -eq $null) { $old = '' } }
      if ($old -match '(?ms)^\[TAGame\.MatchStatsExporter_TA\][^\[]*PacketSendRate=([1-9]\d*)' -and $old -match "(?ms)^\[TAGame\.MatchStatsExporter_TA\][^\[]*Port=$port") { continue }
      if ($old -and -not (Test-Path "$f.bak")) { Set-Content -LiteralPath "$f.bak" -Value $old -NoNewline }
      $lines = @($old -split "`n" | ForEach-Object { $_.TrimEnd([char]13) } | Where-Object { $_ -ne '' })
      $out = @(); $in = $false
      foreach ($l in $lines) {
        if ($l.Trim().StartsWith('[')) { $in = ($l.Trim() -eq '[TAGame.MatchStatsExporter_TA]') }
        elseif ($in -and $l -match '^\s*(PacketSendRate|Port)\s*=') { continue }
        $out += $l
        if ($in -and $l.Trim().StartsWith('[')) { $out += 'PacketSendRate=30'; $out += "Port=$port" }
      }
      if (-not ($lines | Where-Object { $_.Trim() -eq '[TAGame.MatchStatsExporter_TA]' })) { $out += '[TAGame.MatchStatsExporter_TA]'; $out += 'PacketSendRate=30'; $out += "Port=$port" }
      Set-Content -LiteralPath $f -Value (($out -join "`r`n") + "`r`n") -NoNewline
      Write-Host "Turned on Rocket League's Stats API in $f"
      $changed++
    }
  }
  if ($changed) { Write-Host 'Restart Rocket League now (fully close it and open it again) so it picks this up.' }
}
Enable-StatsApi
while ($true) {
  try {
    $c = New-Object Net.Sockets.TcpClient('127.0.0.1', $port)
  } catch {
    Write-Host "Waiting for Rocket League (port $port). Is PacketSendRate set in TAStatsAPI.ini, and the game restarted?"
    try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$gfx/api/rl/feed" -Body ([byte[]]@()) | Out-Null } catch { Write-Host "Can't reach StandBy GFX at $gfx (is it shared on the network?)" }
    Start-Sleep 3; continue
  }
  Write-Host 'Connected to Rocket League. Sending...'
  $s = $c.GetStream(); $s.ReadTimeout = 3000
  $buf = New-Object byte[] 262144; $dec = $enc.GetDecoder(); $chars = New-Object char[] 262144
  while ($true) {
    try { $n = $s.Read($buf, 0, $buf.Length) } catch { $n = -1 }
    if ($n -eq 0) { break }
    $body = [byte[]]@()
    if ($n -gt 0) { $k = $dec.GetChars($buf, 0, $n, $chars, 0); $body = $enc.GetBytes($chars, 0, $k) }
    try { Invoke-WebRequest -UseBasicParsing -Method Post -Uri "$gfx/api/rl/feed" -Body $body -ContentType 'text/plain' | Out-Null }
    catch { Write-Host "Can't reach StandBy GFX at $gfx" ; Start-Sleep 1 }
  }
  $c.Close(); Write-Host 'Rocket League closed the connection. Retrying...'; Start-Sleep 2
}
"""


def observer_script(gfx, port=PORT):
    """The RL Observer client: a .cmd for the game PC (Windows, nothing to install)."""
    return OBSERVER.replace("__GFX__", gfx).replace("__PORT__", str(port)).replace(chr(10), chr(13) + chr(10))


SECTION = "[TAGame.MatchStatsExporter_TA]"


def set_ini(text, rate=30, port=PORT):
    """The Stats API switched on in an ini's text: PacketSendRate and Port under its section (added when missing)."""
    want = {"PacketSendRate": str(rate), "Port": str(port)}
    lines, out, inside, seen = text.splitlines(), [], False, set()
    for ln in lines:
        st = ln.strip()
        if st.startswith("["):
            if inside:
                out += [f"{k}={v}" for k, v in want.items() if k not in seen]
            inside = st.lower() == SECTION.lower()
        elif inside and "=" in st and st.split("=", 1)[0].strip() in want:
            k = st.split("=", 1)[0].strip()
            seen.add(k)
            out.append(f"{k}={want[k]}")
            continue
        out.append(ln)
    if inside:
        out += [f"{k}={v}" for k, v in want.items() if k not in seen]
    if not any(l.strip().lower() == SECTION.lower() for l in lines):
        out += ([""] if out and out[-1].strip() else []) + [SECTION] + [f"{k}={v}" for k, v in want.items()]
    return "\r\n".join(out) + "\r\n"


def installs():
    """Rocket League folders on this PC (Epic manifests, Steam libraries, the usual places)."""
    found = []
    man = os.path.join(os.environ.get("PROGRAMDATA", r"C:\ProgramData"), "Epic", "EpicGamesLauncher", "Data", "Manifests")
    for f in (os.listdir(man) if os.path.isdir(man) else []):
        try:
            with open(os.path.join(man, f), encoding="utf-8") as fh:
                m = json.load(fh)
            if "rocket" in str(m.get("DisplayName", "")).lower():
                found.append(m.get("InstallLocation", ""))
        except (OSError, ValueError):
            pass
    steam = os.path.join(os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"), "Steam")
    libs = [steam]
    try:
        with open(os.path.join(steam, "steamapps", "libraryfolders.vdf"), encoding="utf-8") as fh:
            libs += [m.replace("\\\\", "\\") for m in re.findall(r'"path"\s+"([^"]+)"', fh.read())]
    except OSError:
        pass
    found += [os.path.join(l, "steamapps", "common", "rocketleague") for l in libs]
    found.append(r"C:\Program Files\Epic Games\rocketleague")
    out = []
    for d in found:
        if d and os.path.isdir(os.path.join(d, "TAGame", "Config")) and os.path.normcase(d) not in [os.path.normcase(o) for o in out]:
            out.append(d)
    return out


def enable_stats_api():
    """Turn the Stats API on in every Rocket League found here (the old file kept as .bak). -> the files changed."""
    done = []
    for d in installs():
        for name in ("DefaultStatsAPI.ini", "TAStatsAPI.ini"):
            f = os.path.join(d, "TAGame", "Config", name)
            if name == "TAStatsAPI.ini" and not os.path.isfile(f):
                continue
            old = open(f, encoding="utf-8", errors="replace").read() if os.path.isfile(f) else ""
            if old and not os.path.exists(f + ".bak"):
                with open(f + ".bak", "w", encoding="utf-8") as fh:
                    fh.write(old)
            with open(f, "w", encoding="utf-8", newline="") as fh:
                fh.write(set_ini(old))
            done.append(f)
    if not done:
        raise ValueError("Rocket League isn't installed on this PC. If it runs on another PC, the observer client turns it on there.")
    return done


def sweep(own, port, timeout=0.4):
    """The first other PC on this PC's local networks (the /24 around each address) with the port open."""
    hosts = []
    for ip in own:
        a = ip.split(".")
        if len(a) == 4 and not ip.startswith("169.254."):
            hosts += [f"{a[0]}.{a[1]}.{a[2]}.{i}" for i in range(1, 255) if str(i) != a[3]]

    def probe(h):
        try:
            socket.create_connection((h, port), timeout=timeout).close()
            return h
        except OSError:
            return None
    with ThreadPoolExecutor(64) as ex:
        return next((h for h in ex.map(probe, hosts) if h), None)


def _layer(kind, name, x, y, w, h, **kw):
    l = {"id": "l" + uuid.uuid4().hex[:8], "name": name, "type": kind, "x": x, "y": y, "w": w, "h": h, "opacity": 1, "rotation": 0,
         "visible": True, "blend": "normal", "field": "", "anim": {"in": {"dur": 0, "delay": 0, "type": "fade"}, "out": {"dur": 0, "delay": 0, "type": "fade"}}}
    if kind == "rect":
        l.update({"fill": "#000000", "radius": 0, "stroke": "#000000", "strokeWidth": 0})
    else:
        l.update({"text": "", "font": "Anton", "size": 40, "color": "#ffffff", "align": "center", "valign": "middle", "tracking": 0, "caps": True,
                  "lineHeight": 1.15, "fit": "shrink", "weight": 700, "italic": False, "scroll": 0})
    l.update(kw)
    return l


BLUE, ORANGE, DARK = "#1e5bd8", "#e8661c", "#0d1117"


def hud_comps():
    """The ready-made Rocket League graphics: a live scorebug and a final score board from the last finished game."""
    t = "Rocket League"
    bug = [
        _layer("rect", "Blue bar", 540, 24, 290, 64, fill=BLUE, radius=6),
        _layer("text", "Blue name", 556, 24, 258, 64, text=f"{{{{{t}!Blue name}}}}", size=36, align="left"),
        _layer("rect", "Blue score box", 830, 24, 70, 64, fill="#123a8c"),
        _layer("text", "Blue score", 830, 24, 70, 64, text=f"{{{{{t}!Blue score}}}}", size=46),
        _layer("rect", "Clock box", 900, 24, 120, 64, fill=DARK),
        _layer("text", "Clock", 900, 24, 120, 64, text=f"{{{{{t}!Clock}}}}", size=38),
        _layer("rect", "Orange score box", 1020, 24, 70, 64, fill="#9c3f0c"),
        _layer("text", "Orange score", 1020, 24, 70, 64, text=f"{{{{{t}!Orange score}}}}", size=46),
        _layer("rect", "Orange bar", 1090, 24, 290, 64, fill=ORANGE, radius=6),
        _layer("text", "Orange name", 1106, 24, 258, 64, text=f"{{{{{t}!Orange name}}}}", size=36, align="right"),
        _layer("rect", "Watching box", 40, 960, 420, 80, fill=DARK, opacity=0.85, radius=6),
        _layer("text", "Watching", 56, 960, 280, 80, text=f"{{{{{t}!Watching}}}}", size=34, align="left"),
        _layer("text", "Boost", 336, 960, 110, 80, text=f"{{{{{t}!Watching boost}}}}", size=46, color="#f5c518", align="right"),
    ]
    g = "RL Last game"
    board = [
        _layer("rect", "Backdrop", 0, 0, 1920, 1080, fill=DARK, opacity=0.92),
        _layer("text", "Title", 360, 90, 1200, 80, text="Final score", size=56, color="#9aa4b2"),
        _layer("rect", "Blue bar", 360, 190, 520, 120, fill=BLUE, radius=8),
        _layer("text", "Blue name", 380, 190, 360, 120, text=f"{{{{{g}!Blue name}}}}", size=52, align="left"),
        _layer("text", "Blue score", 740, 190, 130, 120, text=f"{{{{{g}!Blue score}}}}", size=90),
        _layer("rect", "Orange bar", 1040, 190, 520, 120, fill=ORANGE, radius=8),
        _layer("text", "Orange score", 1050, 190, 130, 120, text=f"{{{{{g}!Orange score}}}}", size=90),
        _layer("text", "Orange name", 1180, 190, 360, 120, text=f"{{{{{g}!Orange name}}}}", size=52, align="right"),
    ]
    for side, x0 in (("Blue", 360), ("Orange", 1040)):
        board.append(_layer("text", f"{side} header", x0, 340, 250, 40, text="Player", size=24, color="#9aa4b2", align="left", font="Inter"))
        for j, h in enumerate(("G", "A", "SV", "SH")):
            board.append(_layer("text", f"{side} header {h}", x0 + 250 + j * 66, 340, 60, 40, text=h, size=24, color="#9aa4b2", font="Inter"))
        for i in range(1, SLOTS + 1):
            y = 390 + (i - 1) * 70
            board.append(_layer("text", f"{side} {i} name", x0, y, 250, 60, text=f"{{{{{g}!{side} {i} name}}}}", size=30, align="left", caps=False))
            for j, s in enumerate(("goals", "assists", "saves", "shots")):
                board.append(_layer("text", f"{side} {i} {s}", x0 + 250 + j * 66, y, 60, 60, text=f"{{{{{g}!{side} {i} {s}}}}}", size=30))
    return [("rl:scorebug", "RL Scorebug", "overlay", bug), ("rl:final", "RL Final score", "board", board)]


def start(engine):
    engine.rl = Rocket(engine)
    threading.Thread(target=engine.rl.run, daemon=True, name="rocket-league").start()
