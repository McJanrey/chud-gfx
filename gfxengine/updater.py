"""Self-update for the desktop app, from GitHub releases.

On launch the app asks GitHub for the latest release of this repository.
If it's newer than the running copy, the control panel offers it. Installing
downloads the release zip (checking its SHA-256 when GitHub provides one),
unpacks it next to the app, then hands over to a small script that waits
for the app to close, copies the new files in (leaving settings.json and
the workspace alone) and starts the new version.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import zipfile

from .config import DATA_DIR, FROZEN
from .log import log
from .version import VERSION

REPO = "McJanrey/chud-gfx"
LATEST_URL = f"https://api.github.com/repos/{REPO}/releases/latest"
_token = None


def github_token():
    """This PC's GitHub login for the private repo: GH_TOKEN / GITHUB_TOKEN, else the GitHub CLI's (gh auth token)."""
    global _token
    if _token is None:
        _token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN") or ""
        if not _token:
            try:
                _token = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10,
                                        creationflags=0x08000000 if os.name == "nt" else 0).stdout.strip()
            except (OSError, subprocess.SubprocessError):
                _token = ""
    return _token or None


def github_request(url, accept, user_agent):
    """The login goes only to api.github.com (unredirected): release files redirect to signed storage links."""
    req = urllib.request.Request(url, headers={"Accept": accept, "User-Agent": user_agent})
    if github_token() and url.startswith("https://api.github.com/"):
        req.add_unredirected_header("Authorization", "Bearer " + github_token())
    return req
ASSET_NAME = "ChudGFX-windows.zip"
UPDATE_DIR = os.path.join(DATA_DIR, "_update")


def parse_version(text):
    """"v1.0.12" -> (1, 0, 12). Anything unnumbered (a dev build) -> (0,)."""
    numbers = re.findall(r"\d+", text or "")
    return tuple(int(n) for n in numbers) if numbers and re.match(r"v?\d", text or "") else (0,)


def is_newer(latest, current):
    return parse_version(latest) > parse_version(current)


class Updater:
    def __init__(self):
        self.current = VERSION
        self.latest = None
        self.notes = ""
        self.asset = None
        self.status = "idle"      # idle, checking, downloading, installing, error
        self.check_error = None   # why the last check for updates failed
        self.progress = 0
        self.error = None
        # Only the packaged app can replace itself.
        self.can_install = FROZEN and sys.platform == "win32"
        self.on_exit = None       # set by the window, to close it for the restart
        self.before_exit = None   # set by the engine: saves the workspace first
        self.work_dir = UPDATE_DIR
        self._etag = None         # GitHub answers 304 (free, no rate limit) while nothing's new
        self._lock = threading.Lock()

    def info(self):
        return {"current": self.current, "latest": self.latest, "notes": self.notes,
                "available": bool(self.latest and self.asset and is_newer(self.latest, self.current)),
                "can_install": self.can_install, "status": self.status,
                "progress": self.progress, "error": self.error, "check_error": self.check_error}

    # --- checking --------------------------------------------------------

    def check_in_background(self, every=0, on_change=None):
        """Checks now, and again every `every` seconds (so a new version is offered while the
        app stays open); on_change() after each check, for the pages."""
        def run():
            while True:
                if self.status not in ("downloading", "installing"):
                    was = self.info()
                    self.check()
                    if on_change and self.info() != was:
                        on_change()
                if not every:
                    return
                time.sleep(every)
        threading.Thread(target=run, daemon=True).start()

    def check(self):
        self.status, self.error, self.check_error = "checking", None, None
        try:
            request = github_request(LATEST_URL, "application/vnd.github+json", f"Chud-GFX/{self.current}")
            if self._etag:
                request.add_header("If-None-Match", self._etag)
            with urllib.request.urlopen(request, timeout=10) as r:
                release = json.loads(r.read().decode("utf-8"))
                etag = r.headers.get("ETag")
        except urllib.error.HTTPError as e:
            self.status = "idle"
            if e.code == 304:   # (same release as last time)
                return
            if e.code == 404:
                log("No releases published on GitHub yet")
            else:
                self.check_error = f"GitHub said {e.code}"
                log(f"Couldn't check for updates (GitHub said {e.code})", "warn")
            return
        except Exception as e:
            self.status = "idle"
            self.check_error = str(getattr(e, "reason", e))
            log(f"Couldn't check for updates ({self.check_error})", "warn")
            return
        self.latest = release.get("tag_name")
        self.notes = (release.get("body") or "").strip()
        self.asset = next((a for a in release.get("assets", []) if a.get("name") == ASSET_NAME), None)
        self._etag = etag if self.asset else None   # (no zip yet: CI still uploading, look again in full)
        self.status = "idle"
        if self.info()["available"]:
            log(f"Update available: {self.latest} (you have {self.current})")
        else:
            log(f"GFX Baby {self.current} is up to date")

    # --- installing ------------------------------------------------------

    def install_in_background(self):
        if not self.can_install:
            raise ValueError("Updates can only be installed in the desktop app")
        if not self.info()["available"]:
            raise ValueError("No update available")
        with self._lock:
            if self.status in ("downloading", "installing"):
                return
            self.status, self.progress, self.error = "downloading", 0, None
        threading.Thread(target=self._install, daemon=True).start()

    def _install(self):
        try:
            zip_path = self._download()
            self.status = "installing"
            new_dir = self._unpack(zip_path)
            script = self._write_script(new_dir)
            log(f"Installing {self.latest} - GFX Baby will restart")
            if self.before_exit:
                try:
                    self.before_exit()
                except Exception as e:   # (still update: the workspace saves itself every change anyway)
                    log(f"Couldn't save before the update: {e}", "warn")
            # Hidden console, own process group so it outlives the app.
            subprocess.Popen(["cmd", "/c", script], cwd=os.path.dirname(os.path.abspath(sys.executable)),
                             creationflags=0x08000000 | 0x00000200)
            (self.on_exit or (lambda: os._exit(0)))()
        except Exception as e:
            self.status, self.error = "error", f"{type(e).__name__}: {e}"
            log(f"Update failed: {self.error}", "error")

    def _download(self):
        # A fresh folder per attempt: a previous update's files can still be in
        # use (or locked) for a while, and must never block this one.
        os.makedirs(UPDATE_DIR, exist_ok=True)
        for old in os.listdir(UPDATE_DIR):
            shutil.rmtree(os.path.join(UPDATE_DIR, old), ignore_errors=True)
        self.work_dir = os.path.join(UPDATE_DIR, f"{self.latest}-{int(time.time())}")
        os.makedirs(self.work_dir)
        path = os.path.join(self.work_dir, ASSET_NAME)
        total = self.asset.get("size") or 0
        digest = hashlib.sha256()
        request = github_request(self.asset.get("url") or self.asset["browser_download_url"], "application/octet-stream",
                                 f"Chud-GFX/{self.current}")
        with urllib.request.urlopen(request, timeout=30) as r, open(path, "wb") as f:
            done = 0
            while True:
                chunk = r.read(256 * 1024)
                if not chunk:
                    break
                f.write(chunk)
                digest.update(chunk)
                done += len(chunk)
                if total:
                    self.progress = min(99, int(done * 100 / total))
        expected = (self.asset.get("digest") or "").removeprefix("sha256:")
        if not expected:
            raise ValueError("GitHub gave no checksum for this update, so it wasn't installed")
        if digest.hexdigest() != expected:
            raise ValueError("Download didn't match GitHub's checksum; try again")
        self.progress = 100
        return path

    def _unpack(self, zip_path):
        new_dir = os.path.join(self.work_dir, "new")
        with zipfile.ZipFile(zip_path) as z:
            for name in z.namelist():  # refuse paths that climb out of the folder
                target = os.path.normpath(os.path.join(new_dir, name))
                if not target.startswith(os.path.normpath(new_dir) + os.sep):
                    raise ValueError(f"Unexpected file in update: {name}")
            z.extractall(new_dir)
        if not os.path.isfile(os.path.join(new_dir, "ChudGFX.exe")):
            raise ValueError("The update doesn't contain ChudGFX.exe")
        return new_dir

    def _write_script(self, new_dir):
        app_dir = os.path.dirname(os.path.abspath(sys.executable))
        script = os.path.join(self.work_dir, "apply-update.bat")
        with open(script, "w", encoding="utf-8") as f:
            f.write(f"""@echo off
rem GFX Baby updater: waits for the app to close, copies in the new
rem version (settings and the workspace are left alone), then restarts it.
:wait
tasklist /FI "PID eq {os.getpid()}" 2>nul | find "{os.getpid()}" >nul && (ping -n 2 127.0.0.1 >nul & goto wait)
robocopy "{new_dir}\\_internal" "{app_dir}\\_internal" /MIR /R:3 /W:1 /NFL /NDL /NJH /NJS /NP >nul
robocopy "{new_dir}" "{app_dir}" /XD _internal workspace workspaces library _update /XF settings.json /R:3 /W:1 /NFL /NDL /NJH /NJS /NP >nul
start "" "{app_dir}\\ChudGFX.exe"
""")
        return script


def clean_up_old_update():
    """Remove the previous update's download once the new version is running.
    Waits a bit first: the script that just installed us may still be finishing."""
    def clean():
        time.sleep(30)
        shutil.rmtree(UPDATE_DIR, ignore_errors=True)
    if FROZEN and os.path.isdir(UPDATE_DIR):
        threading.Thread(target=clean, daemon=True).start()
