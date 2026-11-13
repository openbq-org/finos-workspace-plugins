/* Test helper: a small .xlsx workbook built in memory. */
/* A small workbook built here: a zip of SpreadsheetML parts, one of them deflated. */
async function deflate(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function zip(entries) {
  const encoder = new TextEncoder();
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, text, compress] of entries) {
    const raw = encoder.encode(text);
    const data = compress ? await deflate(raw) : raw;
    const nameBytes = encoder.encode(name);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, compress ? 8 : 0, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, nameBytes.length, true);
    parts.push(new Uint8Array(local.buffer), nameBytes, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(10, compress ? 8 : 0, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, raw.length, true);
    entry.setUint16(28, nameBytes.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
export async function workbook() {
  return zip([
    ["xl/workbook.xml", `<workbook ${NS}><sheets><sheet name="Trades" sheetId="1" r:id="rId1"/><sheet name="Notes" sheetId="2" r:id="rId2"/></sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'],
    ["xl/sharedStrings.xml", `<sst ${NS}><si><t>desk</t></si><si><t>qty</t></si><si><t>traded</t></si><si><r><t>F</t></r><r><t>X</t></r></si><si><t>total</t></si></sst>`],
    ["xl/styles.xml", `<styleSheet ${NS}><numFmts><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`],
    ["xl/worksheets/sheet1.xml", `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>4</v></c></row><row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2"><v>40</v></c><c r="C2" s="1"><v>45292</v></c><c r="D2"><f>B2*2</f><v>80</v></c></row><row r="4"><c r="A4" t="inlineStr"><is><t>Rates</t></is></c><c r="B4"><v>2.5</v></c><c r="D4" t="e"><v>#DIV/0!</v></c></row></sheetData></worksheet>`, true],
    ["xl/worksheets/sheet2.xml", `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="str"><v>note</v></c><c r="B1" t="str"><v>done</v></c></row><row r="2"><c r="A2" t="str"><v>check</v></c><c r="B2" t="b"><v>1</v></c></row></sheetData></worksheet>`],
  ]);
}

