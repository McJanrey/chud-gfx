"""Multistream restarts and its listen address, OBS's wrong-password close, cleanup before an update,
and the one-copy-at-a-time guard."""
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
from pathlib import Path
from unittest import mock

from sgfx import app, stream, updater
from sgfx.obs import OBS
from tests.test_obs import frame, read_frame


def folder(test):
    d = tempfile.mkdtemp()
    test.addCleanup(shutil.rmtree, d, True)
    return d


class Multistream(unittest.TestCase):
    def make(self):
        m = stream.Multistream(folder(self))
        m.set({"targets": [{"id": "a", "platform": "twitch", "name": "Twitch", "url": "rtmp://x/app", "key": "k1", "on": True}]})
        m.cfg["on"] = True
        m.restart = mock.Mock()
        return m

    def test_only_changes_ffmpeg_uses_restart_it(self):
        m = self.make()
        a = {"id": "a", "platform": "twitch", "name": "Main", "url": "rtmp://x/app", "key": "••••", "on": True}
        m.set({"targets": [a]})   # (rename)
        m.set({"targets": [a, {"platform": "kick", "key": "", "on": False}]})   # (+ Platform)
        self.assertEqual(m.restart.call_count, 0)
        m.set({"targets": [{**a, "key": "k2"}]})
        m.set({"targets": [{**a, "key": "••••"}], "port": 1936})
        self.assertEqual(m.restart.call_count, 2)

    def test_a_replaced_run_never_starts_ffmpeg(self):
        m = self.make()
        m.gen = 5
        with mock.patch.object(stream, "ffmpeg", return_value="ffmpeg"), mock.patch.object(stream.subprocess, "Popen") as popen:
            m._run(4)
        popen.assert_not_called()

    def test_listens_on_this_pc_unless_the_network_is_on(self):
        d = folder(self)
        with mock.patch.dict(os.environ, {"SGFX_LAN": ""}):
            self.assertEqual(stream.listen_host(d), "127.0.0.1")
            Path(d, "settings.json").write_text(json.dumps({"network": True}))
            self.assertEqual(stream.listen_host(d), "0.0.0.0")

    def test_sharing_change_relistens_unless_live(self):
        m = self.make()
        m.status["state"] = "waiting"
        m.relisten()
        m.status["state"] = "live"
        m.relisten()
        self.assertEqual(m.restart.call_count, 1)

    def test_waiting_says_this_pc_only(self):
        m = self.make()
        m.gen = 1
        proc = mock.Mock(stderr=mock.Mock(read=lambda n: b""))
        proc.wait = lambda: setattr(m, "proc", None)
        seen = []
        m._set = lambda state, detail, kbps=0: seen.append(detail)
        with mock.patch.dict(os.environ, {"SGFX_LAN": ""}), mock.patch.object(stream, "ffmpeg", return_value="ffmpeg"),                 mock.patch.object(stream.subprocess, "Popen", return_value=proc):
            m._run(1)
        self.assertIn("rtmp://127.0.0.1:1935/live", seen[0])


class Exit(unittest.TestCase):
    def test_cleanup_runs_before_the_update_exits(self):
        done = []
        with mock.patch.object(updater, "before_exit", [lambda: done.append("a"), lambda: 1 / 0, lambda: done.append("b")]), \
                mock.patch.object(updater.os, "_exit", side_effect=lambda c: done.append(c)), mock.patch.object(updater, "log"):
            updater.exit_now()
        self.assertEqual(done, ["a", "b", 0])

    @unittest.skipUnless(os.name == "nt", "Windows mutex")
    def test_a_second_copy_on_the_same_data_folder_is_refused(self):
        d = Path(folder(self))
        self.assertTrue(app.one_instance(d))
        self.assertIsNone(app.one_instance(d))
        self.assertTrue(app.one_instance(d / "other"))


class WrongPassword(unittest.TestCase):
    def test_close_4009_says_wrong_password_and_stops_retrying(self):
        srv = socket.socket()
        srv.bind(("127.0.0.1", 0))
        srv.listen(2)
        self.addCleanup(srv.close)
        tries = []

        def serve():
            while True:
                try:
                    conn, _ = srv.accept()
                except OSError:
                    return
                tries.append(1)
                req = conn.recv(4096).decode()
                key = [l.split(": ")[1] for l in req.split("\r\n") if l.lower().startswith("sec-websocket-key")][0]
                acc = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
                conn.sendall(f"HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {acc}\r\n\r\n".encode())
                conn.sendall(frame({"op": 0, "d": {"rpcVersion": 1, "authentication": {"salt": "s", "challenge": "c"}}}))
                read_frame(conn)
                conn.sendall(bytes([0x88, 2]) + struct.pack(">H", 4009))
                conn.close()
        threading.Thread(target=serve, daemon=True).start()
        o = OBS(folder(self))
        o.save({"host": "127.0.0.1", "port": srv.getsockname()[1], "password": "nope", "on": True})
        for _ in range(50):
            if o.status["state"] == "error":
                break
            time.sleep(0.1)
        self.assertTrue(o.status["detail"].startswith("Wrong password"), o.status["detail"])
        time.sleep(0.3)
        self.assertFalse([t for t in threading.enumerate() if getattr(t, "_target", None) == o._run])   # (ended, not waiting to retry)
        self.assertEqual(len(tries), 1)
        o.stop()


if __name__ == "__main__":
    unittest.main()
