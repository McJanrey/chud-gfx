"""Run of show: templates per game (blocks of segments), built into tonight's show for one match.

A template: {id, name, game, best_of, blocks: [{id, name, color, repeat, segments: [{id, title, notes, color,
mins, game, skip_last, graphics: [graphic names]}]}]}. A repeat block runs once per map of the series; its
segments marked skip_last are left out after the last map. Titles and notes fill in {{Match.TeamA}},
{{Match.TeamB}}, {{Match.BestOf}}, {{Map.N}}.

The show: {template_id, template_name, match, match_key, segments: [...], current, times: {seg id: {start}}, built}.
Times: a started segment keeps its real start; the rest are estimated from it. Once a team has won the
series, the maps not needed (and the break before them) drop out.
"""
import re
import time
import uuid
import datetime

GAMES = [("lol", "League of Legends", ("LEAGUE OF LEGENDS", "LOL")), ("valorant", "VALORANT", ("VALORANT",)),
         ("cod", "Call of Duty", ("CALL OF DUTY", "COD")), ("rl", "Rocket League", ("ROCKET LEAGUE",)),
         ("smash", "Smash", ("SMASH",)), ("ow", "Overwatch", ("OVERWATCH",))]


def new_id():
    return uuid.uuid4().hex[:10]


def game_key(name):
    up = (name or "").upper()
    for key, _, words in GAMES:
        if any(w in up for w in words):
            return key
    return ""


def match_key(m):
    return "|".join(str(m.get(k, "")) for k in ("date", "time", "team1", "team2", "game"))


def next_match(schedule, now=None):
    """The first Schedule match that hasn't started (more than 4 hours ago)."""
    now = now or datetime.datetime.now()
    best = None
    for m in (schedule or {}).get("matches") or []:
        try:
            at = datetime.datetime.fromisoformat(f"{m.get('date')}T{m.get('time') or '00:00'}")
        except (TypeError, ValueError):
            continue
        if at > now - datetime.timedelta(hours=4) and (best is None or at < best[0]):
            best = (at, m)
    return best[1] if best else None


def pick_template(templates, m, best_of=None):
    key = game_key((m or {}).get("game", ""))
    same = [t for t in templates if t.get("game") == key] or [t for t in templates if not t.get("game")]
    if best_of:
        same = [t for t in same if int(t.get("best_of") or 0) == int(best_of)] or same
    return same[0] if same else None


def _fill(text, m, n):
    t = str(text or "")
    t = re.sub(r"\{\{\s*Match\.TeamA\s*\}\}", m.get("team1", "") or "Team A", t, flags=re.I)
    t = re.sub(r"\{\{\s*Match\.TeamB\s*\}\}", m.get("team2", "") or "Team B", t, flags=re.I)
    t = re.sub(r"\{\{\s*Match\.BestOf\s*\}\}", str(m.get("best_of", "")), t, flags=re.I)
    return re.sub(r"\{\{\s*Map\.N\s*\}\}", "" if n is None else str(n), t, flags=re.I)


def build(template, m, now=None):
    m = dict(m or {})
    bo = int(m.get("best_of") or template.get("best_of") or 1)
    m["best_of"] = bo
    m.setdefault("game_key", game_key(m.get("game", "")))
    segs = []
    for b in template.get("blocks") or []:
        maps = range(1, bo + 1) if b.get("repeat") else [None]
        for n in maps:
            for s in b.get("segments") or []:
                if n is not None and n == bo and s.get("skip_last"):
                    continue
                segs.append({"id": new_id(), "title": _fill(s.get("title"), m, n), "notes": _fill(s.get("notes"), m, n),
                             "color": s.get("color", "#ffffff"), "mins": float(s.get("mins") or 0), "game": bool(s.get("game")),
                             "skip_last": bool(s.get("skip_last")), "graphics": list(s.get("graphics") or []),
                             "block": b.get("name", ""), "block_color": b.get("color", "#ffffff"), "map": n})
    return {"template_id": template.get("id"), "template_name": template.get("name", ""), "match": m, "match_key": match_key(m),
            "segments": segs, "current": -1, "times": {}, "built": now or time.time()}


