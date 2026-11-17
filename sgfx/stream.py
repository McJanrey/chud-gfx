"""Multistream: OBS streams once to this PC (rtmp://<this pc>:1935/live), FFmpeg copies it to every
platform turned on, without re-encoding. Settings in <library>/stream.json; stream keys stay in that file
and only their last 4 characters are ever sent to a page.
"""
import json
import os
import re
import shutil
import subprocess
import threading
import time

PLATFORMS = {"twitch": ("Twitch", "rtmp://live.twitch.tv/app"), "youtube": ("YouTube", "rtmp://a.rtmp.youtube.com/live2"),
             "kick": ("Kick", "rtmps://fa723fc1b171.global-contribute.live-video.net/app"), "facebook": ("Facebook", "rtmps://live-api-s.facebook.com:443/rtmp"),
             "x": ("X", "rtmp://va.pscp.tv:80/x"), "custom": ("Custom", "")}


def ffmpeg():
    path = shutil.which("ffmpeg")
    if path:
        return path
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return None


def tee_targets(targets):
    """The tee muxer's output list; one platform failing doesn't stop the others."""
    outs = []
    for t in targets:
        if t.get("on") and t.get("url") and t.get("key"):
            url = t["url"].rstrip("/") + "/" + t["key"]
            outs.append("[f=flv:onfail=ignore]" + url.replace("|", "%7C").replace("[", "%5B").replace("]", "%5D"))
    return "|".join(outs)


def listen_host(folder):
    """This PC only unless 'Let other PCs use this engine' is on (Net's <library>/settings.json): ffmpeg takes
    any stream key, so anyone on a venue LAN could otherwise send video out on these channels."""
    try:
        with open(os.path.join(folder, "settings.json"), encoding="utf-8") as f:
            net = json.load(f)
    except (OSError, ValueError):
        net = {}
    return "0.0.0.0" if net.get("network", bool(os.environ.get("SGFX_LAN"))) else "127.0.0.1"


