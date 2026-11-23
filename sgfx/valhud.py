"""The VAL HUD (SCC 2027 layout) as ordinary graphics: every piece is a layer in the composer, placed where the
SCC 2027 VALORANT HUD has it, so it can be moved, restyled or rebuilt there like any other graphic.

What changes with the match comes from the "VALORANT" table: words as fields, and pictures as small URLs this
engine draws (/val-svg/...: the ult ring, ability charges, the health bar, armor, the round tracker) or keeps
(/val-img/...: the official agent, ability and weapon pictures). A layer's "Show only while" field hides it
(dead players, the buy phase, a planted spike, names tucked away 20 s into a round).
"""
import re
from urllib.parse import quote

from .rocket import _layer

SIDES = ("Left", "Right")
SIDEARMS = {"Classic", "Shorty", "Frenzy", "Ghost", "Sheriff", "Bandit"}
NAVY, BLUE, RED, GOLD, LINE = "#111823", "#66b5f4", "#ee5b58", "#f0cb74", "#acacac"
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")
OWEN_WIN = {"elimination": "Elimination", "spike": "Detonation", "defuse": "Deactivation", "time": "Time"}
WIN_HOW = {"elimination": "Elimination", "spike": "Detonation", "defuse": "Defuse", "time": "Time"}


def _secs(t):
    m = re.fullmatch(r"(\d+):(\d\d)", t or "")
    return int(m.group(1)) * 60 + int(m.group(2)) if m else None


def _colour(c, d):
    c = str(c or "").strip()
    return c if re.fullmatch(r"#[0-9a-fA-F]{6}", c) else d


# --- the table fields ---------------------------------------------------------------------------------
def _file(name):
    n = __import__("re").sub(r"[^A-Za-z0-9]", "", str(name or ""))
    return n[:1].upper() + n[1:].lower() if n.isupper() and len(n) > 1 else n


