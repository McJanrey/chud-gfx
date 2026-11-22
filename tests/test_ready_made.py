import tempfile
import unittest
from pathlib import Path

from sgfx.app import pick_workspace_in
from sgfx.server import Engine
from sgfx import huds


class ReadyMade(unittest.TestCase):
    def test_old_graphics_move_into_their_hud_with_changes_and_off(self):
        e = Engine(str(pick_workspace_in(Path(tempfile.mkdtemp()))), None)
        e.comps().append({"id": "c1", "name": "VAL Scorebug", "hud_page": "val:scorebug", "kind": "overlay", "layers": [{"id": "x", "type": "rect", "name": "Mine"}]})
        e.project.setdefault("hud_pages", []).append("val:scorebug")
        parts = [("val:scorebug", "VAL Scorebug", "overlay", [{"type": "rect", "name": "Built"}]), ("val:round", "VAL Round win", "overlay", [])]
        h = huds.ready_made(e, "val", "VALORANT graphics", "valorant", parts)
        self.assertEqual([c["name"] for c in e.comps() if c.get("hud_page")], [])
        self.assertEqual([p["name"] for p in h["parts"]], ["VAL Scorebug", "VAL Round win"])
        self.assertEqual(h["parts"][0]["layers"][0]["name"], "Mine")   # (their changes kept)
        self.assertFalse(any(p["on"] for p in h["parts"]))
        self.assertIsNone(huds.ready_made(e, "val", "VALORANT graphics", "valorant", parts))   # (once)
