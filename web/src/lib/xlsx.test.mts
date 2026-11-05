import assert from "node:assert/strict";
import { test } from "node:test";
import { columnIndex, decodeXml, readXlsx, sheetRows, XlsxError } from "./xlsx";
import { detectColumns, parseTradebook } from "./tradebook";

/** A minimal zip (the reader does not check CRCs): stored or deflated parts, as Excel writes them. */
async function zip(files: Record<string, string>, deflate: string[] = []): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const method = deflate.includes(name) ? 8 : 0;
    const data =
      method === 8 ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()) : raw;
    const nm = enc.encode(name);
    const local = new Uint8Array(30 + nm.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, nm.length, true);
    local.set(nm, 30);
    const cd = new Uint8Array(46 + nm.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, raw.length, true);
    cv.setUint16(28, nm.length, true);
    cv.setUint32(42, offset, true);
    cd.set(nm, 46);
    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, central.length, true);
  ev.setUint16(10, central.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let p = 0;
  for (const part of all) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

const WORKBOOK = `<workbook xmlns:r="r"><sheets><sheet name="Trades" sheetId="1" r:id="rId3"/></sheets></workbook>`;
const RELS = `<Relationships><Relationship Id="rId3" Type="worksheet" Target="worksheets/trades.xml"/></Relationships>`;
const SHARED = `<sst><si><t>trade_date</t></si><si><t>symbol</t></si><si><t>trade_type</t></si><si><t>quantity</t></si><si><t>price</t></si><si><r><t>trade</t></r><r><t>_id</t></r></si><si><t>INFY</t></si><si><t>buy</t></si></sst>`;
const SHEET = `<worksheet><sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>Tradebook &amp; charges</t></is></c></row>
  <row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="s"><v>1</v></c><c r="C2" t="s"><v>2</v></c><c r="D2" t="s"><v>3</v></c><c r="E2" t="s"><v>4</v></c><c r="F2" t="s"><v>5</v></c></row>
  <row r="3"><c r="A3" s="1"><v>46027</v></c><c r="B3" t="s"><v>6</v></c><c r="C3" t="s"><v>7</v></c><c r="D3"><v>10</v></c><c r="E3"><v>1000.5</v></c><c r="F3" t="str"><v>T-9</v></c></row>
  <row r="4"/>
</sheetData></worksheet>`;

test("an Excel tradebook reads like the CSV: first sheet through the workbook, shared and inline strings, date serials", async () => {
  const bytes = await zip(
    { "xl/workbook.xml": WORKBOOK, "xl/_rels/workbook.xml.rels": RELS, "xl/sharedStrings.xml": SHARED, "xl/worksheets/trades.xml": SHEET },
    ["xl/worksheets/trades.xml", "xl/sharedStrings.xml"],
  );
  const rows = await readXlsx(bytes);
  assert.deepEqual(rows[0], ["Tradebook & charges"]);
  assert.deepEqual(rows[1], ["trade_date", "symbol", "trade_type", "quantity", "price", "trade_id"]);
  const { headerRow, mapping } = detectColumns(rows);
  assert.equal(headerRow, 1);
  const [t] = parseTradebook(rows, headerRow, mapping, "book.xlsx").trades;
  assert.deepEqual([t.date, t.symbol, t.side, t.quantity, t.price, t.ref], ["2026-01-05", "INFY", "buy", 10, 1000.5, "t::T-9"]);
});

test("gaps between cells keep their columns", () => {
  const rows = sheetRows(`<row r="1"><c r="A1"><v>1</v></c><c r="D1"><v>4</v></c></row>`, []);
  assert.deepEqual(rows, [["1", "", "", "4"]]);
  assert.equal(columnIndex("AA7"), 26);
  assert.equal(decodeXml("&lt;A&amp;B&gt; &#8377;"), "<A&B> ₹");
});

test("files that are not .xlsx say what to do", async () => {
  await assert.rejects(readXlsx(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])), (e: unknown) => e instanceof XlsxError && /old Excel/.test(e.message));
  await assert.rejects(readXlsx(new TextEncoder().encode("date,symbol\n")), (e: unknown) => e instanceof XlsxError && /isn't an Excel/.test(e.message));
});
