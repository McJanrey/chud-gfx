"""Data sources -> tables (lists of rows of strings).

A source: {id, name, type: "file" | "url" | "sheet", path (file), url (url / sheet), tab (sheet), refresh (seconds)}.
Files: CSV / TSV / text, JSON, Excel (.xlsx). Web addresses: CSV or JSON. Google Sheets: the sheet's
address (shared "anyone with the link"), read as CSV, the tab by name or the address's gid.
"""
import csv
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
        if target:
            sheet = "xl/" + target.lstrip("/").replace("xl/", "", 1)
    rows = []
    for row in ET.fromstring(z.read(sheet)).iter("{%s}row" % NS["m"]):
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
            else:
                val = _s(float(v.text)) if v is not None and re.fullmatch(r"-?\d+(\.\d+)?", v.text or "") else (v.text if v is not None else "")
            out.append(val)
        rows.append(out)
    return rows


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
    if tab:
        return f"https://docs.google.com/spreadsheets/d/{m.group(1)}/gviz/tq?tqx=out:csv&sheet={urllib.parse.quote(tab)}"
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
