"""The app updates itself from its GitHub releases (the Albion app's way): the release's Setup installer is
downloaded and checked against GitHub's sha256, then run with only its progress window (no questions, no
console); it closes the app, installs over it (workspaces and library stay) and opens it again.
Only the installed (frozen) app updates.
"""
import hashlib
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import urllib.request
from pathlib import Path

from . import __version__

REPO = "McJanrey/chud-gfx"   # (it replaced GFX Baby there: same release files, so GFX Baby and the Hub update into it)
ASSET = "ChudGFX-windows.zip"   # (the Hub installs from this)
SETUP = "Chud-GFX-Baby-Setup.exe"   # (the app updates itself with this)
EXE = "ChudGFX.exe"
log = logging.getLogger("sgfx")
_token = None
before_exit = []   # (app.main's cleanup: install() ends with os._exit, which skips finally blocks)


def parse(v):
    nums = re.findall(r"\d+", (v or "").lstrip("vV"))
    return tuple(int(n) for n in nums[:3]) if nums else None


def newer(latest, installed):
    lt, it = parse(latest), parse(installed)
    return lt is not None and (it is None or lt > it)


def token():
    """A GitHub login for a private repo: GH_TOKEN / GITHUB_TOKEN, else the GitHub CLI's. None = public only."""
    global _token
    if _token is None:
        _token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
        if not _token:
            try:
                _token = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10, creationflags=0x08000000).stdout.strip()
            except (OSError, subprocess.SubprocessError):
                _token = ""
    return _token or None


def _request(url, accept="application/vnd.github+json"):
    req = urllib.request.Request(url, headers={"User-Agent": "standby-gfx", "Accept": accept})
    if token() and url.startswith("https://api.github.com/"):
        req.add_unredirected_header("Authorization", "Bearer " + token())   # (never sent on to the storage link)
    return req


def check():
    with urllib.request.urlopen(_request(f"https://api.github.com/repos/{REPO}/releases/latest"), timeout=20) as r:
        rel = json.loads(r.read())
    z = next((a for a in rel.get("assets", []) if a.get("name") == SETUP), None)
    latest = (rel.get("tag_name") or "").lstrip("v")
    digest = (z or {}).get("digest") or ""
    return {"current": __version__, "version": latest, "update": bool(z) and newer(latest, __version__),
            "url": z and (z.get("url") or z["browser_download_url"]), "size": z and z.get("size"),
            "checksum": digest.split(":", 1)[1] if digest.startswith("sha256:") else None}


def download(url, dest, expected, size=None, progress=None):
    if not expected:
        raise ValueError("the release has no checksum, so it was not downloaded")
    h, done, part = hashlib.sha256(), 0, dest + ".part"
    try:
        with urllib.request.urlopen(_request(url, "application/octet-stream"), timeout=60) as r, open(part, "wb") as f:
            total = size or int(r.headers.get("Content-Length") or 0)
            while chunk := r.read(1 << 16):
                f.write(chunk)
                h.update(chunk)
                done += len(chunk)
                if progress:
                    progress(done, total)
        if (size and done != size) or h.hexdigest() != expected.lower():
            raise ValueError("the download doesn't match the release, so it was not installed")
        os.replace(part, dest)
        return dest
    finally:
        if os.path.exists(part):
            os.remove(part)


def install(info, progress=None):
    if not getattr(sys, "frozen", False):
        raise ValueError("Only the installed app updates itself (this copy runs from source)")
    if not info or not info.get("update"):
        raise ValueError("No update")
    tmp = Path(tempfile.gettempdir(), "standby-gfx-update")
    tmp.mkdir(exist_ok=True)
    setup = download(info["url"], str(tmp / f"Chud-GFX-Baby-Setup-{info['version']}.exe"), info["checksum"], info.get("size"), progress)
    args = [setup, "/SILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS", "/NOCANCEL", f"/DIR={Path(sys.executable).parent}"]
    try:   # (out of Windows' job object, so it outlives the app)
        subprocess.Popen(args, creationflags=0x08 | 0x200 | 0x01000000, close_fds=True)
    except OSError:
        subprocess.Popen(args, creationflags=0x08 | 0x200, close_fds=True)
    threading.Timer(1.0, exit_now).start()   # (let the page get its answer first; the installer reopens the app)


def exit_now():
    for f in before_exit:
        try:
            f()
        except Exception:
            log.exception("Cleanup before the update failed")
    os._exit(0)
