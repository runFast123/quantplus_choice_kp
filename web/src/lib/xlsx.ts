/**
 * A small .xlsx reader: the first worksheet as rows of text, read in the browser (the file never leaves the device).
 * An .xlsx file is a zip of XML parts; this reads the zip directory, inflates the parts with the platform's
 * DecompressionStream, and pulls cell values out of the sheet XML. Formulas give their stored result; dates stay Excel
 * serial numbers (the tradebook reader converts them). Old binary .xls files are not read (save them as .xlsx or CSV).
 */

export class XlsxError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The zip's entries by name, inflated on demand. */
function zipEntries(b: Uint8Array): Map<string, () => Promise<Uint8Array>> {
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError("This isn't an Excel (.xlsx) file. Save it as .xlsx or CSV and try again.");
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out = new Map<string, () => Promise<Uint8Array>>();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new XlsxError("The Excel file looks damaged.");
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extraLen = u16(b, p + 30);
    const commentLen = u16(b, p + 32);
    const local = u32(b, p + 42);
    const name = dec.decode(b.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + u16(b, local + 26) + u16(b, local + 28);
    const raw = b.subarray(start, start + size);
    out.set(name, () => (method === 0 ? Promise.resolve(raw) : method === 8 ? inflate(raw) : Promise.reject(new XlsxError("Unsupported compression in the Excel file."))));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENTITIES[e.toLowerCase()],
  );

/** Text of every <t> inside a fragment (a shared string may be split into rich-text runs). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join("");

/** "B12" → 1 (zero-based column). */
export function columnIndex(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Sheet XML + shared strings → rows of cell text (pure; tested without a zip). */
export function sheetRows(sheetXml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const rm of sheetXml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row: string[] = [];
    const body = rm[1] ?? "";
    let next = 0;
    for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/.exec(attrs)?.[1];
      const col = ref ? columnIndex(ref) : next;
      const type = /\bt="([a-zA-Z]+)"/.exec(attrs)?.[1] ?? "n";
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      let text = "";
      if (type === "s") text = v != null ? (shared[Number(v)] ?? "") : "";
      else if (type === "inlineStr") text = texts(inner);
      else if (type === "b") text = v === "1" ? "TRUE" : "FALSE";
      else text = v != null ? decodeXml(v) : "";
      while (row.length < col) row.push("");
      row[col] = text.trim();
      next = col + 1;
    }
    rows.push(row);
  }
  return rows;
}

/** The first worksheet of an .xlsx file as rows of text. */
export async function readXlsx(bytes: ArrayBuffer | Uint8Array): Promise<string[][]> {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (b[0] === 0xd0 && b[1] === 0xcf) throw new XlsxError("This is an old Excel (.xls) file. Open it and save it as .xlsx or CSV, then try again.");
  const zip = zipEntries(b);
  const read = async (name: string) => {
    const get = zip.get(name);
    return get ? new TextDecoder().decode(await get()) : null;
  };
  // The first sheet in the workbook's order, through its relationship id.
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  const rid = wb ? /<sheet\b[^>]*\br:id="([^"]+)"/.exec(wb)?.[1] : undefined;
  if (rid && rels) {
    const target = new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`).exec(rels)?.[1] ??
      new RegExp(`<Relationship\\b[^>]*\\bTarget="([^"]+)"[^>]*\\bId="${rid}"`).exec(rels)?.[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`;
  }
  const sheet = await read(sheetPath);
  if (!sheet) throw new XlsxError("The Excel file has no worksheet we can read.");
  const sst = await read("xl/sharedStrings.xml");
  const shared = sst ? [...sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1])) : [];
  return sheetRows(sheet, shared);
}
