import base64
import hashlib
import json
import os
import shutil
import socket
import struct
import tempfile
import threading
import time
import unittest

from sgfx.obs import auth
from sgfx.server import Engine


def frame(obj):
    data = json.dumps(obj).encode()
    n = len(data)
    return bytes([0x81]) + (bytes([n]) if n < 126 else bytes([126]) + struct.pack(">H", n)) + data


def read_frame(conn):
    b0, b1 = conn.recv(2)
    n = b1 & 0x7F
    if n == 126:
        n = struct.unpack(">H", conn.recv(2))[0]
    mask = conn.recv(4)
    data = b""
    while len(data) < n:
        data += conn.recv(n - len(data))
    return json.loads(bytes(b ^ mask[i % 4] for i, b in enumerate(data)))


class FakeOBS(threading.Thread):
    """Just enough obs-websocket 5: hello (no password), identify, three requests, one scene event."""
    def __init__(self):
        super().__init__(daemon=True)
        self.srv = socket.socket()
        self.srv.bind(("127.0.0.1", 0))
        self.srv.listen(1)
        self.port = self.srv.getsockname()[1]
        self.switched = []
        self.conn = None

    def run(self):
        conn, _ = self.srv.accept()
        self.conn = conn
        req = conn.recv(4096).decode()
        key = [l.split(": ")[1] for l in req.split("\r\n") if l.lower().startswith("sec-websocket-key")][0]
        acc = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        conn.sendall(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {acc}\r\n\r\n".encode())
        conn.sendall(frame({"op": 0, "d": {"rpcVersion": 1}}))
        assert read_frame(conn)["op"] == 1
        conn.sendall(frame({"op": 2, "d": {"negotiatedRpcVersion": 1}}))
        answers = {"GetSceneList": {"currentProgramSceneName": "Gameplay", "scenes": [{"sceneName": "Break"}, {"sceneName": "Gameplay"}]},
                   "GetStreamStatus": {"outputActive": True}, "GetRecordStatus": {"outputActive": False}}
        try:
            while True:
                m = read_frame(conn)["d"]
                if m["requestType"] == "SetCurrentProgramScene":
                    self.switched.append(m["requestData"]["sceneName"])
                conn.sendall(frame({"op": 7, "d": {"requestId": m["requestId"], "requestType": m["requestType"], "requestStatus": {"result": True, "code": 100},
                                                    "responseData": answers.get(m["requestType"], {})}}))
        except (OSError, ValueError):
            pass

    def event(self, scene):
        self.conn.sendall(frame({"op": 5, "d": {"eventType": "CurrentProgramSceneChanged", "eventData": {"sceneName": scene}}}))


class Obs(unittest.TestCase):
    def test_auth_matches_the_obs_websocket_docs(self):
        self.assertEqual(auth("supersecretpassword", "lM1GncleQOaCu9lT1yeUZhFYnqhsLLP1G5lAGo3ixaI=", "+IxH4CnCiqpX1rM9scsNynZzbOe4KhDeYcTNS3PDaeY="),
                         "1Ct943GAT+6YQUUX47Ia/ncufilbe6+oD6lY+5kaCu4=")

    def test_scenes_rules_and_on_air_switch(self):
        fake = FakeOBS()
        fake.start()
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        comps = [{"id": "c1", "name": "Break board", "kind": "board", "layers": [], "obs_scene": "Break"}, {"id": "c2", "name": "Bug", "layers": []}]
        json.dump({"name": "T", "global": {}, "compositions": comps, "transitions": []}, open(os.path.join(d, "project.json"), "w"))
        e = Engine(d, os.path.join(d, "lib"))
        e.obs.save({"host": "127.0.0.1", "port": fake.port, "on": True, "rules": [{"scene": "Break", "comp": "c2", "action": "in"}]})
        for _ in range(50):
            if e.obs.status["scenes"]:
                break
            time.sleep(0.1)
        self.assertEqual((e.obs.status["scene"], e.obs.status["scenes"], e.obs.status["live"]), ("Gameplay", ["Gameplay", "Break"], True))
        fake.event("Break")
        for _ in range(30):
            if "c2" in e.buses.state["program"]["on"]:
                break
            time.sleep(0.1)
        self.assertIn("c2", e.buses.state["program"]["on"])
        e.obs.status["scene"] = "Gameplay"
        e.act("/api/program", {"id": "c1", "on": True})
        for _ in range(30):
            if fake.switched:
                break
            time.sleep(0.1)
        self.assertEqual(fake.switched, ["Break"])
        e.obs.save({"on": False})


if __name__ == "__main__":
    unittest.main()
