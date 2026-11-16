import json
import os
import shutil
import tempfile
import unittest

from sgfx.server import Engine


class Store(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)
        json.dump({"name": "T", "global": {"left": {"name": "A", "score": 0}}, "compositions": [], "transitions": []},
                  open(os.path.join(self.d, "project.json"), "w"))
        self.e = Engine(self.d)

    def test_global_merges_saves_and_backs_up(self):
        self.e.act("/api/global", {"global": {"left": {"score": 2}, "event": "NACE"}})
        saved = json.load(open(os.path.join(self.d, "project.json")))
        self.assertEqual(saved["global"]["left"], {"name": "A", "score": 2})
        self.assertEqual(saved["global"]["event"], "NACE")
        self.assertEqual(len(os.listdir(os.path.join(self.d, "backups"))), 1)

    def test_upload_lands_in_assets_with_a_free_name(self):
        a = self.e.upload("logo.png", b"x", "logos")
        b = self.e.upload("logo.png", b"y", "logos")
        self.assertEqual((a, b), ("assets/logos/logo.png", "assets/logos/logo-2.png"))
        with self.assertRaises(ValueError):
            self.e.upload("evil.exe", b"x")
        with self.assertRaises(ValueError):
            self.e.upload("a.png", b"x", "../../outside")


    def test_graphics_save_delete_to_bin_and_back(self):
        a = self.e.act("/api/comp", {"comp": {"name": "A", "layers": []}})["comp"]
        b = self.e.act("/api/comp", {"comp": {"name": "B", "layers": []}})["comp"]
        self.e.act("/api/cue", {"id": a["id"]})
        self.e.act("/api/comp/delete", {"id": a["id"]})
        self.assertEqual([c["name"] for c in self.e.project["compositions"]], ["B"])
        self.assertEqual(self.e.buses.state["preview"]["on"], [])
        self.e.act("/api/comp/restore", {})
        self.assertEqual([c["name"] for c in self.e.project["compositions"]], ["A", "B"])
        self.e.act("/api/comp/order", {"ids": [b["id"], a["id"]]})
        self.assertEqual([c["name"] for c in self.e.project["compositions"]], ["B", "A"])
        with self.assertRaises(ValueError):
            self.e.act("/api/comp/order", {"ids": [a["id"]]})


if __name__ == "__main__":
    unittest.main()


class Ingest(unittest.TestCase):
    def test_hud_fields_become_a_table_and_score_goes_to_global(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        json.dump({"name": "T", "global": {"left": {"score": 0}, "right": {"score": 0}}, "compositions": [], "transitions": []}, open(os.path.join(d, "project.json"), "w"))
        e = Engine(d)
        e.act("/api/ingest/VALORANT HUD", {"fields": {"Map": "Lotus", "Round": 12}, "score": [1, 0]})
        t = e.state()["data"]["tables"]
        self.assertEqual(t["VALORANT HUD"], [["Field", "Value"], ["Map", "Lotus"], ["Round", "12"]])
        self.assertEqual(t["HUDs"][1], ["VALORANT HUD", "on"])
        self.assertEqual(e.project["global"]["left"]["score"], 1)


class Check(unittest.TestCase):
    def test_show_check_finds_missing_files_fonts_and_stingers(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        comp = {"id": "c1", "name": "Board", "layers": [{"id": "l1", "type": "image", "src": "assets/gone.png"}, {"id": "l2", "type": "text", "font": "Gotham-Bold"}]}
        json.dump({"name": "T", "global": {"left": {"name": "SCC"}}, "compositions": [comp], "transitions": [{"id": "s", "name": "Main", "type": "stinger", "src": "assets/st.webm"}]},
                  open(os.path.join(d, "project.json"), "w"))
        items = Engine(d, os.path.join(d, "lib")).act("/api/check", {})["items"]
        texts = [i["level"] + ": " + i["text"] for i in items]
        self.assertTrue(texts[0].startswith("stop"))
        self.assertTrue(any("assets/gone.png" in t for t in texts))
        self.assertTrue(any('stinger "Main"' in t for t in texts))
        self.assertTrue(any("Gotham-Bold" in t for t in texts))
        self.assertTrue(any("No right team name" in t for t in texts))


class Timer(unittest.TestCase):
    def test_start_pause_reset_from_down(self):
        import time as _t
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        json.dump({"name": "T", "global": {}, "compositions": [], "transitions": []}, open(os.path.join(d, "project.json"), "w"))
        e = Engine(d)
        t = lambda: e.project["global"]["timer"]
        e.act("/api/timer", {"action": "from", "from": "1:30"})
        self.assertEqual((t()["from"], t()["secs"]), (90, 90))
        e.act("/api/timer", {"action": "down", "down": True})
        e.act("/api/timer", {"action": "start"})
        t()["started"] -= 10   # (as if it ran 10 seconds)
        e.act("/api/timer", {"action": "pause"})
        self.assertAlmostEqual(t()["secs"], 80, delta=0.5)
        self.assertEqual(t()["started"], 0)
        e.act("/api/timer", {"action": "reset"})
        self.assertEqual(t()["secs"], 90)
        rows = dict(map(tuple, e.state()["data"]["tables"]["Global"]))
        self.assertEqual((rows["Timer secs"], rows["Timer down"]), ("90", "1"))
