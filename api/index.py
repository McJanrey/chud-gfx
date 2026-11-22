"""StandBy Live on Vercel: the StandBy GFX engine as one Python function (Vercel runs `handler`, our own
request handler, for the requests that need data; the page files in web/ are served straight from Vercel's CDN).
Documents live in Supabase (SGFX_STORE=supabase); the show is SGFX_SHOW. The engine is made on the first request
that needs it, once per server instance, and reads the show back whenever another instance changed it."""
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("SGFX_STORE", "supabase")

from sgfx.server import Engine, handler as _handler  # noqa: E402
from sgfx.store import SupabaseStore  # noqa: E402


class _Lazy:
    """The engine, made on first use: a request that never needs it (a missing file) never opens the database."""
    _engine = None

    def __getattr__(self, name):
        if _Lazy._engine is None:
            _Lazy._engine = Engine(os.path.join("/tmp", "shows", os.environ.get("SGFX_SHOW", "chud")))
        return getattr(_Lazy._engine, name)


_Base = _handler(_Lazy())


class handler(_Base):
    """Each request closes its database connection when done: an idle server instance holds none (the pooler
    allows a few hundred, shared with Standby's own database)."""
    def do_GET(self):
        if self.path.startswith("/assets/"):   # (the show's own files aren't on the website yet: no database for a 404)
            return self._send(404, b"not found", "text/plain")
        try:
            return super().do_GET()
        finally:
            SupabaseStore.close()

    def do_POST(self):
        try:
            return super().do_POST()
        finally:
            SupabaseStore.close()
