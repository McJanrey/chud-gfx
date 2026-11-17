"""The py-server fixes: sources that can't be read, undo after Program changed, run of show on a LAN day,
playlists edited while playing, pack paths with dots, and asset paths that climb out of assets/."""
import datetime
import io
import json
import os
import shutil
import tempfile
import time
import unittest
import zipfile
from unittest import mock

from sgfx import pack, ros
from sgfx import server
from sgfx.buses import Buses
from sgfx.server import Engine


def workspace(project):
    d = tempfile.mkdtemp()
    os.makedirs(os.path.join(d, "assets"))
    json.dump(project, open(os.path.join(d, "project.json"), "w"))
    return d


class EngineCase(unittest.TestCase):
    project = {}

    def setUp(self):
        self.d = workspace({"name": "T", "global": {}, "transitions": [], "playlists": [], "sources": [],
                            "compositions": [{"id": i, "name": i, "kind": "overlay", "layers": []} for i in "ABC"], **self.project})
        self.addCleanup(shutil.rmtree, self.d, True)
        self.e = Engine(self.d)
        self.e.playing = None


class Sources(EngineCase):
    def test_unreadable_workbook_keeps_last_table(self):
        open(os.path.join(self.d, "show.xlsx"), "wb").write(b"x")
        self.e.project["sources"] = [{"id": "s1", "name": "Show", "type": "file", "path": "show.xlsx"}]
        with mock.patch.object(server.srcmod, "parse", return_value=[["A"], ["1"]]):
            self.assertEqual(self.e.sources()["Show"], [["A"], ["1"]])
        os.utime(os.path.join(self.d, "show.xlsx"), (time.time() + 5, time.time() + 5))
        with mock.patch.object(server.srcmod, "parse", side_effect=zipfile.BadZipFile("File is not a zip file")):
            self.assertEqual(self.e.sources()["Show"], [["A"], ["1"]])   # (no 500: the old table stays)
        self.assertIn("zip", self.e.source_status["s1"]["error"])

    def test_refresh_that_isnt_a_number(self):
        self.assertEqual(server.refresh_secs("auto"), 10.0)
        self.assertEqual(server.refresh_secs("30"), 30.0)
        self.assertEqual(server.refresh_secs(0.5), 2.0)
        self.e.set_sources([{"name": "Web", "type": "file", "path": "x.csv", "refresh": "auto"}])
        self.assertEqual(self.e.project["sources"][0]["refresh"], 10.0)

    def test_slow_reads_dont_hold_the_lock(self):
        for p in ("/api/source/read", "/api/stinger/cut"):
            self.assertTrue(p.startswith(server.UNLOCKED))


class Undo(unittest.TestCase):
    def test_program_change_after_take_drops_undo(self):
        b = Buses(lambda: {"sb": "overlay", "lt": "lower third"})
        b.program("sb", True)
        b.set_values("sb", {"score": "1-0"}, "both")
        b.cue("lt"); b.take({"type": "cut"})
        self.assertTrue(b.cut["undo"])
        b.program("lt", False)
        self.assertFalse(b.cut["undo"])
        b.set_values("sb", {"score": "2-0"}, "both")
        self.assertFalse(b.undo())
        self.assertEqual(b.state["program"]["values"]["sb"], {"score": "2-0"})

    def test_preview_edits_keep_undo(self):
        b = Buses(lambda: {})
        b.cue("a"); b.take({"type": "cut"})
        b.set_values("a", {"x": "1"})
        self.assertTrue(b.cut["undo"])
        b.send_values("a")
        self.assertFalse(b.cut["undo"])


def at(dt):
    return {"date": dt.strftime("%Y-%m-%d"), "time": dt.strftime("%H:%M")}


