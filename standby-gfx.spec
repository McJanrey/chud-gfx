# PyInstaller: one folder (fast start, small updates), windowed, the web files bundled next to the exe.
a = Analysis(["ChudGFX.py"], datas=[("web", "web"), ("starter", "starter"), ("sgfx/val_glyphs.json", "sgfx"), ("sgfx/val27_owen.json", "sgfx")], hiddenimports=["webview.platforms.edgechromium", "webview.platforms.winforms", "psd_tools", "mss",
             "winrt.windows.media.ocr", "winrt.windows.graphics.imaging", "winrt.windows.storage.streams", "winrt.windows.globalization",
             "winrt.windows.foundation", "winrt.windows.foundation.collections"])
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="ChudGFX", console=False, icon="web/placeholders/logo.ico")
coll = COLLECT(exe, a.binaries, a.datas, name="ChudGFX")
