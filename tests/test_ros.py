import unittest
from sgfx import ros


class Ros(unittest.TestCase):
    def setUp(self):
        self.t = ros.blank_template("LoL Bo3", "lol", 3)
        self.m = {"team1": "Maryville University", "team2": "St. Clair College", "game": "PREMIER LEAGUE OF LEGENDS", "date": "2026-11-19", "time": "20:00"}

    def test_build_repeats_maps_and_skips_last_break(self):
        show = ros.build(self.t, self.m)
        titles = [s["title"] for s in show["segments"]]
        self.assertEqual(titles, ["Countdown", "Desk · Casters", "Map 1", "Between maps", "Map 2", "Between maps", "Map 3", "Wrap-up"])
        self.assertEqual(show["segments"][1]["notes"], "Casters introduce Maryville University vs St. Clair College")
        self.assertEqual(show["match"]["game_key"], "lol")

    def test_series_won_drops_spare_maps(self):
        show = ros.build(self.t, self.m)
        gone = {s["title"] + str(s["map"]) for s in show["segments"] if s["id"] in ros.dropped(show, 2, 0)}
        self.assertEqual(gone, {"Between maps2", "Map 33"})
        self.assertEqual(ros.dropped(show, 1, 1), set())

    def test_timeline_and_step(self):
        show = ros.build(self.t, self.m)
        ros.step(show, 1, now=1000.0)
        tl = ros.timeline(show, now=1000.0)
        self.assertEqual(tl[0]["start"], 1000.0)
        self.assertEqual(tl[1]["start"], 1000.0 + 15 * 60)
        self.assertTrue(tl[1]["est"])
        ros.step(show, 1, now=2000.0)
        self.assertEqual(ros.timeline(show, now=2000.0)[2]["start"], 2000.0 + 600)
        ros.step(show, -1)
        self.assertEqual(show["current"], 0)
        self.assertNotIn(show["segments"][1]["id"], show["times"])

    def test_pick_and_next_match(self):
        import datetime
        sched = {"matches": [dict(self.m, date="2026-11-11"), self.m, dict(self.m, date="2026-11-25", game="VALORANT")]}
        self.assertEqual(ros.next_match(sched, datetime.datetime(2026, 11, 15))["date"], "2026-11-19")
        self.assertIs(ros.pick_template([self.t], self.m), self.t)
        self.assertIsNone(ros.pick_template([self.t], {"game": "VALORANT"}))


if __name__ == "__main__":
    unittest.main()
