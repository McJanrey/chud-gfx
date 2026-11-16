"""The error log: standby-gfx.log next to the app (or in %LOCALAPPDATA%/StandBy GFX run from source).

Everything that goes wrong lands here with its full traceback: engine errors, crashes in background threads,
and errors from the pages (Control, the outputs in OBS / vMix), which send theirs to /api/log.
Kept small: 1 MB a file, the last 3 files. Show check > Error log shows the newest lines.
"""
import collections
import logging
import logging.handlers
import os
import sys
import threading
import time

log = logging.getLogger("sgfx")
recent = collections.deque(maxlen=200)   # (time, text) of the latest errors, for Show check
path = None


class _Recent(logging.Handler):
    def emit(self, record):
        if record.levelno >= logging.ERROR:
            recent.append((record.created, record.getMessage().splitlines()[0][:300] if record.getMessage() else ""))


def setup(folder):
    """Log to <folder>/standby-gfx.log; uncaught errors anywhere (main thread or not) go there too."""
    global path
    path = os.path.normpath(os.path.join(folder, "standby-gfx.log"))
    fh = logging.handlers.RotatingFileHandler(path, maxBytes=1 << 20, backupCount=3, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(threadName)s: %(message)s"))
    log.setLevel(logging.INFO)
    log.addHandler(fh)
    log.addHandler(_Recent())
    sys.excepthook = lambda t, e, tb: log.critical("Crash", exc_info=(t, e, tb))
    threading.excepthook = lambda a: log.error("Thread %s stopped", a.thread and a.thread.name, exc_info=(a.exc_type, a.exc_value, a.exc_traceback))
    return path


def page_error(body, client=""):
    """An error from a page: {page, msg, src, line, stack}."""
    b = body if isinstance(body, dict) else {}
    cut = lambda k, n: str(b.get(k) or "")[:n]
    log.error("Page %s%s: %s%s%s", cut("page", 80), f" ({client})" if client else "", cut("msg", 500),
              f" at {cut('src', 200)}:{cut('line', 12)}" if b.get("src") else "", ("\n" + cut("stack", 3000)) if b.get("stack") else "")


def tail(lines=300):
    """The newest lines of the log (oldest first)."""
    if not path or not os.path.isfile(path):
        return "Nothing logged yet."
    with open(path, encoding="utf-8", errors="replace") as f:
        return "".join(collections.deque(f, maxlen=lines)) or "Nothing logged yet."


def errors_since(secs):
    t = time.time() - secs
    return [m for at, m in recent if at >= t]
