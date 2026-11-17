import io
import unittest
import zipfile

from sgfx import sources


class Sources(unittest.TestCase):
    def test_csv_tsv_json(self):
        self.assertEqual(sources.parse(b"\xef\xbb\xbfField,Value\nLeft,SCC\n", "a.csv"), [["Field", "Value"], ["Left", "SCC"]])
        self.assertEqual(sources.parse(b"a\tb\n1\t2", "a.txt"), [["a", "b"], ["1", "2"]])
        self.assertEqual(sources.parse(b'[{"team":"SCC","score":2},{"team":"GMU","rank":1.0}]', "x.json"),
                         [["team", "score", "rank"], ["SCC", "2", ""], ["GMU", "", "1"]])
        self.assertEqual(sources.parse(b'{"Left": "SCC", "Live": true}'), [["Field", "Value"], ["Left", "SCC"], ["Live", "true"]])

    def test_xlsx(self):
        b = io.BytesIO()
        with zipfile.ZipFile(b, "w") as z:
            z.writestr("xl/sharedStrings.xml", '<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si><t>Field</t></si><si><t>Score</t></si></sst>')
            z.writestr("xl/worksheets/sheet1.xml", '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
                       '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="C2"><v>3</v></c></row></sheetData></worksheet>')
        self.assertEqual(sources.parse(b.getvalue(), "s.xlsx"), [["Field"], ["Score", "", "3"]])

    def test_sheet_url(self):
        u = "https://docs.google.com/spreadsheets/d/ABC_123/edit#gid=42"
        self.assertEqual(sources.sheet_url(u), "https://docs.google.com/spreadsheets/d/ABC_123/export?format=csv&gid=42")
        self.assertEqual(sources.sheet_url(u, "Match Day"), "https://docs.google.com/spreadsheets/d/ABC_123/export?format=xlsx")
        with self.assertRaises(ValueError):
            sources.fetch({"type": "url", "url": "file:///etc/passwd"})


if __name__ == "__main__":
    unittest.main()


class Stream(unittest.TestCase):
    def test_tee_and_masked_keys(self):
        import tempfile, shutil
        from sgfx import stream
        self.assertEqual(stream.tee_targets([{"on": True, "url": "rtmp://a/app/", "key": "k1"}, {"on": False, "url": "rtmp://b", "key": "k2"}, {"on": True, "url": "rtmp://c", "key": ""}]),
                         "[f=flv:onfail=ignore]rtmp://a/app/k1")
        d = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, d, True)
        m = stream.Multistream(d)
        m.set({"targets": [{"id": "t1", "platform": "twitch", "url": "rtmp://live.twitch.tv/app", "key": "live_secret_1234", "on": True}]})
        pub = m.public()["targets"][0]
        self.assertEqual(pub["key"], "••••1234")
        m.set({"targets": [dict(pub, on=False)]})
        self.assertEqual(m.cfg["targets"][0]["key"], "live_secret_1234")
        with self.assertRaises(ValueError):
            m.set({"targets": [{"url": "http://x", "key": "a"}]})
