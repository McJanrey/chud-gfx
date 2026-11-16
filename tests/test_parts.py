import unittest

from sgfx import parts


class Parts(unittest.TestCase):
    def test_make_place_update_every_copy(self):
        plate = parts.make("Plate", [{"id": "a", "type": "rect", "x": 100, "y": 50, "w": 300, "h": 60}, {"id": "b", "type": "text", "x": 120, "y": 60, "w": 200, "h": 40, "text": "Name"}])
        self.assertEqual((plate["w"], plate["h"], plate["layers"][1]["x"]), (300, 60, 20))
        one, two = parts.place(plate, 0, 0, "i1"), parts.place(plate, 500, 900, "i2")
        project = {"parts": [plate], "compositions": [{"id": "c1", "layers": [{"id": "bg"}] + one}, {"id": "c2", "layers": two + [{"id": "top"}]}]}
        one[1]["text"], one[1]["color"] = "Caster", "#ff0000"   # (change copy 1, then update the part from it)
        self.assertEqual(parts.update(project, plate["id"], "c1", "i1"), 2)
        c2 = project["compositions"][1]["layers"]
        self.assertEqual([l.get("text") for l in c2], [None, "Caster", None])
        self.assertEqual((c2[1]["x"], c2[1]["y"], c2[1]["color"], c2[1]["part_at"]), (520, 910, "#ff0000", "i2"))
        self.assertEqual(project["compositions"][0]["layers"][0]["id"], "bg")


if __name__ == "__main__":
    unittest.main()
