import json, tempfile, unittest
from pathlib import Path
from sgfx import app


class Starter(unittest.TestCase):
    def test_seed_once_never_over_own(self):
        with tempfile.TemporaryDirectory() as t:
            t = Path(t); st, d = t / "starter", t / "data"
            (st / "workspaces" / "esm").mkdir(parents=True); (st / "workspaces" / "esm" / "project.json").write_text("{}")
            (st / "library").mkdir(); (st / "library" / "teams.json").write_text('["A"]')
            (d / "workspaces").mkdir(parents=True); (d / "library").mkdir()
            (d / "library" / "teams.json").write_text('["mine"]')
            app.seed(d, st)
            self.assertTrue((d / "workspaces" / "esm" / "project.json").is_file())
            self.assertEqual((d / "library" / "teams.json").read_text(), '["mine"]')   # (the user's own stays)
            import shutil; shutil.rmtree(d / "workspaces" / "esm")
            app.seed(d, st)
            self.assertFalse((d / "workspaces" / "esm").exists())   # (deleted by the user: not brought back)
            self.assertIn("workspaces/esm", json.loads((d / "starter.json").read_text()))


if __name__ == "__main__":
    unittest.main()
