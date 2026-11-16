"""OBS Studio over its WebSocket server (obs-websocket 5, built into OBS 28+).

Shows OBS's scene, LIVE and REC; switches scenes; adds this engine's outputs to OBS as browser sources;
rules: when OBS shows a scene, take a graphic in or out. Settings in <library>/obs.json; the password
stays in that file and is never sent to a page.
"""
import base64
import hashlib
import json
import os
import socket
import struct
import threading
import time
import uuid


class WS:
    """The smallest WebSocket client that works: text frames, masked, ping/pong, close."""
    def __init__(self, host, port, timeout=5):
        self.sock = socket.create_connection((host, port), timeout=timeout)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall((f"GET / HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
                           f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Protocol: obswebsocket.json\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise ConnectionError("OBS closed the connection")
            head += chunk
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError("OBS didn't accept the connection")
        self.buf = head.split(b"\r\n\r\n", 1)[1]
        self.lock = threading.Lock()

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("OBS closed the connection")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, obj, opcode=1):
        data = json.dumps(obj).encode() if opcode == 1 else obj
        mask = os.urandom(4)
        n = len(data)
        head = bytes([0x80 | opcode]) + (bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n))
        with self.lock:
            self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        msg = b""
        while True:
            b0, b1 = self._read(2)
            op, n = b0 & 0x0F, b1 & 0x7F
            if n == 126:
                n = struct.unpack(">H", self._read(2))[0]
            elif n == 127:
                n = struct.unpack(">Q", self._read(8))[0]
            mask = self._read(4) if b1 & 0x80 else None
            data = self._read(n)
            if mask:
                data = bytes(b ^ mask[i % 4] for i, b in enumerate(data))
            if op == 9:
                self.send(data, 10)
                continue
            if op == 8:
                raise ConnectionError("OBS closed the connection")
            if op in (0, 1, 2):
                msg += data
                if b0 & 0x80:
                    return json.loads(msg)

    def close(self):
        try:
            self.sock.close()
        except OSError:
            pass


def auth(password, salt, challenge):
    secret = base64.b64encode(hashlib.sha256((password + salt).encode()).digest()).decode()
    return base64.b64encode(hashlib.sha256((secret + challenge).encode()).digest()).decode()


