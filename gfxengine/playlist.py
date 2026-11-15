"""Playlists: graphics played one after another on Program by themselves, like
an ad rotation but for whole graphics. Each item stays on for its seconds, then
goes out as the next comes in; at the end it loops or stops.

    project["playlists"] = [{"id", "name", "loop": True,
                             "items": [{"comp": graphic id, "secs": 10}]}]

Only one plays at a time. Its state lives here, not in the project:
{"id", "index", "until" (when the item ends), "comp" (the graphic on air)}.
"""
import threading
import time

from .project import new_id


def clean(playlists, comp_ids):
    out = []
    for p in playlists if isinstance(playlists, list) else []:
        if not isinstance(p, dict):
            continue
        items = []
        for it in p.get("items") or []:
            try:
                secs = max(1.0, min(3600.0, float(it.get("secs") or 10)))
            except (TypeError, ValueError, AttributeError):
                continue
            if it.get("comp") in comp_ids:
                items.append({"comp": it["comp"], "secs": secs})
        out.append({"id": str(p.get("id") or new_id("p"))[:20], "name": str(p.get("name") or "Playlist").strip()[:60] or "Playlist",
                    "loop": p.get("loop") is not False, "items": items})
    return out


class Player:
    def __init__(self, ws, live, on_change=lambda: None, clock=time.time):
        self.ws, self.live, self.on_change, self.clock = ws, live, on_change, clock
        self.lock = threading.RLock()
        self.state = None
        self._stop = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()

    def close(self):
        self._stop.set()

    def get(self):
        with self.lock:
            # (with the engine's clock, so a page on another PC can count down right)
            return {**self.state, "now": self.clock()} if self.state else None

    def _list(self, pid):
        return next((p for p in self.ws.get().get("playlists") or [] if p["id"] == pid), None)

    def play(self, pid, index=0):
        p = self._list(pid)
        if not p or not p["items"]:
            raise ValueError("That playlist has no graphics in it")
        with self.lock:
            index = max(0, min(int(index or 0), len(p["items"]) - 1))
            self._show(p, index)

    def step(self, by=1):
        with self.lock:
            if not self.state:
                raise ValueError("No playlist is playing")
            p = self._list(self.state["id"])
            if not p or not p["items"]:
                return self.stop()
            n = len(p["items"])
            i = self.state["index"] + by
            if i >= n and not p["loop"] and by > 0:
                return self.stop()
            self._show(p, i % n)

    def stop(self, take_off=True):
        with self.lock:
            st, self.state = self.state, None
        if st and take_off and st.get("comp"):
            try:
                self.live.program(st["comp"], False)
            except KeyError:
                pass
        self.on_change()

    def _show(self, p, index):
        item = p["items"][index]
        off = self.state.get("comp") if self.state else None
        if off != item["comp"]:
            self.live.swap(off, item["comp"])
        self.state = {"id": p["id"], "name": p["name"], "index": index, "count": len(p["items"]),
                      "comp": item["comp"], "until": self.clock() + item["secs"]}
        self.on_change()

    def tick(self):
        with self.lock:
            st = self.state
            if not st:
                return
            # Taken off air by hand (OUT, Clear Program): the playlist stops too.
            if st["comp"] not in self.live.get()["program"]["on"]:
                self.state = None
                self.on_change()
                return
            if self.clock() >= st["until"]:
                self.step(1)

    def _run(self):
        while not self._stop.wait(0.25):
            try:
                self.tick()
            except Exception:   # a graphic deleted mid-play, say: stop rather than loop on the error
                with self.lock:
                    self.state = None
                self.on_change()