class Multistream:
    def __init__(self, folder):
        self.path = os.path.join(folder, "stream.json")
        try:
            with open(self.path, encoding="utf-8") as f:
                self.cfg = json.load(f)
        except (OSError, ValueError):
            self.cfg = {}
        self.cfg.setdefault("on", False)
        self.cfg.setdefault("port", 1935)
        self.cfg.setdefault("targets", [])
        self.proc, self.status, self.lock = None, {"state": "off", "detail": "", "since": 0, "kbps": 0}, threading.Lock()
        self.gen = 0   # (bumped by start and stop: an older _run sees it and ends instead of starting a second ffmpeg)
        self.on_change = lambda: None
        if self.cfg["on"]:
            self.start()

    def _save(self):
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        with open(self.path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(self.cfg, f, indent=1)
        os.replace(self.path + ".tmp", self.path)

    def public(self):
        return {"on": self.cfg["on"], "port": self.cfg["port"], "status": dict(self.status), "ffmpeg": bool(ffmpeg()),
                "platforms": [[k, n, u] for k, (n, u) in PLATFORMS.items()],
                "targets": [{**{k: v for k, v in t.items() if k != "key"}, "key": ("••••" + t["key"][-4:]) if t.get("key") else ""} for t in self.cfg["targets"]]}

    def set(self, body):
        old = {t["id"]: t for t in self.cfg["targets"]}
        targets = []
        for t in body.get("targets") or []:
            if not isinstance(t, dict):
                continue
            tid = t.get("id") or "t" + os.urandom(4).hex()
            key = str(t.get("key") or "")
            if key.startswith("••••"):   # (unchanged: the page only has the masked one)
                key = old.get(tid, {}).get("key", "")
            url = str(t.get("url") or "").strip()
            if url and not re.match(r"rtmps?://", url):
                raise ValueError("A server address starts with rtmp:// or rtmps://")
            targets.append({"id": tid, "platform": str(t.get("platform", "custom")), "name": str(t.get("name", ""))[:40], "url": url, "key": key.strip(), "on": bool(t.get("on"))})
        before = (tee_targets(self.cfg["targets"]), self.cfg["port"])
        self.cfg["targets"] = targets
        if "port" in body:
            self.cfg["port"] = max(1024, min(65535, int(body["port"] or 1935)))
        self._save()
        if self.cfg["on"] and (tee_targets(targets), self.cfg["port"]) != before:   # (a restart drops OBS and every platform: only when ffmpeg's command changes)
            self.restart()

    def turn(self, on):
        self.cfg["on"] = bool(on)
        self._save()
        self.restart() if on else self.stop()

    def restart(self):
        self.stop()
        self.start()

    def relisten(self):
        """'Let other PCs use this engine' changed: listen on the new address now (not while live: the next
        OBS reconnect picks it up, since _run reads it each time)."""
        if self.cfg["on"] and self.status.get("state") != "live":
            self.restart()

    def stop(self):
        with self.lock:
            p, self.proc = self.proc, None
            self.gen += 1
        if p and p.poll() is None:
            p.terminate()
            try:
                p.wait(5)
            except subprocess.TimeoutExpired:
                p.kill()
        self._set("off", "")

    def start(self):
        with self.lock:
            self.gen += 1
            gen = self.gen
        threading.Thread(target=self._run, args=(gen,), daemon=True).start()

    def _set(self, state, detail, kbps=0):
        self.status = {"state": state, "detail": detail, "since": time.time() if state != self.status.get("state") else self.status.get("since", 0), "kbps": kbps}
        self.on_change()

    def _run(self, gen):
        """Wait for OBS, copy to the platforms, and wait again when OBS stops."""
        exe = ffmpeg()
        if not exe:
            return self._set("error", "FFmpeg isn't installed on this PC")
        while self.cfg["on"]:
            outs = tee_targets(self.cfg["targets"])
            if not outs:
                return self._set("error", "Turn on at least one platform with its stream key")
            host = listen_host(os.path.dirname(self.path))
            cmd = [exe, "-hide_banner", "-loglevel", "info", "-stats", "-listen", "1", "-i", f"rtmp://{host}:{self.cfg['port']}/live",
                   "-map", "0", "-c", "copy", "-f", "tee", outs]
            flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            with self.lock:
                if not self.cfg["on"] or gen != self.gen:
                    return
                self.proc = subprocess.Popen(cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=flags)
                proc = self.proc
            # (say where: OBS on another PC is refused until Outputs > Network lets other PCs in)
            self._set("waiting", "Waiting for OBS" if host == "0.0.0.0" else f"Waiting for OBS on this PC (rtmp://127.0.0.1:{self.cfg['port']}/live)")
            buf = b""
            while True:
                ch = proc.stderr.read(1)
                if not ch:
                    break
                if ch not in b"\r\n":
                    buf += ch
                    continue
                line = buf.decode("utf-8", "replace")
                buf = b""
                if line.startswith("Input #0"):
                    self._set("live", "Sending to " + ", ".join(t["name"] or t["platform"] for t in self.cfg["targets"] if t.get("on")))
                m = re.search(r"bitrate=\s*([\d.]+)kbits/s", line)
                if m and self.status["state"] == "live":
                    self._set("live", "Sending to " + ", ".join(t["name"] or t["platform"] for t in self.cfg["targets"] if t.get("on")), round(float(m.group(1))))
                elif re.search(r"(?i)error|failed|refused", line) and "onfail" not in line:
                    for t in self.cfg["targets"]:   # (never show a stream key)
                        if t.get("key"):
                            line = line.replace(t["key"], "••••")
                    self.status["detail"] = line[-160:]
            proc.wait()
            with self.lock:
                if self.proc is not proc:
                    return
            time.sleep(1)   # (OBS stopped: listen again)
