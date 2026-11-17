import io
import unittest
import zipfile

from sgfx import sources, tables

M = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'


def book(rows_xml, styles=""):
    b = io.BytesIO()
    with zipfile.ZipFile(b, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook {M} {R}><sheets><sheet name="Standings" sheetId="1" r:id="rId1"/>'
                   '<sheet name="Match" sheetId="2" r:id="rId2"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')
        z.writestr("xl/worksheets/sheet1.xml", f'<worksheet {M}><sheetData><row r="1"><c r="A1"><v>9</v></c></row></sheetData></worksheet>')
        z.writestr("xl/worksheets/sheet2.xml", f'<worksheet {M}><sheetData>{rows_xml}</sheetData></worksheet>')
        if styles:
            z.writestr("xl/styles.xml", f'<styleSheet {M}>{styles}</styleSheet>')
    return b.getvalue()


class BadGlobalShapes(unittest.TestCase):
    def test_tables_survive_bad_inner_values(self):
        g = {"left": {"name": None}, "ticker": [3, "Hi"], "custom": [["Host"], ["Caster", "Ann"], 5],
             "schedule": {"matches": [{"team1": None, "team2": 7}]}, "standings": {"teams": [{"name": None}]}}
        rows = dict(map(tuple, tables.global_rows(g)))
        self.assertEqual((rows["Ticker"], rows["Caster"], "Host" in rows), ("3  |  Hi  |  ", "Ann", False))
        self.assertEqual(dict(map(tuple, tables.schedule_rows(g)))["Match 1 teams"], "7")
        self.assertEqual(dict(map(tuple, tables.roster_rows(g)))["Team"], "")
        self.assertEqual(dict(map(tuple, tables.standings_rows(g)))["Team 1 shown"], "")

    def test_bad_list_items(self):
        for g in ({"schedule": {"matches": [None, {"team1": "A", "time": 1930, "date": 5}]}}, {"schedule": {"matches": {"a": 1}}},
                  {"standings": {"teams": ["Saints"]}}, {"sponsors": ["a.png", {"logo": "b.png"}]}):
            for f in (tables.global_rows, tables.sponsor_rows, tables.schedule_rows, tables.standings_rows):
                f(g)
        g = {"schedule": {"matches": [None, {"team1": "A", "time": 1930}]}, "sponsors": ["a.png", {"logo": "b.png"}]}
        self.assertEqual(dict(map(tuple, tables.schedule_rows(g)))["Match 1 teams"], "A")
        self.assertEqual(dict(map(tuple, tables.global_rows(g)))["Sponsor logo"], "b.png")


class TeamsCsvKeepsTags(unittest.TestCase):
    def test_round_trip_keeps_tag_and_flag(self):
        teams = [{"name": "Saints", "players": [{"tag": "Faker", "name": "Lee", "id": "x", "country": "kr", "flag": "kr.png", "photo": "p.png"}]}]
        back, _, _ = tables.teams_from_csv(tables.teams_csv(teams), teams)
        self.assertEqual(back[0]["players"][0], teams[0]["players"][0])
        old_csv = "Name,Player 1,Player 1 ID\nSaints,Lee Sang,x\n"   # (an older CSV without tag / flag columns)
        back, _, _ = tables.teams_from_csv(old_csv, teams)
        self.assertEqual((back[0]["players"][0]["tag"], back[0]["players"][0]["flag"], back[0]["players"][0]["name"]), ("Faker", "kr.png", "Lee Sang"))

    def test_new_player_gets_no_old_tag(self):
        teams = [{"name": "Saints", "players": [{"tag": "Faker", "name": "Lee", "id": "x", "flag": "kr.png"}]}]
        back, _, _ = tables.teams_from_csv("Name,Player 1,Player 1 country\nSaints,Kim,us\n", teams)
        self.assertEqual(back[0]["players"][0], {"name": "Kim", "country": "us"})
        back, _, _ = tables.teams_from_csv("Name,Player 1,Player 2\nSaints,Kim,lee\n", teams)   # (Lee moved to slot 2)
        self.assertEqual(back[0]["players"][1]["tag"], "Faker")


class XlsxRowsTabsDates(unittest.TestCase):
    def test_blank_rows_kept(self):
        data = book('<row r="1"><c r="A1" t="inlineStr"><is><t>Field</t></is></c></row><row r="2"><c r="B2"><v>2</v></c></row>'
                    '<row r="5"><c r="B5"><v>1</v></c></row>')
        self.assertEqual(sources.parse(data, "s.xlsx", "Match"), [["Field"], ["", "2"], [], [], ["", "1"]])

    def test_unknown_tab_errors(self):
        with self.assertRaises(ValueError):
            sources.parse(book(""), "s.xlsx", "Match D2")
        self.assertEqual(sources.parse(book(""), "s.xlsx"), [["9"]])

    def test_dates_and_times(self):
        styles = ('<numFmts count="1"><numFmt numFmtId="164" formatCode="[$-409]h:mm\\ AM/PM;@"/></numFmts>'
                  '<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="20"/><xf numFmtId="14"/><xf numFmtId="164"/></cellXfs>')
        data = book('<row r="1"><c r="A1" s="1"><v>0.8125</v></c><c r="B1" s="2"><v>45976</v></c>'
                    '<c r="C1" s="3"><v>0.5</v></c><c r="D1" s="0"><v>2</v></c><c r="E1" s="3"><v>0.8125</v></c></row>', styles)
        self.assertEqual(sources.parse(data, "s.xlsx", "Match"), [["19:30", "2025-11-15", "12:00 PM", "2", "7:30 PM"]])

    def test_checkbox_and_percent(self):
        styles = '<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="9"/><xf numFmtId="10"/></cellXfs>'
        data = book('<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c><c r="C1" s="1"><v>0.45</v></c>'
                    '<c r="D1" s="2"><v>0.4567</v></c><c r="E1" s="1"><v>-0.1</v></c></row>', styles)
        self.assertEqual(sources.parse(data, "s.xlsx", "Match"), [["TRUE", "FALSE", "45%", "45.67%", "-10%"]])


if __name__ == "__main__":
    unittest.main()
