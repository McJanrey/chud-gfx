"""Where a workspace's documents live: files on this PC (the desktop app) or a database (the website, later).

Every JSON document the engine keeps (project.json, live.json, the saved maps / games, teams, run of show) goes
through read_json / write_json with its path inside the workspace, so the engine never needs to know which one.
`files` (the default) is exactly what the desktop app always did: whole-file writes through a .tmp and an atomic
rename. The web backend (Supabase) is chosen with the environment variable SGFX_STORE=supabase.
"""
import json
import os


class FileStore:
    """Documents as files under one folder (the open workspace)."""
    kind = "files"

    def __init__(self, folder):
        self.folder = folder

    def _path(self, rel):
        path = os.path.normpath(os.path.join(self.folder, rel))
        if os.path.commonpath([os.path.abspath(path), os.path.abspath(self.folder)]) != os.path.abspath(self.folder):
            raise ValueError("Outside the workspace")
        return path

    def read_json(self, rel, default=None):
        try:
            with open(self._path(rel), encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return default

    def write_json(self, rel, data, indent=1):
        path = self._path(rel)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            json.dump(data, f, indent=indent)
        os.replace(path + ".tmp", path)

    def put_aside(self, rel):
        """Keeps a document under a dated name (a new series: the old one is kept, not deleted)."""
        import time
        path = self._path(rel)
        if os.path.isfile(path):
            os.replace(path, path[:-5] + time.strftime("-%Y%m%d-%H%M%S") + ".json")

    def exists(self, rel):
        return os.path.isfile(self._path(rel))


def open_store(folder):
    """The store for a workspace: files unless SGFX_STORE says otherwise (only files exists so far)."""
    kind = os.environ.get("SGFX_STORE", "files")
    if kind != "files":
        raise ValueError(f"Storage backend {kind!r} isn't available yet")
    return FileStore(folder)
