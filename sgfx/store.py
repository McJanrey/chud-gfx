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


class StoreConflict(Exception):
    """Someone else saved the same document since it was read: read it again, then change it."""


class SupabaseStore:
    """Documents as rows of live.docs in Postgres (Supabase), one show per workspace (the website).

    Connects as the standby_live role, which can only reach the live schema, over TLS checked against
    Supabase's root certificate. Each document keeps a version: a write only lands on the version it read
    (two people saving at once: the second gets StoreConflict instead of silently undoing the first)."""
    kind = "supabase"
    _conn = None
    _lock = __import__("threading").Lock()   # (one connection, used by one request at a time: it isn't thread-safe)

    def __init__(self, show):
        self.show = str(show)
        self.versions = {}

    @classmethod
    def _db(cls):
        if cls._conn is None:
            import ssl
            import pg8000.native as pg
            ca = os.path.join(os.path.dirname(__file__), "certs", "supabase-ca.crt")
            cls._conn = pg.Connection(os.environ["SGFX_DB_USER"], password=os.environ["SGFX_DB_PASSWORD"],
                                      host=os.environ.get("SGFX_DB_HOST", "aws-1-us-east-1.pooler.supabase.com"), port=int(os.environ.get("SGFX_DB_PORT", "6543")),
                                      database="postgres", ssl_context=ssl.create_default_context(cafile=ca), timeout=15)
        return cls._conn

    @classmethod
    def _run(cls, sql, **params):
        with cls._lock:
            try:
                return cls._db().run(sql, **params)
            except Exception as e:
                if "connection" not in str(e).lower() and "network" not in str(e).lower() and not isinstance(e, (OSError, EOFError)):
                    raise
                cls._conn = None   # (a dropped connection: one fresh try)
                return cls._db().run(sql, **params)

    @staticmethod
    def _rel(rel):
        rel = str(rel).replace("\\", "/").lstrip("/")
        if not rel or ".." in rel.split("/"):
            raise ValueError("Outside the workspace")
        return rel

    def read_json(self, rel, default=None):
        rel = self._rel(rel)
        rows = self._run("select data::text, version from live.docs where show = :s and path = :p", s=self.show, p=rel)
        if not rows:
            self.versions.pop(rel, None)
            return default
        self.versions[rel] = rows[0][1]
        return json.loads(rows[0][0])

    def write_json(self, rel, data, indent=1):
        rel, text = self._rel(rel), json.dumps(data)
        known = self.versions.get(rel)
        if known is None:   # (never read here: written whole, as a file would be; only a read-then-write is checked)
            rows = self._run("insert into live.docs (show, path, data) values (:s, :p, cast(:d as jsonb)) "
                             "on conflict (show, path) do update set data = excluded.data, version = live.docs.version + 1, updated_at = now() returning version",
                             s=self.show, p=rel, d=text)
        else:
            rows = self._run("update live.docs set data = cast(:d as jsonb), version = version + 1, updated_at = now() "
                             "where show = :s and path = :p and version = :v returning version", s=self.show, p=rel, d=text, v=known)
            if not rows:
                raise StoreConflict(rel)
        self.versions[rel] = rows[0][0]

    def version(self, rel):
        """The saved version now (None: not there): cheap, to see whether someone else changed it."""
        rows = self._run("select version from live.docs where show = :s and path = :p", s=self.show, p=self._rel(rel))
        return rows[0][0] if rows else None

    def put_aside(self, rel):
        rel = self._rel(rel)
        self._run("with gone as (delete from live.docs where show = :s and path = :p returning show, path, data) "
                  "insert into live.docs_aside (show, path, data) select show, path, data from gone", s=self.show, p=rel)
        self.versions.pop(rel, None)

    def exists(self, rel):
        return self.version(rel) is not None


def open_store(folder):
    """The store for a workspace: files (the desktop app) unless SGFX_STORE=supabase (the website: the
    workspace's folder name is the show's id)."""
    kind = os.environ.get("SGFX_STORE", "files")
    if kind == "supabase":
        return SupabaseStore(os.path.basename(os.path.normpath(folder)))
    if kind != "files":
        raise ValueError(f"Storage backend {kind!r} isn't available")
    return FileStore(folder)
