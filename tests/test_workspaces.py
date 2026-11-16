import json
import os
import shutil
import tempfile
import unittest

from sgfx.server import Engine


class Workspaces(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.root, True)
        ws = os.path.join(self.root, "first")
        os.makedirs(ws)
        json.dump({"name": "First", "global": {}, "compositions": [{"id": "c1", "name": "A", "layers": []}], "transitions": []},
                  open(os.path.join(ws, "project.json"), "w"))
        self.e = Engine(ws, os.path.join(self.root, "lib"))

    def test_new_copy_open_rename_remove(self):
        new = self.e.act("/api/workspace/new", {"name": "Winter LAN"})["folder"]
        self.assertEqual(new, "winter-lan")
        cp = self.e.act("/api/workspace/copy", {"folder": "first"})["folder"]
        names = {w["folder"]: w for w in self.e.workspaces()}
        self.assertEqual(names[cp]["name"], "First copy")
        self.assertEqual(names[cp]["graphics"], 1)
        self.assertTrue(names["first"]["open"])
        self.e.act("/api/workspace/open", {"folder": new})
        self.assertEqual(self.e.project["name"], "Winter LAN")
        with self.assertRaises(ValueError):
            self.e.ws_remove(new)
        self.e.act("/api/workspace/remove", {"folder": "first"})
        self.assertNotIn("first", [w["folder"] for w in self.e.workspaces()])
        self.assertEqual(len(os.listdir(os.path.join(self.root, ".removed"))), 1)
        with self.assertRaises(KeyError):
            self.e.ws_open("../etc")

    def test_backup_restore_keeps_current(self):
        self.e.act("/api/global", {"global": {"event": "ONE"}})
        name = self.e.backups()[0]["name"]
        self.e.project["global"]["event"] = "TWO"
        self.e.act("/api/backup/restore", {"name": name})
        self.assertEqual(self.e.project["global"]["event"], "ONE")


if __name__ == "__main__":
    unittest.main()


class Migrate(unittest.TestCase):
    def test_gfx_baby_folder(self):
        from pathlib import Path
        from sgfx import app
        d = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, d, True)
        for ws in ("show", "esm"):
            (d / "workspaces" / ws).mkdir(parents=True)
            (d / "workspaces" / ws / "project.json").write_text(json.dumps({"name": ws, "compositions": []}))
        (d / "library").mkdir()
        (d / "run-of-show.json").write_text('{"templates": [{"id": "t"}]}')
        (d / "settings.json").write_text('{"workspace": "esm", "http_port": 7790}')
        app.migrate(d)
        self.assertEqual(json.loads((d / "library" / "run-of-show.json").read_text())["templates"][0]["id"], "t")
        self.assertTrue((d / "workspaces" / "esm" / "backups" / "before-standby-gfx.json").is_file())
        self.assertEqual(app.pick_workspace(d).name, "esm")
        self.assertEqual(app.old_settings(d)["http_port"], 7790)
        (d / "workspaces" / "esm" / "project.json").write_text('{"name": "changed"}')
        app.migrate(d)   # (the copy is made once: GFX Baby's version stays)
        self.assertEqual(json.loads((d / "workspaces" / "esm" / "backups" / "before-standby-gfx.json").read_text())["name"], "esm")
