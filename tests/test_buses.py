import unittest

from sgfx.buses import Buses

KINDS = {"b1": "board", "b2": "board", "l1": "lower third", "l2": "lower third", "o1": "overlay", "o2": "overlay"}
CUT = {"type": "cut"}


def make():
    return Buses(lambda: KINDS)


class BusTests(unittest.TestCase):
    def test_one_board_and_one_lower_third_per_bus_overlays_stack(self):
        b = make()
        for c in ("b1", "b2", "l1", "l2", "o1", "o2"):
            b.cue(c)
        self.assertEqual(b.state["preview"]["on"], ["b2", "l2", "o1", "o2"])

    def test_take_swaps_boards_back_to_preview_and_carries_values(self):
        b = make()
        b.cue("b1"); b.set_values("b1", {"Name": "Alex"}); b.take(CUT)
        b.cue("b2"); b.cue("o1"); b.take(CUT)
        self.assertEqual(sorted(b.state["program"]["on"]), ["b2", "o1"])
        self.assertEqual(b.state["preview"]["on"], ["b1"])
        self.assertEqual(b.state["preview"]["values"]["b1"], {"Name": "Alex"})
        b.take(CUT)
        self.assertEqual(sorted(b.state["program"]["on"]), ["b1", "o1"])
        self.assertEqual(b.state["preview"]["on"], ["b2"])

    def test_lower_third_replaced_not_swapped(self):
        b = make()
        b.cue("l1"); b.take(CUT); b.cue("l2"); b.take(CUT)
        self.assertEqual(b.state["program"]["on"], ["l2"])
        self.assertEqual(b.state["preview"]["on"], [])

    def test_empty_take_changes_nothing(self):
        b = make()
        self.assertFalse(b.take(CUT))
        self.assertEqual(b.cut["seq"], 0)

    def test_undo_once_after_take_or_clear(self):
        b = make()
        b.cue("b1"); b.take(CUT); b.clear()
        self.assertEqual(b.state["program"]["on"], [])
        self.assertTrue(b.cut["undo"])
        self.assertTrue(b.undo())
        self.assertEqual(b.state["program"]["on"], ["b1"])
        self.assertFalse(b.undo())

    def test_in_and_out_leave_the_rest(self):
        b = make()
        b.cue("o1"); b.take(CUT)
        b.cue("b1"); b.program("b1", True)
        self.assertEqual(sorted(b.state["program"]["on"]), ["b1", "o1"])
        self.assertEqual(b.state["preview"]["on"], [])
        b.program("o1", False)
        self.assertEqual(b.state["program"]["on"], ["b1"])
        self.assertEqual(b.cut["only"], ["o1"])

    def test_send_values_in_place(self):
        b = make()
        b.cue("b1"); b.take(CUT)
        seq = b.cut["seq"]
        b.set_values("b1", {"Name": "Sam"}); b.send_values("b1")
        self.assertEqual(b.state["program"]["values"]["b1"], {"Name": "Sam"})
        self.assertEqual(b.cut["seq"], seq)   # no transition plays

    def test_saved_state_round_trips(self):
        b = make()
        b.cue("b1"); b.take(CUT)
        again = Buses(lambda: KINDS, b.saved())
        self.assertEqual(again.state["program"]["on"], ["b1"])


if __name__ == "__main__":
    unittest.main()
