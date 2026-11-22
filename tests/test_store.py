import os
import tempfile
import unittest

from sgfx.store import FileStore, open_store


class Store(unittest.TestCase):
    def test_files_round_trip_and_stay_inside_the_workspace(self):
        d = tempfile.mkdtemp()
        s = open_store(d)
        self.assertEqual(s.kind, "files")
        self.assertIsNone(s.read_json("project.json"))
        s.write_json("project.json", {"name": "Show"})
        self.assertEqual(s.read_json("project.json"), {"name": "Show"})
        self.assertTrue(os.path.isfile(os.path.join(d, "project.json")))
        with self.assertRaises(ValueError):
            s.write_json("../escape.json", {})

    def test_unknown_backend_is_refused(self):
        os.environ["SGFX_STORE"] = "nope"
        try:
            with self.assertRaises(ValueError):
                open_store(tempfile.mkdtemp())
        finally:
            del os.environ["SGFX_STORE"]
