import os
import tempfile
import threading
import unittest
from pathlib import Path

from sgfx.app import pick_workspace_in
from sgfx.server import make_server
from tests.test_hudlink import call


class Valorant(unittest.TestCase):
    """Partial sends from any reader become the VALORANT table; rounds and maps are kept, a map win counts in the series."""
    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.engine, self.srv = make_server(str(pick_workspace_in(d)), str(d / "library"), 0)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()

    def tearDown(self):
        self.srv.shutdown()

    def send(self, body):
        code, r = call(self.engine.port, "/api/val/ingest", body)
        self.assertEqual(code, 200, r)

    def table(self, name):
        rows = call(self.engine.port, "/api/state")[1]["data"]["tables"].get(name) or []
        return {r[0]: r[1] for r in rows[1:]}

    def test_match_rounds_maps_and_series(self):
        self.send({"teams": [{"name": "Saints", "score": 0}, {"name": "Lancers", "score": 0}], "round": 1, "map": "Ascent", "first_attack": 1,
                   "players": [{"team": 0, "slot": 1, "name": "Kai", "agent": "Jett", "alive": True, "credits": 800, "ult": 2, "ult_max": 7, "kills": 0, "deaths": 0}]})
        t = self.table("VALORANT")
        self.assertEqual((t["Left name"], t["Left side"], t["Right side"], t["Map"]), ("Saints", "DEF", "ATK", "Ascent"))
        self.assertEqual((t["Left 1 name"], t["Left 1 agent"], t["Left 1 alive"], t["Left 1 kd"]), ("Kai", "Jett", "yes", "0/0/0"))
        # partial send: only the round and one player's health change, the rest stays
        self.send({"round": 13, "players": [{"team": 0, "slot": 1, "alive": False}], "spike": "planted"})
        t = self.table("VALORANT")
        self.assertEqual((t["Left side"], t["Left 1 alive"], t["Left 1 agent"], t["Spike"], t["Half"]), ("ATK", "no", "Jett", "planted", "Second half"))
        self.send({"event": "round_end", "winner": 1, "how": "spike", "teams": [{"score": 6}, {"score": 7}]})
        r = self.table("VAL Last round")
        self.assertEqual((r["Winner"], r["How"], r["Left score"], r["Right score"]), ("Lancers", "Spike detonated", "6", "7"))
        self.assertEqual(self.table("VALORANT")["Right history"], "W")
        # the map ends: frozen, series +1 for the right team, next map starts clean with the same team names
        self.send({"event": "map_end", "winner": 1, "teams": [{"score": 9}, {"score": 13}]})
        m = self.table("VAL Map 1")
        self.assertEqual((m["Winner"], m["Left score"], m["Right score"], m["Map"]), ("Lancers", "9", "13", "Ascent"))
        self.assertEqual(self.table("VAL Last map")["Winner"], "Lancers")
        self.assertEqual(int((self.engine.project["global"].get("right") or {}).get("score")), 1)
        t = self.table("VALORANT")
        self.assertEqual((t["Left name"], t["Left score"], t["Round"], t["Left 1 name"]), ("Saints", "0", "1", ""))
        self.assertTrue(os.path.isfile(os.path.join(self.engine.folder, "val-maps.json")))
        # new series: maps put aside, not deleted
        call(self.engine.port, "/api/val/clear", {})
        self.assertEqual(self.table("VAL Map 1"), {})
        self.assertTrue(any(f.startswith("val-maps-") for f in os.listdir(self.engine.folder)))

    def test_graphics_added_once_and_series_switch(self):
        call(self.engine.port, "/api/val", {"series": False})
        self.send({"teams": [{"name": "A"}, {"name": "B"}]})
        self.send({"round": 2})
        names = [c["name"] for c in self.engine.comps()]
        hud = next(h for h in self.engine.project["huds"] if h["id"] == "val")   # (a HUD of their own, never among the graphics)
        parts = [p["name"] for p in hud["parts"]]
        for n in ("VAL Scorebug", "VAL Round win", "VAL Spike planted", "VAL Timeout", "VAL Tech pause", "VAL Buy-phase scoreboard"):
            self.assertNotIn(n, names)
            self.assertEqual(parts.count(n), 1, n)
        self.assertFalse(any(p["on"] for p in hud["parts"]))
        self.send({"event": "map_end", "winner": 0})
        self.assertFalse((self.engine.project.get("global") or {}).get("left", {}).get("score"))

    def test_scores_only_reader_gets_rounds_and_the_map(self):
        """The screen reader sends only scores: one side one up is a round (spike / defuse told from the spike), 13 clear is the map."""
        self.send({"teams": [{"name": "Saints", "score": 0}, {"name": "Lancers", "score": 0}], "first_attack": 0,
                   "players": [{"team": 0, "slot": 1, "name": "Kai", "armor": "heavy", "weapon": "Vandal", "weapon_id": "9c82e19d-4575-0200-1a81-3eacf00cf872",
                                "spike": True, "abilities": {"C": [1, 2], "Q": [0, 1], "X": [9, 9]}}]})
        o = self.engine.val.owen_update()
        kai = o["players"][0]
        self.assertEqual((kai["shield"], kai["regen_shield"], kai["weapon"], kai["abilities"]), (50, False, "Vandal", {"C": [1, 2], "Q": [0, 1]}))
        self.assertEqual(o["match"]["spike"], {"state": "carried", "carrier": ["left", 1]})
        self.send({"spike": "planted"})
        self.send({"teams": [{"score": 1}, {"score": 0}], "spike": ""})   # attackers (left) won with the spike down
        self.send({"teams": [{"score": 1}, {"score": 0}]})                 # the same score again is not another round
        self.send({"teams": [{"score": 1}, {"score": 7}]})                 # a misread jump is not a round
        self.send({"teams": [{"score": 1}, {"score": 1}]})
        self.assertEqual([(h["winner"], h["how"]) for h in self.engine.val.match.history], [(0, "spike"), (1, "elimination")])
        self.assertEqual(self.engine.val.owen_update()["match"]["rounds"], [{"winner": "left", "win_type": "Detonation"}, {"winner": "right", "win_type": "Elimination"}])
        for n in range(2, 14):
            self.send({"teams": [{"score": n}, {"score": 1}]})
        self.assertEqual(str(self.table("VAL Last map")["Left score"]), "13")
        self.assertEqual(self.engine.val.match.history, [])   # (a fresh map)

    def test_off_refuses(self):
        call(self.engine.port, "/api/val", {"on": False})
        code, r = call(self.engine.port, "/api/val/ingest", {"round": 3})
        self.assertEqual(code, 400)
