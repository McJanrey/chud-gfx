# PyInstaller: one folder (fast start, small updates), windowed, the web files bundled next to the exe.
a = Analysis(["ChudGFX.py"], datas=[("web", "web")], hiddenimports=["webview.platforms.edgechromium", "webview.platforms.winforms", "psd_tools"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="ChudGFX", console=False, icon="web/placeholders/logo.ico")
coll = COLLECT(exe, a.binaries, a.datas, name="ChudGFX")
