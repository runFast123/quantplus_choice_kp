import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHECK_TAG,
  CHECK_TESTED,
  checkKey,
  daysAgoIST,
  isCheckRule,
  liveYears,
  periodsSentence,
  quarterStartIST,
  signalDayOf,
  standingLine,
  total,
  type RecordRow,
} from "./signal-checks";

test("signal checks: which rules, keys and the close a signal fired on", () => {
  assert.ok(isCheckRule("strong_trend") && isCheckRule("rsi_dip") && !isCheckRule("kk_dip") && !isCheckRule("sma_trend"));
  assert.equal(checkKey("rsi_dip", "TCS", "2026-10-29"), "rsi_dip|TCS|2026-10-29");
  // a dip buy is keyed by its setup close, not the fill day
  assert.equal(signalDayOf({ generated_at: "2026-10-30T10:30:00Z", payload: { signal_day: "2026-10-29" } }), "2026-10-29");
  // other signals by their own day in India time (23:59 IST is still that day; 18:30 UTC is the next)
  assert.equal(signalDayOf({ generated_at: "2026-10-29T10:25:00Z", payload: {} }), "2026-10-29");
  assert.equal(signalDayOf({ generated_at: "2026-10-29T18:30:00Z", payload: {} }), "2026-10-30");
  // quarters and day counts in India time
  assert.equal(quarterStartIST(Date.parse("2026-12-31T18:29:00Z")), "2026-10-01");
  assert.equal(quarterStartIST(Date.parse("2026-12-31T18:31:00Z")), "2027-01-01");
  assert.equal(daysAgoIST(90, Date.parse("2026-11-01T06:00:00Z")), "2026-08-03");
});

test("tags: words and a plain explanation, never advice", () => {
  for (const rule of ["strong_trend", "rsi_dip"] as const) {
    assert.ok(CHECK_TAG[rule].label.length > 0);
    assert.match(CHECK_TAG[rule].title, /not advice/);
  }
});

test("tested record: totals match the research and the line says where the tag was wrong", () => {
  const rsi = total(CHECK_TESTED.rsi_dip.years);
  assert.equal(rsi.tagged.n, 205);
  assert.equal(rsi.tagged.made, 79.5);
  const trend = total(CHECK_TESTED.strong_trend.years);
  assert.deepEqual([trend.tagged.n, trend.rest.n], [427, 1288]);
  assert.equal(Math.round(trend.tagged.made), 40);   // 40.0 in the research; weighted from rounded years
  assert.equal(Math.round(trend.rest.made), 57);

  const r = standingLine("rsi_dip", CHECK_TESTED.rsi_dip.years);
  assert.match(r, /^Since 2023, RSI dips tagged stronger made money 80 times in 100 \(205 signals\) vs 59 for the rest\./);
  assert.match(r, /In 2025 the 6 tagged dips made money only 50 times in 100, below the 57 of the rest\./);
  assert.doesNotMatch(r, /In 2024/);
  const t = standingLine("strong_trend", CHECK_TESTED.strong_trend.years);
  assert.match(t, /tagged weak made money 40 times in 100 \(427 signals\) vs 57 for the rest\./);
  assert.match(t, /In 2022 .* did better than the rest/);
  assert.match(t, /In 2023 .* did better than the rest/);
  assert.match(periodsSentence("strong_trend"), /9 of 18 months.*thin/);
  assert.match(periodsSentence("rsi_dip"), /6 of 7 quarters/);
  assert.equal(standingLine("rsi_dip", []), "");
});

test("live record: finished trades by year, tagged vs the rest", () => {
  const rows: RecordRow[] = [
    { strategy: "rsi_dip", month: "2025-08-01", label: "high", signals: 3, trades: 2, made_money: 2 },
    { strategy: "rsi_dip", month: "2025-08-01", label: "low", signals: 10, trades: 9, made_money: 5 },
    { strategy: "rsi_dip", month: "2026-01-01", label: "normal", signals: 4, trades: 4, made_money: 3 },
    { strategy: "rsi_dip", month: "2026-02-01", label: "none", signals: 2, trades: 2, made_money: 0 },   // not judged: left out
    { strategy: "strong_trend", month: "2026-01-01", label: "weak", signals: 5, trades: 5, made_money: 1 },
  ];
  const y = liveYears(rows, "rsi_dip");
  assert.deepEqual(y.map((x) => x.year), [2025, 2026]);
  assert.deepEqual(y[0], { year: 2025, tagged: { n: 2, made: 100 }, rest: { n: 9, made: 55.6 } });
  assert.deepEqual(y[1].tagged, { n: 0, made: 0 });
  assert.deepEqual(total(y).rest, { n: 13, made: 61.6 });   // weighted from the yearly figures
  assert.deepEqual(liveYears(rows, "strong_trend")[0].tagged, { n: 5, made: 20 });
});
