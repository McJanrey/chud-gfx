import tempfile
import unittest
from pathlib import Path

from sgfx.app import pick_workspace_in
from sgfx.server import Engine


class Events(unittest.TestCase):
    def test_new_event_keeps_organiser_and_game(self):
        e = Engine(str(pick_workspace_in(Path(tempfile.mkdtemp()))), None)
        folder = e.ws_new("SCC Winter", {"organiser": "St. Clair", "game": "lol"})
        w = next(w for w in e.workspaces() if w["folder"] == folder)
        self.assertEqual((w["organiser"], w["game"]), ("St. Clair", "lol"))

    def test_start_from_copies_graphics_and_unknown_game_is_other(self):
        e = Engine(str(pick_workspace_in(Path(tempfile.mkdtemp()))), None)
        e.project["compositions"] = [{"id": "a", "name": "A", "layers": []}]
        e.save_project()
        here = next(w for w in e.workspaces() if w["open"])["folder"]
        folder = e.ws_new("Copy night", {"start": here, "game": "chess"})
        w = next(w for w in e.workspaces() if w["folder"] == folder)
        self.assertEqual((w["name"], w["graphics"], w["game"]), ("Copy night", 1, "other"))

    def test_delete_only_removed_events(self):
        import os
        e = Engine(str(pick_workspace_in(Path(tempfile.mkdtemp()))), None)
        folder = e.ws_new("Gone soon", {"game": "val"})
        with self.assertRaises(ValueError):
            e.ws_purge(folder)   # (still listed: must be removed first)
        e.ws_remove(folder)
        gone = e.removed_workspaces()[0]["folder"]
        with self.assertRaises(ValueError):
            e.ws_purge("../" + gone + "/..")
        e.ws_purge(gone)
        self.assertEqual(e.removed_workspaces(), [])
        self.assertTrue(os.path.isdir(e.folder))

    def test_going_home_takes_everything_off_air(self):
        e = Engine(str(pick_workspace_in(Path(tempfile.mkdtemp()))), None)
        e.buses.state["program"]["on"] = ["a"]
        e.buses.state["preview"]["on"] = ["b"]
        e.act("/api/offair", {})
        self.assertEqual((e.buses.state["program"]["on"], e.buses.state["preview"]["on"]), ([], []))


if __name__ == "__main__":
    unittest.main()
