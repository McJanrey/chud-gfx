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


if __name__ == "__main__":
    unittest.main()
