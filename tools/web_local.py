"""Runs the website version (api/index.py) on this PC, against the database: python tools/web_local.py [port]"""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for line in open(os.path.join(ROOT, ".env.local"), encoding="utf-8").read().split():
    k, _, v = line.partition("=")
    if k.startswith("SGFX_"):
        os.environ.setdefault(k, v)
sys.path.insert(0, os.path.join(ROOT, "api"))
from http.server import ThreadingHTTPServer  # noqa: E402
import index  # noqa: E402

port = int(sys.argv[1]) if len(sys.argv) > 1 else 7830
print(f"StandBy Live (local) on http://127.0.0.1:{port}", flush=True)
ThreadingHTTPServer(("127.0.0.1", port), index.handler).serve_forever()