class OBS:
    EVENTS = 1 | 4 | 64   # General, Scenes, Outputs

    def __init__(self, folder):
        self.path = os.path.join(folder, "obs.json")
        try:
            with open(self.path, encoding="utf-8") as f:
                self.cfg = json.load(f)
        except (OSError, ValueError):
            self.cfg = {}
        for k, v in (("on", False), ("host", "127.0.0.1"), ("port", 4455), ("password", ""), ("rules", [])):
            self.cfg.setdefault(k, v)
        self.ws, self.pending = None, {}
        self.status = {"state": "off", "detail": "", "scene": "", "scenes": [], "live": False, "rec": False}
        self.on_change = lambda: None
        self.on_scene = lambda scene: None
        self.stop_flag = threading.Event()
        if self.cfg["on"]:
            self.start()

    def public(self):
        return {**{k: v for k, v in self.cfg.items() if k != "password"}, "has_password": bool(self.cfg.get("password")), "status": dict(self.status)}

    def save(self, body):
        for k in ("host", "port", "rules", "on"):
            if k in body:
                self.cfg[k] = body[k]
        if body.get("password") is not None and body.get("password") != "":
            self.cfg["password"] = str(body["password"])
        if body.get("clear_password"):
            self.cfg["password"] = ""
        self.cfg["port"] = int(self.cfg.get("port") or 4455)
        self.cfg["rules"] = [{"scene": str(r.get("scene", "")), "comp": str(r.get("comp", "")), "action": "out" if r.get("action") == "out" else "in"}
                             for r in self.cfg.get("rules") or [] if isinstance(r, dict)]
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(self.cfg, f, indent=1)
        os.replace(self.path + ".tmp", self.path)
        if any(k in body for k in ("host", "port", "password", "on")):
            self.restart()

    def _set(self, **kw):
        self.status.update(kw)
        self.on_change()

    def restart(self):
        self.stop()
        if self.cfg["on"]:
            self.start()

    def stop(self):
        self.stop_flag.set()
        if self.ws:
            self.ws.close()
        self.ws = None
        self._set(state="off", detail="", scene="", scenes=[], live=False, rec=False)

    def start(self):
        self.stop_flag = threading.Event()
        threading.Thread(target=self._run, args=(self.stop_flag,), daemon=True).start()

    def request(self, kind, data=None, wait=5):
        if not self.ws:
            raise ValueError("OBS isn't connected")
        rid = uuid.uuid4().hex
        box = self.pending[rid] = {"ev": threading.Event()}
        self.ws.send({"op": 6, "d": {"requestType": kind, "requestId": rid, "requestData": data or {}}})
        if not box["ev"].wait(wait):
            self.pending.pop(rid, None)
            raise ValueError("OBS didn't answer")
        res = box["res"]
        st = res.get("requestStatus") or {}
        if not st.get("result"):
            raise ValueError(st.get("comment") or f"OBS said no ({kind})")
        return res.get("responseData") or {}

    def _run(self, stop):
        while not stop.is_set():
            try:
                self._set(state="connecting", detail=f"{self.cfg['host']}:{self.cfg['port']}")
                ws = WS(self.cfg["host"], self.cfg["port"])
                hello = ws.recv()["d"]
                ident = {"rpcVersion": 1, "eventSubscriptions": self.EVENTS}
                if hello.get("authentication"):
                    if not self.cfg.get("password"):
                        ws.close()
                        self._set(state="error", detail="OBS asks for a password: type it in (OBS > Tools > WebSocket Server Settings > Show Connect Info)")
                        return
                    a = hello["authentication"]
                    ident["authentication"] = auth(self.cfg["password"], a["salt"], a["challenge"])
                ws.send({"op": 1, "d": ident})
                ws.sock.settimeout(None)
                first = ws.recv()
                if first.get("op") != 2:
                    raise ConnectionError("OBS didn't accept (wrong password?)")
                self.ws = ws
                threading.Thread(target=self._refresh, daemon=True).start()
                self._set(state="on", detail="")
                while not stop.is_set():
                    m = ws.recv()
                    self._message(m)
            except (OSError, ConnectionError, ValueError, KeyError) as e:
                self.ws = None
                if stop.is_set():
                    return
                wrong = "4009" in str(e) or "password" in str(e).lower()
                self._set(state="error", detail=("Wrong password" if wrong else "Can't reach OBS: is it open with its WebSocket server on?") + f" ({e.__class__.__name__})")
                stop.wait(5)

    def _refresh(self):
        try:
            sl = self.request("GetSceneList")
            st = self.request("GetStreamStatus")
            rc = self.request("GetRecordStatus")
            self._set(scenes=[s["sceneName"] for s in reversed(sl.get("scenes") or [])], scene=sl.get("currentProgramSceneName", ""),
                      live=bool(st.get("outputActive")), rec=bool(rc.get("outputActive")))
        except ValueError:
            pass

    def _message(self, m):
        op, d = m.get("op"), m.get("d") or {}
        if op == 7:
            box = self.pending.pop(d.get("requestId"), None)
            if box:
                box["res"] = d
                box["ev"].set()
        elif op == 5:
            kind, data = d.get("eventType"), d.get("eventData") or {}
            if kind == "CurrentProgramSceneChanged":
                self._set(scene=data.get("sceneName", ""))
                self.on_scene(data.get("sceneName", ""))
            elif kind == "StreamStateChanged":
                self._set(live=bool(data.get("outputActive")))
            elif kind == "RecordStateChanged":
                self._set(rec=bool(data.get("outputActive")))
            elif kind in ("SceneListChanged", "SceneCreated", "SceneRemoved", "SceneNameChanged"):
                threading.Thread(target=self._refresh, daemon=True).start()

    def add_sources(self, scene, sources):
        """sources: [(name, url)] -> browser sources (1920 x 1080) in the scene (made if missing)."""
        if scene not in self.status["scenes"]:
            self.request("CreateScene", {"sceneName": scene})
        made = []
        for name, url in sources:
            try:
                self.request("CreateInput", {"sceneName": scene, "inputName": name, "inputKind": "browser_source",
                                             "inputSettings": {"url": url, "width": 1920, "height": 1080, "reroute_audio": True}})
                made.append(name)
            except ValueError as e:
                if "exists" not in str(e).lower():
                    raise
        return made
