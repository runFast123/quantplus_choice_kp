// Unit tests for the admin Signals tab helpers (ADR-063):  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyFilters,
  fromSignal,
  fromWatch,
  groupByStock,
  headline,
  istDay,
  parseFilters,
  ruleCounts,
  signalsHref,
  sizeOf,
  type StockInfo,
} from "./admin-signals";
import { RULE_KEYS } from "./rules";

// Shapes as stored on 18 Nov 2026 (trading_signals.payload, signal_watch).
const sig = (symbol: string, strategy: string, payload: Record<string, unknown>) => ({ symbol, strategy, generated_at: "2026-11-18T10:15:00Z", payload });
const signals = [
  sig("AAA", "sma_trend", { action: "buy", close: 650, stop: 514.26, label: "SMA 20/50 trend" }),
  sig("AAA", "supertrend_breakout", { action: "buy", close: 651, label: "SuperTrend breakout" }),
  sig("BBB", "rsi_dip", { action: "buy", fill: 2150.16, close: 2150.16, stop: 1665.44, signal_day: "2026-11-17", label: "RSI dip" }),
  sig("CCC", "ma200_trend", { action: "exit", close: 649.9, pnl_pct: -0.25, label: "200-day trend: 60-session review" }),
  sig("OLD", "rsi_reversal", { action: "buy", close: 10 }),
  sig("ODD", "sma_trend", { action: "note" }),
].map(fromSignal);
const levels = [
  { symbol: "AAA", strategy: "rsi_dip", signal_day: "2026-11-18", limit_price: "1105.96", stop: "752.75", payload: { signal_close: 1176.6 } },
  { symbol: "DDD", strategy: "kk_dip", signal_day: "2026-11-18", limit_price: 90, stop: 70, payload: null },
].map(fromWatch);
const day = [...signals, ...levels].filter((s) => s != null);
const info = new Map<string, StockInfo>([
  ["AAA", { name: "Alpha Industries", sector: "Metals", segment: "equity", rank: 40, last: 652, changePct: 1.2 }],
  ["BBB", { name: "Beta Pharma", sector: "Pharma", segment: "equity", rank: 700, last: 2160, changePct: -3.5 }],
  ["CCC", { name: "Gamma Ltd", sector: "Metals", segment: "sme", rank: null, last: 650, changePct: 0 }],
  ["DDD", { name: "Delta Corp", sector: null, segment: "equity", rank: 120, last: 95, changePct: 0.4 }],
]);
const rows = groupByStock(day, info);
const f = (sp: Record<string, string> = {}) => parseFilters(sp);
const syms = (sp: Record<string, string> = {}) => applyFilters(rows, f(sp)).map((r) => r.symbol);

test("admin signals: stored rows read as buys, levels and exits; old rules and other rows drop", () => {
  assert.equal(signals.filter(Boolean).length, 4);
  const dip = signals[2]!;
  assert.deepEqual([dip.kind, dip.limit, dip.stop, dip.checkDay], ["buy", 2150.16, 1665.44, "2026-11-17"]); // keyed on the setup close
  const exit = signals[3]!;
  assert.deepEqual([exit.kind, exit.resultPct, exit.how, exit.stop], ["exit", -0.25, "60-session review", null]);
  assert.equal(signals[0]!.checkDay, "2026-11-18");
  assert.deepEqual([levels[0]!.kind, levels[0]!.limit, levels[0]!.close, levels[0]!.checkDay], ["level", 1105.96, 1176.6, "2026-11-18"]);
  assert.equal(istDay("2026-11-18T19:00:00Z"), "2026-11-19"); // after 18:30 UTC it is the next day in India
});

test("admin signals: one row per stock, rules in the app's order, counts per rule", () => {
  const a = rows.find((r) => r.symbol === "AAA")!;
  assert.deepEqual(a.rules, ["sma_trend", "supertrend_breakout", "rsi_dip"]);
  assert.deepEqual([a.buys, a.levels, a.exits], [2, 1, 0]);
  const counts = ruleCounts(day);
  assert.deepEqual(counts.map((c) => c.rule), [...RULE_KEYS]); // every rule, fired or not
  const by = new Map(counts.map((c) => [c.rule, c]));
  assert.deepEqual(by.get("rsi_dip"), { rule: "rsi_dip", buys: ["BBB"], levels: ["AAA"], exits: [] });
  assert.deepEqual(by.get("strong_trend")?.buys, []);
  assert.deepEqual(headline(rows), { stocksBuying: 3, buys: 3, levels: 2, exits: 1, multi: 1 });
});

test("admin signals: filters and sorts", () => {
  assert.deepEqual(syms(), ["AAA", "DDD", "BBB"]); // default: buys and dip levels, most rules first, then the larger
  assert.deepEqual(syms({ show: "exit" }), ["CCC"]);
  assert.deepEqual(syms({ show: "level" }), ["AAA", "DDD"]);
  assert.deepEqual(syms({ show: "all", rule: "rsi_dip" }), ["AAA", "BBB"]);
  assert.deepEqual(applyFilters(rows, f({ rule: "rsi_dip" }))[0].signals.map((s) => s.strategy), ["rsi_dip"]); // only that rule's lines
  assert.deepEqual(syms({ multi: "1" }), ["AAA"]);
  assert.deepEqual(syms({ multi: "1", rule: "rsi_dip" }), ["AAA"]); // RSI dip's stocks that another rule also picked
  assert.deepEqual(syms({ size: "top1000" }), ["BBB"]);
  assert.deepEqual(syms({ show: "all", segment: "sme" }), ["CCC"]);
  assert.deepEqual(syms({ sector: "Metals", show: "all" }), ["AAA", "CCC"]);
  assert.deepEqual(syms({ find: "beta" }), ["BBB"]);
  assert.deepEqual(syms({ find: "ddd" }), ["DDD"]);
  assert.deepEqual(syms({ sort: "move" }), ["BBB", "AAA", "DDD"]);
  assert.deepEqual(syms({ sort: "symbol" }), ["AAA", "BBB", "DDD"]);
});

test("admin signals: the URL keeps only what is set; unknown values fall back", () => {
  assert.deepEqual(f({ rule: "nope", show: "__proto__", size: "toString", sort: "x", segment: "etf" }), f());
  assert.equal(signalsHref("2026-11-18", f()), "/admin?tab=signals&day=2026-11-18");
  assert.equal(
    signalsHref("2026-11-18", f({ show: "exit" }), { rule: "kk_dip", multi: true, q: "tata" }),
    "/admin?tab=signals&day=2026-11-18&rule=kk_dip&show=exit&find=tata&multi=1",
  );
  assert.deepEqual(
    [1, 100, 101, 500, 1000, 1001, null].map(sizeOf),
    ["top100", "top100", "top500", "top500", "top1000", "rest", "rest"],
  );
});
