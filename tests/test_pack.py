import json
import os
import shutil
import tempfile
import unittest

from sgfx.server import Engine

SAMPLE = r"C:\Users\User\Downloads\SCHEDULE.chudgfx"


class Packs(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)
        os.makedirs(os.path.join(self.d, "assets", "pics"))
        open(os.path.join(self.d, "assets", "pics", "a.png"), "wb").write(b"A")
        comp = {"id": "c1", "name": "Board", "layers": [{"id": "l1", "type": "image", "src": "assets/pics/a.png"}, {"id": "l2", "type": "text", "text": "{{Match!B2}}"}]}
        json.dump({"name": "T", "global": {}, "compositions": [comp], "sources": [{"id": "s1", "name": "Match", "type": "url", "url": "https://x"}], "transitions": []},
                  open(os.path.join(self.d, "project.json"), "w"))
        self.e = Engine(self.d)

    def test_export_then_import_twice(self):
        name, data = self.e.pack_export(["c1"])
        self.assertEqual(name, "Board")
        got = self.e.pack_import(data)
        self.assertEqual(got[0]["name"], "Board (2)")
        self.assertNotEqual(got[0]["id"], "c1")
        self.assertEqual(got[0]["layers"][0]["src"], "assets/pics/a.png")   # (same file: reused)
        open(os.path.join(self.d, "assets", "pics", "a.png"), "wb").write(b"CHANGED")
        got = self.e.pack_import(data)
        self.assertEqual(got[0]["layers"][0]["src"], "assets/pics/a-2.png")   # (different file: renamed)
        self.assertEqual(open(os.path.join(self.d, "assets", "pics", "a-2.png"), "rb").read(), b"A")

    @unittest.skipUnless(os.path.exists(SAMPLE), "sample pack not on this PC")
    def test_gfx_baby_pack(self):
        got = self.e.pack_import(open(SAMPLE, "rb").read())
        self.assertEqual(got[0]["name"], "SCHEDULE")
        self.assertTrue(os.path.exists(os.path.join(self.d, "assets", "HEADER.png")))


class HtmlExport(unittest.TestCase):
    def test_zip_has_player_files_and_data_files(self):
        import io, zipfile
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        os.makedirs(os.path.join(d, "assets", "logos"))
        open(os.path.join(d, "assets", "logos", "scc.png"), "wb").write(b"L")
        comp = {"id": "c1", "name": "Bug", "layers": [{"id": "l1", "type": "image", "src": "{{Global!Left logo}}"}]}
        json.dump({"name": "T", "global": {"left": {"logo": "assets/logos/scc.png"}}, "compositions": [comp], "transitions": []}, open(os.path.join(d, "project.json"), "w"))
        name, data = Engine(d).html_export(["c1"])
        names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        for want in ("index.html", "state.json", "engine/stage.js", "fonts/Inter.ttf", "assets/logos/scc.png"):
            self.assertIn(want, names)
