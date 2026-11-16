import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

from sgfx.app import pick_workspace_in
from sgfx.server import make_server


def call(port, path, body=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}{path}", json.dumps(body).encode() if body is not None else None, {"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


class HudLink(unittest.TestCase):
    """The engine side of the link the game HUDs speak (their hud-link/enginelink.py)."""
    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.engine, self.srv = make_server(str(pick_workspace_in(d)), str(d / "library"), 0)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.port = self.engine.port

    def tearDown(self):
        self.srv.shutdown()

    def test_hello_ingest_global(self):
        _, hi = call(self.port, "/api/hello")
        self.assertEqual(hi["app"], "chud-gfx")
        body = {"source": "League HUD", "game": "lol", "fields": {"KILLS LEFT": 7}, "series": {"left": {"score": 2}, "best_of": 5},
                "hud": {"port": 7799, "graphics": [{"id": "a", "name": "Agent select", "path": "a.html"}]}, "engine": hi["id"], "hud_id": "h1"}
        code, reply = call(self.port, "/api/ingest", body)
        self.assertEqual((code, reply["id"]), (200, hi["id"]))
        _, st = call(self.port, "/api/state")
        self.assertEqual(st["data"]["tables"]["League HUD"][1], ["KILLS LEFT", "7"])
        self.assertEqual((st["project"]["global"]["left"]["score"], st["project"]["global"]["best_of"]), (2, 5))
        self.assertEqual([c["name"] for c in st["project"]["compositions"] if c.get("hud_page")], ["Agent select"])
        call(self.port, "/api/ingest", body)   # (added once)
        _, st = call(self.port, "/api/state")
        self.assertEqual(len([c for c in st["project"]["compositions"] if c.get("hud_page")]), 1)
        self.assertEqual(call(self.port, "/api/ingest", dict(body, hud_id="h2"))[1]["code"], "taken")
        self.assertEqual(call(self.port, "/api/ingest", dict(body, engine="other"))[1]["code"], "wrong_engine")
        self.assertEqual(call(self.port, "/api/global?engine=other")[1]["code"], "wrong_engine")
        self.assertIn("sponsors", call(self.port, f"/api/global?engine={hi['id']}")[1]["global"])


if __name__ == "__main__":
    unittest.main()
