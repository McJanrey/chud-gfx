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


def _db_env():
    """The website's database login, from .env.local (not in git); without it the live test is skipped."""
    path = os.path.join(os.path.dirname(__file__), "..", ".env.local")
    if not os.path.isfile(path):
        return False
    for line in open(path, encoding="utf-8").read().split():
        k, _, v = line.partition("=")
        if k.startswith("SGFX_DB_"):
            os.environ.setdefault(k, v)
    return "SGFX_DB_PASSWORD" in os.environ


@unittest.skipUnless(_db_env(), "no database login (.env.local)")
class Supabase(unittest.TestCase):
    """Against the real live schema, in a throwaway show that is removed afterwards."""
    def setUp(self):
        from sgfx.store import SupabaseStore
        self.show = "test-" + os.urandom(6).hex()
        self.a, self.b = SupabaseStore(self.show), SupabaseStore(self.show)

    def tearDown(self):
        from sgfx.store import SupabaseStore
        SupabaseStore._run("delete from live.docs where show = :s", s=self.show)
        SupabaseStore._run("delete from live.docs_aside where show = :s", s=self.show)

    def test_round_trip_and_two_writers_do_not_overwrite_each_other(self):
        from sgfx.store import StoreConflict
        self.assertIsNone(self.a.read_json("project.json"))
        self.a.write_json("project.json", {"name": "One"})
        self.assertEqual(self.b.read_json("project.json"), {"name": "One"})
        self.a.write_json("project.json", {"name": "Two"})   # (a saves first...)
        with self.assertRaises(StoreConflict):
            self.b.write_json("project.json", {"name": "Stale"})   # (...b still has the old version)
        self.assertEqual(self.b.read_json("project.json"), {"name": "Two"})
        self.b.write_json("project.json", {"name": "Three"})
        self.assertEqual(self.a.read_json("project.json"), {"name": "Three"})

    def test_put_aside_keeps_the_old_one(self):
        from sgfx.store import SupabaseStore
        self.a.write_json("lol-games.json", [1, 2])
        self.a.put_aside("lol-games.json")
        self.assertFalse(self.a.exists("lol-games.json"))
        kept = SupabaseStore._run("select count(*) from live.docs_aside where show = :s", s=self.show)[0][0]
        self.assertEqual(kept, 1)
        with self.assertRaises(ValueError):
            self.a.read_json("../x.json")
