"""Multistream, built in: one RTMP input from OBS sent on to every platform.

Its code, page and programs (MediaMTX, FFmpeg) are in apps/multistream; it runs in this
process on its own port and is switched on and off from the Stream page."""
import importlib
import os
import sys
import threading

from . import config
from .log import log

PORT = 7795


def _root():
    return os.path.join(config.RESOURCE_DIR, "apps", "multistream")


class StreamPart:
    def __init__(self):
        self.app = None
        self.error = ""
        self.lock = threading.Lock()

    def _mod(self):
        root = _root()
        if root not in sys.path:
            sys.path.insert(0, root)
        return importlib.import_module("multistream.app")

    def start(self):
        with self.lock:
            if self.app:
                return
            try:
                mod = self._mod()
                app = mod.StreamApp()
                mod.start(app, PORT)
                self.app, self.error = app, ""
            except Exception as e:   # port taken, files missing: say why on the Stream page
                self.error = f"{type(e).__name__}: {e}"
                log(f"Multistream didn't start: {self.error}")

    def stop(self):
        with self.lock:
            app, self.app = self.app, None
            if app:
                try:
                    self._mod().stop(app)
                except Exception as e:
                    log(f"Multistream didn't stop cleanly: {e}")

    def state(self):
        return {"running": bool(self.app), "error": self.error, "port": PORT}
