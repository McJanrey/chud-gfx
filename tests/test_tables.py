import json
import os
import unittest

from sgfx import bracket, tables

CASES = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "global_cases.json"), encoding="utf-8"))


class SameAsTheOldApp(unittest.TestCase):
    """Every probe of the old app: the same settings make the same rows."""

    def test_global(self):
        for c in CASES:
            with self.subTest(change=c["change"]):
                want = [[k, tables.DEFAULT_LOOP if v == tables.OLD_LOOP else v] for k, v in c["tables"]["Global"]]   # (our own loop video)
                self.assertEqual(tables.global_rows(c["global"]), want)

    def test_sponsors(self):
        for c in CASES:
            self.assertEqual(tables.sponsor_rows(c["global"]), c["tables"]["Sponsors"])

    def test_schedule(self):
        for c in CASES:
            self.assertEqual(tables.schedule_rows(c["global"]), c["tables"]["Schedule"])


    def test_roster_with_no_teams(self):
        f = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "roster_empty.json"), encoding="utf-8"))
        self.assertEqual(tables.roster_rows(f["global"], f["teams"]), f["Roster"])


    def test_standings(self):
        for c in json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "standings_cases.json"), encoding="utf-8")):
            self.assertEqual(tables.standings_rows(c["global"]), c["Standings"])


    def test_tournament(self):
        for c in json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "tournament_cases.json"), encoding="utf-8")):
            top = c["global"]["tournament"]["top"]
            with self.subTest(size=top["size"], format=top["format"], reset=top["reset"], scored=len(top["scores"])):
                self.assertEqual(bracket.tournament_rows(c["global"]), c["Tournament"])


    def test_stats_teams_with_nothing_connected(self):
        f = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "old_state_esm.json"), encoding="utf-8"))
        self.assertEqual(tables.stats_rows(), f["data"]["tables"]["Stats"])
        self.assertEqual(tables.teams_rows(f["teams"]), f["data"]["tables"]["Teams"])


if __name__ == "__main__":
    unittest.main()
