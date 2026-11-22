"""StandBy Live on Vercel: the StandBy GFX engine as one Python function (Vercel runs `handler`, our own
request handler, for every request). Documents live in Supabase (SGFX_STORE=supabase); the show is SGFX_SHOW.
The engine is made once per server instance and reads the show back whenever another instance changed it."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("SGFX_STORE", "supabase")

from sgfx.server import Engine, handler as _handler  # noqa: E402

engine = Engine(os.path.join("/tmp", "shows", os.environ.get("SGFX_SHOW", "chud")))


class handler(_handler(engine)):
    pass
