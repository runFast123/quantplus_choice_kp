// Unit tests for "Am I too late?" (the Head-start meter): npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { HEAD_START } from "./head-start-data";
import { BANDS, MIN_TRADES, rowsFor, stageOf, summaryOf, verdictOf, type RuleRow } from "./head-start";
import { RULE_KEYS } from "./rules";

describe("stage of a price against its 1-year range", () => {
  test("bands follow how far the price is above the low", () => {
    assert.equal(stageOf(110, 100, 200)?.band, "<25%");
    assert.equal(stageOf(125, 100, 200)?.band, "25-50%");
    assert.equal(stageOf(199, 100, 300)?.band, "50-100%");
    assert.equal(stageOf(200, 100, 300)?.band, ">=100%");
  });
  test("position and the plain word for it", () => {
    const s = stageOf(175, 100, 200)!;
    assert.equal(s.position, 0.75);
    assert.equal(s.where, "near the top");
    assert.equal(stageOf(100, 100, 200)!.where, "near the bottom");
    assert.equal(stageOf(140, 100, 200)!.where, "in the lower half");
  });
  test("a price outside the stored range is clamped, the run still measured", () => {
    const s = stageOf(250, 100, 200)!;
    assert.equal(s.position, 1);
    assert.equal(s.run, 1.5);
  });
  test("missing or empty ranges give no stage", () => {
    assert.equal(stageOf(null, 100, 200), null);
    assert.equal(stageOf(150, null, 200), null);
    assert.equal(stageOf(150, 100, 100), null);
    assert.equal(stageOf(150, 0, 200), null);
  });
});

describe("verdict against the rule's own median", () => {
  const rule = { n: 500, win: 55, median: 2 };
  test("too few trades never get a verdict", () => {
    assert.equal(verdictOf({ n: MIN_TRADES - 1, win: 90, median: 20 }, rule), "too few");
  });
  test("within one point is about the same", () => {
    assert.equal(verdictOf({ n: 100, win: 55, median: 2.9 }, rule), "about the same");
    assert.equal(verdictOf({ n: 100, win: 60, median: 3.5 }, rule), "better");
    assert.equal(verdictOf({ n: 100, win: 40, median: -1 }, rule), "worse");
  });
});

describe("rows and summary from the tested record", () => {
  test("every live rule has every band and both periods", () => {
    for (const k of RULE_KEYS) {
      const rec = HEAD_START[k];
      assert.ok(rec, k);
      for (const b of BANDS) for (const p of ["all", "2019-23", "2024-26"] as const) assert.ok(rec.bands[b.key][p], `${k} ${b.key} ${p}`);
    }
  });
  test("the dip rules did better from more than double the low, in both periods (the study's finding)", () => {
    const rows = rowsFor(">=100%");
    for (const k of ["rsi_dip", "kk_dip"]) assert.equal(rows.find((r) => r.rule === k)!.steady, "better", k);
  });
  test("one row per rule, in display order", () => {
    assert.deepEqual(rowsFor("<25%").map((r) => r.rule), [...RULE_KEYS]);
  });
  test("the summary names steady rules and counts the rest", () => {
    const row = (name: string, steady: RuleRow["steady"]) => ({ name, steady }) as RuleRow;
    assert.equal(
      summaryOf([row("A", "better"), row("B", "better"), row("C", null)]),
      "In the tested record, A and B did better from this stage than on average, in both periods. For the other rule the two periods disagree or there were too few trades.",
    );
    assert.match(summaryOf([row("A", null)]), /no rule did steadily better or worse/);
  });
  test("the copy never claims that early is better", () => {
    for (const b of BANDS) assert.doesNotMatch(summaryOf(rowsFor(b.key)), /earl(y|ier)/i);
  });
});
