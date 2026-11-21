import unittest

from sgfx import valhud
from sgfx.valorant import Match


class ValHud(unittest.TestCase):
    """The SCC-layout VAL HUD: graphics made of plain layers, fed by table fields and drawn pictures."""
    def test_fields_follow_the_match(self):
        m = Match(("Saints", "Lancers"))
        m.merge({"phase": "combat", "timer": "1:10", "players": [
            {"team": 0, "slot": 1, "name": "Kai", "alive": True, "health": 62, "credits": 3900, "ult": 3, "ult_max": 7, "armor": "heavy",
             "weapon": "Ghost", "weapon_id": "1baa85b4-4c70-1284-64bb-6481dfc3bb4e", "agent_id": "add6443a-41bd-e414-f6ad-e58d267f4e95",
             "abilities": {"C": [1, 2]}, "spike": True},
            {"team": 1, "slot": 1, "name": "Onyx", "alive": False, "kills": 2, "deaths": 1, "assists": 0}]})
        f = valhud.fields(m, {"left": {"color": "#123456"}})
        self.assertEqual((f["Condensed"], f["Names"], f["Buy phase"]), ("yes", "", ""))   # (past 20 s into the round)
        self.assertEqual((f["Left 1 up"], f["Left 1 down"], f["Left 1 hp"], f["Left 1 cash"], f["Left 1 carrying"]), ("yes", "", "62", "3,900", "yes"))
        self.assertTrue(f["Left 1 side gun"] and not f["Left 1 main gun"])
        self.assertEqual((f["Left 1 hp bar"], f["Left 1 ult ring"], f["Left 1 c marks"], f["Left 1 armor pic"]),
                         ("/val-svg/bar/62/123456.svg", "/val-svg/ring/3/7.svg", "/val-svg/marks/1/2.svg", "/val-svg/armor/heavy.svg"))
        self.assertEqual((f["Right 1 down"], f["Right 1 kda"]), ("yes", "2 / 1 / 0"))
        m.merge({"phase": "buy"})
        f = valhud.fields(m, {})
        self.assertEqual((f["Left 1 here"], f["Left 1 board"], f["Buy phase"]), ("", "yes", "yes"))   # (tabs step aside for the board)

    def test_pictures_take_only_their_own_shapes(self):
        for good in ("ring/3/7.svg", "marks/1/2.svg", "bar/62/66b5f4.svg", "dot/66b5f4/1.svg", "armor/regen.svg", "spike/ink.svg", "tracker/0e1s/66b5f4/ee5b58.svg"):
            self.assertTrue(valhud.svg(good).startswith("<svg"), good)
        for bad in ("bar/62/red;x.svg", "armor/<b>.svg", "ring/x/7.svg", "nope/1.svg", "tracker/0e/zz/zz.svg"):
            self.assertIsNone(valhud.svg(bad), bad)

    def test_graphics_are_plain_layers(self):
        names = [n for _, n, _, _ in valhud.comps()]
        self.assertEqual(names, ["VAL HUD · Top bar", "VAL HUD · Players", "VAL HUD · Buy phase", "VAL HUD · Round win"])
        for _, _, _, layers in valhud.comps():
            self.assertTrue(all(l["type"] in ("rect", "text", "image") for l in layers))
