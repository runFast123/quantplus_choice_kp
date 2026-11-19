// Unit tests for the pure news helpers:  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeEntities, isQuotePage, nseFilingSymbol, normaliseUrl, parseFeed, parseFeedDate } from "./feed";
import { SymbolMatcher, smallNameForms } from "./match";
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
test("matcher: longer names win, the RBI is not Bank of India, small caps need an alias", () => {
  const banks = new SymbolMatcher(
    [
      { symbol: "SBIN", exchange: "NSE", name: "State Bank of India", rank: 5 },
      { symbol: "BANKINDIA", exchange: "NSE", name: "Bank of India", rank: 150 },
      { symbol: "TINYCO", exchange: "NSE", name: "Tiny Widgets", rank: 2900 },
      { symbol: "NIFTY", exchange: "NSE", name: "NIFTY 50", rank: null, segment: "index" },
    ],
    [],
    { nameRankLimit: 500 },
  );
  const syms = (t: string) => banks.match(t).map((x) => x.symbol).sort();
  assert.deepEqual(syms("State Bank of India raises deposit rates"), ["SBIN"]);
  assert.deepEqual(syms("Reserve Bank of India holds the repo rate"), []);
  assert.deepEqual(syms("Bank of India Q2 profit jumps"), ["BANKINDIA"]);
  assert.deepEqual(syms("State Bank of India and Bank of India cut rates"), ["BANKINDIA", "SBIN"]);
  assert.deepEqual(syms("Tiny Widgets wins an order"), []);
  assert.deepEqual(syms("Nifty 50 ends at a record"), ["NIFTY"]);
  // Without the rank limit (per-company search), small caps match by name.
  const one = new SymbolMatcher([{ symbol: "TINYCO", exchange: "NSE", name: "Tiny Widgets Limited", rank: 2900 }], []);
  assert.deepEqual(one.match("Tiny Widgets wins an order").map((x) => x.symbol), ["TINYCO"]);
});

