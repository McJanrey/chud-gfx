"""HUD Builder, built in: design a game HUD visually, fed by this engine's data.

Its code and page are in apps/hudbuilder; it runs in this process on its own port and is
switched on and off from the HUD Builder page."""
import argparse
import importlib
import os
import sys
import threading

from . import config
from .log import log

PORT = 7800


def _root():
    return os.path.join(config.RESOURCE_DIR, "apps", "hudbuilder")


class BuilderPart:
    def __init__(self):
        self.app = None
        self.error = ""
        self.lock = threading.Lock()

    def _import(self, name):
        root = _root()
        if root not in sys.path:
            sys.path.insert(0, root)
        return importlib.import_module(name)

    def start(self):
        with self.lock:
            if self.app:
                return
            try:
                main = self._import("hudbuilder.__main__")
                parser = argparse.ArgumentParser()
                main.add_arguments(parser)
                app = main.build_app(parser.parse_args(["--port", str(PORT)]))
                self._import("hudbuilder.app").start(app)
                self.app, self.error = app, ""
            except Exception as e:   # port taken, files missing: say why on the page
                self.error = f"{type(e).__name__}: {e}"
                log(f"HUD Builder didn't start: {self.error}")

    def stop(self):
        with self.lock:
            app, self.app = self.app, None
            if app:
                try:
                    app.stop()
                except Exception as e:
                    log(f"HUD Builder didn't stop cleanly: {e}")

    def state(self):
        return {"running": bool(self.app), "error": self.error, "port": PORT}
