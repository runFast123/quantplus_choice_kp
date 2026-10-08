"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  ChartLineUpIcon,
  RepeatIcon,
} from "@phosphor-icons/react";
import { Delta } from "@/components/ui/data";
import { TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import {
  simulateSip,
  simulateTechnicalStrategy,
  type StrategyResult,
} from "@/lib/backtest-engine";
import { price, rupees } from "@/lib/format";
import type { Candle } from "@/lib/types";

interface BacktestLabProps {
  candles: Candle[];
  symbol: string;
}

export function BacktestLab({ candles, symbol }: BacktestLabProps) {
  const [activeTab, setActiveTab] = useState<"sip" | "strategy">("sip");
  const [monthlyAmount, setMonthlyAmount] = useState<number>(10000);
  const [strategyType, setStrategyType] = useState<"sma_cross" | "rsi_pullback">("sma_cross");

  // Run dynamic SIP simulation
  const sipResult = useMemo(() => {
    return simulateSip(candles, monthlyAmount);
  }, [candles, monthlyAmount]);

  // Run technical rule simulation
  const stratResult: StrategyResult | null = useMemo(() => {
    return simulateTechnicalStrategy(candles, strategyType);
  }, [candles, strategyType]);

  const SIP_PRESETS = [5000, 10000, 25000, 50000];

  return (
    <div className="flex flex-col gap-4">
      {/* Mode Switcher Tabs */}
      <div className="flex items-center justify-between border-b border-border pb-2.5">
        <div className="flex items-center gap-1.5" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "sip"}
            onClick={() => setActiveTab("sip")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors",
              activeTab === "sip"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
          >
            <RepeatIcon size={14} aria-hidden />
            <span>SIP vs Lump Sum</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "strategy"}
            onClick={() => setActiveTab("strategy")}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors",
              activeTab === "strategy"
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
            )}
          >
            <ChartLineUpIcon size={14} aria-hidden />
            <span>Rule Strategy Simulation</span>
          </button>
        </div>

        <span className="num text-[11px] text-muted-foreground">
          {candles.length} historical bars
        </span>
      </div>

      {activeTab === "sip" && sipResult && (
        <div className="flex flex-col gap-4">
          {/* Controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Monthly SIP:</span>
              <div className="flex items-center gap-1.5">
                {SIP_PRESETS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    onClick={() => setMonthlyAmount(amt)}
                    className={clsx(
                      "num rounded border px-2 py-0.5 text-[11.5px] font-medium transition-colors",
                      monthlyAmount === amt
                        ? "border-foreground bg-foreground/5 text-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/30",
                    )}
                  >
                    ₹{amt.toLocaleString("en-IN")}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label htmlFor="custom-sip" className="eyebrow">Custom ₹:</label>
              <input
                id="custom-sip"
                type="number"
                step="1000"
                min="500"
                value={monthlyAmount}
                onChange={(e) => setMonthlyAmount(Math.max(500, Number(e.target.value) || 500))}
                className="num h-7 w-24 rounded border border-input bg-card px-2 text-[12px] text-foreground focus:border-foreground focus:outline-none"
              />
            </div>
          </div>

          {/* Performance strip */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 border-y border-border py-3 text-[13px]">
            <div>
              <p className="eyebrow">Total Invested</p>
              <p className="num mt-1 text-[16px] font-medium text-foreground">
                {rupees(sipResult.totalInvested, { decimals: false })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {sipResult.durationMonths} monthly installments
              </p>
            </div>

            <div>
              <p className="eyebrow">SIP Value Today</p>
              <p className="num mt-1 text-[16px] font-medium text-foreground">
                {rupees(sipResult.finalValue, { decimals: false })}
              </p>
              <p className="num text-[11px] text-muted-foreground">
                {sipResult.totalUnits.toFixed(2)} shares accumulated
              </p>
            </div>

            <div>
              <p className="eyebrow">SIP Return</p>
              <div className="mt-1 text-[16px] font-medium">
                <Delta value={sipResult.roiPct} />
              </div>
              <p className="text-[11px] text-muted-foreground">Dollar-cost averaged</p>
            </div>

            <div>
              <p className="eyebrow">Lump Sum Benchmark</p>
              <div className="mt-1 text-[16px] font-medium">
                <Delta value={sipResult.lumpSumRoiPct} />
              </div>
              <p className="num text-[11px] text-muted-foreground">
                {rupees(sipResult.lumpSumFinalValue, { decimals: false })} if upfront
              </p>
            </div>
          </div>

          {/* Monthly ledger */}
          <TableWrap>
            <table className="w-full min-w-[420px]">
              <thead>
                <tr>
                  <th className={th}>Month</th>
                  <th className={thNum}>Price</th>
                  <th className={thNum}>Units Acquired</th>
                  <th className={thNum}>Invested</th>
                  <th className={thNum}>Portfolio Value</th>
                </tr>
              </thead>
              <tbody>
                {sipResult.entries.slice(-8).reverse().map((e) => (
                  <tr key={e.date} className={tr}>
                    <td className={td + " num text-muted-foreground"}>{e.date}</td>
                    <td className={tdNum}>{price(e.price)}</td>
                    <td className={tdNum}>{Number(e.units).toFixed(3)}</td>
                    <td className={tdNum}>{rupees(e.cumulativeInvested, { decimals: false })}</td>
                    <td className={tdNum}>{rupees(e.currentValue, { decimals: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </div>
      )}

      {activeTab === "strategy" && (
        <div className="flex flex-col gap-4">
          {/* Strategy selector */}
          <div className="flex items-center gap-3">
            <span className="eyebrow">Strategy:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setStrategyType("sma_cross")}
                className={clsx(
                  "rounded border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  strategyType === "sma_cross"
                    ? "border-foreground bg-foreground/5 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/30",
                )}
              >
                SMA 20/50 Golden Cross
              </button>
              <button
                type="button"
                onClick={() => setStrategyType("rsi_pullback")}
                className={clsx(
                  "rounded border px-2.5 py-1 text-[12px] font-medium transition-colors",
                  strategyType === "rsi_pullback"
                    ? "border-foreground bg-foreground/5 text-foreground"
                    : "border-border text-muted-foreground hover:border-foreground/30",
                )}
              >
                SMA 20 Pullback &amp; Trail
              </button>
            </div>
          </div>

          {stratResult ? (
            <>
              {/* Metrics */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 border-y border-border py-3 text-[13px]">
                <div>
                  <p className="eyebrow">Cumulative Return</p>
                  <div className="mt-1 text-[16px] font-medium">
                    <Delta value={stratResult.totalReturnPct} />
                  </div>
                  <p className="text-[11px] text-muted-foreground">Sum of trade returns</p>
                </div>

                <div>
                  <p className="eyebrow">Win Rate</p>
                  <p className="num mt-1 text-[16px] font-medium text-foreground">
                    {stratResult.winRatePct}%
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {stratResult.totalTrades} closed trade{stratResult.totalTrades === 1 ? "" : "s"}
                  </p>
                </div>

                <div>
                  <p className="eyebrow">Profit Factor</p>
                  <p className="num mt-1 text-[16px] font-medium text-foreground">
                    {stratResult.profitFactor}x
                  </p>
                  <p className="text-[11px] text-muted-foreground">Gross gain / gross loss</p>
                </div>

                <div>
                  <p className="eyebrow">Max Drawdown</p>
                  <p className="num mt-1 text-[16px] font-medium text-loss">
                    −{stratResult.maxDrawdownPct}%
                  </p>
                  <p className="text-[11px] text-muted-foreground">Peak-to-trough decline</p>
                </div>
              </div>

              {/* Trade Log */}
              {stratResult.trades.length > 0 ? (
                <TableWrap>
                  <table className="w-full min-w-[420px]">
                    <thead>
                      <tr>
                        <th className={th}>Entry</th>
                        <th className={thNum}>Entry ₹</th>
                        <th className={th}>Exit</th>
                        <th className={thNum}>Exit ₹</th>
                        <th className={thNum}>Duration</th>
                        <th className={thNum}>P&amp;L</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stratResult.trades.slice(-6).reverse().map((t, idx) => (
                        <tr key={`${t.entryDate}-${idx}`} className={tr}>
                          <td className={td + " num text-muted-foreground"}>{t.entryDate}</td>
                          <td className={tdNum}>{price(t.entryPrice)}</td>
                          <td className={td + " num text-muted-foreground"}>{t.exitDate}</td>
                          <td className={tdNum}>{price(t.exitPrice)}</td>
                          <td className={tdNum}>{t.barsHeld}d</td>
                          <td className={tdNum}>
                            <Delta value={t.pnlPct} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">
                  No crossover triggers occurred in this historical time window for {symbol}.
                </p>
              )}
            </>
          ) : (
            <p className="text-[12.5px] text-muted-foreground">
              Insufficient candle history to run strategy simulation.
            </p>
          )}
        </div>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Simulated on daily historical NSE candles. Past performance does not guarantee future results. Research only.
      </p>
    </div>
  );
}
