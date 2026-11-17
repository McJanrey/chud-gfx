import tempfile
import unittest
from pathlib import Path

from sgfx.app import pick_workspace_in
from sgfx.server import Engine


class TournamentPartSaves(unittest.TestCase):
    # (the Tournament page sends only the part it changed: a groups save must not undo a bracket score)
    def test_groups_save_keeps_bracket(self):
        e = Engine(str(pick_workspace_in(Path(tempfile.mkdtemp()))), None)
        e.set_global({"tournament": {"top": {"size": 8, "scores": {"R1 M1": ["2", ""]}}}})
        e.set_global({"tournament": {"groups": [{"name": "GROUP A", "scores": {"Opening 1": ["1", ""]}}]}})
        t = e.project["global"]["tournament"]
        self.assertEqual(t["top"]["scores"]["R1 M1"], ["2", ""])
        self.assertEqual(t["groups"][0]["scores"]["Opening 1"], ["1", ""])
        e.set_global({"tournament": {"top": {"size": 8, "scores": {}}}})
        self.assertEqual(e.project["global"]["tournament"]["groups"][0]["name"], "GROUP A")


if __name__ == "__main__":
    unittest.main()
