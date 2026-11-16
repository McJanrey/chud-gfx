"""Black-box probe of the OLD app's Standings table (test copy only, port 7890)."""
import copy
import json
import os
import urllib.request

BASE = "http://127.0.0.1:7890"
get = lambda: json.load(urllib.request.urlopen(BASE + "/api/state"))


def post(g):
    urllib.request.urlopen(urllib.request.Request(BASE + "/api/global", json.dumps({"global": g}).encode(),
                                                  {"Content-Type": "application/json", "Origin": BASE})).read()


start = get()["global"]
T = lambda n, w, l, pts="", diff="": {"name": n, "w": w, "l": l, "pts": pts, "diff": diff}
TEAMS = [T("Saints", "5", "1", "15", "+12"), T("Hawks", "3", "3", "9", "0"), T("Falcons", "4", "2", "12", "+5"),
         T("Lords", "1", "5", "3", "-9"), T("Owls", "", "", "", ""), T("Bears", "2", "4", "6", "-3")]
VARIANTS = [
    {"title": "", "subtitle": "LEADERBOARD", "count": 8, "stat": "record", "stat2": "", "teams": TEAMS},
    {"title": "FALL SPLIT", "subtitle": "", "count": 8, "stat": "points", "stat2": "", "teams": TEAMS},
    {"title": "X", "subtitle": "Y", "count": 8, "stat": "wins", "stat2": "diff", "teams": TEAMS},
    {"title": "X", "subtitle": "Y", "count": 16, "stat": "diff", "stat2": "points", "teams": TEAMS},
    {"title": "X", "subtitle": "Y", "count": 4, "stat": "losses", "stat2": "record", "teams": TEAMS},
    {"title": "X", "subtitle": "Y", "count": 8, "stat": "none", "stat2": "", "teams": TEAMS},
    {"title": "X", "subtitle": "Y", "count": 8, "stat": "record", "stat2": "", "teams": []},
]
cases = []
for v in VARIANTS:
    g = copy.deepcopy(start)
    g["standings"] = v
    post(g)
    s = get()
    cases.append({"global": s["global"], "Standings": s["data"]["tables"]["Standings"]})
post(start)
json.dump(cases, open(os.path.join(os.path.dirname(__file__), "fixtures", "standings_cases.json"), "w", encoding="utf-8"), indent=1)
print(len(cases))
