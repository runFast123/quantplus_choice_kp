import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewDate, STRONG_TREND_TESTED, strongTrendStatus, weatherView } from "./strong-trend";
import { ruleSentence } from "./signal-trade";
import { defaultHorizon } from "./trade-odds";

test("weather: each state says whether Strong trend is on", () => {
  assert.match(weatherView("sunny", 13.2).sentence, /signals are on/);
  assert.match(weatherView("sunny", 13.2).sentence, /VIX 13\.2/);
  assert.match(weatherView("mixed", null).sentence, /wait for a sunny market/);
  assert.match(weatherView("stormy", 24).sentence, /pause/);
  assert.equal(weatherView(null, null).label, "Unknown");
});

test("status: below the safety stop only when the last close reaches it", () => {
  assert.deepEqual(strongTrendStatus(90, 89.5), { label: "Below safety stop", tone: "loss" });
  assert.deepEqual(strongTrendStatus(90, 90), { label: "Below safety stop", tone: "loss" });
  assert.deepEqual(strongTrendStatus(90, 95), { label: "Open", tone: "neutral" });
  assert.deepEqual(strongTrendStatus(null, 95), { label: "Open", tone: "neutral" });
});

test("review: about 87 calendar days (60 sessions) after the signal", () => {
  assert.equal(reviewDate("2026-01-01T10:25:00Z").toISOString().slice(0, 10), "2026-03-29");
});

test("rule sentences and the odds horizon know Strong trend", () => {
  assert.match(ruleSentence("strong_trend", "buy"), /52-week high/);
  assert.match(ruleSentence("strong_trend", "exit", "STOP_HIT"), /safety stop/);
  assert.match(ruleSentence("strong_trend", "exit", "REVIEW_60"), /60 trading sessions/);
  assert.equal(defaultHorizon("strong_trend"), 20);
});

test("tested record: internally consistent", () => {
  const t = STRONG_TREND_TESTED;
  assert.ok(t.madeMoneyPct > 0 && t.madeMoneyPct < 100);
  assert.ok(t.avgWinPct > 0 && t.avgLossPct < 0);
  assert.ok(t.higher20Pct > t.randomHigher20Pct);
});
