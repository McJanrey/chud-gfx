import json
import struct
import unittest

from gfxengine import obs


class FakeSock:
    """Feeds bytes to WS.recv and records what WS.send writes."""
    def __init__(self, data=b""):
        self.data, self.sent = data, b""

    def recv(self, n):
        out, self.data = self.data[:n], self.data[n:]
        return out

    def sendall(self, b):
        self.sent += b


def ws_with(data=b""):
    w = obs.WS.__new__(obs.WS)
    w.sock, w.buf = FakeSock(data), b""
    import threading
    w.wlock = threading.Lock()
    return w


class Auth(unittest.TestCase):
    def test_spec_example(self):
        # obs-websocket v5 protocol docs, "Creating an authentication string"
        self.assertEqual(obs.auth_string("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=",
                                         "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="),
                         "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=")


class Frames(unittest.TestCase):
    def test_reads_text_answers_ping(self):
        ping = bytes([0x89, 2]) + b"hi"
        text = b'{"op":0}'
        w = ws_with(ping + bytes([0x81, len(text)]) + text)
        self.assertEqual(w.recv(), '{"op":0}')
        self.assertEqual(w.sock.sent[0], 0x8A)            # pong went back, masked
        self.assertTrue(w.sock.sent[1] & 0x80)

    def test_reads_long_and_fragmented(self):
        big = b"x" * 300
        w = ws_with(bytes([0x01, 126]) + struct.pack(">H", 300) + big + bytes([0x80, 1]) + b"y")
        self.assertEqual(w.recv(), "x" * 300 + "y")

    def test_send_is_masked_and_round_trips(self):
        w = ws_with()
        w.send(0x1, json.dumps({"op": 1}))
        raw = w.sock.sent
        self.assertEqual(raw[0], 0x81)
        n = raw[1] & 0x7F
        mask, body = raw[2:6], raw[6:6 + n]
        self.assertEqual(bytes(b ^ mask[i % 4] for i, b in enumerate(body)), b'{"op": 1}')

    def test_close_returns_none(self):
        self.assertIsNone(ws_with(bytes([0x88, 0])).recv())


class FakeOBS:
    def __init__(self):
        self.state, self.scenes = {"connected": True}, []

    def set_scene(self, name, preview=False):
        self.scenes.append(name)


class TakeSwitchesScene(unittest.TestCase):
    def test_graphic_going_on_air_switches_obs(self):
        import threading
        from gfxengine import app

        class Live:
            on = []
            def get(self):
                return {"program": {"on": list(self.on)}}

        class WS:
            def get(self):
                return {"compositions": [{"id": "a", "obsScene": "Starting Soon"}, {"id": "b"}]}

        e = app.Engine.__new__(app.Engine)
        e.obs, e.live, e.ws, e._pgm_on = FakeOBS(), Live(), WS(), set()
        started = []
        real = threading.Thread
        threading.Thread = lambda target, args, daemon: type("T", (), {"start": lambda self: started.append(target(*args))})()
        try:
            Live.on = ["b"]; e._program_changed()          # no scene set for b
            Live.on = ["b", "a"]; e._program_changed()     # a goes on air
            e._program_changed()                           # still on: no second switch
        finally:
            threading.Thread = real
        self.assertEqual(e.obs.scenes, ["Starting Soon"])



class SettingsKept(unittest.TestCase):
    def test_obs_and_multistream_settings_are_saved(self):
        import os
        import tempfile
        from gfxengine.config import Settings
        p = os.path.join(tempfile.mkdtemp(), "s.json")
        Settings(p).update({"obs": {"enabled": True, "port": 4455}, "multistream": {"enabled": True}})
        again = Settings(p).get()
        self.assertTrue(again["obs"]["enabled"] and again["multistream"]["enabled"])



class OriginCheck(unittest.TestCase):
    def test_only_own_pages_can_post(self):
        from gfxengine.app import origin_ok
        own = {7790, 7795, 7800}
        self.assertTrue(origin_ok(None, "127.0.0.1:7790", own))                              # Companion, HUDs
        self.assertTrue(origin_ok("http://127.0.0.1:7790", "127.0.0.1:7790", own))          # its own page
        self.assertTrue(origin_ok("http://192.168.2.40:7790", "192.168.2.40:7790", own))    # control from another PC
        self.assertTrue(origin_ok("http://localhost:7800", "127.0.0.1:7790", own))          # built-in HUD Builder
        self.assertFalse(origin_ok("https://evil.example", "127.0.0.1:7790", own))          # any website
        self.assertFalse(origin_ok("http://localhost:3000", "127.0.0.1:7790", own))         # another local app
        self.assertFalse(origin_ok("null", "127.0.0.1:7790", own))                          # sandboxed / file pages


if __name__ == "__main__":
    unittest.main()
