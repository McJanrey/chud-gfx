import json
import os
import shutil
import tempfile
import unittest

from sgfx import psd
from sgfx.server import Engine

SAMPLE = r"C:\Users\User\Downloads\Caster Desk Lower Third - edit file.psd"


class Names(unittest.TestCase):
    def test_default_names_are_fixed(self):
        for n in ("Layer 6", "Rectangle 2", "Line 1 copy 2", "Gradient Fill 1", "Vector Smart Object", "Rectangle 3 copy 9-2"):
            self.assertTrue(psd.is_default(n), n)
        for n in ("TEAM LEFT", "SPONSOR", "soriin @Soriin5", "MAIN SECTION BACKGROUND"):
            self.assertFalse(psd.is_default(n), n)


@unittest.skipUnless(os.path.exists(SAMPLE), "sample PSD not on this PC")
class Import(unittest.TestCase):
    def test_lower_third(self):
        try:
            import psd_tools  # noqa: F401
        except ImportError:
            self.skipTest("psd-tools not installed")
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        json.dump({"name": "T", "global": {}, "compositions": [], "transitions": []}, open(os.path.join(d, "project.json"), "w"))
        e = Engine(d)
        c = e.import_psd("Caster Desk Lower Third - edit file.psd", open(SAMPLE, "rb").read())
        names = [l["name"] for l in c["layers"]]
        self.assertEqual(names[0], "MAIN SECTION BACKGROUND")
        bg = c["layers"][0]
        self.assertEqual((bg["x"], bg["y"], bg["w"], bg["h"]), (77, 862, 425, 146))
        self.assertEqual(next(l for l in c["layers"] if l["name"] == "Layer 3")["blend"], "screen")
        self.assertEqual(next(l for l in c["layers"] if l["name"] == "Layer 6")["field"], "")
        self.assertTrue(os.path.exists(os.path.join(d, bg["src"])))
