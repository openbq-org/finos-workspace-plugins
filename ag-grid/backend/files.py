"""Files for the `aggrid-file` widget, carried in JSON: a workbook as base64, a CSV as text.

The workbook is written with the standard library's zipfile: SpreadsheetML parts with inline
strings, numbers and a date style.
"""

import base64
import io
import zipfile
from datetime import date
from xml.sax.saxutils import escape

import trades

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
{sheets}
</Types>"""
NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
EXCEL_EPOCH = date(1899, 12, 30)


def column(index: int) -> str:
    name = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        name = chr(65 + rest) + name
    return name


def cell(ref: str, value) -> str:
    if value is None:
        return ""
    if isinstance(value, date):
        return f'<c r="{ref}" s="1"><v>{(value - EXCEL_EPOCH).days}</v></c>'
    if isinstance(value, bool):
        return f'<c r="{ref}" t="b"><v>{int(value)}</v></c>'
    if isinstance(value, (int, float)):
        return f'<c r="{ref}"><v>{value}</v></c>'
    return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'


def sheet_xml(rows: list[list]) -> str:
    body = "".join(
        f'<row r="{r + 1}">' + "".join(cell(f"{column(c)}{r + 1}", v) for c, v in enumerate(row)) + "</row>" for r, row in enumerate(rows)
    )
    return f"<worksheet {NS}><sheetData>{body}</sheetData></worksheet>"


def workbook(sheets: dict[str, list[list]]) -> bytes:
    out = io.BytesIO()
    names = list(sheets)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        overrides = "".join(
            f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            for i in range(len(names))
        )
        z.writestr("[Content_Types].xml", CONTENT_TYPES.format(sheets=overrides))
        z.writestr(
            "_rels/.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        )
        z.writestr(
            "xl/workbook.xml",
            f"<workbook {NS}><sheets>" + "".join(f'<sheet name="{escape(n)}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, n in enumerate(names)) + "</sheets></workbook>",
        )
        z.writestr(
            "xl/_rels/workbook.xml.rels",
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i + 1}.xml"/>' for i in range(len(names)))
            + f'<Relationship Id="rId{len(names) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
        )
        z.writestr("xl/styles.xml", f'<styleSheet {NS}><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/></cellXfs></styleSheet>')
        for i, name in enumerate(names):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", sheet_xml(sheets[name]))
    return out.getvalue()


def workbook_bytes() -> bytes:
    rows = trades.build()[:200]
    by_desk: dict[str, float] = {}
    for row in rows:
        by_desk[row["desk"]] = by_desk.get(row["desk"], 0) + row["notional"]
    return workbook(
        {
            "Trades": [["Trades report"], [], ["id", "traded", "desk", "product", "quantity", "price", "notional"]]
            + [[r["id"], date.fromisoformat(r["traded"]), r["desk"], r["product"], r["quantity"], r["price"], r["notional"]] for r in rows],
            "By desk": [["desk", "notional"]] + [[desk, round(total, 2)] for desk, total in sorted(by_desk.items())],
        }
    )


def positions_workbook() -> dict:
    """The workbook carried in JSON, for a host that passes plugins JSON only."""
    return {"file": {"name": "positions.xlsx", "base64": base64.b64encode(workbook_bytes()).decode()}}


def trades_csv() -> dict:
    lines = ["id,desk,product,quantity,price"]
    for r in trades.build()[:100]:
        product = '"' + r["product"].replace('"', '""') + '"' if "," in r["product"] else r["product"]
        lines.append(f"{r['id']},{r['desk']},{product},{r['quantity']},{r['price']}")
    return {"csv": "\n".join(lines) + "\n"}
