import json
import unittest
import urllib.error
from unittest import mock

from sgfx import updater


class _R:
    def __init__(self, body, headers):
        self.body, self.headers = body, headers

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        pass


class Check(unittest.TestCase):
    def test_unchanged_release_reuses_last_answer(self):
        rel = {"tag_name": "v9.9.9", "assets": [{"name": updater.SETUP, "url": "u", "size": 1, "digest": "sha256:ab"}]}
        sent = []

        def fake(req, timeout=0):   # (answers by the header, so another thread checking at the same time can't upset it)
            tag = req.get_header("If-none-match")
            sent.append(tag)
            if tag == '"x"':
                raise urllib.error.HTTPError("u", 304, "Not Modified", {}, None)
            return _R(json.dumps(rel).encode(), {"ETag": '"x"'})
        with mock.patch.object(updater.urllib.request, "urlopen", fake), mock.patch.dict(updater._last, clear=True):
            first, second = updater.check(), updater.check()
        self.assertEqual(first, second)
        self.assertTrue(first["update"])
        self.assertEqual(sent[-1], '"x"')   # (the second asked "changed since?" and got the saved answer)