def needed(best_of):
    return int(best_of) // 2 + 1


def dropped(show, left, right):
    """Segment ids no longer needed: once a side has won, later maps (and the breaks after the deciding map)."""
    need = needed(show.get("match", {}).get("best_of") or 1)
    if max(int(left or 0), int(right or 0)) < need:
        return set()
    played = int(left or 0) + int(right or 0)
    return {s["id"] for s in show.get("segments", []) if s.get("map") and (s["map"] > played or (s["map"] == played and s.get("skip_last")))}


def timeline(show, now=None, left=0, right=0, start=None):
    """[{seg, start, est, done, skip}] with clock times (epoch seconds). Unstarted shows count from `start`
    (the match time minus the segments before the first game) or now."""
    now = now or time.time()
    segs, times, cur = show.get("segments", []), show.get("times", {}), show.get("current", -1)
    skip = dropped(show, left, right)
    if start is None:
        start = now
        mt = show.get("match", {})
        try:
            at = datetime.datetime.fromisoformat(f"{mt.get('date')}T{mt.get('time') or '00:00'}").timestamp()
            pre = 0.0
            for s in segs:
                if s.get("game") or s.get("map"):
                    break
                pre += s["mins"] * 60
            start = max(now, at - pre)
        except (TypeError, ValueError):
            pass
    out, t = [], start
    for i, s in enumerate(segs):
        if s["id"] in skip:
            out.append({"seg": s, "start": None, "est": True, "done": False, "skip": True})
            continue
        real = (times.get(s["id"]) or {}).get("start")
        if real:
            t = real
        elif i == cur + 1 and cur >= 0:
            t = max(t, now)   # (the next one can't start before now)
        out.append({"seg": s, "start": t, "est": not real, "done": i < cur, "skip": False})
        t += s["mins"] * 60
    return out


def step(show, by, now=None, skip=()):
    """Next (+1) / back (-1). Moving on stamps the new segment's real start; skipped ones are jumped over."""
    segs = show.get("segments", [])
    i = show.get("current", -1) + by
    while 0 <= i < len(segs) and segs[i]["id"] in skip:
        i += by
    i = max(-1, min(len(segs), i))
    show["current"] = i
    if by > 0 and 0 <= i < len(segs):
        show.setdefault("times", {})[segs[i]["id"]] = {"start": now or time.time()}
    if by < 0 and 0 <= i + 1 < len(segs):
        for s in segs[i + 1:]:
            show.get("times", {}).pop(s["id"], None)
    return show


def blank_template(name="New template", game="", best_of=3):
    seg = lambda title, notes, color, mins, g=False, sl=False: {"id": new_id(), "title": title, "notes": notes, "color": color, "mins": mins, "game": g, "skip_last": sl, "graphics": []}
    return {"id": new_id(), "name": name, "game": game, "best_of": best_of, "blocks": [
        {"id": new_id(), "name": "Pre-show", "color": "#bf5af2", "repeat": False, "segments": [seg("Countdown", "Starting soon, sponsors", "#bf5af2", 15.0), seg("Desk · Casters", "Casters introduce {{Match.TeamA}} vs {{Match.TeamB}}", "#ffffff", 10.0)]},
        {"id": new_id(), "name": "Match", "color": "#64d2ff", "repeat": True, "segments": [seg("Map {{Map.N}}", "Live game", "#30d158", 40.0, True), seg("Between maps", "Skipped after the last map", "#ff9f0a", 5.0, False, True)]},
        {"id": new_id(), "name": "Post-show", "color": "#bf5af2", "repeat": False, "segments": [seg("Wrap-up", "Result, standings, what's next", "#bf5af2", 10.0)]}]}
