"""Network: whether other PCs may use this engine, on which address, its name, and finding other engines.

Settings in <library>/settings.json: {"network": bool, "bind": "" (every network) or one of this PC's
addresses, "name": "..."}. The server always listens on every address; requests from other PCs are
refused unless the network is on (and arrive on the picked address).
Finding: a UDP question "SGFX?" on port 7821 (broadcast); every engine with the network on answers
with its name and port.
"""
import json
import os
import socket
import threading
import time

PORT = 7821
ASK = b"SGFX?"


class Net:
    def __init__(self, folder, port):
        self.path, self.port = os.path.join(folder, "settings.json"), port
        try:
            with open(self.path, encoding="utf-8") as f:
                self.cfg = json.load(f)
        except (OSError, ValueError):
            self.cfg = {}
        self.cfg.setdefault("network", bool(os.environ.get("SGFX_LAN")))
        self.cfg.setdefault("bind", "")
        self.cfg.setdefault("name", socket.gethostname())
        threading.Thread(target=self._answer, daemon=True).start()

    def save(self, change):
        if "network" in change:
            self.cfg["network"] = bool(change["network"])
        if "bind" in change:
            self.cfg["bind"] = str(change["bind"] or "")
        if "name" in change:
            self.cfg["name"] = str(change["name"] or "").strip()[:60] or socket.gethostname()
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(self.cfg, f, indent=1)
        os.replace(self.path + ".tmp", self.path)

    def allowed(self, client_ip, local_ip):
        if client_ip.startswith("127.") or client_ip == "::1":
            return True
        if not self.cfg["network"]:
            return False
        return not self.cfg["bind"] or local_ip == self.cfg["bind"]

    def _answer(self):
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            s.bind(("", PORT))
        except OSError:
            return   # (another engine on this PC answers already)
        while True:
            try:
                data, addr = s.recvfrom(64)
            except OSError:
                time.sleep(1)
                continue
            if data == ASK and self.cfg["network"]:
                s.sendto(json.dumps({"name": self.cfg["name"], "port": self.port}).encode(), addr)

    def scan(self, wait=1.2):
        """[{name, address, port}] of engines that answered (this one included when its network is on)."""
        found = {}
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        s.settimeout(0.2)
        try:
            for target in ("255.255.255.255", "127.0.0.1"):
                try:
                    s.sendto(ASK, (target, PORT))
                except OSError:
                    pass
            end = time.time() + wait
            while time.time() < end:
                try:
                    data, addr = s.recvfrom(512)
                    info = json.loads(data)
                    found[(addr[0], info.get("port"))] = {"name": str(info.get("name", ""))[:60], "address": addr[0], "port": int(info.get("port") or 0)}
                except (socket.timeout, ValueError):
                    pass
        finally:
            s.close()
        out = list(found.values())
        # (this PC answers on 127.0.0.1 and on its network address: keep the one other PCs can use)
        out = [x for x in out if not (x["address"].startswith("127.") and any(y is not x and y["name"] == x["name"] and y["port"] == x["port"] for y in out))]
        return sorted(out, key=lambda x: (x["name"], x["address"]))
