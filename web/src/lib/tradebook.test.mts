import assert from "node:assert/strict";
import { test } from "node:test";
import { csvRows, detectColumns, hash53, mapHeader, mergeTrades, missingFields, normName, parseSide, parseTradebook, parseTradeDate } from "./tradebook";

// Zerodha Console's tradebook (the current column set; an older one had tradingsymbol and no series).
const ZERODHA = `symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time
INFY,INE009A01021,2026-01-05,NSE,EQ,EQ,buy,false,10.000000,1000.000000,101,2001,2026-01-05T10:15:32
INFY,INE009A01021,2026-02-05,NSE,EQ,EQ,buy,false,10.000000,2000.000000,102,2002,2026-02-05T11:00:00
NIFTY26JANFUT,,2026-01-06,NFO,FO,,buy,false,75,24000,103,2003,2026-01-06T09:20:00
INFY,INE009A01021,2026-03-05,NSE,EQ,EQ,sell,false,5,1800,104,2004,2026-03-05T14:45:10`;

const ZERODHA_OLD = `trade_date,tradingsymbol,exchange,segment,trade_type,quantity,price,order_id,trade_id,order_execution_time
05-01-2026,TCS-EQ,NSE,EQ,BUY,2,3000.5,9001,77,05-01-2026 10:15:32`;

// An order-history style export with title rows, stock names instead of symbols, a value instead of a price, and
// cancelled orders (the layout is illustrative: Groww does not publish its columns).
const NAMED = `Order history
Client code,AB1234
,
Stock name,ISIN,Type,Quantity,Value,Exchange,Exchange Order Id,Execution date and time,Order status
Tata Consultancy Services Ltd.,INE467B01029,BUY,4,"12,000.00",NSE,X1,05-11-2025 10:15 AM,Executed
Infosys Limited,INE009A01021,SELL,2,"3,200",NSE,X2,06-11-2025 02:30 PM,Cancelled
Total,,,,"15,200",,,,`;

test("Zerodha: the header is found by name, futures are left out, trade ids become references", () => {
  const rows = csvRows(ZERODHA);
  const { headerRow, mapping } = detectColumns(rows);
  assert.equal(headerRow, 0);
  assert.deepEqual(missingFields(mapping), []);
  const { trades, skipped } = parseTradebook(rows, headerRow, mapping, "tradebook.csv");
  assert.equal(trades.length, 3);
  assert.deepEqual(trades.map((t) => [t.date, t.time, t.symbol, t.side, t.quantity, t.price, t.ref]), [
    ["2026-01-05", "10:15:32", "INFY", "buy", 10, 1000, "t:NSE:101"],
    ["2026-02-05", "11:00:00", "INFY", "buy", 10, 2000, "t:NSE:102"],
    ["2026-03-05", "14:45:10", "INFY", "sell", 5, 1800, "t:NSE:104"],
  ]);
  assert.deepEqual(skipped, [{ line: 4, file: "tradebook.csv", reason: "futures, options or another non-equity segment" }]);
});

test("Zerodha's older column set and day-first dates read the same", () => {
  const rows = csvRows(ZERODHA_OLD);
  const { headerRow, mapping } = detectColumns(rows);
  const [t] = parseTradebook(rows, headerRow, mapping).trades;
  assert.deepEqual([t.date, t.time, t.symbol, t.side, t.quantity, t.price], ["2026-01-05", "10:15:32", "TCS", "buy", 2, 3000.5]);
});

test("title rows are skipped, names and values are read, cancelled orders and totals are left out", () => {
  const rows = csvRows(NAMED);
  const { headerRow, mapping } = detectColumns(rows);
  assert.equal(headerRow, 3);
  assert.deepEqual(missingFields(mapping), []);
  const { trades, skipped } = parseTradebook(rows, headerRow, mapping);
  assert.equal(trades.length, 1);
  const [t] = trades;
  assert.deepEqual([t.date, t.time, t.symbol, t.name, t.isin, t.quantity, t.price], ["2025-11-05", "10:15:00", null, "Tata Consultancy Services Ltd.", "INE467B01029", 4, 3000]);
  assert.match(t.ref, /^h:[0-9a-z]+:0$/);
  assert.deepEqual(skipped.map((s) => s.reason), ["not executed (cancelled)"]);
});

test("a file without trade ids gives the same references every time, and two equal fills stay two", () => {
  const csv = `date,symbol,side,qty,price\n2026-01-05,TCS,B,1,3000\n2026-01-05,TCS,B,1,3000`;
  const read = () => {
    const rows = csvRows(csv);
    const { headerRow, mapping } = detectColumns(rows);
    return parseTradebook(rows, headerRow, mapping).trades.map((t) => t.ref);
  };
  const a = read();
  assert.equal(a.length, 2);
  assert.notEqual(a[0], a[1]);
  assert.deepEqual(read(), a);
});

test("overlapping files: each trade once, in date order", () => {
  const rows = csvRows(ZERODHA);
  const { headerRow, mapping } = detectColumns(rows);
  const one = parseTradebook(rows, headerRow, mapping).trades;
  const { trades, repeated } = mergeTrades([one.slice(1), one]);
  assert.equal(repeated, 2);
  assert.deepEqual(trades.map((t) => t.ref), ["t:NSE:101", "t:NSE:102", "t:NSE:104"]);
});

test("a file missing a needed column says which", () => {
  assert.deepEqual(missingFields(mapHeader(["Date", "Scrip", "Qty"])), ["side", "price"]);
});

test("dates: day first, month names, ISO, Excel serial numbers; nonsense refused", () => {
  assert.deepEqual(parseTradeDate("05/11/2026"), { date: "2026-11-05", time: null });
  assert.deepEqual(parseTradeDate("5-Nov-26 3:04 pm"), { date: "2026-11-05", time: "15:04:00" });
  assert.deepEqual(parseTradeDate("12 Sept 2025"), { date: "2025-09-12", time: null });
  assert.deepEqual(parseTradeDate("2026-01-05T10:15:32"), { date: "2026-01-05", time: "10:15:32" });
  assert.equal(parseTradeDate("46027")?.date, "2026-01-05");
  assert.equal(parseTradeDate("31/02/2026"), null);
  assert.equal(parseTradeDate("Total"), null);
});

test("buy and sell in the words brokers use", () => {
  assert.deepEqual(["BUY", "b", "Bought", "Purchase", "SELL", "s", "Sale", "Market"].map(parseSide), ["buy", "buy", "buy", "buy", "sell", "sell", "sell", null]);
});

test("company names match without the legal ending", () => {
  assert.equal(normName("Tata Consultancy Services Ltd."), normName("TATA CONSULTANCY SERVICES LIMITED"));
  assert.equal(normName("Larsen & Toubro Ltd"), "larsen and toubro");
  assert.equal(hash53("a"), hash53("a"));
});
