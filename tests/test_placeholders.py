import unittest

from sgfx.server import swap_placeholders


class Placeholders(unittest.TestCase):
    def test_old_stand_ins_become_ours(self):
        p = {"compositions": [
            {"name": "Player graphic (3)", "layers": [{"type": "image", "src": "assets/x/psg.png", "show": "{{Roster!No headshots}}", "w": 900, "h": 500}]},
            {"name": "Final four", "layers": [{"type": "image", "src": "{{Global!Tournament logo}}", "placeholder": "assets/Final four/TOURNAMENT LOGO_ REPLACE ME.png"},
                                              {"type": "image", "src": "assets/Final four/Border.png"}]}]}
        swap_placeholders(p)
        players, (logo, border) = p["compositions"][0]["layers"][0], p["compositions"][1]["layers"]
        self.assertEqual((players["src"], players["position"]), ("placeholders/player-3.png", "bottom"))
        self.assertEqual(logo["placeholder"], "placeholders/logo.png")
        self.assertEqual(logo["src"], "{{Global!Tournament logo}}")          # (the real logo still wins when set)
        self.assertEqual(border["src"], "assets/Final four/Border.png")      # (designs untouched)


if __name__ == "__main__":
    unittest.main()