def fields(m, g):
    """The fields the SCC-layout graphics read (added to the VALORANT table)."""
    from .valorant import attackers
    f, atk = {}, attackers(m.round, m.first)
    picking = bool((getattr(m, "select", {}) or {}).get("on"))   # (agent select: the in-round HUD steps aside)
    secs, planted, buy = _secs(m.timer), m.spike == "planted" and not picking, m.phase == "buy" and not picking
    cond = planted or (m.phase == "combat" and secs is not None and secs <= 79)   # (names tuck away 20 s into the round, or at the plant)
    won = m.history[-1] if m.history and m.phase == "end" else None
    need = max(1, (int((g.get("best_of") or 3)) + 1) // 2)
    f.update({"Buy phase": "yes" if buy else "", "In round": "" if buy or picking else "yes", "Planted": "yes" if planted else "",
              "Names": "" if cond or picking else "yes", "Condensed": "yes" if cond and not picking else "", "Top on": "" if picking else "yes",
              "Round label": f"ROUND {m.round}",
              "Round won": "yes" if won else ""})
    for i, s in enumerate(SIDES):
        gt, t = g.get(s.lower()) or {}, m.teams[i]
        col = _colour(gt.get("color"), (BLUE, RED)[i])
        name = gt.get("name") or t["name"] or ("Team A", "Team B")[i]
        f.update({f"{s} color": col, f"{s} logo": gt.get("logo") or "", f"{s} tricode": (gt.get("short") or name[:3]).upper(),
                  f"{s} full name": name.upper(), f"{s} timeout 1": "/val-svg/dot/%s/%d.svg" % (col[1:], 1 if int(t.get("timeouts") or 0) >= 1 else 0),
                  f"{s} timeout 2": "/val-svg/dot/%s/%d.svg" % (col[1:], 1 if int(t.get("timeouts") or 0) >= 2 else 0)})
        try:
            series = int(gt.get("score") or 0)
        except (TypeError, ValueError):
            series = 0
        for n in range(1, 3):
            f[f"{s} map pip {n}"] = ("/val-svg/dot/%s/%d.svg" % (col[1:], 1 if series >= n else 0)) if n <= need else ""
        for n in range(1, 6):
            p = m.players.get((i, n), {})
            k = f"{s} {n}"
            have = bool(p.get("name"))
            dead = p.get("alive") is False
            aid, gid = p.get("agent_id") or "", p.get("weapon_id") or ""
            ab = p.get("abilities") or {}
            ult, most = int(p.get("ult") or 0), int(p.get("ult_max") or 7)
            show = have and not buy and not picking   # (the tabs step aside for the buy-phase board and agent select)
            f.update({f"{k} here": "yes" if show else "", f"{k} up": "yes" if show and not dead else "", f"{k} down": "yes" if show and dead else "",
                      f"{k} board": "yes" if have and buy else "",
                      f"{k} pic": f"/val-img/agent/{aid}/displayicon.png" if UUID.match(aid) else "",
                      # (Owen's picture folders: the agent and gun as file names, e.g. "KAY/O" -> "Kayo")
                      f"{k} agent file": _file(p.get("agent")), f"{k} weapon file": _file(p.get("weapon")),
                      f"{k} ult pic": f"/val-img/agent/{aid}/ultimate.png" if UUID.match(aid) else "",
                      f"{k} ult ring": f"/val-svg/ring/{min(ult, most)}/{most}.svg",
                      f"{k} hp bar": f"/val-svg/bar/{0 if dead else max(0, min(100, int(p.get('health') or 0)))}/{'3a3a3a' if dead else col[1:]}.svg",
                      f"{k} tab bar": f"/val-svg/obar/{100 if dead else max(0, min(100, int(p.get('health') or 0)))}/{'3a3a3a' if dead else col[1:]}/{'r' if i else 'l'}.svg",
                      f"{k} hp": "" if dead else str(int(p.get("health") or 0)) if have else "",
                      f"{k} cash": f"{int(p.get('credits')):,}" if str(p.get("credits", "")).isdigit() else "",
                      f"{k} armor pic": f"/val-svg/armor/{p['armor']}.svg" if p.get("armor") in ("heavy", "light", "regen") else "",
                      f"{k} side gun": f"/val-img/weapon/{gid}/killstreamicon.png" if UUID.match(gid) and p.get("weapon") in SIDEARMS else "",
                      f"{k} main gun": f"/val-img/weapon/{gid}/killstreamicon.png" if UUID.match(gid) and p.get("weapon") not in SIDEARMS else "",
                      f"{k} gun": f"/val-img/weapon/{gid}/killstreamicon.png" if UUID.match(gid) else "",
                      f"{k} carrying": "yes" if p.get("spike") is True and show and not dead else "",   # (not while the cards are away: it would float),
                      f"{k} kda": f"{int(p.get('kills') or 0)}/{int(p.get('deaths') or 0)}/{int(p.get('assists') or 0)}" if have else ""})
            for key, part in (("c", "grenade"), ("q", "ability1"), ("e", "ability2")):
                c = ab.get(key.upper()) or [0, 1]
                f[f"{k} {key} pic"] = f"/val-img/agent/{aid}/{part}.png" if UUID.match(aid) else ""
                f[f"{k} {key} marks"] = f"/val-svg/marks/{int(c[0])}/{int(c[1])}.svg"
                f[f"{k} {key} out"] = "" if c[0] else "yes"
    # agent select
    from . import valorant as V
    cat = V._catalog or {}
    roles = {a["id"]: a for a in cat.get("agents", [])}
    sel = getattr(m, "select", {}) or {}
    picks = [(i, n, m.players.get((i, n), {})) for i in (0, 1) for n in range(1, 6)]
    first = m.first if m.first in (0, 1) else 0
    mp = next((x for x in cat.get("maps", []) if x["id"] == sel.get("map_id")), None)
    try:
        game_no = int(g.get("game") or 0) or sum(int((g.get(k) or {}).get("score") or 0) for k in ("left", "right")) + 1
    except (TypeError, ValueError):
        game_no = 1
    f.update({"Select on": "yes" if sel.get("on") else "", "Select timer": sel.get("timer", ""), "Map number": f"MAP {game_no}",
              "Locked count": f"{sum(1 for _, _, p in picks if p.get('locked') and p.get('pick'))}/10",
              "Select map": (mp or {}).get("name", m.map or "").upper(),
              "Select map pic": f"/val-img/map/{mp['id']}/splash.png" if mp else ""})
    for i, s in enumerate(SIDES):
        f[f"{s} select side"] = "ATTACK" if first == i else "DEFEND"
    for i, n, p in picks:
        k, aid = f"{SIDES[i]} {n}", p.get("pick") or ""
        on = bool(sel.get("on"))
        ok = bool(UUID.match(aid))
        locked = ok and bool(p.get("locked"))
        f.update({f"{k} pick art": f"/val-img/agent/{aid}/fullportrait.png" if ok else "",
                  f"{k} locked": "yes" if on and locked else "", f"{k} hovering": "yes" if on and ok and not locked else "", f"{k} empty": "yes" if on and not ok else "",
                  f"{k} pick name": (roles.get(aid) or {}).get("name", "").upper() if ok else "", f"{k} pick locked": "yes" if locked else "",
                  f"{k} select name": p.get("name") or ""})
    f["Banner"] = getattr(m, "banner", "")
    f["Banner color"] = f[f"{SIDES[m.banner_side]} color"] if getattr(m, "banner_side", None) in (0, 1) else "#ffffff"
    f["Round tracker"] = f"/val-svg/tracker/{_track(m)}/{f['Left color'][1:]}/{f['Right color'][1:]}.svg"
    # each round on its own (Owen's SCC 2027 tracker: a cell per team per round, the win icon in the winner's colour)
    by_round = {h["round"]: h for h in m.history if isinstance(h.get("round"), int)}   # (by the round's own number: a reader that joins mid-match)
    for r in range(1, 25):
        h = by_round.get(r) if by_round else (m.history[r - 1] if r <= len(m.history) else None)
        w = h.get("winner") if h else None
        board = f.get("Buy phase") == "yes"   # (the tracker is on the buy-phase board only)
        f[f"Round {r} left won"] = "yes" if w == 0 and board else ""
        f[f"Round {r} right won"] = "yes" if w == 1 and board else ""
        f[f"Round {r} icon"] = f"/library/owen-hud/assets/win-{OWEN_WIN.get(h.get('how'), 'Elimination')}.png" if h else ""
        f[f"Round {r} now"] = "yes" if r == m.round and board else ""
    if won:
        w = won["winner"]
        f.update({"Round winner": f["Left full name" if w == 0 else "Right full name"], "Round winner side": "ATTACK" if atk == w else "DEFENCE",
                  "Round winner how": WIN_HOW.get(won["how"], "").upper(), "Round winner color": f["Left color" if w == 0 else "Right color"],
                  "Round winner logo": f["Left logo" if w == 0 else "Right logo"]})
    else:
        f.update({"Round winner": "", "Round winner side": "", "Round winner how": "", "Round winner color": GOLD, "Round winner logo": ""})
    return f


def _track(m):
    """The round history in a URL: '0e1s...' (winner, how) then 'c' and the colours, short enough to cache."""
    return "".join(f"{h['winner']}{(h['how'] or 'e')[0]}" for h in m.history[:40]) or "-"


# --- the pictures (/val-svg/...) -----------------------------------------------------------------------
def svg(path):
    """(svg text) for /val-svg/<kind>/<args>.svg, or None."""
    bits = path.removesuffix(".svg").split("/")
    try:
        kind, args = bits[0], bits[1:]
        if kind == "ring":
            return _ring(int(args[0]), int(args[1]))
        if kind == "marks":
            return _marks(int(args[0]), int(args[1]))
        if kind == "bar":
            return _bar(int(args[0]), _hex(args[1]))
        if kind == "obar":
            return _obar(int(args[0]), _hex(args[1]), args[2] == "r" if len(args) > 2 else False)
        if kind == "dot":
            return _dot(_hex(args[0]), args[1] == "1")
        if kind == "armor":
            return _armor(args[0])
        if kind == "spike":
            return _spike(args[0] == "ink")
        if kind == "tracker":
            return _tracker(args[0], _hex(args[1]) if len(args) > 1 else BLUE, _hex(args[2]) if len(args) > 2 else RED)
    except (ValueError, IndexError):
        return None
    return None


def _spike(ink):
    body, core = ("#111111", "#c4c5ca") if ink else ("#ff5148", "#ffd3cf")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="42" viewBox="0 0 40 42"><path d="M20 1 31 14 20 41 9 14Z" fill="{body}"/>'
            f'<path d="M20 8 25.5 15 20 31 14.5 15Z" fill="{core}"/></svg>')


