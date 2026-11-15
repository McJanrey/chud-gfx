"""OBS Studio link over obs-websocket v5 (OBS 28+, Tools > WebSocket Server Settings, port 4455).

Stdlib only: a small WebSocket client (text frames, ping/pong, close) plus the OBS hello/identify
handshake with its password challenge. Keeps live state (scenes, program/preview scene, streaming,
recording, studio mode) and sends requests. Reconnects by itself while enabled."""
import base64
import hashlib
import json
import os
import socket
import struct
import threading
import time

from .log import log

RECONNECT_S = 5


# --- WebSocket (client side, RFC 6455, just what OBS needs) -------------------------------

class WS:
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
        head, self.buf = head.split(b"\r\n\r\n", 1)
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise ConnectionError("OBS didn't accept the WebSocket connection")
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest())
        if accept not in head:
            raise ConnectionError("bad WebSocket handshake")
        self.sock.settimeout(None)
        self.wlock = threading.Lock()

    def _read(self, n):
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("OBS closed the connection")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def send(self, op, payload=b""):
        if isinstance(payload, str):
            payload = payload.encode()
        n = len(payload)
        head = bytes([0x80 | op])
        head += bytes([0x80 | n]) if n < 126 else bytes([0x80 | 126]) + struct.pack(">H", n) if n < 65536 else bytes([0x80 | 127]) + struct.pack(">Q", n)
        mask = os.urandom(4)
        body = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        with self.wlock:
            self.sock.sendall(head + mask + body)

    def recv(self):
        """The next text message (str), answering pings; None when closed."""
        parts = []
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
            if op == 0x9:
                self.send(0xA, data)
                continue
            if op == 0x8:
                return None
            if op in (0x1, 0x0):
                parts.append(data)
                if b0 & 0x80:
                    return b"".join(parts).decode("utf-8", "replace")

    def close(self):
        try:
            self.send(0x8)
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass


def auth_string(password, salt, challenge):
    """obs-websocket v5: base64(sha256(base64(sha256(password + salt)) + challenge))."""
    secret = base64.b64encode(hashlib.sha256((password + salt).encode()).digest()).decode()
    return base64.b64encode(hashlib.sha256((secret + challenge).encode()).digest()).decode()


# --- OBS -------------------------------------------------------------------------------------

