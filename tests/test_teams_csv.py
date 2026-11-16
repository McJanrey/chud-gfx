import unittest

from sgfx import tables


class TeamsCsv(unittest.TestCase):
    def test_round_trip_and_merge(self):
        teams = [{"name": "Saints", "short": "SCC", "logo": "assets/logos/s.png", "color": "#0b6b3a", "game": "lol",
                  "players": [{"name": "Ann", "id": "ann#1", "country": "ca", "photo": "assets/players/a.png"}]}]
        text = tables.teams_csv(teams)
        self.assertTrue(text.startswith("Name,Short name,Logo,Colour,Game,Player 1,Player 1 ID,Player 1 country,Player 1 headshot"))
        back, added, updated = tables.teams_from_csv(text, [])
        self.assertEqual((added, updated), (1, 0))
        self.assertEqual(back[0]["players"][0]["id"], "ann#1")
        merged, added, updated = tables.teams_from_csv("Name,Short name\nsaints,STC\nOther,OTH\n", teams)
        self.assertEqual((added, updated, merged[0]["short"], merged[0]["players"][0]["name"]), (1, 1, "STC", "Ann"))


if __name__ == "__main__":
    unittest.main()