def _hex(s):
    if not re.fullmatch(r"[0-9a-fA-F]{6}", s):
        raise ValueError(s)
    return "#" + s


def _ring(have, most):
    import math
    n, r = max(1, min(12, most)), 18
    gap, seg = (0.22 if n > 1 else 0), 2 * math.pi / max(1, min(12, most))
    d = []
    for i in range(n):
        a0 = -math.pi / 2 + i * seg + gap / 2
        a1 = a0 + seg - gap
        p = lambda a: f"{20.5 + r * math.cos(a):.2f} {20.5 + r * math.sin(a):.2f}"
        col = "#ffffff" if i < have else "rgba(6,9,15,.8)"
        d.append(f'<path d="M{p(a0)} A{r} {r} 0 {1 if seg - gap > math.pi else 0} 1 {p(a1)}" stroke="{col}" stroke-width="3.6" fill="none"/>')
    if have >= most:   # (ready: one whole ring, glowing)
        return ('<svg xmlns="http://www.w3.org/2000/svg" width="41" height="41" viewBox="0 0 41 41"><defs><filter id="g" x="-30%" y="-30%" width="160%" height="160%">'
                '<feGaussianBlur stdDeviation="1.4"/></filter></defs><circle cx="20.5" cy="20.5" r="18" stroke="#fff" stroke-width="3.6" fill="none" filter="url(#g)" opacity=".9"/>'
                '<circle cx="20.5" cy="20.5" r="18" stroke="#fff" stroke-width="3.6" fill="none"/></svg>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="41" height="41" viewBox="0 0 41 41">{"".join(d)}</svg>'


def _marks(have, most):
    most = max(1, min(4, most))
    w = most * 8 + (most - 1) * 3
    x0 = (33 - w) / 2
    bars = "".join(f'<rect x="{x0 + i * 11:.1f}" y="0" width="8" height="2" fill="{"#fff" if i < have else "rgba(255,255,255,.25)"}"/>' for i in range(most))
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="33" height="2" viewBox="0 0 33 2">{bars}</svg>'


def _bar(pct, col):
    pct = max(0, min(100, pct))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="308" height="8" viewBox="0 0 308 8" preserveAspectRatio="none">'
            f'<rect width="308" height="8" fill="rgba(0,0,0,.35)"/><rect width="{3.08 * pct:.1f}" height="8" fill="{col}"/></svg>')


