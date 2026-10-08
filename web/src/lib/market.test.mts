// Unit tests for NSE session clock and holiday calendar: npm run test:unit
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { nseSession, NSE_HOLIDAYS, toTradingViewSymbol, toTradingViewWidgetSymbol } from "./market";

describe("NSE Holiday Calendar & Session Clock", () => {
  test("identifies official NSE trading holidays", () => {
    // 2026 Republic Day: Monday Jan 26, 2026
    // In IST (+05:30), 10:00 AM IST = 04:30 AM UTC
    const republicDay = new Date("2026-01-26T04:30:00Z");
    const res = nseSession(republicDay);

    assert.equal(res.isHoliday, true);
    assert.equal(res.holidayName, "Republic Day");
    assert.equal(res.state, "closed");
    assert.equal(res.label, "Closed · Republic Day");
  });

  test("identifies Gandhi Jayanti holiday", () => {
    // 2026 Gandhi Jayanti: Friday Oct 2, 2026
    const gandhiJayanti = new Date("2026-10-02T05:00:00Z");
    const res = nseSession(gandhiJayanti);

    assert.equal(res.isHoliday, true);
    assert.equal(res.holidayName, "Gandhi Jayanti");
    assert.equal(res.state, "closed");
    assert.equal(res.label, "Closed · Gandhi Jayanti");
  });

  test("handles Diwali Laxmi Pujan special Muhurat trading session", () => {
    // 2026-11-08: 14:00 IST (08:30 UTC) -> Before Muhurat session
    const diwaliAfternoon = new Date("2026-11-08T08:30:00Z");
    const resAfternoon = nseSession(diwaliAfternoon);
    assert.equal(resAfternoon.state, "closed");
    assert.equal(resAfternoon.label, "Muhurat session 18:15");

    // 2026-11-08: 18:30 IST (13:00 UTC) -> During Muhurat session
    const diwaliMuhurat = new Date("2026-11-08T13:00:00Z");
    const resMuhurat = nseSession(diwaliMuhurat);
    assert.equal(resMuhurat.state, "open");
    assert.equal(resMuhurat.label, "Muhurat session open");
  });

  test("identifies weekends", () => {
    // Saturday Jan 17, 2026 at 11:00 IST (05:30 UTC)
    const saturday = new Date("2026-01-17T05:30:00Z");
    const res = nseSession(saturday);

    assert.equal(res.isWeekend, true);
    assert.equal(res.state, "closed");
    assert.equal(res.label, "Closed · weekend");
  });

  test("identifies regular market open session", () => {
    // Wednesday Jan 21, 2026 at 11:30 IST (06:00 UTC)
    const midSession = new Date("2026-01-21T06:00:00Z");
    const res = nseSession(midSession);

    assert.equal(res.isHoliday, false);
    assert.equal(res.isWeekend, false);
    assert.equal(res.state, "open");
    assert.equal(res.label, "Market open");
  });

  test("identifies pre-open session", () => {
    // Wednesday Jan 21, 2026 at 09:05 IST (03:35 UTC)
    const preOpen = new Date("2026-01-21T03:35:00Z");
    const res = nseSession(preOpen);

    assert.equal(res.state, "pre-open");
    assert.equal(res.label, "Pre-open");
  });

  test("contains valid dates across holiday dictionary", () => {
    assert.ok(Object.keys(NSE_HOLIDAYS).length >= 35);
    for (const [dateStr, name] of Object.entries(NSE_HOLIDAYS)) {
      assert.match(dateStr, /^\d{4}-\d{2}-\d{2}$/);
      assert.ok(name.length > 2);
    }
  });
});

describe("TradingView Symbol Formatter", () => {
  test("formats standard NSE equities", () => {
    assert.equal(toTradingViewSymbol("TCS"), "NSE:TCS");
    assert.equal(toTradingViewSymbol("RELIANCE"), "NSE:RELIANCE");
    assert.equal(toTradingViewSymbol("INFY"), "NSE:INFY");
  });

  test("handles special characters in tickers", () => {
    assert.equal(toTradingViewSymbol("M&M"), "NSE:M_M");
    assert.equal(toTradingViewSymbol("BAJAJ-AUTO"), "NSE:BAJAJ_AUTO");
    assert.equal(toTradingViewSymbol("L&TFH"), "NSE:L_TFH");
  });

  test("maps major NSE indices correctly", () => {
    assert.equal(toTradingViewSymbol("NIFTY"), "NSE:NIFTY");
    assert.equal(toTradingViewSymbol("NIFTY 50"), "NSE:NIFTY");
    assert.equal(toTradingViewSymbol("BANKNIFTY"), "NSE:BANKNIFTY");
    assert.equal(toTradingViewSymbol("NIFTYIT"), "NSE:CNXIT");
    assert.equal(toTradingViewSymbol("INDIAVIX"), "NSE:INDIAVIX");
  });

  test("handles BSE exchange selection", () => {
    assert.equal(toTradingViewSymbol("TCS", "BSE"), "BSE:TCS");
    assert.equal(toTradingViewSymbol("500325", "BSE"), "BSE:500325");
  });

  test("formats embed widget symbols using BSE to avoid Apple fallback", () => {
    assert.equal(toTradingViewWidgetSymbol("HDFCBANK"), "BSE:HDFCBANK");
    assert.equal(toTradingViewWidgetSymbol("TCS"), "BSE:TCS");
    assert.equal(toTradingViewWidgetSymbol("M&M"), "BSE:M_M");
    assert.equal(toTradingViewWidgetSymbol("NIFTY"), "NSE:NIFTY");
  });
});


