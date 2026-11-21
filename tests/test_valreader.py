import os
import unittest

from PIL import Image

HERE = os.path.dirname(__file__)


@unittest.skipUnless(os.name == "nt", "Windows text recognition")
class ValReader(unittest.TestCase):
    """A real VALORANT replay frame (spike planted, Tab scoreboard open): every value checked by eye."""
    def test_spike_scoreboard_frame(self):
        from sgfx import valreader as V
        d = V.parse(Image.open(os.path.join(HERE, "fixtures", "val_spike_scoreboard.png")))
        self.assertEqual([t.get("score") for t in d["teams"]], [2, 0])
        self.assertEqual((d["spike"], d["sides"]), ("planted", ["DEF", "ATK"]))
        self.assertEqual([p["alive"] for p in d["players"]], [False, False, False, True, True, False, True, False, False, False])
        rows = {r["name"]: r for t in (0, 1) for r in d["roster"][t]}
        expect = {"crippled kid": (6, 0, 2, 2150, True), "SCCProd3": (2, 2, 3, 3350, (7, 8)), "SCCProd2": (1, 1, 0, 4100, (4, 7)),
                  "ludociel": (7, 2, 0, 600, True), "seren": (0, 3, 0, 1700, (5, 8)), "Himmy Butler": (0, 3, 1, 2150, (5, 8))}
        for name, (k, dd, a, cr, ult) in expect.items():
            r = rows[name]
            self.assertEqual((r["kills"], r["deaths"], r["assists"], r["credits"]), (k, dd, a, cr), name)
            self.assertEqual(r.get("ult_ready", False) if ult is True else (r.get("ult"), r.get("ult_max")), ult, name)
        # loadout: official silhouettes; the dead players' rows are empty
        self.assertEqual({n: (r["weapon"], r["armor"]) for n, r in rows.items() if r["weapon"] or r["armor"]},
                         {"crippled kid": ("Vandal", "heavy"), "meowpilled": ("Vandal", "heavy"), "ludociel": ("Vandal", "")})
