// Unit tests for the pure news helpers:  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEntities, nseFilingSymbol, normaliseUrl, parseFeed, parseFeedDate } from "./feed";
import { SymbolMatcher } from "./match";
import { scoreTone } from "./tone";

const symbols = [
  { symbol: "NTPC", exchange: "NSE" as const, name: "NTPC Limited" },
  { symbol: "SBIN", exchange: "NSE" as const, name: "State Bank of India" },
  { symbol: "ITC", exchange: "NSE" as const, name: "ITC" },
  { symbol: "LT", exchange: "NSE" as const, name: "Larsen & Toubro" },
  { symbol: "INFY", exchange: "NSE" as const, name: "Infosys" },
];
const aliases = [
  { symbol: "SBIN", exchange: "NSE", alias: "SBI" },
  { symbol: "ITC", exchange: "NSE", alias: "ITC" },
  { symbol: "LT", exchange: "NSE", alias: "L&T" },
];
const m = new SymbolMatcher(symbols, aliases);
const syms = (t: string) => m.match(t).map((x) => x.symbol).sort();

test("matcher: names, aliases, tickers", () => {
  assert.deepEqual(syms("Infosys and L&T rally"), ["INFY", "LT"]);
  assert.deepEqual(syms("SBI raises deposit rates"), ["SBIN"]);
  assert.deepEqual(syms("INFY ADR jumps"), ["INFY"]);
});
test("matcher: sibling companies are not the parent", () => {
  assert.deepEqual(syms("NTPC Green shares jump"), []);
  assert.deepEqual(syms("SBI Life posts profit"), []);
  assert.deepEqual(syms("ITC Hotels demerger"), []);
  assert.deepEqual(syms("L&T Finance raises funds"), []);
  assert.deepEqual(syms("NTPC Green and NTPC both rise"), ["NTPC"]);
});
test("matcher: word boundaries and case", () => {
  assert.deepEqual(syms("Critical capacity in citcom"), []); // "itc" inside a word, wrong case
  assert.deepEqual(syms("lt is not L&T"), ["LT"]);
});
test("tone: direction and explanation", () => {
  assert.equal(scoreTone("Infosys shares crash to 6-year lows").label, "negative");
  assert.ok(scoreTone("Stock at 6-year lows").terms.includes("−new low"));
  assert.equal(scoreTone("TCS beats estimates, profit rises 12%").label, "positive");
  assert.equal(scoreTone("Board meeting scheduled on Friday").label, "neutral");
  assert.ok(scoreTone("Wipro hits 52-week high").terms.includes("+new high"));
});
test("feed: RSS parsing, entities, dates", () => {
  const xml = `<rss><channel><item><title><![CDATA[M&amp;M hits &amp;#8377;3,000]]></title><link>https://x.test/a?utm_source=rss</link><pubDate>Wed, 01 Oct 2026 10:00:00 +0530</pubDate></item></channel></rss>`;
  const [it] = parseFeed(xml);
  assert.equal(it.title, "M&M hits ₹3,000");
  assert.equal(normaliseUrl(it.link), "https://x.test/a");
  assert.equal(it.publishedAt?.toISOString(), "2026-10-01T04:30:00.000Z");
  assert.equal(parseFeedDate("01-Oct-2026 10:55:00")?.toISOString(), "2026-10-01T05:25:00.000Z");
  assert.equal(decodeEntities("&amp;amp;"), "&");
  assert.equal(nseFilingSymbol("https://nsearchives.nseindia.com/corporate/INFY_01102026105448_Press.pdf"), "INFY");
});
