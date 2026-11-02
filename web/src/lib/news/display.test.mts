import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanTitle, dayLabel, groupByDay, stocksInNews, summaryEchoes } from "./display";

test("headlines lose the publisher name tacked onto the end, nothing else", () => {
  assert.equal(cleanTitle("Zen Technologies share jumps 8% on order book - Moneycontrol.com", "Moneycontrol · Market reports"), "Zen Technologies share jumps 8% on order book");
  assert.equal(cleanTitle("Coal India unit files for $800 million IPO - Business Standard", "Business Standard · Markets"), "Coal India unit files for $800 million IPO");
  // a dash that is part of the story stays
  assert.equal(cleanTitle("Nifty above 23,300 - what analysts say", "Economic Times · Markets"), "Nifty above 23,300 - what analysts say");
  assert.equal(cleanTitle("RIL vs JPL - which to buy?", "Mint · Markets"), "RIL vs JPL - which to buy?");
  assert.equal(cleanTitle("No dash here at all", "Mint · Markets"), "No dash here at all");
});

test("a summary that only repeats the headline is not shown", () => {
  const t = "Accumulate Bank of Baroda; target of Rs 280: Prabhudas Lilladher - Moneycontrol.com";
  assert.ok(summaryEchoes("Accumulate Bank of Baroda; target of Rs 280: Prabhudas Lilladher Moneycontrol.com", t));
  assert.ok(summaryEchoes(null, t));
  assert.ok(summaryEchoes("", t));
  assert.ok(!summaryEchoes("Shares surged nearly 7.5% after the company reported a 41% rise in net profit for Q2.", "Reliance shares jump"));
});

test("days are India-time and read as Today / Yesterday / a date", () => {
  const now = Date.parse("2026-11-02T06:00:00Z"); // 11:30 IST
  assert.equal(dayLabel("2026-11-01T19:00:00Z", now), "Today"); // 00:30 IST on the 2nd
  assert.equal(dayLabel("2026-11-01T10:00:00Z", now), "Yesterday");
  assert.match(dayLabel("2026-10-29T10:00:00Z", now), /29 Oct/);
  const g = groupByDay(
    [{ published_at: "2026-11-02T05:00:00Z" }, { published_at: "2026-11-02T01:00:00Z" }, { published_at: "2026-11-01T09:00:00Z" }],
    now,
  );
  assert.deepEqual(g.map((x) => [x.label, x.items.length]), [["Today", 2], ["Yesterday", 1]]);
});

test("stocks in the news: most named first, with positive and negative counts", () => {
  const s = stocksInNews([
    { symbols: ["RELIANCE", "JPL"], tone_label: "positive", is_filing: false },
    { symbols: ["RELIANCE"], tone_label: "negative", is_filing: false },
    { symbols: ["RELIANCE", "RELIANCE"], tone_label: "neutral", is_filing: true },
    { symbols: ["TCS"], tone_label: "positive", is_filing: false },
  ]);
  assert.deepEqual(s[0], { symbol: "RELIANCE", n: 3, pos: 1, neg: 1 });
  assert.deepEqual(s.map((x) => x.symbol), ["RELIANCE", "JPL", "TCS"]);
});
