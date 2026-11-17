import json
import os
import tempfile
import threading
import unittest
from pathlib import Path

from sgfx.app import pick_workspace_in
from sgfx.server import Engine, good_host


class Hosts(unittest.TestCase):
    def test_hosts(self):
        for h in ("127.0.0.1:7820", "localhost:7820", "192.168.1.20:7820", "[::1]:7820", "", None):
            self.assertTrue(good_host(h), h)
        for h in ("evil.example.com:7820", "attacker.test"):
            self.assertFalse(good_host(h), h)


class Saves(unittest.TestCase):
    def test_saves_at_once_keep_project_whole(self):
        e = Engine(str(pick_workspace_in(Path(tempfile.mkdtemp()))), None)

        def hammer(n):
            for i in range(40):
                with e.lock:
                    e.act("/api/global", {"global": {f"k{n}": i}})
        ts = [threading.Thread(target=hammer, args=(n,)) for n in range(6)]
        [t.start() for t in ts]
        [t.join() for t in ts]
        with open(os.path.join(e.folder, "project.json"), encoding="utf-8") as f:
            g = json.load(f)["global"]
        self.assertEqual([g[f"k{n}"] for n in range(6)], [39] * 6)


if __name__ == "__main__":
    unittest.main()


class BadGlobal(unittest.TestCase):
    def test_bad_shapes_refused_and_state_still_works(self):
        e = Engine(str(pick_workspace_in(Path(tempfile.mkdtemp()))), None)
        for bad in ({"left": "x"}, {"sponsors": "x"}, {"clock": [1]}, "x"):
            with self.assertRaises(ValueError):
                e.set_global(bad)
        e.set_global({"left": {"name": "SCC"}, "event": "WWL"})
        self.assertEqual(e.project["global"]["left"]["name"], "SCC")
        e.state()   # (a bad send used to break this, and with it every page)
