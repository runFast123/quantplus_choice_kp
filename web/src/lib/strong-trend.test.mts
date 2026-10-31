import assert from "node:assert/strict";
import { test } from "node:test";
import { reviewDate, STRONG_TREND_TESTED, strongTrendStatus, weatherView } from "./strong-trend";
import { ruleSentence } from "./signal-trade";
import { defaultHorizon } from "./trade-odds";

test("weather: each state says whether Strong trend is on, and why", () => {
  const sunny = weatherView({ state: "sunny", nifty: 110, sma50: 105, sma200: 100, vix: 13.2 });
  assert.match(sunny.sentence, /signals are on/);
  assert.match(sunny.sentence, /VIX 13\.2/);
  assert.match(weatherView({ state: "mixed", vix: null }).sentence, /wait for a sunny market/);
  const downtrend = weatherView({ state: "stormy", nifty: 95, sma50: 98, sma200: 100, vix: 15.3 });
  assert.match(downtrend.sentence, /^The Nifty 50 and its 50-day average are below the 200-day average \(India VIX 15\.3 is calm\)\. .*pause/);
  const nervous = weatherView({ state: "stormy", nifty: 110, sma50: 105, sma200: 100, vix: 24 });
  assert.match(nervous.sentence, /^The market is nervous \(India VIX 24\.0, above 22\)\./);
  assert.doesNotMatch(nervous.sentence, /below the 200-day/);
  assert.equal(weatherView({ state: null }).label, "Unknown");
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

test("SMA 20/50 trend: same plan as Strong trend, a leader's cross, better than the old cross", async () => {
  const { isTrendRule, SMA_TREND_TESTED } = await import("./strong-trend");
  const { strategyLabel } = await import("./format");
  assert.ok(isTrendRule("sma_trend") && isTrendRule("strong_trend") && !isTrendRule("sma_20_50_cross"));
  assert.equal(strategyLabel.sma_trend, "SMA 20/50 trend");
  assert.equal(strategyLabel.sma_20_50_cross, "SMA 20/50 cross (old rule)");
  assert.match(ruleSentence("sma_trend", "buy"), /market leader/);
  assert.match(ruleSentence("sma_trend", "exit", "REVIEW_60"), /60 trading sessions/);
  assert.equal(defaultHorizon("sma_trend"), 20);
  assert.ok(SMA_TREND_TESTED.madeMoneyPct > SMA_TREND_TESTED.before.madeMoneyPct);
  assert.ok(SMA_TREND_TESTED.recent.madeMoneyPct > SMA_TREND_TESTED.before.recentMadeMoneyPct);
});
