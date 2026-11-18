import json
import socket
import tempfile
import threading
import time
import unittest
from pathlib import Path

from sgfx.app import pick_workspace_in
from sgfx.server import make_server
from tests.test_hudlink import call


def state(players, blue, orange, secs, winner=""):
    return {"Event": "UpdateState", "Data": {"MatchGuid": "G1", "Players": players, "Game": {
        "Teams": [{"Name": "Blue", "TeamNum": 0, "Score": blue}, {"Name": "Orange", "TeamNum": 1, "Score": orange}],
        "TimeSeconds": secs, "bOvertime": False, "bHasWinner": bool(winner), "Winner": winner, "Arena": "Stadium_P"}}}


def p(name, team, goals, saves=0):
    return {"Name": name, "PrimaryId": f"Steam|{name}|0", "TeamNum": team, "Score": goals * 100, "Goals": goals, "Shots": goals, "Assists": 0, "Saves": saves, "Touches": 5, "Demos": 0, "Boost": 33}


class RocketLeague(unittest.TestCase):
    """Psyonix's Stats API (a TCP socket of back-to-back JSON) into tables, with each finished game frozen."""
    def setUp(self):
        d = Path(tempfile.mkdtemp())
        self.engine, self.srv = make_server(str(pick_workspace_in(d)), str(d / "library"), 0)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.game = socket.socket()
        self.game.bind(("127.0.0.1", 0))
        self.game.listen(1)
        call(self.engine.port, "/api/rl", {"port": self.game.getsockname()[1]})
        self.game.settimeout(10)
        self.conn, _ = self.game.accept()

    def tearDown(self):
        self.conn.close()
        self.game.close()
        self.srv.shutdown()

    def send(self, *msgs, split=False):
        raw = "".join(json.dumps(m) for m in msgs).encode()   # (no separators: the game sends them back to back)
        if split:   # (a message cut across two reads)
            self.conn.sendall(raw[:37]); time.sleep(0.1); self.conn.sendall(raw[37:])
        else:
            self.conn.sendall(raw)

    def tables(self):
        return call(self.engine.port, "/api/state")[1]["data"]["tables"]

    def wait(self, check):
        for _ in range(50):
            t = self.tables()
            if check(t):
                return t
            time.sleep(0.1)
        self.fail("timed out: " + json.dumps({k: v for k, v in t.items() if "RL" in k or "Rocket" in k})[:800])

    def field(self, rows, f):
        return next((r[1] for r in rows if r[0] == f), None)

    def test_leaver_kept_and_game_frozen(self):
        self.send({"Event": "MatchCreated", "Data": {"MatchGuid": "G1"}},
                  state([p("Ann", 0, 1), p("Bob", 1, 0, saves=3)], 1, 0, 65), split=True)
        t = self.wait(lambda t: self.field(t.get("Rocket League", []), "Blue 1 name") == "Ann")
        self.assertEqual(self.field(t["Rocket League"], "Clock"), "1:05")
        # Bob quits: gone from the list, his line stays
        self.send({"Event": "PlayerLeft", "Data": {"MatchGuid": "G1", "PlayerName": "Bob", "PrimaryId": "Steam|Bob|0"}},
                  state([p("Ann", 0, 2)], 2, 0, 0),
                  {"Event": "MatchEnded", "Data": {"MatchGuid": "G1", "WinnerTeamNum": 0}})
        t = self.wait(lambda t: "RL Game 1" in t)
        g = t["RL Game 1"]
        self.assertEqual((self.field(g, "Blue score"), self.field(g, "Orange score")), ("2", "0"))
        self.assertEqual((self.field(g, "Orange 1 name"), self.field(g, "Orange 1 saves"), self.field(g, "Orange 1 left")), ("Bob", "3", "yes"))
        self.assertEqual(self.field(g, "Winner"), "Blue")
        self.assertEqual(t["RL Last game"], g)
        # the series: Blue (left) +1, once
        self.send(state([p("Ann", 0, 2)], 2, 0, 0, winner="Blue"))
        time.sleep(0.3)
        st = call(self.engine.port, "/api/state")[1]
        self.assertEqual(str(st["project"]["global"]["left"]["score"]), "1")
        self.assertEqual(len(st["rl"]["games"]), 1)
        # kept on disk: a restart still has it
        saved = json.loads((Path(self.engine.folder) / "rl-games.json").read_text())
        self.assertEqual(saved[0]["fields"]["Orange 1 name"], "Bob")
        # next game: fresh players; New series puts the old games aside
        self.send({"Event": "MatchCreated", "Data": {"MatchGuid": "G2"}})
        self.wait(lambda t: self.field(t.get("Rocket League", []), "Blue 1 name") == "")
        call(self.engine.port, "/api/rl/clear", {})
        self.assertNotIn("RL Game 1", self.tables())
        self.assertTrue(list(Path(self.engine.folder).glob("rl-games-*.json")))

    def test_save_now_and_backup_trigger(self):
        code, r = call(self.engine.port, "/api/rl/save", {})
        self.assertEqual(code, 400)   # (nothing yet)
        self.send(state([p("Ann", 0, 1), p("Bob", 1, 1)], 1, 1, 30))
        self.wait(lambda t: self.field(t.get("Rocket League", []), "Orange 1 name") == "Bob")
        self.assertEqual(call(self.engine.port, "/api/rl/save", {})[1], {"game": 1})
        # MatchEnded never arrives, but the winner shows in the state: still saved, and only once
        self.send({"Event": "MatchCreated", "Data": {"MatchGuid": "G3"}}, state([p("Ann", 0, 3), p("Bob", 1, 1)], 3, 1, 0, winner="Blue"))
        self.send(state([p("Ann", 0, 3), p("Bob", 1, 1)], 3, 1, 0, winner="Blue"))
        t = self.wait(lambda t: "RL Game 2" in t)
        time.sleep(0.3)
        self.assertNotIn("RL Game 3", self.tables())
        self.assertEqual(self.field(t["RL Game 2"], "Blue score"), "3")


if __name__ == "__main__":
    unittest.main()
