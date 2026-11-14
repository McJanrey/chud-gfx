"""Chud Hud as a data source: find the Chud Hud editions running on this PC and their events.
Each event's live fields are already served by Chud Hud as flat JSON at /hud.json?event=<id>,
which the engine reads like any web-address source ({{Chud Hud!Field}})."""
import json
import urllib.request

# Each edition's control-room port (Chud Hud's variant.js); all three can run at once.
EDITIONS = (("Chud Hud", 7777), ("Chud Hud LOTD", 7787), ("Chud Hud WWL", 7767))


def _state(port, timeout):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/state", timeout=timeout) as r:
        return json.loads(r.read())


def find(timeout=0.8, fetch=_state):
    """[{edition, port, events: [{id, name, game}]}] for every edition that answers. Closed ones are skipped."""
    found = []
    for edition, port in EDITIONS:
        try:
            st = fetch(port, timeout)
        except Exception:   # not running, or an older build: just not listed
            continue
        events = [{"id": e.get("id"), "name": e.get("name") or e.get("id"), "game": e.get("game", "")}
                  for e in (st.get("db") or {}).get("events", []) if e.get("id")]
        found.append({"edition": edition, "port": port, "events": events})
    return found


def source_for(edition, port, event_id, name=None):
    """A ready web-address source for one event, read every second like Chud Hud's own outputs."""
    return {"name": name or edition, "type": "url", "url": f"http://127.0.0.1:{port}/hud.json?event={event_id}",
            "path": "", "sheet": "", "refresh": 1}
