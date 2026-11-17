"""Data sources -> tables (lists of rows of strings).

A source: {id, name, type: "file" | "url" | "sheet", path (file), url (url / sheet), tab (sheet), refresh (seconds)}.
Files: CSV / TSV / text, JSON, Excel (.xlsx). Web addresses: CSV or JSON. Google Sheets: the sheet's
address (shared "anyone with the link"), read as CSV, the tab by name or the address's gid.
"""
import csv
import datetime
import io
import json
import re
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET


def _s(v):
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return v if isinstance(v, str) else json.dumps(v) if isinstance(v, (dict, list)) else str(v)


def from_json(data):
    """A list of objects -> a header row + one row each; an object -> Field / Value rows; a list of lists as is."""
    if isinstance(data, dict):
        for key in ("values", "rows", "data", "items"):   # (common wrappers: Sheets API, CMS exports)
            if isinstance(data.get(key), list):
                return from_json(data[key])
        return [["Field", "Value"]] + [[str(k), _s(v)] for k, v in data.items()]
    if isinstance(data, list):
        if data and all(isinstance(r, dict) for r in data):
            head = []
            for r in data:
                head += [k for k in r if k not in head]
            return [head] + [[_s(r.get(k)) for k in head] for r in data]
        return [[_s(c) for c in r] if isinstance(r, list) else [_s(r)] for r in data]
    return [[_s(data)]]


def from_text(text):
    text = text.lstrip("﻿")
    first = text.split("\n", 1)[0]
    delim = "\t" if first.count("\t") > first.count(",") else ","
    return [row for row in csv.reader(io.StringIO(text, newline=""), delimiter=delim)]


NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def from_xlsx(data, tab=""):
    """The first sheet (or the one named `tab`) of an .xlsx, values only."""
    z = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    sheet = "xl/worksheets/sheet1.xml"
    if tab:
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        rels = ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))
        rid = next((s.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id") for s in wb.iter("{%s}sheet" % NS["m"]) if s.get("name", "").lower() == tab.lower()), None)
        target = next((r.get("Target") for r in rels if r.get("Id") == rid), None)
        if not target:   # (not silently the first tab: a renamed tab shows on the Data page)
            raise ValueError(f"No tab named {tab}")
        sheet = "xl/" + target.lstrip("/").replace("xl/", "", 1)
    dates = _date_styles(z)
    rows = []
    for row in ET.fromstring(z.read(sheet)).iter("{%s}row" % NS["m"]):
        while len(rows) < int(row.get("r") or 0) - 1:   # (Excel leaves empty rows out: keep B5 on row 5)
            rows.append([])
        out = []
        for c in row.findall("m:c", NS):
            col = col_index(re.match(r"[A-Z]+", c.get("r", "A")).group())
            while len(out) < col:
                out.append("")
            v = c.find("m:v", NS)
            if c.get("t") == "s" and v is not None:
                val = shared[int(v.text)]
            elif c.get("t") == "inlineStr":
                val = "".join(t.text or "" for t in c.iter("{%s}t" % NS["m"]))
            elif c.get("t") == "b" and v is not None:   # (as the sheet shows a checkbox)
                val = "TRUE" if v.text == "1" else "FALSE"
            elif c.get("t") in (None, "n") and v is not None and int(c.get("s") or 0) in dates and re.fullmatch(r"-?\d+(\.\d+)?", v.text or ""):
                val = _serial(float(v.text), dates[int(c.get("s") or 0)])
            else:
                val = _s(float(v.text)) if v is not None and re.fullmatch(r"-?\d+(\.\d+)?", v.text or "") else (v.text if v is not None else "")
            out.append(val)
        rows.append(out)
    return rows


# Excel's built-in date / time / percent formats by id (only the parts _serial looks at).
DATE_FMTS = {9: "0%", 10: "0.00%", 14: "yyyy", 15: "yyyy", 16: "yyyy", 17: "yyyy", 18: "h:mm", 19: "h:mm:ss", 20: "h:mm", 21: "h:mm:ss",
             22: "yyyy h:mm", 45: "h:mm:ss", 46: "h:mm:ss", 47: "h:mm:ss"}


def _date_styles(z):
    """Cell style index -> its number format, for the styles that show a date, a time or a percent."""
    if "xl/styles.xml" not in z.namelist():
        return {}
    st = ET.fromstring(z.read("xl/styles.xml"))
    fmts = dict(DATE_FMTS)
    for f in st.iter("{%s}numFmt" % NS["m"]):
        fmts[int(f.get("numFmtId") or 0)] = f.get("formatCode", "")
    xfs = st.find("m:cellXfs", NS)
    out = {}
    for i, xf in enumerate(xfs if xfs is not None else []):
        code = re.sub(r'"[^"]*"|\[[^\]]*\]|\\.', "", fmts.get(int(xf.get("numFmtId") or 0), "")).lower()   # (not quoted text, [Red], [$-409])
        if re.search(r"[dyhs%]", code):
            out[i] = code
    return out


def _serial(v, code):
    """An Excel number as the sheet shows it, roughly: 45%, 2026-11-17, 7:30 PM, 19:30 or both."""
    # shortcut: ISO dates whatever the cell's format, no thousands / currency; 1904-based workbooks are 4 years off
    if "%" in code:
        dec = re.search(r"\.(0+)", code)
        return f"{v * 100:.{len(dec.group(1)) if dec else 0}f}%"
    if v < 0 or v >= 2958466:
        return _s(v)
    d = datetime.datetime(1899, 12, 30) + datetime.timedelta(seconds=round(v * 86400))
    day = d.strftime("%Y-%m-%d") if re.search(r"[dy]", code) else ""
    ampm = "am/pm" in code
    clock = d.strftime(("%I" if ampm else "%H") + (":%M:%S" if "s" in code else ":%M") + (" %p" if ampm else "")) if re.search(r"[hs]", code) else ""
    clock = clock.lstrip("0") if ampm else clock
    return " ".join(x for x in (day, clock) if x)


def col_index(letters):
    n = 0
    for ch in letters.upper():
        n = n * 26 + ord(ch) - 64
    return n - 1


def parse(data, name="", tab=""):
    low = name.lower()
    if low.endswith(".xlsx") or data[:2] == b"PK":
        return from_xlsx(data, tab)
    text = data.decode("utf-8-sig", errors="replace")
    if low.endswith(".json") or text.lstrip()[:1] in "[{":
        try:
            return from_json(json.loads(text))
        except ValueError:
            pass
    return from_text(text)


def sheet_url(url, tab=""):
    m = re.search(r"/spreadsheets/d/([A-Za-z0-9_-]+)", url or "")
    if not m:
        return url
    if tab:   # (the workbook, its tab picked by name: the gviz CSV blanks the fewer-type cells of a mixed column)
        return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=xlsx"
    gid = re.search(r"[#&?]gid=(\d+)", url)
    return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv" + (f"&gid={gid.group(1)}" if gid else "")


def fetch(src, timeout=8):
    url = sheet_url(src.get("url", ""), src.get("tab", "")) if src.get("type") == "sheet" else src.get("url", "")
    if not re.match(r"https?://", url or ""):
        raise ValueError("Needs a web address (http:// or https://)")
    req = urllib.request.Request(url, headers={"User-Agent": "StandBy-GFX"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read(20_000_000)
    return parse(data, urllib.parse.urlparse(url).path, src.get("tab", ""))
