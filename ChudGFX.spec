# PyInstaller build for the desktop app.
#
#   pip install -r requirements-windows.txt pyinstaller
#   pyinstaller --noconfirm ChudGFX.spec
#
# Produces dist/ChudGFX/ChudGFX.exe (plus its _internal folder). The GitHub
# Actions workflow in .github/workflows/build-windows.yml runs this.
import os
import sys

from PyInstaller.utils.hooks import collect_all

root = SPECPATH
icon = os.path.join(root, "packaging", "icon.ico")

hidden = []
datas = [(os.path.join(root, "web"), "web"), (os.path.join(root, "starter"), "starter")]
# Multistream (Stream page): its code is imported from these files at run time; bin/ has MediaMTX and FFmpeg
# (python apps/multistream/tools/fetch_binaries.py, pinned and checked by SHA-256).
for app_name, parts in (("multistream", ("multistream", "web", "bin")), ("hudbuilder", ("hudbuilder", "web"))):
    for part in parts:
        if os.path.isdir(os.path.join(root, "apps", app_name, part)):
            datas.append((os.path.join(root, "apps", app_name, part), os.path.join("apps", app_name, part)))
binaries = []
# FFmpeg (for converting video) and the PSD reader's data files.
for package in ("imageio_ffmpeg", "psd_tools"):
    d, b, h = collect_all(package)
    datas += d
    binaries += b
    hidden += h
hidden += ["openpyxl", "ssl", "uuid", "webbrowser", "http.server", "zipfile", "tempfile", "secrets"]
if sys.platform == "win32":
    # pywebview's Windows window (Edge WebView2) is loaded at runtime.
    hidden += ["webview.platforms.winforms", "webview.platforms.edgechromium", "clr"]

a = Analysis(
    [os.path.join(root, "GFXEngine.py")],
    pathex=[root],
    datas=datas,
    binaries=binaries,
    hiddenimports=hidden,
    excludes=["tkinter"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ChudGFX",
    console=False,
    icon=icon if sys.platform == "win32" else None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="ChudGFX")
