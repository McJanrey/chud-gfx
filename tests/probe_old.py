"""Black-box probe of the OLD app (a test copy, never MJ's live one): sets Global settings,
records the data tables it produces. Output: tests/fixtures/global_cases.json = [{"global", "tables"}].
Run only against the scratch copy:  python tests/probe_old.py http://127.0.0.1:7890
"""
import copy
import json
import os
import sys
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:7890"
assert BASE.endswith(":7890"), "probe the test copy only"


def get():
    return json.load(urllib.request.urlopen(BASE + "/api/state"))


def post(path, body):
    req = urllib.request.Request(BASE + path, json.dumps(body).encode(), {"Content-Type": "application/json", "Origin": BASE})
    urllib.request.urlopen(req).read()


start = get()["global"]
cases = []
VARIANTS = [
    {},
    {"best_of": 5, "left": {"score": 2}, "right": {"score": 1}},
    {"best_of": 1, "left": {"score": 1}, "right": {"score": 0}},
    {"best_of": 7, "left": {"score": 3}, "right": {"score": 3}, "game": 4},
    {"best_of": 3, "left": {"score": 0}, "right": {"score": 2}, "event": "NACE", "stage": "FINALS"},
    {"caster": {"count": 2, "primary": "#112233", "secondary": "#445566"}},
    {"caster": {"count": 3}},
    {"caster": {"count": 4, "text": "#abcdef"}},
    {"clock": {"mode": "time", "until": "", "zone": "", "label": ""}},
    {"clock": {"mode": "countdown", "until": "19:00", "zone": "EST", "label": "BACK SOON"}},
    {"timer": {"secs": 90, "from": 90, "down": True, "started": 0}},
    {"bgloop": {"on": False}},
    {"ticker": ["ONE", "TWO"]},
    {"custom": [["Host", "MJ"], ["Mode", "BO3"]]},
]
for v in VARIANTS:
    g = copy.deepcopy(start)
    for k, val in v.items():
        g[k] = {**g.get(k, {}), **val} if isinstance(val, dict) and isinstance(g.get(k), dict) else val
    post("/api/global", {"global": g})
    s = get()
    cases.append({"change": v, "global": s["global"], "tables": {k: s["data"]["tables"][k] for k in ("Global", "Sponsors", "Schedule")}})
post("/api/global", {"global": start})
out = os.path.join(os.path.dirname(__file__), "fixtures", "global_cases.json")
json.dump(cases, open(out, "w", encoding="utf-8"), indent=1)
print(len(cases), "cases ->", out)
