import test from "node:test";
import assert from "node:assert/strict";
import { calculatePortfolioHealth, type HealthPosition } from "./portfolio-health.js";

test("calculatePortfolioHealth returns default report for empty positions", () => {
  const report = calculatePortfolioHealth([]);
  assert.equal(report.positionCount, 0);
  assert.equal(report.totalValue, 0);
  assert.equal(report.hhi, 0);
  assert.equal(report.scores.overall, 0);
  assert.equal(report.verdict, "High Concentration Risk");
  assert.equal(report.riskFlags.length, 0);
});

test("calculatePortfolioHealth computes correct HHI, effective N, and metrics for well-diversified portfolio", () => {
  // 10 positions equally weighted at 10% each (10 * 10^2 = 1000 HHI)
  const sectors = ["Financials", "IT", "Pharma", "Auto", "Energy", "FMCG", "Metals", "Realty", "Media", "Telecom"];
  const positions: HealthPosition[] = sectors.map((sec, i) => ({
    symbol: `STOCK${i}`,
    quantity: 10,
    avgPrice: 100,
    lastPrice: 110, // In profit
    value: 1100,
    invested: 1000,
    totalPnl: 100,
    totalPct: 10,
    sector: sec,
    rsi: 55,
  }));

  const report = calculatePortfolioHealth(positions);
  assert.equal(report.positionCount, 10);
  assert.equal(report.totalValue, 11000);
  assert.equal(report.totalInvested, 10000);
  assert.equal(report.totalPnl, 1000);
  assert.equal(report.totalPnlPct, 10);
  assert.equal(report.hhi, 1000);
  assert.equal(report.effectiveN, 10);
  assert.equal(report.concentrationRating, "well_diversified");
  assert.equal(report.topHolding?.weightPct, 10);
  assert.equal(report.topSector?.weightPct, 10);
  assert.equal(report.sectors.length, 10);
  assert.equal(report.rsiExhaustionCount, 0);
  assert.equal(report.underwaterCount, 0);
  assert.equal(report.winnerCount, 10);
  assert.equal(report.loserCount, 0);

  // Scores should be very high
  assert.ok(report.scores.overall >= 85, `Overall score was ${report.scores.overall}`);
  assert.equal(report.verdict, "Institutional Grade");
  const breadthFlag = report.riskFlags.find((f) => f.id === "optimal-breadth");
  assert.ok(breadthFlag, "Expected optimal-breadth positive flag");
});

test("calculatePortfolioHealth flags high single-stock and sector concentration", () => {
  const positions: HealthPosition[] = [
    {
      symbol: "MEGACAP",
      quantity: 100,
      avgPrice: 1000,
      lastPrice: 800, // 20% down
      value: 80000,   // 80% of 100,000
      sector: "Financials",
      rsi: 76,        // Overbought exhaustion
    },
    {
      symbol: "SMALLCAP",
      quantity: 200,
      avgPrice: 100,
      lastPrice: 100,
      value: 20000,   // 20%
      sector: "Financials",
      rsi: 28,        // Oversold
    },
  ];

  const report = calculatePortfolioHealth(positions);
  assert.equal(report.positionCount, 2);
  assert.equal(report.totalValue, 100000);
  // HHI: 80^2 + 20^2 = 6400 + 400 = 6800
  assert.equal(report.hhi, 6800);
  assert.equal(report.concentrationRating, "highly_concentrated");
  assert.equal(report.topHolding?.symbol, "MEGACAP");
  assert.equal(report.topHolding?.weightPct, 80);
  assert.equal(report.topSector?.sector, "Financials");
  assert.equal(report.topSector?.weightPct, 100);
  assert.equal(report.rsiExhaustionCount, 1);
  assert.equal(report.rsiOversoldCount, 1);
  assert.equal(report.underwaterCount, 1);
  assert.equal(report.verdict, "High Concentration Risk");

  // Check generated risk flags
  const singleStockRisk = report.riskFlags.find((f) => f.id === "single-stock-risk");
  assert.ok(singleStockRisk, "Expected single-stock-risk flag");

  const sectorRisk = report.riskFlags.find((f) => f.id === "sector-concentration");
  assert.ok(sectorRisk, "Expected sector-concentration flag");

  const rsiRisk = report.riskFlags.find((f) => f.id === "rsi-exhaustion");
  assert.ok(rsiRisk, "Expected rsi-exhaustion flag");

  const underwaterRisk = report.riskFlags.find((f) => f.id === "underwater-gap");
  assert.ok(underwaterRisk, "Expected underwater-gap flag");
});