class RunOfShow(EngineCase):
    def test_next_match_skips_a_finished_show(self):
        now = datetime.datetime(2026, 11, 20, 16, 30)
        a = {"team1": "A", "team2": "B", "date": "2026-11-20", "time": "14:00"}
        c = {"team1": "C", "team2": "D", "date": "2026-11-20", "time": "17:00"}
        sched = {"matches": [a, c]}
        self.assertEqual(ros.next_match(sched, now)["team1"], "A")
        self.assertEqual(ros.next_match(sched, now, skip={ros.match_key(a)})["team1"], "C")

    def test_auto_moves_on_after_a_finished_show(self):
        now = datetime.datetime.now().replace(second=0, microsecond=0)
        a = dict(at(now - datetime.timedelta(hours=2)), team1="A", team2="B", game="LoL")
        c = dict(at(now + datetime.timedelta(hours=1)), team1="C", team2="D", game="LoL")
        self.e.project["global"] = {"schedule": {"matches": [a, c]}}
        r = self.e.ros()
        r["templates"] = [ros.blank_template("LoL Bo3", "lol", 3)]
        self.e.ros_auto()
        self.assertEqual(r["show"]["match"]["team1"], "A")
        r["show"]["current"] = len(r["show"]["segments"])   # (match 1's show ran to its end)
        self.e.ros_auto()
        self.assertEqual(r["show"]["match"]["team1"], "C")
        self.e.ros_auto()   # (and stays on match 2: match 1 doesn't come back once its show is gone)
        self.assertEqual(r["show"]["match"]["team1"], "C")
        self.assertEqual(self.e.ros_state()["next_match"]["team1"], "C")

    def test_auto_picked_template_follows_best_of(self):
        now = datetime.datetime.now().replace(second=0, microsecond=0)
        a = dict(at(now + datetime.timedelta(hours=1)), team1="A", team2="B", game="LoL")
        self.e.project["global"] = {"schedule": {"matches": [a]}}
        r = self.e.ros()
        bo3, bo5 = ros.blank_template("LoL Bo3", "lol", 3), ros.blank_template("LoL Bo5", "lol", 5)
        r["templates"] = [bo3, bo5]
        self.e.ros_auto()
        self.assertEqual(r["show"]["template_id"], bo3["id"])
        self.e.project["global"]["best_of"] = 5
        a["time"] = (now + datetime.timedelta(hours=2)).strftime("%H:%M")   # (moved: not hand-picked, so Global wins)
        self.e.ros_auto()
        self.assertEqual(r["show"]["template_id"], bo5["id"])

    def test_auto_keeps_a_hand_picked_template(self):
        now = datetime.datetime.now().replace(second=0, microsecond=0)
        m = dict(at(now + datetime.timedelta(hours=2)), team1="A", team2="B", game="LoL")
        self.e.project["global"] = {"schedule": {"matches": [m]}}
        r = self.e.ros()
        bo3, bo5 = ros.blank_template("LoL Bo3", "lol", 3), ros.blank_template("LoL Bo5 Finals", "lol", 5)
        r["templates"] = [bo3, bo5]
        self.e.ros_build(bo5["id"])
        m["time"] = (now + datetime.timedelta(hours=2, minutes=30)).strftime("%H:%M")   # (delayed)
        self.e.ros_auto()
        self.assertEqual(r["show"]["template_id"], bo5["id"])
        self.assertEqual(r["show"]["match"]["time"], m["time"])


class Playlists(EngineCase):
    project = {"playlists": [{"id": "p1", "name": "Ads", "loop": True, "items": [{"comp": i, "secs": 5} for i in "ABC"]},
                             {"id": "p2", "name": "Socials", "loop": True, "items": [{"comp": "C", "secs": 5}]}]}

    def setUp(self):
        super().setUp()
        self.e.lock.acquire()   # (the engine's own playlist thread waits: these tests step it by hand)
        self.addCleanup(self.e.lock.release)

    def step(self):
        self.e._playlist_next(self.e.playing)

    def on(self):
        return self.e.buses.state["program"]["on"]

    def test_stop_after_the_list_was_edited(self):
        self.e.playlist_play("p1")
        self.step(); self.step()
        self.assertEqual(self.on(), ["B"])
        self.e.set_playlists([{"id": "p1", "loop": True, "items": [{"comp": "B"}, {"comp": "C"}]}])   # (A removed)
        self.e.playlist_stop()
        self.assertEqual(self.on(), [])

    def test_deleted_playlist_takes_its_graphic_off(self):
        self.e.playlist_play("p1")
        self.step()
        self.e.set_playlists([])
        self.step()
        self.assertEqual(self.on(), [])
        self.assertIsNone(self.e.playing)

    def test_replaying_doesnt_flicker_the_graphic_on_air(self):
        self.e.playlist_play("p1")
        self.step()
        seen = []
        real = self.e.buses.program
        with mock.patch.object(self.e.buses, "program", side_effect=lambda c, on, t=None: seen.append((c, on)) or real(c, on, t)):
            self.e.playlist_play("p1")   # (restarted: A is its first item, already up)
            self.step()
        self.assertNotIn(("A", False), seen)
        self.assertEqual(self.on(), ["A"])

    def test_playing_another_takes_the_first_ones_graphic_off(self):
        self.e.playlist_play("p1")
        self.step()
        self.e.playlist_play("p2")
        self.step()
        self.assertEqual(self.on(), ["C"])