def _obar(pct, col, right):
    """Owen's tab health bar (308 x 8): the dark track, the fill from the team's side, cut by the tab's 25 px rounded corners."""
    pct, w = max(0, min(100, pct)), 3.08 * max(0, min(100, pct))
    x = 308 - w if right else 0
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="308" height="8" viewBox="0 0 308 8" preserveAspectRatio="none">'
            f'<defs><clipPath id="t"><rect x="0" y="-26" width="308" height="34" rx="25" ry="25"/></clipPath></defs>'
            f'<g clip-path="url(#t)"><rect width="308" height="8" fill="rgba(0,0,0,.35)"/><rect x="{x:.1f}" width="{w:.1f}" height="8" fill="{col}"/></g></svg>')


def _dot(col, on):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12"><circle cx="6" cy="6" r="5.2" fill="{col if on else NAVY}" '
            f'stroke="#fff" stroke-width="1.4"/></svg>')


def _armor(kind):
    if kind == "regen":
        return ('<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 21 21"><circle cx="10.5" cy="10.5" r="9" fill="none" stroke="#fff" stroke-width="1.5"/>'
                '<path d="M9.3 5.5h2.4v3.8h3.8v2.4h-3.8v3.8H9.3v-3.8H5.5V9.3h3.8z" fill="#fff"/></svg>')
    if kind not in ("heavy", "light"):
        raise ValueError(kind)
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="21" height="21" viewBox="0 0 21 21">'   # (an outlined badge with the shield's points in it)
            '<polygon points="10.5,1.3 18.7,4.4 17.3,14.4 10.5,19.7 3.7,14.4 2.3,4.4" fill="none" stroke="#dfe3e8" stroke-width="1.2" stroke-linejoin="round"/>'
            f'<text x="10.5" y="13.9" font-family="Arial" font-weight="700" font-size="8.4" text-anchor="middle" fill="#fff">{50 if kind == "heavy" else 25}</text></svg>')


WIN_MARK = {
    "e": '<path d="M11 2a8 8 0 0 0-5 14v3h10v-3a8 8 0 0 0-5-14zm-3 8.5a1.8 1.8 0 1 1 0 .01zm6 0a1.8 1.8 0 1 1 0 .01z" fill="C"/>',
    "s": '<path d="M11 1l6 7-6 13-6-13z" fill="C"/><circle cx="11" cy="11" r="10" fill="none" stroke="C" stroke-width="1.5" stroke-dasharray="3 3"/>',
    "d": '<path d="M11 2l6 7-6 12-6-12z" fill="none" stroke="C" stroke-width="2"/><path d="M4 18 18 4" stroke="C" stroke-width="2.4"/>',
    "t": '<circle cx="11" cy="11" r="8.5" fill="none" stroke="C" stroke-width="2"/><path d="M11 6v5.5l3.5 2" stroke="C" stroke-width="2" fill="none"/>'}


