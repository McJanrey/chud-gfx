"""Window capture (like OBS's Window Capture): this PC's open windows, and a picture of one window's inside even when
other windows cover it (PrintWindow with full-content rendering; a game that gives back black is read from the screen
where the window sits instead). Windows only; elsewhere the list is empty."""
import ctypes
import io
import os
import sys

if sys.platform == "win32":
    from ctypes import wintypes
    U, G, K, D = ctypes.windll.user32, ctypes.windll.gdi32, ctypes.windll.kernel32, ctypes.windll.dwmapi
    U.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    U.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    U.IsWindowVisible.argtypes = U.IsIconic.argtypes = U.IsWindow.argtypes = [wintypes.HWND]
    U.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.RECT)]
    U.ClientToScreen.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.POINT)]
    U.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    U.GetDC.argtypes = [wintypes.HWND]
    U.GetDC.restype = wintypes.HDC
    U.ReleaseDC.argtypes = [wintypes.HWND, wintypes.HDC]
    U.PrintWindow.argtypes = [wintypes.HWND, wintypes.HDC, wintypes.UINT]
    U.GetAncestor.argtypes = [wintypes.HWND, wintypes.UINT]
    U.GetAncestor.restype = wintypes.HWND
    G.CreateCompatibleDC.argtypes = [wintypes.HDC]
    G.CreateCompatibleDC.restype = wintypes.HDC
    G.CreateCompatibleBitmap.argtypes = [wintypes.HDC, ctypes.c_int, ctypes.c_int]
    G.CreateCompatibleBitmap.restype = wintypes.HBITMAP
    G.SelectObject.argtypes = [wintypes.HDC, wintypes.HGDIOBJ]
    G.SelectObject.restype = wintypes.HGDIOBJ
    G.DeleteObject.argtypes = [wintypes.HGDIOBJ]
    G.DeleteDC.argtypes = [wintypes.HDC]
    G.GetDIBits.argtypes = [wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT, ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT]
    K.OpenProcess.restype = wintypes.HANDLE
    K.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
    K.CloseHandle.argtypes = [wintypes.HANDLE]

PW_CLIENTONLY, PW_RENDERFULLCONTENT = 1, 2


def _title(h):
    n = U.GetWindowTextLengthW(h)
    buf = ctypes.create_unicode_buffer(n + 1)
    U.GetWindowTextW(h, buf, n + 1)
    return buf.value


def _exe(h):
    pid = wintypes.DWORD()
    U.GetWindowThreadProcessId(h, ctypes.byref(pid))
    hp = K.OpenProcess(0x1000, False, pid.value)   # (PROCESS_QUERY_LIMITED_INFORMATION)
    if not hp:
        return ""
    try:
        buf, size = ctypes.create_unicode_buffer(1024), wintypes.DWORD(1024)
        return os.path.basename(buf.value) if K.QueryFullProcessImageNameW(hp, 0, buf, ctypes.byref(size)) else ""
    finally:
        K.CloseHandle(hp)


def _cloaked(h):
    v = ctypes.c_int(0)
    D.DwmGetWindowAttribute(wintypes.HWND(h), 14, ctypes.byref(v), ctypes.sizeof(v))   # (DWMWA_CLOAKED: a hidden UWP / other-desktop window)
    return v.value != 0


def _size(h):
    r = wintypes.RECT()
    U.GetClientRect(h, ctypes.byref(r))
    return r.right - r.left, r.bottom - r.top


def listing():
    """[{"id", "title", "exe", "w", "h"}]: the open windows worth capturing (visible, a title, not tiny), as OBS lists them."""
    if sys.platform != "win32":
        return []
    out, me = [], os.getpid()
    PROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def each(h, _):
        try:
            if not U.IsWindowVisible(h) or _cloaked(h) or U.GetAncestor(h, 3) != h:   # (GA_ROOTOWNER: a real top window)
                return True
            t = _title(h)
            w, hh = _size(h)
            if not t or (w < 200 or hh < 150) and not U.IsIconic(h):
                return True
            pid = wintypes.DWORD()
            U.GetWindowThreadProcessId(h, ctypes.byref(pid))
            if pid.value == me:
                return True
            out.append({"id": int(h), "title": t, "exe": _exe(h), "w": w, "h": hh, "minimised": bool(U.IsIconic(h))})
        except Exception:
            pass
        return True
    U.EnumWindows(PROC(each), 0)
    return out


def find(exe="", title=""):
    """The window to capture: the same program first (a game's title changes), then the same title. None: not open."""
    wins = [w for w in listing() if not w["minimised"]] or listing()
    exe, title = (exe or "").lower(), title or ""
    for test in (lambda w: exe and w["exe"].lower() == exe and w["title"] == title,
                 lambda w: exe and w["exe"].lower() == exe,
                 lambda w: title and w["title"] == title,
                 lambda w: title and title.lower() in w["title"].lower()):
        hit = [w for w in wins if test(w)]
        if hit:
            return max(hit, key=lambda w: w["w"] * w["h"])["id"]
    return None


def capture(hwnd):
    """The inside of a window as a PIL image (None: gone or minimised)."""
    from PIL import Image
    h = wintypes.HWND(hwnd)
    if not U.IsWindow(h) or U.IsIconic(h):
        return None
    w, hh = _size(h)
    if w < 2 or hh < 2:
        return None
    wdc = U.GetDC(h)
    mdc = G.CreateCompatibleDC(wdc)
    bmp = G.CreateCompatibleBitmap(wdc, w, hh)
    old = G.SelectObject(mdc, bmp)
    try:
        U.PrintWindow(h, mdc, PW_CLIENTONLY | PW_RENDERFULLCONTENT)

        class BIH(ctypes.Structure):
            _fields_ = [("biSize", wintypes.DWORD), ("biWidth", ctypes.c_long), ("biHeight", ctypes.c_long), ("biPlanes", wintypes.WORD),
                        ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD), ("biSizeImage", wintypes.DWORD),
                        ("biXPelsPerMeter", ctypes.c_long), ("biYPelsPerMeter", ctypes.c_long), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]
        bi = BIH(ctypes.sizeof(BIH), w, -hh, 1, 32, 0, 0, 0, 0, 0, 0)
        buf = ctypes.create_string_buffer(w * hh * 4)
        G.GetDIBits(mdc, bmp, 0, hh, buf, ctypes.byref(bi), 0)
        img = Image.frombuffer("RGBA", (w, hh), buf.raw, "raw", "BGRA", 0, 1).convert("RGB")
    finally:
        G.SelectObject(mdc, old)
        G.DeleteObject(bmp)
        G.DeleteDC(mdc)
        U.ReleaseDC(h, wdc)
    if not img.getbbox():   # (all black: a game PrintWindow can't see; read it where it sits on the screen)
        pt = wintypes.POINT(0, 0)
        U.ClientToScreen(h, ctypes.byref(pt))
        import mss
        with mss.MSS() as s:
            g = s.grab({"left": pt.x, "top": pt.y, "width": w, "height": hh})
            img = Image.frombytes("RGB", g.size, g.rgb)
    return img


def thumb(hwnd, width=360):
    img = capture(hwnd)
    if img is None:
        return None
    img.thumbnail((width, width))
    out = io.BytesIO()
    img.save(out, "JPEG", quality=70)
    return out.getvalue()
