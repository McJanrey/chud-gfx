import tempfile
import unittest
from pathlib import Path

from sgfx.app import pick_workspace_in
from sgfx.server import Engine


class UploadSameFile(unittest.TestCase):
    def test_same_file_reused_different_file_gets_a_new_name(self):
        e = Engine(str(pick_workspace_in(Path(tempfile.mkdtemp()))), None)
        a = e.upload("Logo.png", b"\x89PNG one", "logos")
        self.assertEqual(e.upload("Logo.png", b"\x89PNG one", "logos"), a)
        self.assertEqual(e.upload("Logo.png", b"\x89PNG two", "logos"), "assets/logos/Logo-2.png")
