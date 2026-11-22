"""Copy the shows from an installed app into starter/, so every new install opens with them.
Run: python tools/snapshot_starter.py "C:/Chud GFX Baby"   (then commit starter/ and release)"""
import shutil, sys
from pathlib import Path

SKIP = {"backups", ".trash", "live.json"}   # (history, deleted files, the last live values)
src, dst = Path(sys.argv[1] if len(sys.argv) > 1 else "C:/Chud GFX Baby"), Path(__file__).resolve().parent.parent / "starter"
shutil.rmtree(dst, ignore_errors=True)
for ws in sorted((src / "workspaces").iterdir()):
    if (ws / "project.json").is_file():
        shutil.copytree(ws, dst / "workspaces" / ws.name, ignore=lambda d, names: [n for n in names if n in SKIP])
(dst / "library").mkdir(parents=True, exist_ok=True)
for f in ("teams.json",):   # (machine settings, obs, stream keys and paid fonts stay out)
    if (src / "library" / f).is_file():
        shutil.copy2(src / "library" / f, dst / "library" / f)
import json
for pj in (dst / "workspaces").glob("*/project.json"):   # (each install makes its own camera password)
    d = json.loads(pj.read_text(encoding="utf-8")); d.pop("cam_password", None)
    pj.write_text(json.dumps(d, indent=1, ensure_ascii=False), encoding="utf-8")
print("starter:", *[p.name for p in (dst / "workspaces").iterdir()])
