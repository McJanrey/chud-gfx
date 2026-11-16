import argparse

from .server import serve

p = argparse.ArgumentParser(prog="sgfx", description="StandBy GFX engine")
p.add_argument("--workspace", required=True)
p.add_argument("--library")
p.add_argument("--port", type=int, default=7800)
a = p.parse_args()
serve(a.workspace, a.library, a.port)
