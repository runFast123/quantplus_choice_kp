/**
 * Pure CSV parser and normalizer for Indian broker holdings exports
 * Supports: Zerodha (Kite/Console), Groww, Angel One, Upstox, Dhan, ICICI Direct, and generic CSVs.
 */

export interface ParsedHoldingRow {
  rawSymbol: string;
  cleanSymbol: string;
  quantity: number;
  avgPrice: number;
  isValid: boolean;
  error?: string;
}

export interface ParseHoldingsResult {
  rows: ParsedHoldingRow[];
  validRows: ParsedHoldingRow[];
  delimiter: string;
  detectedHeaders: {
    symbolCol?: string;
    qtyCol?: string;
    priceCol?: string;
  };
}

/** Split CSV text into rows, respecting quoted fields with commas or newlines */
function splitCsvRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let currentRecord: string[] = [];
  let currentField = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        // Escaped quote
        currentField += '"';
        i++;
      } else {
        // Toggle quoted field
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      currentRecord.push(currentField.trim());
      currentField = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      currentRecord.push(currentField.trim());
      currentField = "";
      if (currentRecord.some((f) => f.length > 0)) {
        records.push(currentRecord);
      }
      currentRecord = [];
    } else {
      currentField += char;
    }
  }

  if (currentField || currentRecord.length > 0) {
    currentRecord.push(currentField.trim());
    if (currentRecord.some((f) => f.length > 0)) {
      records.push(currentRecord);
    }
  }

  return records;
}

/** Detect delimiter from comma, tab, semicolon */
function detectDelimiter(firstLines: string): string {
  const commaCount = (firstLines.match(/,/g) || []).length;
  const tabCount = (firstLines.match(/\t/g) || []).length;
  const semicolonCount = (firstLines.match(/;/g) || []).length;

  if (tabCount > commaCount && tabCount > semicolonCount) return "\t";
  if (semicolonCount > commaCount && semicolonCount > tabCount) return ";";
  return ",";
}

