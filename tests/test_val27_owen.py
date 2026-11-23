import json
import os
import tempfile
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

    def test_files_copied_into_show_assets_never_overwritten(self):
        with tempfile.TemporaryDirectory() as d:
            lib, show = os.path.join(d, "lib"), os.path.join(d, "show")
            for rel in ("hud/Resources/Agentes/Jett/Jett.png", "hud/Resources/Armas/Vandal.png", "assets/spike.png", "layers/a.svg", "fonts/Rubik.woff2"):
                os.makedirs(os.path.dirname(os.path.join(lib, "owen-hud", rel)), exist_ok=True)
                open(os.path.join(lib, "owen-hud", rel), "w").write("lib")
            e = E({"id": "val27", "key": "val27", "built": [], "parts": []})
            e.library, e.folder = lib, show
            huds.upgrade_val27(e)
            a = os.path.join(show, "assets", "hud")
            for rel in ("agents/Jett/Jett.png", "guns/Vandal.png", "ui/spike.png", "layers/a.svg", "fonts/Rubik.woff2"):
                self.assertTrue(os.path.isfile(os.path.join(a, rel)), rel)
            open(os.path.join(a, "ui/spike.png"), "w").write("mine")
            huds.hud_assets(e)
            self.assertEqual(open(os.path.join(a, "ui/spike.png")).read(), "mine")

    def test_no_layer_reads_the_app_library(self):
        self.assertNotIn("/library/", json.dumps(huds.builtin("val27")))


if __name__ == "__main__":
    unittest.main()
