import tempfile
import unittest

from sgfx import logs


class Logs(unittest.TestCase):
    def test_page_errors_land_in_the_log(self):
        logs.setup(tempfile.mkdtemp())
        logs.page_error({"page": "output", "msg": "boom", "src": "stage.js", "line": 12, "stack": "at x\nat y"})
        text = logs.tail()
        self.assertIn("Page output: boom at stage.js:12", text)
        self.assertIn("at y", text)
        self.assertEqual(logs.errors_since(60)[-1], "Page output: boom at stage.js:12")


if __name__ == "__main__":
    unittest.main()
