"""Video made web-ready in the background: .mov / .avi / .mkv (and .mp4 / .webm the browser can't play are
left alone) -> WebM VP9 keeping see-through parts when the video has them, otherwise MP4 (H.264).
A .zip of PNG frames (a PNG sequence) -> one see-through WebM at the chosen frame rate.
"""
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile

from .stream import ffmpeg

NEEDS = (".mov", ".avi", ".mkv", ".m4v", ".wmv", ".flv")
FLAGS = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def has_alpha(path):
    """Does the video carry see-through pixels? (its pixel format has an alpha channel)"""
    exe = ffmpeg()
    out = subprocess.run([exe, "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace", creationflags=FLAGS).stderr
    m = re.search(r"Video: [^\n]*?\b(yuva\w*|rgba\w*|argb|bgra|abgr|gbrap\w*|ya\d+\w*|pal8)\b", out)
    return bool(m) or re.search(r"alpha_mode\s*:\s*1", out) is not None


def duration(path):
    out = subprocess.run([ffmpeg(), "-hide_banner", "-i", path], capture_output=True, text=True, errors="replace", creationflags=FLAGS).stderr
    m = re.search(r"Duration: (\d+):(\d+):([\d.]+)", out)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3)) if m else 0


class Jobs:
    def __init__(self, on_change):
        self.jobs, self.on_change = {}, on_change

    def public(self):
        cut = time.time() - 600
        return [dict(j) for j in self.jobs.values() if j["state"] == "working" or j["at"] > cut]

    def add(self, name, run):
        jid = uuid.uuid4().hex[:8]
        self.jobs[jid] = {"id": jid, "name": name, "state": "working", "progress": 0, "detail": "", "at": time.time(), "result": ""}
        self.on_change()

        def go():
            j = self.jobs[jid]
            try:
                j["result"] = run(lambda p: self._progress(jid, p))
                j["state"], j["progress"] = "done", 100
            except Exception as e:
                j["state"], j["detail"] = "error", str(e)[:200]
            j["at"] = time.time()
            self.on_change()
        threading.Thread(target=go, daemon=True).start()
        return jid

    def _progress(self, jid, p):
        j = self.jobs[jid]
        if int(p) != j["progress"]:
            j["progress"] = int(p)
            self.on_change()


def _run(cmd, total, progress):
    exe = ffmpeg()
    if not exe:
        raise RuntimeError("FFmpeg isn't installed on this PC")
    p = subprocess.Popen([exe, "-hide_banner", "-y", *cmd], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, creationflags=FLAGS)
    buf, tail = b"", []
    while True:
        ch = p.stderr.read(1)
        if not ch:
            break
        if ch not in b"\r\n":
            buf += ch
            continue
        line = buf.decode("utf-8", "replace")
        buf = b""
        tail = (tail + [line])[-6:]
        m = re.search(r"time=(\d+):(\d+):([\d.]+)", line)
        if m and total:
            progress(min(99, (int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))) / total * 100))
    if p.wait() != 0:
        raise RuntimeError("FFmpeg couldn't convert it: " + " ".join(tail[-2:]))


def video(src, dst_stem, progress):
    """-> the output path (dst_stem + .webm or .mp4)."""
    total = duration(src)
    if has_alpha(src):
        dst = dst_stem + ".webm"
        _run(["-i", src, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4",
              "-auto-alt-ref", "0", "-c:a", "libopus", "-b:a", "160k", dst], total, progress)
    else:
        dst = dst_stem + ".mp4"
        _run(["-i", src, "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-c:a", "aac", "-b:a", "192k", dst], total, progress)
    return dst


def png_sequence(zip_bytes_path, dst_stem, fps, progress):
    """A zip of PNG frames (in name order) -> a see-through WebM."""
    tmp = tempfile.mkdtemp(prefix="sgfx-seq-")
    try:
        with zipfile.ZipFile(zip_bytes_path) as z:
            frames = sorted((n for n in z.namelist() if n.lower().endswith(".png") and not n.startswith("__MACOSX")),
                            key=lambda n: [int(t) if t.isdigit() else t.lower() for t in re.split(r"(\d+)", n)])
            if not frames:
                raise ValueError("No PNG frames in that zip")
            for i, n in enumerate(frames):
                with z.open(n) as f, open(os.path.join(tmp, f"{i:06d}.png"), "wb") as out:
                    shutil.copyfileobj(f, out)
        dst = dst_stem + ".webm"
        _run(["-framerate", str(fps), "-i", os.path.join(tmp, "%06d.png"), "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0", "-crf", "30",
              "-row-mt", "1", "-auto-alt-ref", "0", dst], len(frames) / float(fps), progress)
        return dst
    finally:
        shutil.rmtree(tmp, True)


def stinger_cut(path):
    """Milliseconds to the first frame that covers the whole screen (no see-through pixel left), or None."""
    exe = ffmpeg()
    if not exe:
        raise RuntimeError("FFmpeg isn't installed on this PC")
    dec = ["-c:v", "libvpx-vp9"] if path.lower().endswith(".webm") else []
    p = subprocess.run([exe, "-hide_banner", *dec, "-i", path, "-vf", "alphaextract,signalstats,metadata=print:key=lavfi.signalstats.YMIN", "-f", "null", "-"],
                       capture_output=True, text=True, errors="replace", creationflags=FLAGS)
    t = None
    for line in p.stderr.splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            t = float(m.group(1))
        m = re.search(r"YMIN=(\d+)", line)
        if m and t is not None and int(m.group(1)) >= 250:
            return round(t * 1000)
    return None
