"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckIcon,
  CircleNotchIcon,
  FileTextIcon,
  ReceiptIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  applyParsedTrades,
  parseContractNoteAi,
} from "@/app/app/portfolio/actions";
import { price } from "@/lib/format";
import type { ParsedTrade } from "@/server/privileged/ai";
import type { Portfolio } from "@/lib/types";

interface ContractNoteModalProps {
  portfolios: Portfolio[];
  ready: boolean;
  reason?: string;
}

export function ContractNoteModal({
  portfolios,
  ready,
  reason,
}: ContractNoteModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>(
    portfolios[0]?.id ?? "",
  );
  const [isParsing, setIsParsing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [trades, setTrades] = useState<ParsedTrade[] | null>(null);
  const [modelInfo, setModelInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<{
    ok?: boolean;
    imported?: number;
    updated?: number;
    skipped?: number;
  } | null>(null);

  const handleParse = async () => {
    if (!noteText.trim() || isParsing) return;
    setIsParsing(true);
    setError(null);
    setTrades(null);
    setApplyResult(null);

    try {
      const res = await parseContractNoteAi(noteText);
      if (res.error) {
        setError(res.error);
      } else if (res.trades) {
        setTrades(res.trades);
        setModelInfo(res.model ?? "BYOK AI");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to parse note.");
    } finally {
      setIsParsing(false);
    }
  };

  const handleApply = async () => {
    if (!trades || !trades.length || isApplying) return;
    setIsApplying(true);
    setError(null);

    try {
      const res = await applyParsedTrades(selectedPortfolioId, trades);
      if (res.error) {
        setError(res.error);
      } else {
        setApplyResult(res);
        setTrades(null);
        setNoteText("");
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to apply trades.");
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
      >
        <ReceiptIcon size={16} aria-hidden />
        <span>Contract Note AI</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div className="flex items-center gap-2">
                <FileTextIcon size={20} className="text-foreground" aria-hidden />
                <div>
                  <h2 className="display text-[20px] font-medium leading-none text-foreground">
                    Import Contract Note
                  </h2>
                  <p className="mt-1 text-[12.5px] text-muted-foreground">
                    Zerodha, Groww, Angel One, ICICI Direct, Upstox &amp; HDFC Sec daily notes.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setError(null);
                  setApplyResult(null);
                }}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                aria-label="Close"
              >
                <XIcon size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-col gap-4 overflow-y-auto p-5 text-[13px]">
              {!ready ? (
                <div className="rounded-md border border-border bg-background/50 p-4 text-[12.5px] text-muted-foreground">
                  <p>
                    {reason}{" "}
                    <Link
                      href="/app/integrations"
                      className="text-foreground underline underline-offset-4"
                    >
                      Integrations
                    </Link>
                  </p>
                </div>
              ) : (
                <>
                  {portfolios.length > 1 && (
                    <div className="flex flex-col gap-1.5">
                      <label htmlFor="cn-portfolio" className="eyebrow">
                        Target Portfolio
                      </label>
                      <select
                        id="cn-portfolio"
                        value={selectedPortfolioId}
                        onChange={(e) => setSelectedPortfolioId(e.target.value)}
                        className="h-9 rounded-md border border-input bg-card px-2.5 text-[13px] text-foreground focus:border-foreground focus:outline-none"
                      >
                        {portfolios.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex flex-col gap-2">
                    <label htmlFor="cn-text" className="eyebrow">
                      Contract Note Content
                    </label>
                    <textarea
                      id="cn-text"
                      rows={5}
                      value={noteText}
                      onChange={(e) => {
                        setNoteText(e.target.value);
                        setError(null);
                      }}
                      placeholder="Open your broker's Contract Note PDF or email, select all text (Ctrl+A), copy (Ctrl+C), and paste here...&#10;&#10;e.g.&#10;Order No: 12345678 · INFOSYS LTD · BUY · Qty: 25 · Gross Rate: 1420.50&#10;Order No: 87654321 · RELIANCE IND · BUY · Qty: 10 · Gross Rate: 2450.00"
                      className="font-mono text-[12px] leading-relaxed w-full rounded-md border border-input bg-background/50 p-3 text-foreground placeholder:text-muted-foreground/60 focus:border-foreground focus:outline-none"
                    />
                  </div>

                  {/* Extract action */}
                  <div className="flex items-center justify-between">
                    <p className="text-[11.5px] text-muted-foreground">
                      Parsed with your BYOK AI key. PDF content is never saved or logged.
                    </p>
                    <button
                      type="button"
                      disabled={!noteText.trim() || isParsing}
                      onClick={handleParse}
                      className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-3.5 py-1.5 text-[12.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                    >
                      {isParsing ? (
                        <>
                          <CircleNotchIcon size={14} className="animate-spin" />
                          <span>Parsing with AI…</span>
                        </>
                      ) : (
                        <span>Extract Trades</span>
                      )}
                    </button>
                  </div>

                  {/* Error state */}
                  {error && (
                    <div className="flex items-center gap-2 rounded-md border border-loss/30 bg-loss-soft/30 p-3 text-[12.5px] text-loss">
                      <WarningCircleIcon size={16} aria-hidden />
                      <span>{error}</span>
                    </div>
                  )}

                  {/* Extracted Trades Review */}
                  {trades && (
                    <div className="flex flex-col gap-2.5 border-t border-border pt-3">
                      <div className="flex items-center justify-between">
                        <span className="eyebrow">
                          Extracted {trades.length} Trade{trades.length === 1 ? "" : "s"}
                        </span>
                        {modelInfo && (
                          <span className="num text-[11px] text-muted-foreground">
                            Extracted by {modelInfo}
                          </span>
                        )}
                      </div>

                      {trades.length === 0 ? (
                        <p className="text-[12.5px] text-muted-foreground">
                          No equity trades found in this snippet. Make sure to paste the trade breakdown table.
                        </p>
                      ) : (
                        <div className="max-h-48 overflow-y-auto rounded border border-border">
                          <table className="w-full text-left text-[12px]">
                            <thead className="sticky top-0 bg-muted/60 text-muted-foreground border-b border-border">
                              <tr>
                                <th className="px-3 py-1.5 font-medium">Action</th>
                                <th className="px-3 py-1.5 font-medium">Symbol</th>
                                <th className="px-3 py-1.5 font-medium text-right">Quantity</th>
                                <th className="px-3 py-1.5 font-medium text-right">Execution Price</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border/60">
                              {trades.map((t, idx) => (
                                <tr key={`${t.symbol}-${idx}`} className="hover:bg-foreground/[0.02]">
                                  <td className="px-3 py-1.5">
                                    <span
                                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                                        t.action === "BUY"
                                          ? "bg-gain-soft text-gain"
                                          : "bg-loss-soft text-loss"
                                      }`}
                                    >
                                      {t.action}
                                    </span>
                                  </td>
                                  <td className="px-3 py-1.5 font-mono font-medium text-foreground">
                                    {t.symbol}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono">
                                    {t.quantity.toLocaleString("en-IN")}
                                  </td>
                                  <td className="px-3 py-1.5 text-right font-mono">
                                    ₹{price(t.price)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Apply Success State */}
                  {applyResult && (
                    <div className="rounded-md border border-gain/40 bg-gain-soft/30 p-3 text-[12.5px] text-gain">
                      <div className="flex items-center gap-1.5 font-medium">
                        <CheckIcon size={15} weight="bold" />
                        <span>
                          Contract note applied: {applyResult.imported ?? 0} new positions added,{" "}
                          {applyResult.updated ?? 0} positions updated/closed.
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setError(null);
                  setApplyResult(null);
                }}
                className="rounded-md border border-border px-3.5 py-1.5 text-[13px] font-medium text-foreground hover:bg-foreground/[0.04]"
              >
                Close
              </button>
              {trades && trades.length > 0 && (
                <button
                  type="button"
                  disabled={isApplying}
                  onClick={handleApply}
                  className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-1.5 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isApplying ? (
                    <>
                      <CircleNotchIcon size={14} className="animate-spin" aria-hidden />
                      <span>Applying trades…</span>
                    </>
                  ) : (
                    <span>Confirm &amp; Apply {trades.length} Trades</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