/** Normalize symbol by removing exchange prefixes, series suffixes, and whitespace */
export function cleanBrokerSymbol(raw: string): string {
  let s = raw.trim().toUpperCase();
  // Strip quotes
  s = s.replace(/^["']|["']$/g, "").trim();
  // Strip exchange prefix like "NSE:" or "BSE:"
  s = s.replace(/^(NSE|BSE):/i, "").trim();
  // Strip suffixes: .NS, .BO, -EQ, -BE, -SM, EQ, etc.
  s = s.replace(/(\.NS|\.BO|-EQ|-BE|-SM|\s+EQ)$/i, "").trim();
  // Remove non-alphanumeric except hyphen, ampersand, dot
  s = s.replace(/[^A-Z0-9&\-.]/g, "");
  return s;
}

/** Strip currency tags and parse numeric values */
export function parseNumeric(val: string | number): number {
  if (typeof val === "number") return isNaN(val) ? 0 : val;
  const cleaned = String(val)
    .replace(/[₹$,\s]|Rs\.?|INR/gi, "")
    .trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export function parseHoldingsCsv(csvText: string): ParseHoldingsResult {
  const trimmed = csvText.trim();
  if (!trimmed) {
    return {
      rows: [],
      validRows: [],
      delimiter: ",",
      detectedHeaders: {},
    };
  }

  const delimiter = detectDelimiter(trimmed.slice(0, 500));
  const rawRecords = splitCsvRecords(trimmed, delimiter);

  if (rawRecords.length === 0) {
    return {
      rows: [],
      validRows: [],
      delimiter,
      detectedHeaders: {},
    };
  }

  // Find header line (some broker reports have 1-2 preamble rows before actual columns)
  let headerIndex = -1;
  let symbolColIndex = -1;
  let qtyColIndex = -1;
  let priceColIndex = -1;
  let detectedHeaders: ParseHoldingsResult["detectedHeaders"] = {};

  for (let i = 0; i < Math.min(rawRecords.length, 10); i++) {
    const row = rawRecords[i].map((c) => c.toLowerCase());
    let sIdx = -1;
    let qIdx = -1;
    let pIdx = -1;

    let sPriority = 0;
    for (let j = 0; j < row.length; j++) {
      const col = row[j].trim();
      // Match symbol column with priority:
      // Priority 3: exact "symbol", "ticker", "instrument", "trading symbol"
      // Priority 2: "scrip", "scrip code", "scrip name"
      // Priority 1: "stock name", "company name"
      if (/^(symbol|ticker|instrument|trading\s*symbol)$/i.test(col) && sPriority < 3) {
        sIdx = j;
        sPriority = 3;
      } else if (/^(scrip|scrip\s*code|scrip\s*name)$/i.test(col) && sPriority < 2) {
        sIdx = j;
        sPriority = 2;
      } else if (/^(stock\s*name|company\s*name)$/i.test(col) && sPriority < 1) {
        sIdx = j;
        sPriority = 1;
      }

      // Match quantity column
      if (
        qIdx === -1 &&
        /^(qty|quantity|qty\.|shares|units|available\s*qty|total\s*qty)$/i.test(col)
      ) {
        qIdx = j;
      }
      // Match price column
      if (
        pIdx === -1 &&
        /^(avg|avg\.|avg\s*price|avg\.\s*price|avg\.\s*cost|buy\s*avg|buy\s*avg\.|buy\s*price|average\s*price|buy\s*average\s*price|cost\s*price|purchase\s*price)$/i.test(col)
      ) {
        pIdx = j;
      }
    }

    if (sIdx !== -1 && qIdx !== -1 && pIdx !== -1) {
      headerIndex = i;
      symbolColIndex = sIdx;
      qtyColIndex = qIdx;
      priceColIndex = pIdx;
      detectedHeaders = {
        symbolCol: rawRecords[i][sIdx],
        qtyCol: rawRecords[i][qIdx],
        priceCol: rawRecords[i][pIdx],
      };
      break;
    }
  }

  // If standard headers not explicitly named, fallback to first 3 columns if available
  if (headerIndex === -1 && rawRecords.length > 0) {
    // Check if row 0 could be data or loose headers
    const firstRow = rawRecords[0];
    if (firstRow.length >= 3) {
      headerIndex = 0;
      symbolColIndex = 0;
      qtyColIndex = 1;
      priceColIndex = 2;
    } else {
      return {
        rows: [],
        validRows: [],
        delimiter,
        detectedHeaders: {},
      };
    }
  }

  const rows: ParsedHoldingRow[] = [];

  for (let i = headerIndex + 1; i < rawRecords.length; i++) {
    const record = rawRecords[i];
    if (!record || record.length === 0) continue;

    const rawSym = record[symbolColIndex] ?? "";
    const rawQty = record[qtyColIndex] ?? "";
    const rawPrice = record[priceColIndex] ?? "";

    // Skip empty or total/summary rows
    if (
      !rawSym ||
      /^(total|grand\s*total|summary|portfolio\s*value)/i.test(rawSym.trim())
    ) {
      continue;
    }

    const cleanSymbol = cleanBrokerSymbol(rawSym);
    const quantity = parseNumeric(rawQty);
    const avgPrice = parseNumeric(rawPrice);

    let isValid = true;
    let error: string | undefined;

    if (!cleanSymbol || cleanSymbol.length > 20) {
      isValid = false;
      error = "Invalid symbol";
    } else if (quantity <= 0) {
      isValid = false;
      error = "Quantity must be > 0";
    } else if (avgPrice <= 0) {
      isValid = false;
      error = "Price must be > 0";
    }

    rows.push({
      rawSymbol: rawSym.trim(),
      cleanSymbol,
      quantity,
      avgPrice,
      isValid,
      error,
    });
  }

  return {
    rows,
    validRows: rows.filter((r) => r.isValid),
    delimiter,
    detectedHeaders,
  };
}
