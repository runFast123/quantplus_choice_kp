// Unit tests for CSV parser: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { cleanBrokerSymbol, parseHoldingsCsv, parseNumeric } from "./csv-parser";

describe("cleanBrokerSymbol", () => {
  test("strips exchange prefixes and suffixes", () => {
    assert.equal(cleanBrokerSymbol("INFY-EQ"), "INFY");
    assert.equal(cleanBrokerSymbol("RELIANCE.NS"), "RELIANCE");
    assert.equal(cleanBrokerSymbol("TCS.BO"), "TCS");
    assert.equal(cleanBrokerSymbol("HDFCBANK-BE"), "HDFCBANK");
    assert.equal(cleanBrokerSymbol("NSE:TATAMOTORS"), "TATAMOTORS");
    assert.equal(cleanBrokerSymbol("BSE:ITC"), "ITC");
    assert.equal(cleanBrokerSymbol("SBIN EQ"), "SBIN");
  });

  test("handles quotes and messy whitespace", () => {
    assert.equal(cleanBrokerSymbol('  "WIPRO"  '), "WIPRO");
    assert.equal(cleanBrokerSymbol("'BHARTIARTL-EQ'"), "BHARTIARTL");
  });
});

describe("parseNumeric", () => {
  test("parses formatted Indian currency and quantity strings", () => {
    assert.equal(parseNumeric("₹1,245.50"), 1245.5);
    assert.equal(parseNumeric("Rs. 500"), 500);
    assert.equal(parseNumeric("INR 10,000.75"), 10000.75);
    assert.equal(parseNumeric("1,500"), 1500);
    assert.equal(parseNumeric(250), 250);
    assert.equal(parseNumeric(""), 0);
    assert.equal(parseNumeric("invalid"), 0);
  });
});

describe("parseHoldingsCsv", () => {
  test("parses Zerodha Console holdings format", () => {
    const csv = `Instrument,Qty.,Avg. cost,Cur. val,P&L,Net chg.
INFY,50,1420.50,75000,3975,+5.5%
RELIANCE-EQ,20,"2,450.00",50000,1000,+2.0%
TCS,15,3800.00,57000,0,0%
Total,85,---,182000,4975,`;

    const res = parseHoldingsCsv(csv);
    assert.equal(res.rows.length, 3); // "Total" row skipped
    assert.equal(res.validRows.length, 3);

    assert.equal(res.rows[0].cleanSymbol, "INFY");
    assert.equal(res.rows[0].quantity, 50);
    assert.equal(res.rows[0].avgPrice, 1420.5);
    assert.equal(res.rows[0].isValid, true);

    assert.equal(res.rows[1].cleanSymbol, "RELIANCE");
    assert.equal(res.rows[1].quantity, 20);
    assert.equal(res.rows[1].avgPrice, 2450.0);
    assert.equal(res.rows[1].isValid, true);
  });

  test("parses Groww holdings format", () => {
    const csv = `Stock Name,Symbol,Quantity,Average Price,Current Value
Infosys Ltd,INFY,100,1500.00,160000
Tata Motors,TATAMOTORS,250,920.50,240000`;

    const res = parseHoldingsCsv(csv);
    assert.equal(res.validRows.length, 2);
    assert.equal(res.rows[0].cleanSymbol, "INFY");
    assert.equal(res.rows[0].quantity, 100);
    assert.equal(res.rows[0].avgPrice, 1500);
    assert.equal(res.rows[1].cleanSymbol, "TATAMOTORS");
    assert.equal(res.rows[1].quantity, 250);
    assert.equal(res.rows[1].avgPrice, 920.5);
  });

  test("parses Angel One format", () => {
    const csv = `Symbol,Quantity,Buy Average Price,LTP
HDFCBANK,40,1650.25,1680.00
ICICIBANK,80,1120.00,1150.00`;

    const res = parseHoldingsCsv(csv);
    assert.equal(res.validRows.length, 2);
    assert.equal(res.rows[0].cleanSymbol, "HDFCBANK");
    assert.equal(res.rows[0].quantity, 40);
    assert.equal(res.rows[0].avgPrice, 1650.25);
  });

  test("parses tab-delimited exports cleanly", () => {
    const tsv = "Symbol\tQty\tAvg Price\nLT\t10\t3500\nITC\t200\t450";
    const res = parseHoldingsCsv(tsv);
    assert.equal(res.delimiter, "\t");
    assert.equal(res.validRows.length, 2);
    assert.equal(res.rows[0].cleanSymbol, "LT");
    assert.equal(res.rows[0].quantity, 10);
    assert.equal(res.rows[0].avgPrice, 3500);
  });

  test("handles empty and malformed input gracefully", () => {
    const emptyRes = parseHoldingsCsv("");
    assert.equal(emptyRes.rows.length, 0);

    const malformedCsv = `Symbol,Quantity,Price
,,
INVALID,0,-50`;
    const res = parseHoldingsCsv(malformedCsv);
    assert.equal(res.validRows.length, 0);
  });
});
