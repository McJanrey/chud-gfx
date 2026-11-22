"""Copies a workspace into the website's database as a show (StandBy Live).

    python tools/push_show.py <workspace folder> <show id> [library folder]

Reads the database login from .env.local. Writes project.json, live.json, the saved games / maps, and the
shared teams and run of show (from the library when given). Pictures and other files are not copied yet.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
for line in open(os.path.join(os.path.dirname(__file__), "..", ".env.local"), encoding="utf-8").read().split():
    k, _, v = line.partition("=")
    if k.startswith("SGFX_DB_"):
        os.environ.setdefault(k, v)

from sgfx.store import FileStore, SupabaseStore  # noqa: E402

ws, show = sys.argv[1], sys.argv[2]
lib = sys.argv[3] if len(sys.argv) > 3 else ws
src, shared, dst = FileStore(ws), FileStore(lib), SupabaseStore(show)
for rel, store in [("project.json", src), ("live.json", src), ("lol-games.json", src), ("val-maps.json", src), ("rl-games.json", src),
                   ("teams.json", shared), ("run-of-show.json", shared)]:
    doc = store.read_json(rel)
    if doc is not None:
        dst.write_json(rel, doc)
        print("copied", rel)
