"use client";

import { useId, useMemo, useState } from "react";
import {
  CheckIcon,
  CircleNotchIcon,
  FileArrowUpIcon,
  InfoIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import { importHoldingsCsv, type ImportResult } from "@/app/app/portfolio/actions";
import { parseHoldingsCsv } from "@/lib/csv-parser";
import { price } from "@/lib/format";
import type { Portfolio } from "@/lib/types";

interface CsvImportModalProps {
  portfolios: Portfolio[];
}

export function CsvImportModal({ portfolios }: CsvImportModalProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [rawText, setRawText] = useState("");
  const [selectedPortfolioId, setSelectedPortfolioId] = useState<string>(
    portfolios[0]?.id ?? "",
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const fileInputId = useId();

  // Instant preview parsing
  const preview = useMemo(() => {
    if (!rawText.trim()) return null;
    return parseHoldingsCsv(rawText);
  }, [rawText]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const content = evt.target?.result;
      if (typeof content === "string") {
        setRawText(content);
        setImportResult(null);
      }
    };
    reader.readAsText(file);
  };

  const handleImport = async () => {
    if (!preview || preview.validRows.length === 0) return;
    setIsSubmitting(true);
    setImportResult(null);

    try {
      const res = await importHoldingsCsv(selectedPortfolioId, rawText);
      setImportResult(res);
      if (res.ok) {
        setRawText("");
      }
    } catch (err: unknown) {
      setImportResult({
        ok: false,
        error: err instanceof Error ? err.message : "Failed to import holdings.",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-foreground/[0.04]"
      >
        <FileArrowUpIcon size={16} aria-hidden />
        <span>Import CSV</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fadeIn">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h2 className="display text-[20px] font-medium leading-none text-foreground">
                  Import Holdings from Broker CSV
                </h2>
                <p className="mt-1 text-[12.5px] text-muted-foreground">
                  Supports Zerodha Console, Groww, Angel One, Upstox, Dhan &amp; generic spreadsheets.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setImportResult(null);
                }}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
                aria-label="Close"
              >
                <XIcon size={18} />
              </button>
            </div>

            {/* Body */}
            <div className="flex flex-col gap-4 overflow-y-auto p-5 text-[13px]">
              {/* Portfolio destination */}
              {portfolios.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="target-portfolio" className="eyebrow">
                    Destination Portfolio
                  </label>
                  <select
                    id="target-portfolio"
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

              {/* File upload dropzone & text input */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="eyebrow">Upload File or Paste CSV Data</span>
                  <label
                    htmlFor={fileInputId}
                    className="cursor-pointer text-[12px] font-medium text-foreground underline underline-offset-4 hover:text-foreground/80"
                  >
                    Browse .csv file
                  </label>
                  <input
                    id={fileInputId}
                    type="file"
                    accept=".csv,.tsv,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>

                <textarea
                  rows={4}
                  value={rawText}
                  onChange={(e) => {
                    setRawText(e.target.value);
                    setImportResult(null);
                  }}
                  placeholder="Paste CSV rows here, or click 'Browse .csv file' above...&#10;e.g.&#10;Instrument,Qty.,Avg. cost&#10;RELIANCE,25,2450.00&#10;INFY,50,1420.50"
                  className="font-mono text-[12px] leading-relaxed w-full rounded-md border border-input bg-background/50 p-3 text-foreground placeholder:text-muted-foreground/60 focus:border-foreground focus:outline-none"
                />
              </div>

              {/* Supported format badges */}
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">Recognized columns:</span>
                <span className="rounded bg-muted px-1.5 py-0.5">Symbol / Instrument / Ticker</span>
                <span className="rounded bg-muted px-1.5 py-0.5">Qty / Quantity / Shares</span>
                <span className="rounded bg-muted px-1.5 py-0.5">Avg Cost / Buy Avg / Price</span>
              </div>

              {/* Preview table */}
              {preview && (
                <div className="flex flex-col gap-2 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <span className="eyebrow">
                      Detected {preview.validRows.length} valid position
                      {preview.validRows.length === 1 ? "" : "s"}
                      {preview.rows.length > preview.validRows.length
                        ? ` (${preview.rows.length - preview.validRows.length} ignored)`
                        : ""}
                    </span>
                    {preview.validRows.length > 0 && (
                      <span className="text-[11.5px] text-muted-foreground">
                        Ready for import
                      </span>
                    )}
                  </div>

                  <div className="max-h-48 overflow-y-auto rounded border border-border">
                    <table className="w-full text-left text-[12px]">
                      <thead className="sticky top-0 bg-muted/60 text-muted-foreground border-b border-border">
                        <tr>
                          <th className="px-3 py-1.5 font-medium">Symbol</th>
                          <th className="px-3 py-1.5 font-medium text-right">Quantity</th>
                          <th className="px-3 py-1.5 font-medium text-right">Avg Price</th>
                          <th className="px-3 py-1.5 font-medium text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {preview.rows.slice(0, 50).map((row, idx) => (
                          <tr
                            key={`${row.cleanSymbol}-${idx}`}
                            className={row.isValid ? "hover:bg-foreground/[0.02]" : "bg-loss-soft/20 text-muted-foreground"}
                          >
                            <td className="px-3 py-1.5 font-mono font-medium text-foreground">
                              {row.cleanSymbol || row.rawSymbol || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {row.quantity > 0 ? row.quantity.toLocaleString("en-IN") : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono">
                              {row.avgPrice > 0 ? `₹${price(row.avgPrice)}` : "—"}
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              {row.isValid ? (
                                <span className="inline-flex items-center gap-1 text-[11px] text-gain">
                                  <CheckIcon size={12} weight="bold" /> Ready
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-[11px] text-loss">
                                  <WarningCircleIcon size={12} /> {row.error}
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Status Message */}
              {importResult && (
                <div
                  className={`rounded-md p-3 text-[12.5px] border ${
                    importResult.ok
                      ? "border-gain/40 bg-gain-soft/30 text-gain"
                      : "border-loss/40 bg-loss-soft/30 text-loss"
                  }`}
                >
                  {importResult.ok ? (
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-1.5 font-medium">
                        <CheckIcon size={15} weight="bold" />
                        <span>
                          Import complete: {importResult.imported ?? 0} positions added,{" "}
                          {importResult.updated ?? 0} existing positions merged.
                        </span>
                      </div>
                      {Boolean(importResult.skipped) && (
                        <p className="text-[11.5px] text-muted-foreground">
                          {importResult.skipped} positions were skipped (not in registry or inactive).
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <WarningCircleIcon size={15} />
                      <span>{importResult.error || "Failed to process holdings."}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Informational note */}
              <div className="flex items-start gap-2 rounded border border-border/80 bg-background/50 p-2.5 text-[11.5px] text-muted-foreground">
                <InfoIcon size={15} className="mt-0.5 shrink-0 text-foreground" aria-hidden />
                <span>
                  <strong>Weighted Average Merging:</strong> If you import a stock you already own, QuantPulse automatically blends the new quantity at the volume-weighted purchase price.
                </span>
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2.5 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  setImportResult(null);
                }}
                className="rounded-md border border-border px-3.5 py-1.5 text-[13px] font-medium text-foreground hover:bg-foreground/[0.04]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!preview || preview.validRows.length === 0 || isSubmitting}
                onClick={handleImport}
                className="inline-flex items-center gap-1.5 rounded-md bg-foreground px-4 py-1.5 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
              >
                {isSubmitting ? (
                  <>
                    <CircleNotchIcon size={14} className="animate-spin" aria-hidden />
                    <span>Importing…</span>
                  </>
                ) : (
                  <span>
                    Import {preview?.validRows.length ? `${preview.validRows.length} ` : ""}Positions
                  </span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