test("matcher: smaller companies by name, strictly (ADR-062)", () => {
  const ref = (symbol: string, name: string, rank: number | null, segment = "equity") => ({ symbol, exchange: "NSE" as const, name, rank, segment });
  const all = new SymbolMatcher(
    [
      ref("VEDL", "Vedanta Limited", 40),
      ref("VEDOG", "Vedanta Oil and Gas Limited", 900),
      ref("VRLLOG", "VRL Logistics Limited", 700),
      ref("INDOCOUNT", "Indo Count Industries Limited", 650),
      ref("CYIENT", "Cyient Limited", 520),
      ref("TAKE", "TAKE Limited", 2000),
      ref("PREMIER", "Premier Limited", 1800),
      ref("AHLNORTH", "Asian Hotels (North) Limited", 1500),
      ref("AHLEAST", "Asian Hotels (East) Limited", 1600),
      ref("GEOJITFSL", "Geojit Financial Services Limited", 800),
      ref("PARAS", "Paras Healthcare Limited", 1100),
      ref("SMALLETF", "Small Cap ETF", 1200, "etf"),
    ],
    [],
    { nameRankLimit: 500, smallNames: true },
  );
  const syms = (t: string) => all.match(t).map((x) => x.symbol).sort();
  assert.deepEqual(syms("VRL Logistics shares jump 14% to 52-week high"), ["VRLLOG"]);
  assert.deepEqual(syms("Indo Count shares rally on US orders"), ["INDOCOUNT"]); // the short form headlines use
  assert.deepEqual(syms("indo count is lower case here"), []); // short forms only in the listed capitals
  assert.deepEqual(syms("Cyient wins a contract"), ["CYIENT"]);
  assert.deepEqual(syms("Vedanta Oil and Gas swings to profit"), ["VEDOG"]); // not Vedanta itself
  assert.deepEqual(syms("Take a look at these stocks"), []); // a common word is never a company
  assert.deepEqual(syms("Premier League final"), []);
  assert.deepEqual(syms("Asian Hotels shares rise"), []); // three companies share the short form
  assert.deepEqual(syms("Asian Hotels (North) shares rise"), ["AHLNORTH"]);
  assert.deepEqual(syms("Buy Paras Healthcare; target of Rs 900: Geojit Financial Services - Moneycontrol.com"), ["PARAS"]); // the broker is the source
  assert.deepEqual(syms("Geojit Financial Services Q2 profit rises"), ["GEOJITFSL"]);
  assert.deepEqual(syms("Small Cap ETF sees inflows"), []);
  // Without smallNames (the old behaviour) only aliases reach them.
  const old = new SymbolMatcher([ref("VRLLOG", "VRL Logistics Limited", 700)], [], { nameRankLimit: 500 });
  assert.deepEqual(old.match("VRL Logistics shares jump"), []);
});
test("matcher: name forms for smaller companies", () => {
  assert.deepEqual(smallNameForms("Indo Count Industries Limited"), [{ text: "Indo Count Industries", exact: false }, { text: "Indo Count", exact: true }]);
  assert.deepEqual(smallNameForms("Tata Teleservices (Maharashtra) Limited"), [{ text: "Tata Teleservices (Maharashtra)", exact: false }, { text: "Tata Teleservices", exact: true }]);
  assert.deepEqual(smallNameForms("eMudhra Limited"), [{ text: "eMudhra", exact: true }]);
  assert.deepEqual(smallNameForms("USHA FINANCIAL SERVICES L"), [{ text: "USHA FINANCIAL SERVICES", exact: false }]);
  assert.deepEqual(smallNameForms("GANESH GREEN BHARAT LIMITED"), [{ text: "GANESH GREEN BHARAT", exact: false }]);
  for (const junk of ["TAKE Limited", "BPL Limited", "SHIVAM-RE1", "111NSETEST", "IRBINVIT", "UTIAMC-NIFTYBETA", "Jai Corp Limited"]) {
    assert.ok(smallNameForms(junk).every((f) => f.text.includes(" ")), junk); // no one-word form for these
  }
});
test("feed: quote and chart pages are not news", () => {
  for (const t of [
    "Trident Share Price - Upstox",
    "Tonbo Imaging India Ltd. Share Price Live Today - CNBC TV18",
    "Virtuoso Optoelectronics Limited (VOEPL.NS) latest stock news and headlines - Yahoo Finance UK",
    "Jyoti Resins and Adhesives Limited (JYOTIRES.NS) interactive stock chart - Yahoo Finance UK",
    "SFC Environmental Technologies Ltd Announcements - Business Standard",
    "M K Sons Fine Jewels Ltd. - Moneycontrol.com",
    "Greenleaf Envirotech Ltd Shareholding Pattern – Promoters, FIIs & DIIs - Value Research",
    "Transrail Lighting (NSEI:TRANSRAILL) - Stock Analysis - Simply Wall St",
    "Nelcast Limited (NELCAST.NS) Slips 0.99% to ₹131.29 - Advance Decline Line - https://www.siam.in/",
    "Shah Metacorp Limited (SHAH.BO) Analyst insights, Price targets and Recommendations - Yahoo Finance",
    "Hawkins Cookers (HAWKINCOOK.NS) Edges Up 1.22% to ₹7602.5 - Market Notes",
  ]) assert.ok(isQuotePage(t), t);
  for (const t of [
    "Tata Steel share price jumps 5% after Q2 results - Business Standard",
    "VRL Logistics shares jumps 14% to 52-week high as Q2-profit more than doubles - Moneycontrol.com",
    "Trident share price: stock rises on export orders",
    "Jay Bharat Maruti Ltd is Rated Hold - MarketsMojo",
  ]) assert.ok(!isQuotePage(t), t);
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

import { safeNext } from "../safe-next";
test("safeNext: only same-origin paths survive", () => {
  for (const bad of ["//evil.com", String.raw`/\evil.com`, "/\t/evil.com", "https://evil.com", "javascript:alert(1)", "evil.com", "/\u0000x", ""]) {
    assert.equal(safeNext(bad), "/app", JSON.stringify(bad));
  }
  assert.equal(safeNext("/app/markets?sector=IT#x"), "/app/markets?sector=IT#x");
  assert.equal(safeNext("/invite/abc"), "/invite/abc");
});