def _tracker(code, left, right):
    """The round grid (1372 x 96, at 154,14 inside the tracker): numbers, a cell per team per round, the round being played."""
    hist = [] if code == "-" else [(int(code[i]), code[i + 1]) for i in range(0, len(code) - 1, 2) if code[i] in "01"]
    n, cur, out = max(24, len(hist)), len(hist), []
    for i in range(n):
        x = 9 + 37 * i
        out.append(f'<text x="{x + 16}" y="16" font-family="Arial" font-weight="700" font-size="11" text-anchor="middle" fill="#fff">{i + 1}</text>')
        for t, y in ((0, 22), (1, 58)):
            won = i < len(hist) and hist[i][0] == t
            col = (left, right)[t]
            out.append(f'<rect x="{x + .5}" y="{y + .5}" width="31" height="31" fill="#0d121a" stroke="{col if won else LINE}"/>')
            if won:
                out.append(f'<g transform="translate({x + 5} {y + 5})">{WIN_MARK.get(hist[i][1], WIN_MARK["e"]).replace("C", col)}</g>')
        if i == 12 or (i > 24 and i % 2 == 1):
            out.append(f'<rect x="{x - 3}" y="22" width="1" height="68" fill="#fff" opacity=".6"/>')
    if cur < n:
        out.append(f'<rect x="{6 + 37 * cur + .5}" y="1.5" width="37" height="93" fill="none" stroke="{GOLD}"/>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="1372" height="96" viewBox="0 0 1372 96">{"".join(out)}</svg>'


# --- the graphics -------------------------------------------------------------------------------------
def comps():
    v = lambda f: "{{VALORANT!" + f + "}}"
    T = lambda name, x, y, w, h, text, size, font="Inter", weight=700, align="center", **kw: _layer(
        "text", name, x, y, w, h, text=text, font=font, size=size, weight=weight, align=align, caps=False, fit="shrink", **kw)
    R = lambda name, x, y, w, h, fill, **kw: _layer("rect", name, x, y, w, h, fill=fill, **kw)
    I = lambda name, x, y, w, h, src, **kw: _layer("image", name, x, y, w, h, src=src, fit=kw.pop("fit", "contain"), **kw)

    # top bar: full (names) and condensed (logos only), round a gap that shows the game's own timer
    top = []
    for mode, show in (("full", v("Names")), ("cond", v("Condensed"))):
        l, w = (625, 265) if mode == "full" else (710, 180)
        top += [R(f"Outline top ({mode})", l, 0, 1920 - 2 * l, 1, f"linear-gradient(90deg, {v('Left color')}, #fff 50%, {v('Right color')})", show=show),
                R(f"Left half ({mode})", l, 0, w, 72, f"linear-gradient(90deg, {v('Left color')}, #ffffff 120%)", radius=10, show=show),
                R(f"Left half fill ({mode})", l + 1, 1, w - 1, 70, NAVY, radius=9, show=show),
                R(f"Left edge ({mode})", l, 0, 10, 72, v("Left color"), radius=0, show=show),
                R(f"Right half ({mode})", 1030, 0, w + (1 if mode == "cond" else 0), 72, f"linear-gradient(270deg, {v('Right color')}, #ffffff 120%)", radius=10, show=show),
                R(f"Right half fill ({mode})", 1030, 1, w - 1 + (1 if mode == "cond" else 0), 70, NAVY, radius=9, show=show),
                R(f"Right edge ({mode})", 1030 + w - 10 + (1 if mode == "cond" else 0), 0, 10, 72, v("Right color"), show=show),
                R(f"Outline bottom ({mode})", l, 71, 1920 - 2 * l, 1, f"linear-gradient(90deg, {v('Left color')}, #fff 50%, {v('Right color')})", show=show)]
        lg = (657, 1226, 18, 37) if mode == "full" else (750, 1121, 11, 50)
        top += [I(f"Left logo ({mode})", lg[0], lg[2], lg[3], lg[3], v("Left logo"), show=show), I(f"Right logo ({mode})", lg[1], lg[2], lg[3], lg[3], v("Right logo"), show=show)]
    top += [R("Gap left square", 878, 1, 12, 70, NAVY), R("Gap right square", 1030, 1, 12, 70, NAVY),   # (square corners at the gap)
            R("Divider left", 829, 1, 1, 70, "#ffffff"), R("Divider right", 1089, 1, 1, 70, "#ffffff"),
            T("Left tricode", 714, 14, 100, 30, v("Left tricode"), 32, font="Anton", weight=400, show=v("Names")),
            T("Left name", 709, 42, 110, 16, v("Left full name"), 14, font="Barlow Condensed", show=v("Names")),
            T("Right tricode", 1100, 14, 100, 30, v("Right tricode"), 32, font="Anton", weight=400, show=v("Names")),
            T("Right name", 1095, 42, 110, 16, v("Right full name"), 14, font="Barlow Condensed", show=v("Names")),
            I("Left map 1", 846, 22, 10, 10, v("Left map pip 1")), I("Left map 2", 846, 40, 10, 10, v("Left map pip 2")),
            I("Right map 1", 1063, 22, 10, 10, v("Right map pip 1")), I("Right map 2", 1063, 40, 10, 10, v("Right map pip 2")),
            T("Left score", 860, 12, 60, 48, v("Left score"), 52, font="Barlow Condensed"),
            T("Right score", 998, 12, 60, 48, v("Right score"), 52, font="Barlow Condensed"),
            T("Round", 910, 6, 100, 18, v("Round label"), 14, font="Barlow Condensed", tracking=3, show=v("In round")),
            R("Banner", 710, 80, 500, 40, NAVY, radius=10, stroke="#ffffff", strokeWidth=1, show=v("Banner")),
            R("Banner bar", 711, 81, 8, 38, v("Banner color"), radius="9 0 0 9", show=v("Banner")),
            T("Banner words", 719, 80, 491, 40, v("Banner"), 20, font="Barlow Condensed", tracking=2, show=v("Banner")),
            R("Spike box", 914, 6, 95, 65, "linear-gradient(#2a0d10, #120607)", radius=8, show=v("Planted")),
            I("Spike", 934, 10, 55, 57, "/val-svg/spike/on.svg", show=v("Planted"))]

    # player tabs, five a side (310 x 88, 106 apart from y 551)
    tabs = []
    for i, s in enumerate(SIDES):
        for n in range(1, 6):
            k, y0, right = f"{s} {n}", 551 + 106 * (n - 1), i == 1
            x0 = 1593 if right else 17
            X = (lambda a, w: x0 + 310 - a - w) if right else (lambda a, w: x0 + a)   # (the right team laid out from its right edge)
            corner = (lambda r: f"0 {r} 0 {r}") if right else (lambda r: f"{r} 0 {r} 0")
            cash = (lambda c: c + " ¤") if right else (lambda c: "¤ " + c)   # (the credits sign on the outer side)   # (the agent box's two rounded corners, mirrored on the right)
            here, up, down = v(f"{k} here"), v(f"{k} up"), v(f"{k} down")
            col = v(f"{s} color")
            tabs += [R(f"{k} tab", x0, y0, 310, 88, "linear-gradient(rgba(102,102,102,.2), rgba(0,0,0,.2)), rgba(17,24,35,.5)", radius=25, stroke="#ffffff", strokeWidth=1, show=up),
                     R(f"{k} tab dead", x0, y0, 310, 88, f"linear-gradient({270 if right else 90}deg, rgba(58,58,58,.9), rgba(58,58,58,0)), rgba(0,0,0,.25)", radius=25, show=down),
                     R(f"{k} agent box", X(-1, 51), y0 - 1, 51, 51, col, radius=corner(25), stroke="#ffffff", strokeWidth=1, show=up),
                     R(f"{k} agent box dead", X(-1, 51), y0 - 1, 51, 51, "#393939", radius=corner(25), show=down),
                     I(f"{k} agent", X(0, 49), y0, 49, 49, v(f"{k} pic"), fit="cover", radius=corner(24), show=up, pic={"flipX": right}),
                     I(f"{k} agent dead", X(0, 49), y0, 49, 49, v(f"{k} pic"), fit="cover", radius=corner(24), show=down, pic={"flipX": right, "gray": 100}),
                     T(f"{k} name", X(62, 108), y0 + 12, 108, 24, v(f"{k} name"), 19, align="right" if right else "left", show=here)]
            for a, key in enumerate("cqe"):
                tabs += [I(f"{k} {key.upper()}", X(172 + 31 * a, 21), y0 + 14, 21, 21, v(f"{k} {key} pic"), show=up),
                         I(f"{k} {key.upper()} charges", X(166 + 31 * a, 33), y0 + 37, 33, 2, v(f"{k} {key} marks"), fit="fill", show=up)]
            tabs += [I(f"{k} ult ring", X(263, 41), y0 + 4, 41, 41, v(f"{k} ult ring"), show=here),
                     I(f"{k} ult", X(274.5, 18), y0 + 15.5, 18, 18, v(f"{k} ult pic"), show=here),
                     T(f"{k} credits", X(12, 96), y0 + 54, 96, 22, cash(v(f"{k} cash")), 19, weight=400, align="right" if right else "left", show=up),
                     I(f"{k} side gun", X(107, 30), y0 + 55, 30, 18, v(f"{k} side gun"), show=up, pic={"flipX": not right}),
                     I(f"{k} main gun", X(141, 62), y0 + 55, 62, 18, v(f"{k} main gun"), show=up, pic={"flipX": not right}),
                     I(f"{k} armor", X(242, 21), y0 + 54, 21, 21, v(f"{k} armor pic"), show=up),
                     T(f"{k} health", X(263, 42), y0 + 54, 42, 22, v(f"{k} hp"), 20, weight=700, align="left" if right else "right", show=up),
                     T(f"{k} K/D/A", X(7, 120), y0 + 54, 120, 22, v(f"{k} kda"), 19, weight=400, align="right" if right else "left", show=down),
                     T(f"{k} credits (dead)", X(233, 70), y0 + 54, 70, 22, cash(v(f"{k} cash")), 19, weight=400, align="left" if right else "right", show=down),
                     I(f"{k} health bar", x0 + 1, y0 + 79, 308, 8, v(f"{k} hp bar"), fit="fill", radius="0 0 24 24 / 0 0 8 8", show=here, pic={"flipX": right}),
                     R(f"{k} spike badge", X(-6, 26), y0 - 4, 26, 26, "#c4c5ca", radius=13, show=v(f"{k} carrying")),
                     I(f"{k} spike", X(-2, 18), y0, 18, 18, "/val-svg/spike/ink.svg", show=v(f"{k} carrying"))]

    # buy phase: the board and the round tracker
    board = [R("Board", 0, 765, 1920, 340, f"linear-gradient(rgba(102,102,102,.2), rgba(0,0,0,.2)), {NAVY}", radius=10),
             I("Left logo mark", 678, 838, 175, 175, v("Left logo"), opacity=.2), I("Right logo mark", 1069, 838, 175, 175, v("Right logo"), opacity=.2),
             R("Tracker", 190, 626, 1540, 124, f"linear-gradient(rgba(102,102,102,.2), rgba(0,0,0,.2)), {NAVY}", radius=10),
             R("Tracker grid", 344, 640, 1372, 96, "rgba(17,24,35,.75)", stroke="#ffffff", strokeWidth=1),
             I("Round tracker", 344, 640, 1372, 96, v("Round tracker"), fit="fill")]
    for i, s in enumerate(SIDES):
        ty = 640 + 50 * i
        board += [R(f"{s} tracker team", 205, ty, 136, 46, "rgba(17,24,35,.75)", radius=10, stroke="rgba(255,255,255,.6)", strokeWidth=1),
                  R(f"{s} tracker edge", 205, ty, 6, 46, v(f"{s} color")),
                  I(f"{s} tracker logo", 220, ty + 11, 24, 24, v(f"{s} logo")),
                  T(f"{s} tracker tricode", 258, ty + 12, 60, 22, v(f"{s} tricode"), 20, font="Barlow Condensed", align="left"),
                  I(f"{s} timeout 1", 322, ty + 10, 12, 12, v(f"{s} timeout 1")), I(f"{s} timeout 2", 322, ty + 26, 12, 12, v(f"{s} timeout 2"))]
        for n in range(1, 6):
            k, y0, right = f"{s} {n}", 785 + 56 * (n - 1), i == 1
            cx, ax, gx, wx = (1741, 1588, 1355, 965) if right else (16, 189, 342, 575)
            X = (lambda base, w, a, ww: base + w - a - ww) if right else (lambda base, w, a, ww: base + a)
            box = lambda name, x, w: R(f"{k} {name} box", x, y0, w, 52, "rgba(13,18,26,.75)", radius=5, stroke=LINE, strokeWidth=1, show=v(f"{k} board"))
            board += [box("credits", cx, 164), T(f"{k} board credits", X(cx, 164, 9, 100), y0 + 15, 100, 22, "¤ " + v(f"{k} cash"), 19, weight=400,
                                                   align="left" if right else "right", show=v(f"{k} board")),
                      box("abilities", ax, 144)]
            for a, key in enumerate("cqe"):
                board += [I(f"{k} board {key.upper()}", X(ax, 144, 13 + 44 * a, 30), y0 + 7, 30, 30, v(f"{k} {key} pic"), show=v(f"{k} board")),
                          I(f"{k} board {key.upper()} charges", X(ax, 144, 11 + 44 * a, 34), y0 + 41, 34, 3, v(f"{k} {key} marks"), fit="fill", show=v(f"{k} board"))]
            board += [box("gun", gx, 224),
                      I(f"{k} board armor", X(gx, 224, 11, 25), y0 + 13, 25, 25, v(f"{k} armor pic"), show=v(f"{k} board")),
                      I(f"{k} board gun", X(gx, 224, 54, 110), y0 + 11, 110, 28, v(f"{k} gun"), pic={"flipX": not right}, show=v(f"{k} board")),
                      I(f"{k} board ult ring", X(gx, 224, 172, 41), y0 + 5, 41, 41, v(f"{k} ult ring"), show=v(f"{k} board")),
                      I(f"{k} board ult", X(gx, 224, 183.5, 18), y0 + 16.5, 18, 18, v(f"{k} ult pic"), show=v(f"{k} board")),
                      box("player", wx, 381),
                      R(f"{k} board wash", wx + 1, y0 + 1, 379, 50, f"linear-gradient({270 if right else 90}deg, {v(f'{s} color')}, transparent 50%)", radius=4, opacity=.2, show=v(f"{k} board")),
                      I(f"{k} board agent", X(wx, 381, 1, 74), y0 + 1, 74, 50, v(f"{k} pic"), fit="cover", pic={"flipX": right}, show=v(f"{k} board")),
                      T(f"{k} board name", X(wx, 381, 85, 170), y0 + 14, 170, 24, v(f"{k} name"), 19, align="right" if right else "left", show=v(f"{k} board")),
                      T(f"{k} board K/D/A", X(wx, 381, 253, 110), y0 + 14, 110, 24, v(f"{k} kda"), 19, weight=400, align="left" if right else "right", show=v(f"{k} board"))]

    # round won: our own graphic, at the same place and size as the SCC one (780 x 232 at 570,159)
    win = [R("Win panel", 570, 180, 780, 189, f"radial-gradient(ellipse at 50% 45%, rgba(17,24,35,.94), rgba(17,24,35,.8) 60%, rgba(17,24,35,0))", radius=6),
           R("Win crest", 919, 159, 82, 82, NAVY, radius=41, stroke="#f9c229", strokeWidth=3),
           I("Win logo", 935, 175, 50, 50, v("Round winner logo")),
           T("Win words", 570, 236, 780, 100, "ROUND WIN", 96, font="Anton", weight=400),
           R("Win bar", 627, 346, 680, 45, "linear-gradient(90deg, rgba(249,194,41,0), #f9c229 20%, #f9c229 80%, rgba(249,194,41,0))"),
           T("Win team", 627, 346, 680, 45, v("Round winner") + "  ·  " + v("Round winner side") + "  ·  " + v("Round winner how"), 26,
             font="Anton", weight=400, color=NAVY)]
    # the moves: what appears plays its In, what goes its Out (the stage plays them as the live data changes)
    A = lambda kind, dur=400, delay=0, out=None, ease="": {"in": {"dur": dur, "delay": delay, "type": kind, **({"ease": ease} if ease else {})},
                                                          "out": {"dur": out or int(dur * .75), "delay": 0, "type": kind}}
    for l in top:
        l.setdefault("show", v("Top on"))
        l["show"] = l["show"] or v("Top on")
        l["anim"] = A("pop", 420) if l["name"].startswith("Spike") else A("slide-down", 380) if l["name"].startswith("Banner") else A("fade", 350)
    for l in tabs:
        side, n = l["name"].split(" ")[0], int(l["name"].split(" ")[1])
        here = "here}}" in str(l.get("show"))
        l["anim"] = A("push-right" if side == "Left" else "push-left", 500, 40 * (n - 1)) if here else A("fade", 260)
        if "carrying" in str(l.get("show")):
            l["anim"] = A("pop", 380)
    for l in board:
        m = re.match(r"(Left|Right) (\d) ", l["name"])
        l["anim"] = A("push-up", 520, 30 * (int(m.group(2)) - 1) if m else 0)
    for l in win:
        kind = {"Win crest": "pop", "Win logo": "pop", "Win words": "scale", "Win bar": "grow-x"}.get(l["name"], "fade")
        delay = {"Win panel": 0, "Win crest": 120, "Win logo": 160, "Win words": 220, "Win bar": 360, "Win team": 520}.get(l["name"], 0)
        l["anim"] = A(kind, 480, delay, 300)
    # agent select: both teams' five cards and the map in the middle (from the SCC agent-select screens, at 1920 x 1080)
    sel = [R("Select shade", 0, 690, 1920, 390, "linear-gradient(rgba(8,10,16,0), rgba(8,10,16,.88) 22%)"),
           T("Map number", 794, 696, 308, 20, v("Map number"), 15, font="Barlow Condensed", weight=600, tracking=4, color="#c9ced6"),
           R("Map card", 794, 728, 308, 352, "#141a24", radius="14 14 0 0"),
           I("Map picture", 794, 728, 308, 268, v("Select map pic"), fit="cover", radius="14 14 0 0"),
           R("Map fade", 794, 860, 308, 136, "linear-gradient(rgba(20,26,36,0), rgba(20,26,36,.85))"),
           T("Map name", 794, 896, 308, 72, v("Select map"), 66, font="Anton", weight=400),
           R("Select panel", 794, 996, 308, 84, "#10151e"),
           T("Agent select words", 830, 1001, 90, 16, "AGENT", 13, font="Barlow Condensed", weight=600, tracking=3, align="left", color="#c9ced6"),
           T("Agent select words 2", 830, 1017, 90, 16, "SELECT", 13, font="Barlow Condensed", weight=600, tracking=3, align="left", color="#c9ced6"),
           T("Select timer", 896, 990, 104, 56, v("Select timer"), 52, font="Anton", weight=400),
           T("Locked", 990, 1001, 100, 16, v("Locked count"), 13, font="Barlow Condensed", weight=600, tracking=3, align="left", color="#c9ced6"),
           T("Locked 2", 990, 1017, 100, 16, "LOCKED", 13, font="Barlow Condensed", weight=600, tracking=3, align="left", color="#c9ced6")]
    for i, s in enumerate(SIDES):
        right = i == 1
        col = v(f"{s} color")
        sel += [I(f"{s} select logo", 1782 if right else 62, 712, 44, 44, v(f"{s} logo")),
                T(f"{s} select team", 1100 if right else 120, 708, 664, 56, v(f"{s} full name"), 52, font="Anton", weight=400, align="right" if right else "left"),
                R(f"{s} select tag", 1373 if right else 507, 718, 96, 26, "transparent", radius=2, stroke=col, strokeWidth=1.5),
                T(f"{s} select tag words", 1373 if right else 507, 718, 96, 26, v(f"{s} select side"), 13, font="Barlow Condensed", weight=600, tracking=4, color=col)]
        for n in range(1, 6):
            k = f"{s} {n}"
            x = (1105 + 148 * (n - 1)) if right else (55 + 148.5 * (n - 1))
            x = round(x)
            sel += [R(f"{k} card", x, 776, 142, 287, "linear-gradient(#1a2130, #0e131c)", radius=2),
                    R(f"{k} card hover edge", x, 776, 142, 287, "transparent", radius=2, stroke=col, strokeWidth=1.5, show=v(f"{k} hovering")),
                    T(f"{k} card empty", x, 860, 142, 80, "?", 56, font="Anton", weight=400, color="rgba(255,255,255,.12)", show=v(f"{k} empty")),
                    I(f"{k} card shadow", x, 776, 142, 287, v(f"{k} pick art"), fit="cover", position="top", opacity=.5, recolor="#9aa0aa", pic={"flipX": right}, show=v(f"{k} hovering")),
                    I(f"{k} card art", x, 776, 142, 287, v(f"{k} pick art"), fit="cover", position="top", pic={"flipX": right}, show=v(f"{k} locked")),
                    R(f"{k} card fade", x, 950, 142, 113, "linear-gradient(rgba(10,13,20,0), rgba(10,13,20,.92) 60%)"),
                    T(f"{k} card agent", x + 10, 1004, 122, 20, v(f"{k} pick name"), 15, font="Barlow Condensed", weight=600, tracking=3, color=col,
                      align="right" if right else "left"),
                    T(f"{k} card player", x + 8, 1026, 126, 30, v(f"{k} select name"), 22, align="right" if right else "left"),
                    R(f"{k} card bar", x, 1059, 142, 4, col, show=v(f"{k} locked"))]
    for l in sel:
        l["anim"] = A("fade", 300) if "card" in l["name"] and ("shadow" in l["name"] or "art" in l["name"] or "edge" in l["name"] or "bar" in l["name"]) else A("push-up", 520)
    sel = [dict(l, show=l.get("show") or v("Select on")) for l in sel]
    return [("val27:top", "VAL HUD · Top bar", "overlay", top), ("val27:tabs", "VAL HUD · Players", "overlay", tabs),
            ("val27:board", "VAL HUD · Buy phase", "overlay", [dict(l, show=l.get("show") or v("Buy phase")) if not l.get("show") else l for l in board]),
            ("val27:win", "VAL HUD · Round win", "overlay", [dict(l, show=v("Round won")) for l in win]),
            ("val27:select", "VAL HUD · Agent select", "overlay", sel)]
