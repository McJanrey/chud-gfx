"""Side-by-side check against the old app (both reading the same TEST COPY of a workspace):
screenshots every graphic's own output from each engine with headless Chrome and scores the difference.

    python tests/compare_old.py [old=http://127.0.0.1:7890] [new=http://127.0.0.1:7820]
Writes tests/compare/<name>.png (old | new | difference) and prints a score per graphic (0 = identical).
"""
import json
import os
import subprocess
import sys
import urllib.request

from PIL import Image, ImageChops, ImageStat

OLD = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:7890"
NEW = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:7820"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.join(os.path.dirname(__file__), "compare")
os.makedirs(OUT, exist_ok=True)
PROFILE = os.path.join(OUT, "_chrome")   # (a throwaway profile, never MJ's)


def shot(url, path):
    subprocess.run([CHROME, "--headless=new", "--hide-scrollbars", "--window-size=1920,1080", "--force-device-scale-factor=1",
                    "--timeout=5000", "--default-background-color=000000ff", "--no-first-run",
                    f"--user-data-dir={PROFILE}", f"--screenshot={path}", url], capture_output=True, timeout=90)
    return Image.open(path).convert("RGB").resize((960, 540))


comps = json.load(urllib.request.urlopen(NEW + "/api/state"))["project"]["compositions"]
rows = []
for c in comps:
    safe = "".join(ch if ch.isalnum() else "_" for ch in c["name"])
    a = shot(f"{OLD}/output?comp={c['id']}", os.path.join(OUT, f"_old_{safe}.png"))
    b = shot(f"{NEW}/output?comp={c['id']}", os.path.join(OUT, f"_new_{safe}.png"))
    diff = ImageChops.difference(a, b)
    score = sum(ImageStat.Stat(diff).mean) / 3 / 255 * 100
    sheet = Image.new("RGB", (960 * 3, 540))
    sheet.paste(a, (0, 0)); sheet.paste(b, (960, 0)); sheet.paste(diff.point(lambda v: min(255, v * 4)), (1920, 0))
    sheet.save(os.path.join(OUT, f"{safe}.png"))
    rows.append((score, c["name"]))
for score, name in sorted(rows, reverse=True):
    print(f"{score:6.2f}  {name}")
