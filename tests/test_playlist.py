import shutil
import tempfile
import unittest

from gfxengine import playlist
from gfxengine.live import Live
from gfxengine.project import Workspace, blank_comp


class Clock:
    t = 1000.0

    def __call__(self):
        return self.t


class Playlists(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.ws = Workspace(self.dir, starter="")
        self.a, self.b = self.ws.add_comp(blank_comp("A")), self.ws.add_comp(blank_comp("B"))
        self.live = Live(self.ws)
        self.clock = Clock()
        self.p = playlist.Player(self.ws, self.live, clock=self.clock)
        self.addCleanup(self.p.close)
        ids = {self.a["id"], self.b["id"]}
        self.ws.set_playlists(playlist.clean([{"id": "p1", "name": "Ads", "items": [
            {"comp": self.a["id"], "secs": 5}, {"comp": self.b["id"], "secs": 3}, {"comp": "gone", "secs": 1}]}], ids))

    def on_air(self):
        return self.live.get()["program"]["on"]

    def test_clean_drops_missing_graphics_and_loops_by_default(self):
        p = self.ws.get()["playlists"][0]
        self.assertEqual([i["comp"] for i in p["items"]], [self.a["id"], self.b["id"]])
        self.assertTrue(p["loop"])

    def test_plays_each_for_its_seconds_then_loops(self):
        self.p.play("p1")
        self.assertEqual(self.on_air(), [self.a["id"]])
        self.clock.t += 4.9
        self.p.tick()
        self.assertEqual(self.on_air(), [self.a["id"]])
        self.clock.t += 0.2
        self.p.tick()
        self.assertEqual(self.on_air(), [self.b["id"]])   # A out as B comes in
        self.clock.t += 3
        self.p.tick()
        self.assertEqual(self.on_air(), [self.a["id"]])
        self.assertEqual(self.p.get()["index"], 0)

    def test_no_loop_stops_and_takes_the_last_off(self):
        lists = self.ws.get()["playlists"]
        lists[0]["loop"] = False
        self.ws.set_playlists(lists)
        self.p.play("p1", 1)
        self.clock.t += 3
        self.p.tick()
        self.assertIsNone(self.p.get())
        self.assertEqual(self.on_air(), [])

    def test_taken_off_by_hand_stops_the_playlist(self):
        self.p.play("p1")
        self.live.program(self.a["id"], False)
        self.p.tick()
        self.assertIsNone(self.p.get())

    def test_other_graphics_on_air_stay(self):
        c = self.ws.add_comp(blank_comp("Scorebug"))
        self.live.program(c["id"], True)
        self.p.play("p1")
        self.clock.t += 5
        self.p.tick()
        self.assertEqual(sorted(self.on_air()), sorted([c["id"], self.b["id"]]))
        self.p.stop()
        self.assertEqual(self.on_air(), [c["id"]])


class Bin(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.dir, True)
        self.ws = Workspace(self.dir, starter="")
        self.a, self.b, self.c = (self.ws.add_comp(blank_comp(n)) for n in "ABC")

    def names(self):
        return [c["name"] for c in self.ws.get()["compositions"]]

    def test_deleted_graphic_comes_back_where_it_was(self):
        self.ws.delete_comp(self.b["id"])
        self.assertEqual(self.names(), ["A", "C"])
        self.assertEqual(self.ws.trash()[0]["comp"]["name"], "B")
        self.ws.restore_comp()
        self.assertEqual(self.names(), ["A", "B", "C"])
        self.assertEqual(self.ws.trash(), [])

    def test_bin_survives_a_restart(self):
        self.ws.delete_comp(self.a["id"])
        self.ws.close()
        again = Workspace(self.dir, starter="")
        self.assertEqual(again.restore_comp(self.a["id"])["name"], "A")
        self.assertEqual(again.get()["compositions"][0]["name"], "A")

    def test_rename(self):
        self.ws.rename_comp(self.a["id"], "  Scorebug ")
        self.assertEqual(self.names()[0], "Scorebug")
        with self.assertRaises(ValueError):
            self.ws.rename_comp(self.a["id"], " ")


class Parts(unittest.TestCase):
    def test_update_changes_every_other_copy_where_it_sits(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        ws = Workspace(d, starter="")
        plate = {"id": "p1", "name": "Plate", "w": 100, "h": 20, "layers": [{"id": "a", "name": "Bar", "type": "shape", "x": 0, "y": 0, "w": 100, "h": 20, "fill": "#000"}]}
        ws.set_parts([plate])
        mk = lambda gid, x: {"id": "l" + gid, "name": "Bar", "type": "shape", "x": x, "y": 50, "w": 100, "h": 20, "fill": "#000", "part": "p1", "group": gid, "field": "Name " + gid}
        c1 = ws.add_comp({"id": "c1", "name": "One", "layers": [mk("g1", 10)]})
        ws.add_comp({"id": "c2", "name": "Two", "layers": [{"id": "x", "type": "text", "x": 0, "y": 0, "w": 1, "h": 1}, mk("g2", 300)]})
        new = dict(plate, layers=[dict(plate["layers"][0], fill="#f00"), {"id": "b", "name": "Line", "type": "shape", "x": 0, "y": 18, "w": 100, "h": 2}])
        n = ws.update_part(new, keep={"comp": c1["id"], "group": "g1"})
        self.assertEqual(n, 1)
        two = ws.comp("c2")["layers"]
        self.assertEqual([l.get("name") for l in two[1:]], ["Bar", "Line"])
        self.assertEqual((two[1]["fill"], two[1]["x"], two[1]["y"], two[1]["group"], two[1]["field"]), ("#f00", 300, 50, "g2", "Name g2"))
        self.assertEqual((two[2]["x"], two[2]["y"]), (300, 68))
        self.assertEqual(ws.comp("c1")["layers"][0]["fill"], "#000")   # (the copy it was changed from: left alone)


if __name__ == "__main__":
    unittest.main()