class ReadNow(EngineCase):
    def test_read_now_keeps_the_last_table(self):
        open(os.path.join(self.d, "show.xlsx"), "wb").write(b"x")
        self.e.project["sources"] = [{"id": "s1", "name": "Show", "type": "file", "path": "show.xlsx"}]
        with mock.patch.object(server.srcmod, "parse", return_value=[["A"], ["1"]]):
            self.e.sources()
        with mock.patch.object(server.srcmod, "parse", side_effect=zipfile.BadZipFile("locked")):
            self.e.read_source("s1")   # ('Read now' while the workbook is locked)
            self.assertEqual(self.e.sources()["Show"], [["A"], ["1"]])
        with mock.patch.object(server.srcmod, "parse", return_value=[["A"], ["2"]]):
            self.e.read_source("s1")   # (and it does read again)
            self.assertEqual(self.e.sources()["Show"], [["A"], ["2"]])


class PackImport(EngineCase):
    def test_two_imports_at_once_get_their_own_ids(self):
        import threading
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            z.writestr("pack.json", json.dumps({"format": "standby-gfx", "compositions": [{"id": "x1", "name": "Bug", "layers": []}]}))
        real, gate = pack.import_pack, threading.Barrier(2, timeout=0.5)

        def slow(*a):
            try:
                gate.wait()   # (both would be unzipping at the same moment, without the import lock)
            except threading.BrokenBarrierError:
                pass
            return real(*a)
        with mock.patch.object(server.pack, "import_pack", side_effect=slow):
            ts = [threading.Thread(target=self.e.pack_import, args=(buf.getvalue(),)) for _ in range(2)]
            [t.start() for t in ts]
            [t.join() for t in ts]
        ids = [c["id"] for c in self.e.comps()]
        names = [c["name"] for c in self.e.comps()]
        self.assertEqual(len(ids), 5)
        self.assertEqual(len(set(ids)), 5)
        self.assertEqual(len(set(names)), 5)


class Packs(unittest.TestCase):
    def test_paths_with_dots(self):
        for p in ("assets/sponsors/red.bull.png", "assets/logos/FaZe.Clan.png", "assets/2024.final/logo.png"):
            self.assertEqual(pack._paths({"src": p}, set()), {p})
        self.assertEqual(pack._paths("assets/a.png,assets/b.png", set()), {"assets/a.png", "assets/b.png"})
        self.assertEqual(pack._paths("{{Global!logo|assets/x.png}}", set()), {"assets/x.png"})

    def test_renames_dont_chain(self):
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        os.makedirs(os.path.join(d, "assets"))
        open(os.path.join(d, "assets", "logo.png"), "wb").write(b"EXISTING")
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as z:
            comps = [{"id": "a", "name": "A", "layers": [{"src": "assets/logo.png"}]}, {"id": "b", "name": "B", "layers": [{"src": "assets/logo-2.png"}]}]
            z.writestr("pack.json", json.dumps({"format": "chud-gfx", "compositions": comps}))
            z.writestr("files/assets/logo.png", b"PACK-A")
            z.writestr("files/assets/logo-2.png", b"PACK-B")
        got, _ = pack.import_pack(buf.getvalue(), d, set(), [])
        read = lambda c: open(os.path.join(d, c["layers"][0]["src"]), "rb").read()
        self.assertEqual([read(c) for c in got], [b"PACK-A", b"PACK-B"])


class Assets(EngineCase):
    def test_remove_stays_inside_assets(self):
        for bad in ("assets/../project.json", "assets/%2e%2e/project.json"):
            with self.assertRaises(KeyError):
                self.e.asset_remove(bad)
        self.assertTrue(os.path.isfile(os.path.join(self.d, "project.json")))
        open(os.path.join(self.d, "assets", "x.png"), "wb").write(b"X")
        self.e.asset_remove("assets/x.png")
        self.assertFalse(os.path.exists(os.path.join(self.d, "assets", "x.png")))


class Convert(EngineCase):
    def test_same_name_twice_gets_two_files(self):
        with mock.patch.object(self.e.jobs, "add", side_effect=lambda name, run: run):
            first = self.e.convert_upload("Intro.mov", b"1")
            second = self.e.convert_upload("intro.mov", b"2")   # (before the first made its file)
        made = []
        with mock.patch.object(server.convert, "video", side_effect=lambda src, base, p: made.append(base) or base + ".mp4"):
            first(None); second(None)
        self.assertEqual([os.path.basename(b) for b in made], ["Intro", "intro-2"])
        self.assertEqual(self.e._converting, set())


if __name__ == "__main__":
    unittest.main()
