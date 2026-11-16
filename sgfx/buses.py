"""Preview and Program (Spec 01 section 5). Pure state: no files, no threads.

    Buses(kinds) where kinds() -> {comp id: "board" | "lower third" | "overlay"}
    state = {"preview": Bus, "program": Bus}, Bus = {"on": [ids], "values": {id: {field: value}}, "seq": n}
"""

import copy

SINGLE = ("board", "lower third")   # one of each per bus; overlays stack


class Buses:
    def __init__(self, kinds, state=None):
        self._kinds = kinds
        self.state = {b: {"on": [], "values": {}, "seq": 0} for b in ("preview", "program")}
        for b, saved in (state or {}).items():
            if b in self.state and isinstance(saved, dict):
                self.state[b]["on"] = [i for i in saved.get("on", []) if isinstance(i, str)]
                self.state[b]["values"] = dict(saved.get("values") or {})
        self._undo = None
        self.cut = {"seq": 0, "transition": {"type": "cut"}, "only": None}   # what the outputs play next

    # --- helpers ---------------------------------------------------------------
    def _kind(self, cid):
        return self._kinds().get(cid) or "overlay"

    def _add(self, on, ids):
        """on with ids added; an incoming board / lower third pushes out the one already there."""
        out = list(on)
        for cid in ids:
            k = self._kind(cid)
            if k in SINGLE:
                out = [i for i in out if self._kind(i) != k]
            if cid not in out:
                out.append(cid)
        return out

    def _bump(self, *buses):
        for b in buses:
            self.state[b]["seq"] += 1

    def _played(self, transition, only=None):
        self.cut = {"seq": self.cut["seq"] + 1, "transition": copy.deepcopy(transition), "only": only,
                    "undo": self._undo is not None}

    def _snapshot(self):
        self._undo = copy.deepcopy({b: {"on": s["on"], "values": s["values"]} for b, s in self.state.items()})

    # --- Preview ---------------------------------------------------------------
    def cue(self, cid, on=True):
        pv = self.state["preview"]
        pv["on"] = self._add(pv["on"], [cid]) if on else [i for i in pv["on"] if i != cid]
        self._bump("preview")

    def set_values(self, cid, values, bus="preview"):
        for b in (("preview", "program") if bus == "both" else (bus,)):
            vals = self.state[b]["values"].setdefault(cid, {})
            for k, v in values.items():
                if v is None:
                    vals.pop(k, None)
                else:
                    vals[str(k)] = v
            self._bump(b)

    def send_values(self, cid):
        self.state["program"]["values"][cid] = copy.deepcopy(self.state["preview"]["values"].get(cid, {}))
        self._bump("program")

    # --- Program ---------------------------------------------------------------
    def take(self, transition):
        pv, pg = self.state["preview"], self.state["program"]
        incoming = list(pv["on"])
        if not incoming:
            return False
        self._snapshot()
        before = pg["on"]
        pg["on"] = self._add(before, incoming)
        swapped = [i for i in before if i not in pg["on"] and self._kind(i) == "board"]
        for cid in swapped:
            pv["values"][cid] = copy.deepcopy(pg["values"].get(cid, {}))
        for cid in incoming:
            pg["values"][cid] = copy.deepcopy(pv["values"].get(cid, {}))
        pv["on"] = swapped
        self._bump("preview", "program")
        self._played(transition)
        return True

    def program(self, cid, on, transition=None):
        pg, pv = self.state["program"], self.state["preview"]
        if on:
            pg["on"] = self._add(pg["on"], [cid])
            if cid in pv["values"]:
                pg["values"][cid] = copy.deepcopy(pv["values"][cid])
            if cid in pv["on"]:
                pv["on"].remove(cid)
                self._bump("preview")
        else:
            pg["on"] = [i for i in pg["on"] if i != cid]
        self._bump("program")
        self._played(transition or {"type": "animate"}, [cid])

    def clear(self, bus="program", transition=None):
        if bus == "program" and self.state["program"]["on"]:
            self._snapshot()
        self.state[bus]["on"] = []
        self._bump(bus)
        if bus == "program":
            self._played(transition or {"type": "animate"})

    def undo(self):
        if not self._undo:
            return False
        for b, s in self._undo.items():
            self.state[b]["on"], self.state[b]["values"] = s["on"], s["values"]
        self._undo = None
        self._bump("preview", "program")
        self._played({"type": "cut"})
        return True

    def forget(self, cid):
        for s in self.state.values():
            if cid in s["on"]:
                s["on"].remove(cid)
            s["values"].pop(cid, None)

    def saved(self):
        return {b: {"on": s["on"], "values": s["values"]} for b, s in self.state.items()}
