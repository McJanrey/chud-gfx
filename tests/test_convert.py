import io
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
import zipfile

from sgfx import convert
from sgfx.server import Engine


@unittest.skipUnless(convert.ffmpeg(), "FFmpeg not installed")
class Convert(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.d, True)
        json.dump({"name": "T", "global": {}, "compositions": [], "transitions": []}, open(os.path.join(self.d, "project.json"), "w"))
        self.e = Engine(self.d)

    def make(self, name, args):
        path = os.path.join(self.d, name)
        subprocess.run([convert.ffmpeg(), "-hide_banner", "-loglevel", "error", "-y", *args, path], check=True)
        return open(path, "rb").read()

    def wait(self, jid):
        for _ in range(200):
            j = self.e.jobs.jobs[jid]
            if j["state"] != "working":
                return j
            time.sleep(0.1)
        self.fail("conversion took too long")

    def test_alpha_mov_to_webm_and_plain_to_mp4(self):
        alpha = self.make("a.mov", ["-f", "lavfi", "-i", "color=c=red@0.5:s=64x36:d=1,format=argb", "-c:v", "qtrle"])
        plain = self.make("p.mov", ["-f", "lavfi", "-i", "testsrc=s=64x36:d=1", "-c:v", "mjpeg"])
        a = self.wait(self.e.convert_upload("Stinger.mov", alpha))
        p = self.wait(self.e.convert_upload("Clip.mov", plain))
        self.assertEqual((a["state"], a["result"]), ("done", "assets/video/Stinger.webm"))
        self.assertEqual((p["state"], p["result"]), ("done", "assets/video/Clip.mp4"))
        self.assertTrue(convert.has_alpha(os.path.join(self.d, a["result"])))

    def test_png_sequence(self):
        buf = io.BytesIO()
        frame = self.make("f.png", ["-f", "lavfi", "-i", "color=c=blue@0.3:s=32x32,format=rgba", "-frames:v", "1"])
        with zipfile.ZipFile(buf, "w") as z:
            for i in (10, 2, 1):
                z.writestr(f"seq/frame_{i}.png", frame)
        j = self.wait(self.e.convert_upload("Intro.zip", buf.getvalue(), fps=25))
        self.assertEqual((j["state"], j["result"]), ("done", "assets/video/Intro.webm"), j["detail"])
