"""The Tournament table: a knockout bracket ("top": 8 or 16 teams, single or double elimination)
and four-team groups (opening, winners, elimination, decider). Winners move through on their own.
Rows match the old app's (tests/fixtures/tournament_cases.json, black-box probes)."""


def _won(score):
    """1 or 2: which side won (both scores in, not level), else 0."""
    try:
        a, b = (float(x) for x in score)
    except (TypeError, ValueError):
        return 0
    return 1 if a > b else 2 if b > a else 0


class _Rows:
    def __init__(self, info):
        self.rows, self.info = [["Field", "Value"]], info   # info(name) -> {"short", "logo"}

    def add(self, k, v):
        self.rows.append([k, "" if v is None else str(v)])

    def team(self, prefix, name, score=None, with_score=True):
        i = self.info(name) if name else {}
        self.add(prefix, name or "")
        self.add(prefix + " short", i.get("short", "") if name else "")
        self.add(prefix + " logo", i.get("logo", "") if name else "")
        if with_score:
            self.add(prefix + " score", score if score is not None else "")


def _match(r, key, a, b, scores):
    """One match: its two teams and scores; returns (winner, loser)."""
    s = scores.get(key) or ["", ""]
    s = (list(s) + ["", ""])[:2]
    r.team(f"Top {key} team 1", a, s[0] if a or s[0] else "")
    r.team(f"Top {key} team 2", b, s[1] if b or s[1] else "")
    w = _won(s) if a and b else 0
    winner = a if w == 1 else b if w == 2 else ""
    loser = b if w == 1 else a if w == 2 else ""
    r.add(f"Top {key} winner", winner)
    return winner, loser


def tournament_rows(g, teams=()):
    t = g.get("tournament") or {}
    top = t.get("top") or {}
    size = 16 if int(top.get("size") or 8) == 16 else 8
    double = top.get("format") == "double"
    reset = top.get("reset", True) is not False
    short_on = bool(top.get("short"))
    scores = top.get("scores") or {}
    known = {(x.get("name") or "").strip().lower(): x for x in teams}

    def info(name):
        k = known.get(name.strip().lower(), {})
        return {"short": k.get("short") or name, "logo": k.get("logo", "")}

    r = _Rows(info)
    r.add("Top teams", size); r.add("Top format", "double" if double else "single")
    r.add("Top reset", "on" if reset else "off"); r.add("Top short names", "on" if short_on else "off")

    names = [(x or "") for x in (top.get("teams") or [])] + [""] * 16
    field = names[:size]
    rounds = size.bit_length() - 1          # 8 -> 3, 16 -> 4
    wb, wb_losers, wb_scores = [field], [], []
    for rn in range(1, rounds + 1):
        nxt, losers, sc = [], [], []
        cur = wb[-1]
        for m in range(len(cur) // 2):
            key = f"R{rn} M{m + 1}"
            w, l = _match(r, key, cur[2 * m], cur[2 * m + 1], scores)
            nxt.append(w); losers.append(l); sc.append((scores.get(key) or ["", ""]))
        wb.append(nxt); wb_losers.append(losers); wb_scores.append(sc)
    wb_champ = wb[-1][0] if wb[-1] else ""

    lb_final = ("", "", ["", ""])
    if double:
        # losers' bracket: L1 pairs the first round's losers; then each "drop" round meets the
        # next winners'-round losers (in reverse order), each odd round pairs its own winners
        lb, ln, li = [], 0, 1
        cur = wb_losers[0]
        ln += 1
        nxt = []
        for m in range(len(cur) // 2):
            w, _ = _match(r, f"L{ln} M{m + 1}", cur[2 * m], cur[2 * m + 1], scores)
            nxt.append(w)
        cur = nxt
        while li < rounds:
            drops = list(reversed(wb_losers[li]))
            ln += 1
            nxt = []
            for m in range(len(cur)):
                key = f"L{ln} M{m + 1}"
                w, _ = _match(r, key, cur[m], drops[m] if m < len(drops) else "", scores)
                nxt.append(w)
                last = (cur[m], drops[m] if m < len(drops) else "", scores.get(key) or ["", ""])
            cur = nxt
            li += 1
            if len(cur) > 1:
                ln += 1
                nxt = []
                for m in range(len(cur) // 2):
                    w, _ = _match(r, f"L{ln} M{m + 1}", cur[2 * m], cur[2 * m + 1], scores)
                    nxt.append(w)
                cur = nxt
        lb_final = last
        lb_champ = cur[0] if cur else ""
        gf_w, _ = _match(r, "GF", wb_champ, lb_champ, scores)
        # a reset final only when the losers'-bracket team won the first (and resets are on)
        need = reset and gf_w and gf_w == lb_champ
        gf2_w, _ = _match(r, "GF2", wb_champ if need else "", lb_champ if need else "", scores if reset else {})   # (resets off: no second final at all)
        champ = gf2_w if need else gf_w
    else:
        champ = wb_champ

    r.team("Top champion", champ, with_score=False)
    if double:
        semis = [(n, s) for n, s in zip(wb[rounds - 1], (list(wb_scores[rounds - 1][0]) + ["", ""])[:2])]
        semis += [(lb_final[0], (list(lb_final[2]) + ["", ""])[0]), (lb_final[1], (list(lb_final[2]) + ["", ""])[1])]
        gf = (list(scores.get("GF") or ["", ""]) + ["", ""])[:2]
        finals = [(wb_champ, gf[0]), (lb_champ, gf[1])]
    else:
        semis = []
        for m, sc in enumerate(wb_scores[rounds - 2]):
            sc = (list(sc) + ["", ""])[:2]
            semis += [(wb[rounds - 2][2 * m], sc[0]), (wb[rounds - 2][2 * m + 1], sc[1])]
        sc = (list(wb_scores[rounds - 1][0]) + ["", ""])[:2]
        finals = [(wb[rounds - 1][0], sc[0]), (wb[rounds - 1][1], sc[1])]
    for i, (n, s) in enumerate(semis, 1):
        r.team(f"Top semi {i}", n, s if n else "")
    for i, (n, s) in enumerate(finals, 1):
        r.team(f"Top final {i}", n, s if n else "")

    for gi, grp in enumerate((t.get("groups") or [])[:4]):
        L = "ABCD"[gi]
        gs = grp.get("scores") or {}
        tm = ([(x or "") for x in grp.get("teams") or []] + [""] * 4)[:4]
        r.add(f"Group {L} name", grp.get("name", ""))

        def gmatch(key, a, b):
            s = (list(gs.get(key) or ["", ""]) + ["", ""])[:2]
            r.team(f"Group {L} {key} team 1", a, s[0] if a or s[0] else "")
            r.team(f"Group {L} {key} team 2", b, s[1] if b or s[1] else "")
            w = _won(s) if a and b else 0
            return (a if w == 1 else b if w == 2 else ""), (b if w == 1 else a if w == 2 else "")

        w1, l1 = gmatch("Opening 1", tm[0], tm[1])
        w2, l2 = gmatch("Opening 2", tm[2], tm[3])
        ww, wl = gmatch("Winners", w1, w2)
        ew, _ = gmatch("Elimination", l1, l2)
        dw, _ = gmatch("Decider", wl, ew)
        r.team(f"Group {L} 1st", ww, with_score=False)
        r.team(f"Group {L} 2nd", dw, with_score=False)
    return r.rows
