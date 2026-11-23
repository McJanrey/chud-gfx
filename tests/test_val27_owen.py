import unittest
from sgfx import huds


class E:
    def __init__(self, h):
        self.project = {"huds": [h], "hud_pages": ["val27"], "compositions": []}

    def comps(self):
        return self.project["compositions"]

    def save_project(self):
        pass


class Val27Owen(unittest.TestCase):
    def test_old_hud_becomes_owens_once_agent_select_kept(self):
        e = E({"id": "val27", "key": "val27", "name": "VAL HUD (SCC 2027)", "game": "valorant", "built": ["top", "players", "select"],
               "parts": [{"id": "top", "name": "Top bar", "layers": []}, {"id": "select", "name": "Agent select", "layers": [{"id": "x"}]}]})
        self.assertTrue(huds.upgrade_val27(e))
        names = [p["name"] for p in e.project["huds"][0]["parts"]]
        self.assertEqual(names, ["Top bar small", "Top bar", "Spike", "Player tabs", "Scoreboard", "Round win", "Agent select"])
        self.assertEqual(e.project["huds"][0]["parts"][-1]["layers"], [{"id": "x"}])
        self.assertFalse(huds.upgrade_val27(e))   # (once)
        new = [pk for pk, *_ in huds.builtin("val27") if pk.split(":")[-1] not in e.project["huds"][0]["built"]]
        self.assertEqual(new, [])   # (nothing added again at the next start)


if __name__ == "__main__":
    unittest.main()
