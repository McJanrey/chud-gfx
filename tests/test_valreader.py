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

    def test_round_timer(self):
        """The round clock by digit shape (Windows' text recognition misses it often), from five real frames."""
        from sgfx import valreader as V
        strip = Image.open(os.path.join(HERE, "fixtures", "val_timers.png")).convert("RGB")
        got = []
        for k in range(5):
            frame = Image.new("RGB", (1920, 1080))
            frame.paste(strip.crop((k * 130, 0, k * 130 + 130, 56)), (895, 22))
            got.append(V.round_timer(frame))
        self.assertEqual(got, ["1:35", "1:09", "0:04", "0:54", "1:39"])

    def test_map_from_the_loading_screen(self):
        from sgfx import valreader as V
        frame = Image.new("RGB", (1920, 1080))
        frame.paste(Image.open(os.path.join(HERE, "fixtures", "val_map_banner.png")).convert("RGB"), (560, 110))
        self.assertEqual(V.parse(frame).get("map"), "Ascent")

    def test_killfeed_frame(self):
        """Kill feed: killer, gun silhouette, headshot mark, victim, and each side's team colour (teal 0, red 1)."""
        from sgfx import valreader as V
        d = V.killfeed(V.normalise(Image.open(os.path.join(HERE, "fixtures", "val_killfeed.png"))))
        self.assertEqual([(r["killer"], r["killer_team"], r["weapon"], r["headshot"], r["victim"], r["victim_team"]) for r in d],
                         [("ludociel", 1, "Guardian", True, "meowpilled", 0), ("SCCProd2", 0, "Bulldog", True, "Himmy Butler", 1)])


@unittest.skipUnless(os.name == "nt", "Windows text recognition")
class FromARealReplay(unittest.TestCase):
    """Bits of a recorded VALORANT replay (2026-11-22) that the reader once got wrong."""

    def setUp(self):
        global V
        from sgfx import valreader as V

    def frame(self, name, at):
        f = Image.new("RGB", (1920, 1080))
        f.paste(Image.open(os.path.join(HERE, "fixtures", name)).convert("RGB"), at)
        return f

    def test_spike_on_the_dark_half_of_its_pulse(self):
        self.assertTrue(V.spike_planted(self.frame("val_spike_dark.png", (900, 0))))

    def test_match_point_is_a_buy_phase(self):
        self.assertEqual(V.parse(self.frame("val_match_point.png", (560, 110))).get("phase"), "buy")

    def test_round_end_numbers_are_not_a_clock(self):
        self.assertIsNone(V.parse(self.frame("val_round_end_clock.png", (880, 0))).get("timer"))
