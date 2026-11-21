"""Text recognition with Windows' own OCR (Windows.Media.Ocr, through the winrt packages): free, built into
Windows 10/11, nothing to download. read(pil_image) -> [(text, x, y, w, h)] in the image's pixels.
"""
import asyncio
import io

_engine = None


def _get():
    global _engine
    if _engine is None:
        from winrt.windows.media.ocr import OcrEngine
        _engine = OcrEngine.try_create_from_user_profile_languages()
        if _engine is None:
            raise RuntimeError("Windows has no text recognition language installed")
    return _engine


async def _read(png):
    from winrt.windows.graphics.imaging import BitmapDecoder
    from winrt.windows.storage.streams import DataWriter, InMemoryRandomAccessStream
    stream = InMemoryRandomAccessStream()
    w = DataWriter(stream)
    w.write_bytes(png)
    await w.store_async()
    await w.flush_async()
    stream.seek(0)
    bmp = await (await BitmapDecoder.create_async(stream)).get_software_bitmap_async()
    res = await _get().recognize_async(bmp)
    out = []
    for line in res.lines:
        for word in line.words:
            r = word.bounding_rect
            out.append((word.text, r.x, r.y, r.width, r.height))
    return out


def read(img, scale=2):
    """Words in a PIL image. Small HUD text reads far better enlarged first (scale), boxes are in the original pixels."""
    if scale != 1:
        img = img.resize((img.width * scale, img.height * scale))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, "PNG")
    words = asyncio.run(_read(buf.getvalue()))
    return [(t, x / scale, y / scale, w / scale, h / scale) for t, x, y, w, h in words]


def text(img, scale=2):
    return " ".join(w[0] for w in read(img, scale))
