"""The data tables graphics read with {{Table!Field}} (Global, Sponsors, Schedule), made from the
workspace's Global settings. Rows match the old app's, checked against tests/fixtures (black-box probes).
"""

import datetime

# Where each caster box sits for 1-4 boxes: "x y scale" (offsets from the design's one box).
CASTER_MOVES = {
    1: ["0 346 1"],
    2: ["-362 346 1", "361 346 1"],
    3: ["-570 373 0.85", "51 373 0.85", "671 373 0.85"],
    4: ["-580 412 0.63", "-109 412 0.63", "361 412 0.63", "831 412 0.63"],
}


# The clock: the time of day, or a countdown to "until" for Starting Soon / Be Right Back.
CLOCK_LABELS = {"time": "LOCAL TIME", "soon": "STARTING SOON", "brb": "BE RIGHT BACK"}

# The background loop used when none is picked (our own video).
DEFAULT_LOOP = "loops/standby-bg-loop.webm"
OLD_LOOP = "loops/scc-bg-loop.webm"   # (the old app's built-in loop: workspaces that saved it get ours)


def _s(v):
    return "" if v is None else str(v)


def _num(v, default=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def global_rows(g):
    rows = [["Field", "Value"]]
    add = lambda k, v: rows.append([k, _s(v)])
    best = _num(g.get("best_of"), 3) or 1
    left, right = g.get("left") or {}, g.get("right") or {}
    add("Event", g.get("event", "")); add("Stage", g.get("stage", "")); add("Best of", best)
    add("Game", g.get("game") or (_num(left.get("score")) + _num(right.get("score")) + 1))
    for S, t in (("Left", left), ("Right", right)):
        score = _num(t.get("score"))
        add(f"{S} name", t.get("name", "")); add(f"{S} short", t.get("short", "")); add(f"{S} logo", t.get("logo", ""))
        add(f"{S} color", t.get("color", "")); add(f"{S} score", score); add(f"{S} game", t.get("game", ""))
        for n in range(1, 5):
            add(f"{S} won {n}", "1" if score >= n else "")
    need = (best + 1) // 2   # (games to win the series = boxes shown)
    for n in range(1, 5):
        add(f"Game box {n}", "1" if n <= need else "")
    add("Tournament logo", g.get("tournament_logo", ""))
    sponsors = [s for s in g.get("sponsors") or [] if s.get("logo")]
    add("Sponsor logo", sponsors[0]["logo"] if sponsors else ""); add("Sponsors", len(sponsors))
    loop = g.get("bgloop") or {}
    src = loop.get("src") or DEFAULT_LOOP
    add("BG loop", (DEFAULT_LOOP if src == OLD_LOOP else src) if loop.get("on", True) else "")
    add("BG loop colour", loop.get("color", "")); add("BG loop brightness", loop.get("brightness", "")); add("BG loop speed", loop.get("speed", ""))
    ticker = [t for t in g.get("ticker") or [] if t]
    add("Ticker", "".join(t + "  |  " for t in ticker))
    clock = g.get("clock") or {}
    mode = clock.get("mode") if clock.get("mode") in CLOCK_LABELS else "time"
    add("Clock mode", mode); add("Clock until", clock.get("until", "")); add("Clock zone", clock.get("zone", "")); add("Clock label", CLOCK_LABELS[mode])
    timer = g.get("timer") or {}
    add("Timer secs", timer.get("secs", 0)); add("Timer started", timer.get("started", 0)); add("Timer down", "1" if timer.get("down") else "")
    caster = g.get("caster") or {}
    count = min(4, max(1, _num(caster.get("count"), 1)))
    add("Caster boxes", count); add("Caster primary", caster.get("primary", "")); add("Caster secondary", caster.get("secondary", ""))
    add("Caster text", caster.get("text") or caster.get("secondary", ""))
    for n in range(1, 5):
        add(f"Caster {n} shown", "1" if n <= count else ""); add(f"Caster {n} move", CASTER_MOVES[count][n - 1] if n <= count else "")
    for k, v in g.get("custom") or []:
        add(k, v)
    return rows


def sponsor_rows(g):
    rows = [["Logo", "Seconds", "Epoch", "White"]]
    for s in g.get("sponsors") or []:
        if s.get("logo"):
            rows.append([s["logo"], _s(s.get("secs", "")), _s(g.get("sponsor_epoch", 0)), "1" if s.get("white") else ""])
    return rows


def _when(date, time):
    try:
        d = datetime.date.fromisoformat(date)
        day = f"{d.strftime('%a').upper()} {d.month}/{d.day}"
    except (TypeError, ValueError):
        day = date or ""
    try:
        h, m = (int(x) for x in time.split(":")[:2])
        clock = f"{(h % 12) or 12}:{m:02d} {'AM' if h < 12 else 'PM'}"
    except (AttributeError, ValueError):
        clock = time or ""
    return "  |  ".join(p for p in (day, clock) if p)


def schedule_rows(g, teams=()):
    s = g.get("schedule") or {}
    matches = s.get("matches") or []
    count = _num(s.get("count"), len(matches))
    logo = {(t.get("name") or "").lower(): t.get("logo", "") for t in teams}
    rows = [["Field", "Value"], ["Count", _s(count)]]
    for i, m in enumerate(matches[:count], 1):
        P = f"Match {i}"
        add = lambda k, v: rows.append([f"{P} {k}", _s(v)])
        add("tournament", m.get("tournament", ""))
        add("game", " | ".join(x for x in (m.get("game", ""), m.get("type", "")) if x))
        add("teams", " vs. ".join(x for x in (m.get("team1", ""), m.get("team2", "")) if x))
        add("when", _when(m.get("date", ""), m.get("time", "")))
        add("show", "1")
        for n in (1, 2):
            name = m.get(f"team{n}", "")
            add(f"team {n}", name); add(f"team {n} logo", logo.get(name.lower(), ""))
    return rows


def roster_rows(g, teams=()):
    """The players of the side picked for the player graphics (Global "roster": left / right)."""
    side = g.get("roster") if g.get("roster") in ("left", "right") else "left"
    pick = (g.get(side) or {}).get("name", "").strip().lower()
    team = next((t for t in teams if pick and (t.get("name") or "").strip().lower() == pick), {}) if pick else {}
    players = [p for p in team.get("players") or [] if isinstance(p, dict)]
    rows = [["Field", "Value"], ["Side", side], ["Team", team.get("name", "")], ["Team short", team.get("short", "")],
            ["Team logo", team.get("logo", "")], ["Game", team.get("game", "")], ["Players", _s(len(players))],
            ["No headshots", "" if any(p.get("photo") for p in players) else "1"]]
    for n in range(1, max(5, len(players)) + 1):
        p = players[n - 1] if n <= len(players) else {}
        rows += [[f"Player {n}", p.get("tag", "")], [f"Player {n} name", p.get("name", "")], [f"Player {n} ID", p.get("id", "")],
                 [f"Player {n} country", p.get("country", "")], [f"Player {n} flag", p.get("flag", "")], [f"Player {n} headshot", p.get("photo", "")]]
    return rows


# Standings: what each stat shows and its column title.
STATS = {"record": "W-L", "points": "PTS", "wins": "W", "losses": "L", "diff": "+/-"}


def _stat(t, kind):
    w, l = t.get("w", ""), t.get("l", "")
    return {"record": f"{w}-{l}" if (w or l) else "", "points": t.get("pts", ""), "wins": w, "losses": l, "diff": t.get("diff", "")}.get(kind, "")


def standings_rows(g, teams=()):
    st = g.get("standings") or {}
    stat = st.get("stat") if st.get("stat") in STATS else "record"
    stat2 = st.get("stat2") if st.get("stat2") in STATS else ""
    count = 16 if _num(st.get("count"), 8) == 16 else 8   # (8 or 16 teams)
    rows = [["Field", "Value"], ["Title", st.get("title") or g.get("event", "")], ["Subtitle", st.get("subtitle", "")], ["Teams", _s(count)],
            ["Stat 1 title", STATS[stat]], ["Stat 2 title", STATS.get(stat2, "")], ["Stat 2 shown", "1" if stat2 else ""],
            ["One stat", "" if stat2 else "1"], ["Stat titles shown", "1"]]
    lookup = {(t.get("name") or "").strip().lower(): t for t in teams}
    entries = st.get("teams") or []
    for n in range(1, count + 1):
        t = entries[n - 1] if n <= len(entries) else {}
        name = t.get("name", "")
        known = lookup.get(name.strip().lower(), {}) if name else {}
        shown = "1" if name else ""
        P = f"Team {n}"
        rows += [[P, name], [f"{P} short", (known.get("short") or name) if name else ""], [f"{P} logo", known.get("logo", "")], [f"{P} shown", shown],
                 [f"{P} stat 1", _stat(t, stat) if name else ""]]
        if stat2:
            rows += [[f"{P} stat 2", _stat(t, stat2) if name else ""], [f"{P} stat 2 shown", "1" if name else ""]]
        else:
            rows += [[f"{P} stat 2", ""], [f"{P} stat 2 shown", ""]]
        rows += [[f"{P} wins", t.get("w", "") if name else ""], [f"{P} losses", t.get("l", "") if name else ""], [f"{P} points", t.get("pts", "") if name else ""],
                 [f"{P} diff", t.get("diff", "") if name else ""], [f"{P} record", _stat(t, "record") if name else ""]]
    return rows


def stats_rows(stats=None):
    """Game stats from a connected game HUD; with none, the titles and zero kills the stats graphics expect."""
    rows = [["Field", "Value"], ["Status", ""], ["Game", ""], ["Stat 1 title", "KILLS"], ["Stat 2 title", "DEATHS"], ["Stat 3 title", "ASSISTS"],
            ["Row 1 title", "KILLS"], ["Row 2 title", "DEATHS"], ["Row 3 title", "K/D"], ["Row 4 title", "ASSISTS"],
            ["Left kills", "0"], ["Right kills", "0"], ["MVP headshot shown", "1"], ["MVP flag shown", "1"]]
    return rows + [[k, _s(v)] for k, v in (stats or {}).items()]


def teams_rows(teams=()):
    rows = [["Name", "Short name", "Logo", "Colour", "Game", "Players"]]
    for t in teams:
        rows.append([t.get("name", ""), t.get("short", ""), t.get("logo", ""), t.get("color", ""), t.get("game", ""), _s(len(t.get("players") or []))])
    return rows
