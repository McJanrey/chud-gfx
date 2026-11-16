"""Black-box probe of the OLD app's Tournament table (test copy only, port 7890).
Fills brackets round by round (each round's match keys are read back from the table the old app makes)."""
import copy
import json
import os
import random
import re
import urllib.request

BASE = "http://127.0.0.1:7890"
get = lambda: json.load(urllib.request.urlopen(BASE + "/api/state"))


def post(g):
    urllib.request.urlopen(urllib.request.Request(BASE + "/api/global", json.dumps({"global": g}).encode(),
                                                  {"Content-Type": "application/json", "Origin": BASE})).read()


def table(g):
    post(g)
    s = get()
    return s["global"], s["data"]["tables"]["Tournament"]


start = get()["global"]
NAMES = ["Saints", "Hawks", "Falcons", "Lords", "Owls", "Bears", "Wolves", "Foxes",
         "Lions", "Tigers", "Sharks", "Eagles", "Rams", "Bulls", "Kings", "Jets"]
rnd = random.Random(7)
cases = []
for size in (8, 16):
    for fmt in ("single", "double"):
        for reset in (True, False):
            g = copy.deepcopy(start)
            g["tournament"]["top"] = {"size": size, "format": fmt, "reset": reset, "short": size == 8,
                                      "teams": NAMES[:size] + [""] * (16 - size), "scores": {}}
            # score every match the table offers, a few times over (later rounds appear once earlier ones are decided)
            for _ in range(12):
                g2, rows = table(g)
                keys = sorted({m.group(1) for k, _ in rows[1:] for m in [re.match(r"^Top ([RL]\d+ M\d+|GF\d?) team 1$", k)] if m})
                new = [k for k in keys if k not in g["tournament"]["top"]["scores"]]
                if not new:
                    break
                for k in new:
                    a, b = rnd.randint(0, 3), rnd.randint(0, 3)
                    if a == b:
                        a += 1
                    g["tournament"]["top"]["scores"][k] = [str(a), str(b)]
            g2, rows = table(g)
            cases.append({"global": g2, "Tournament": rows})
            # and the same bracket half played (the first round only)
            half = copy.deepcopy(g)
            half["tournament"]["top"]["scores"] = {k: v for k, v in g["tournament"]["top"]["scores"].items() if "R1 " in k and not k.startswith(("L", "LB"))}
            g2, rows = table(half)
            cases.append({"global": g2, "Tournament": rows})
# groups: four teams each, scores for every group match
g = copy.deepcopy(start)
for i, grp in enumerate(g["tournament"]["groups"]):
    grp["teams"] = NAMES[i * 4:i * 4 + 4]
for _ in range(5):
    g2, rows = table(g)
    for i, grp in enumerate(g["tournament"]["groups"]):
        L = "ABCD"[i]
        keys = sorted({m.group(1) for k, _ in rows[1:] for m in [re.match(rf"^Group {L} (.+?) team 1$", k)] if m})
        for k in keys:
            if k not in grp["scores"]:
                a, b = rnd.randint(0, 2), rnd.randint(0, 2)
                grp["scores"][k] = [str(a + (a == b)), str(b)]
g2, rows = table(g)
cases.append({"global": g2, "Tournament": rows})
post(start)
json.dump(cases, open(os.path.join(os.path.dirname(__file__), "fixtures", "tournament_cases.json"), "w", encoding="utf-8"), indent=1)
print(len(cases), "cases")