class OBS:
    def __init__(self, on_change=None, on_scene=None):
        self.cfg = {"enabled": False, "host": "127.0.0.1", "port": 4455, "password": ""}
        self.on_change = on_change or (lambda: None)
        self.on_scene = on_scene or (lambda scene: None)   # program scene changed (scene-follow rules)
        self.ws = None
        self.pending = {}
        self.lock = threading.Lock()
        self.state = self._blank()
        self.wake = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    @staticmethod
    def _blank(error=""):
        return {"connected": False, "error": error, "scenes": [], "program": "", "preview": "", "studio": False,
                "streaming": False, "recording": False}

    def configure(self, cfg):
        self.cfg.update({k: cfg[k] for k in ("enabled", "host", "port", "password") if k in cfg})
        self._drop()
        self.wake.set()

    def public(self):
        """State for the pages (never the password)."""
        with self.lock:
            s = dict(self.state)
        s.update(enabled=bool(self.cfg["enabled"]), host=self.cfg["host"], port=self.cfg["port"], hasPassword=bool(self.cfg["password"]))
        return s

    def _set(self, **kw):
        with self.lock:
            self.state.update(kw)
        self.on_change()

    def _drop(self):
        ws, self.ws = self.ws, None
        if ws:
            ws.close()

    # requests --------------------------------------------------------

    def request(self, rtype, data=None, timeout=5):
        ws = self.ws
        if not ws:
            raise ConnectionError("OBS isn't connected")
        rid = os.urandom(6).hex()
        ev = threading.Event()
        self.pending[rid] = [ev, None]
        ws.send(0x1, json.dumps({"op": 6, "d": {"requestType": rtype, "requestId": rid, "requestData": data or {}}}))
        if not ev.wait(timeout):
            self.pending.pop(rid, None)
            raise TimeoutError(f"OBS didn't answer {rtype}")
        res = self.pending.pop(rid)[1]
        st = res.get("requestStatus", {})
        if not st.get("result"):
            raise RuntimeError(st.get("comment") or f"OBS refused {rtype} (code {st.get('code')})")
        return res.get("responseData") or {}

    def set_scene(self, name, preview=False):
        self.request("SetCurrentPreviewScene" if preview else "SetCurrentProgramScene", {"sceneName": name})

    def transition(self):
        self.request("TriggerStudioModeTransition")

    def toggle(self, what):
        self.request({"stream": "ToggleStream", "record": "ToggleRecord"}[what])

    def add_browser_source(self, url, scene=None, name="GFX Baby"):
        """A 1920x1080 browser source with the engine's output, in this scene (or the program scene)."""
        scene = scene or self.state["program"]
        return self.request("CreateInput", {"sceneName": scene, "inputName": name, "inputKind": "browser_source",
                                            "inputSettings": {"url": url, "width": 1920, "height": 1080, "reroute_audio": True},
                                            "sceneItemEnabled": True})

    # connection loop ----------------------------------------------------

    def _run(self):
        while True:
            if not self.cfg["enabled"]:
                if self.state["connected"] or self.state["error"]:
                    self._set(**self._blank())
                self.wake.wait()
                self.wake.clear()
                continue
            try:
                self._session()
            except Exception as e:   # OBS closed, wrong password, not running: say why, try again soon
                msg = str(e) or e.__class__.__name__
                if isinstance(e, (ConnectionRefusedError, socket.timeout, TimeoutError)):
                    msg = "OBS isn't running, or its WebSocket server is off (Tools > WebSocket Server Settings)"
                if self.state["error"] != msg or self.state["connected"]:
                    log(f"OBS: {msg}")
                self._set(**self._blank(msg))
            self._drop()
            for ev in list(self.pending.values()):
                ev[0].set()
            self.wake.wait(RECONNECT_S)
            self.wake.clear()

    def _session(self):
        cfg = dict(self.cfg)
        ws = WS(cfg["host"], int(cfg["port"]))
        hello = json.loads(ws.recv() or "{}")
        if hello.get("op") != 0:
            raise ConnectionError("not an OBS WebSocket server")
        ident = {"rpcVersion": 1, "eventSubscriptions": 1 | 4 | 64 | 1023}   # general, scenes, outputs, ui (all non-high-volume)
        a = hello["d"].get("authentication")
        if a:
            if not cfg["password"]:
                raise PermissionError("OBS asks for a password: type it in OBS settings here")
            ident["authentication"] = auth_string(cfg["password"], a["salt"], a["challenge"])
        ws.send(0x1, json.dumps({"op": 1, "d": ident}))
        self.ws = ws
        reader = threading.Thread(target=self._reader, args=(ws,), daemon=True)
        reader.start()
        self._refresh()
        log(f"OBS connected ({cfg['host']}:{cfg['port']})")
        reader.join()
        if self.state.get("_closed_reason"):
            raise PermissionError(self.state.pop("_closed_reason"))
        raise ConnectionError("OBS closed the connection")

    def _reader(self, ws):
        try:
            while True:
                raw = ws.recv()
                if raw is None:
                    break
                msg = json.loads(raw)
                op, d = msg.get("op"), msg.get("d", {})
                if op == 7 and d.get("requestId") in self.pending:
                    self.pending[d["requestId"]][1] = d
                    self.pending[d["requestId"]][0].set()
                elif op == 5:
                    self._event(d.get("eventType"), d.get("eventData") or {})
        except (OSError, ValueError, ConnectionError):
            pass
        if self.ws is ws and not self.state["connected"]:
            self.state["_closed_reason"] = "OBS refused the password"

    def _refresh(self):
        scenes = self.request("GetSceneList")
        studio = self.request("GetStudioModeEnabled").get("studioModeEnabled", False)
        stream = self.request("GetStreamStatus").get("outputActive", False)
        record = self.request("GetRecordStatus").get("outputActive", False)
        self._set(connected=True, error="", scenes=[s["sceneName"] for s in reversed(scenes.get("scenes", []))],
                  program=scenes.get("currentProgramSceneName", ""), preview=scenes.get("currentPreviewSceneName") or "",
                  studio=studio, streaming=stream, recording=record)

    def _event(self, etype, data):
        if etype == "CurrentProgramSceneChanged":
            self._set(program=data.get("sceneName", ""))
            self.on_scene(data.get("sceneName", ""))
        elif etype == "CurrentPreviewSceneChanged":
            self._set(preview=data.get("sceneName", ""))
        elif etype in ("SceneListChanged", "SceneCreated", "SceneRemoved", "SceneNameChanged"):
            threading.Thread(target=self._safe_refresh, daemon=True).start()
        elif etype == "StreamStateChanged":
            self._set(streaming=bool(data.get("outputActive")))
        elif etype == "RecordStateChanged":
            self._set(recording=bool(data.get("outputActive")))
        elif etype == "StudioModeStateChanged":
            self._set(studio=bool(data.get("studioModeEnabled")))
        elif etype == "ExitStarted":
            self._drop()

    def _safe_refresh(self):
        try:
            self._refresh()
        except Exception:
            pass
