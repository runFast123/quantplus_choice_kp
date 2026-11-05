"use client";

import Link from "next/link";
import clsx from "clsx";
import { useId, useRef, useState } from "react";
import { ArrowLeftIcon, CheckCircleIcon, FileArrowUpIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { date, price, qty, rupees } from "@/lib/format";
import {
  BROKERS,
  csvRows,
  detectColumns,
  FIELD_LABEL,
  hash53,
  MAPPABLE,
  mergeTrades,
  missingFields,
  parseTradebook,
  type Broker,
  type Field,
  type Mapping,
  type SkippedRow,
  type TradebookRow,
} from "@/lib/tradebook";
import { readXlsx, XlsxError } from "@/lib/xlsx";
import { importTradebook, previewTradebook, undoImport, type ImportOutcome, type Review, type StockReview } from "@/app/app/portfolio/import/actions";

type Loaded = { name: string; rows: string[][]; headerRow: number; mapping: Mapping };
type Step = "broker" | "files" | "columns" | "review" | "done";
type Over = Partial<{ replace: string[]; exclude: string[]; aliases: Record<string, string> }>;

const REQUIRED: Field[] = ["date", "side", "quantity"];
const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* private window: the choice just isn't remembered */
    }
  },
};
const mappingKey = (broker: Broker, header: string[]) => `qp_tbcols:${broker}:${hash53(header.join("|").toLowerCase())}`;
const wire = (rows: TradebookRow[]) =>
  rows.map((t) => ({ line: t.line, file: t.file, date: t.date, time: t.time, symbol: t.symbol, name: t.name, isin: t.isin, side: t.side, quantity: t.quantity, price: t.price, ref: t.ref }));

/**
 * The tradebook import wizard (ADR-047): pick the broker, add files (read here, never uploaded), match columns when
 * they are not recognised, review every stock against a dry run, then import in one go with an undo.
 */
export function TradebookImport({ portfolios, holdingsUsed }: { portfolios: { id: string; name: string }[]; holdingsUsed: number }) {
  const [step, setStep] = useState<Step>("broker");
  const [broker, setBroker] = useState<Broker>("zerodha");
  const [portfolioId, setPortfolioId] = useState<string>(portfolios[0]?.id ?? "");
  const [files, setFiles] = useState<Loaded[]>([]);
  const [fixing, setFixing] = useState(0);
  const [trades, setTrades] = useState<TradebookRow[]>([]);
  const [skipped, setSkipped] = useState<SkippedRow[]>([]);
  const [repeated, setRepeated] = useState(0);
  const [review, setReview] = useState<Review | null>(null);
  const [replace, setReplace] = useState<string[]>([]);
  const [exclude, setExclude] = useState<string[]>([]);
  const [aliases, setAliases] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const brokerInfo = BROKERS.find((b) => b.key === broker)!;

  const payload = (rows: TradebookRow[], skippedCount: number, over: Over = {}) => ({
    portfolioId: portfolioId || null,
    broker,
    rows: wire(rows),
    replace: over.replace ?? replace,
    exclude: over.exclude ?? exclude,
    aliases: over.aliases ?? aliases,
    skipped: skippedCount,
  });

  async function preview(rows: TradebookRow[], skippedCount: number, over: Over) {
    const r = await previewTradebook(payload(rows, skippedCount, over));
    if (r.error) throw new Error(r.error);
    if (r.portfolioId && !portfolioId) setPortfolioId(r.portfolioId);
    return r;
  }

  /** First look; then, for stocks you entered by hand, use the tradebook in their place when it gives the same shares. */
  async function firstReview(rows: TradebookRow[], skippedCount: number) {
    setBusy("Checking every stock against your portfolio…");
    setError(null);
    try {
      const a = await preview(rows, skippedCount, { replace: [], exclude: [] });
      const overlap = a.stocks.filter((x) => x.before?.openingOnly).map((x) => x.symbol);
      let final = a;
      let chosen: string[] = [];
      if (overlap.length) {
        const b = await preview(rows, skippedCount, { replace: overlap, exclude: [] });
        chosen = overlap.filter((sym) => {
          const before = a.stocks.find((x) => x.symbol === sym)?.before;
          const after = b.stocks.find((x) => x.symbol === sym);
          return after?.ok && after.after?.quantity === before?.quantity;
        });
        final = chosen.length === overlap.length ? b : chosen.length ? await preview(rows, skippedCount, { replace: chosen, exclude: [] }) : a;
      }
      setReplace(chosen);
      setExclude([]);
      setReview(final);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't check the file.");
      setStep("files");
    } finally {
      setBusy(null);
    }
  }

  async function update(over: Over) {
    setBusy("Updating the check…");
    setError(null);
    try {
      const r = await preview(trades, skipped.length, over);
      if (over.replace) setReplace(over.replace);
      if (over.exclude) setExclude(over.exclude);
      if (over.aliases) setAliases(over.aliases);
      setReview(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "We couldn't update the check.");
    } finally {
      setBusy(null);
    }
  }

  function readAll(list: Loaded[]) {
    const parsed = list.map((f) => parseTradebook(f.rows, f.headerRow, f.mapping, f.name));
    const merged = mergeTrades(parsed.map((p) => p.trades));
    const sk = parsed.flatMap((p) => p.skipped);
    setTrades(merged.trades);
    setRepeated(merged.repeated);
    setSkipped(sk);
    if (!merged.trades.length) {
      setError("We found no executed equity trades in the file. Check it is a tradebook or trade history, not a profit and loss or holdings report.");
      setStep("files");
      return;
    }
    void firstReview(merged.trades, sk.length);
  }

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    setBusy("Reading the file…");
    const loaded: Loaded[] = [];
    try {
      for (const f of Array.from(list)) {
        if (f.size > 25_000_000) throw new Error(`${f.name} is over 25 MB. Download a shorter date range.`);
        const rows = /\.xlsx$/i.test(f.name) ? await readXlsx(await f.arrayBuffer()) : csvRows(await f.text());
        if (!rows.length) throw new Error(`${f.name} is empty.`);
        const found = detectColumns(rows);
        let mapping = found.mapping;
        if (missingFields(mapping).length) {
          const saved = store.get(mappingKey(broker, rows[found.headerRow] ?? []));
          if (saved) mapping = { ...mapping, ...(JSON.parse(saved) as Mapping) };
        }
        loaded.push({ name: f.name, rows, headerRow: found.headerRow, mapping });
      }
    } catch (e) {
      setBusy(null);
      setError(e instanceof XlsxError || e instanceof Error ? e.message : "We couldn't read the file.");
      return;
    }
    setBusy(null);
    const all = [...files, ...loaded];
    setFiles(all);
    if (inputRef.current) inputRef.current.value = "";
    const first = all.findIndex((f) => missingFields(f.mapping).length);
    if (first >= 0) {
      setFixing(first);
      setStep("columns");
    } else readAll(all);
  }

  function setColumn(field: Field, col: number | null) {
    setFiles((fs) =>
      fs.map((f, i) => {
        if (i !== fixing) return f;
        const mapping = { ...f.mapping };
        for (const k of Object.keys(mapping) as Field[]) if (mapping[k] === col) delete mapping[k]; // a column belongs to one field
        if (col == null) delete mapping[field];
        else mapping[field] = col;
        return { ...f, mapping };
      }),
    );
  }

  function confirmColumns() {
    const f = files[fixing];
    store.set(mappingKey(broker, f.rows[f.headerRow] ?? []), JSON.stringify(f.mapping));
    const next = files.findIndex((x, i) => i !== fixing && missingFields(x.mapping).length);
    if (next >= 0) setFixing(next);
    else readAll(files);
  }

  async function doImport() {
    setBusy("Importing…");
    setError(null);
    try {
      const r = await importTradebook(payload(trades, skipped.length));
      if (r.error) setError(r.error);
      else {
        setOutcome(r);
        setStep("done");
      }
    } finally {
      setBusy(null);
    }
  }

  function startOver() {
    setFiles([]);
    setTrades([]);
    setSkipped([]);
    setRepeated(0);
    setReview(null);
    setReplace([]);
    setExclude([]);
    setAliases({});
    setOutcome(null);
    setError(null);
    setStep("files");
  }

  const order: Step[] = ["broker", "files", "columns", "review", "done"];
  const stepLabel: [Step, string][] = [
    ["broker", "Your broker"],
    ["files", "Your file"],
    ["review", "Check"],
    ["done", "Done"],
  ];

  return (
    <div className="flex flex-col gap-5" data-testid="tradebook-import">
      <ol className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground" aria-label="Steps">
        {stepLabel.map(([k, label], i) => {
          const current = step === k || (k === "files" && step === "columns");
          return (
            <li key={k} aria-current={current ? "step" : undefined} className={clsx(order.indexOf(step) >= order.indexOf(k) && "text-foreground", current && "font-medium")}>
              {i + 1}. {label}
            </li>
          );
        })}
      </ol>

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-md border border-loss/30 bg-loss-soft px-3 py-2 text-[13px] text-loss">
          <WarningCircleIcon size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      ) : null}
      {busy ? (
        <p role="status" className="text-[13px] text-muted-foreground">
          {busy}
        </p>
      ) : null}

      {step === "broker" ? (
        <BrokerStep broker={broker} setBroker={setBroker} portfolios={portfolios} portfolioId={portfolioId} setPortfolioId={setPortfolioId} onNext={() => setStep("files")} />
      ) : null}

      {step === "files" ? (
        <div className="flex flex-col gap-4">
          <p className="max-w-2xl text-[13px] leading-5 text-muted-foreground">{brokerInfo.guide}</p>
          <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-10 text-center hover:bg-foreground/[0.02] has-[:focus-visible]:outline has-[:focus-visible]:outline-2">
            <FileArrowUpIcon size={28} aria-hidden className="text-muted-foreground" />
            <span className="text-[14px] font-medium">{files.length ? "Add another file" : "Choose your tradebook files"}</span>
            <span className="max-w-md text-[12px] text-muted-foreground">
              CSV or Excel (.xlsx). Several files are fine; a trade in two files counts once. The file is read on this device and is not uploaded.
            </span>
            <input ref={inputRef} type="file" accept=".csv,.txt,.tsv,.xlsx,text/csv" multiple className="sr-only" aria-label="Tradebook files" onChange={(e) => void onFiles(e.target.files)} />
          </label>
          {files.length ? <p className="text-[12.5px] text-muted-foreground">Already added: {files.map((f) => f.name).join(", ")}.</p> : null}
          <button type="button" className="w-fit text-[13px] text-muted-foreground hover:text-foreground" onClick={() => setStep("broker")}>
            <ArrowLeftIcon size={13} className="mr-1 inline" aria-hidden /> Change broker ({brokerInfo.name})
          </button>
        </div>
      ) : null}

      {step === "columns" && files[fixing] ? <ColumnsStep file={files[fixing]} setColumn={setColumn} onDone={confirmColumns} /> : null}

      {step === "review" && review ? (
        <ReviewStep
          review={review}
          trades={trades}
          skipped={skipped}
          repeated={repeated}
          files={files.map((f) => f.name)}
          holdingsUsed={holdingsUsed}
          busy={!!busy}
          replace={replace}
          onReplace={(sym, on) => void update({ replace: on ? [...replace, sym] : replace.filter((x) => x !== sym) })}
          onExclude={(sym, out) => void update({ exclude: out ? [...exclude, sym] : exclude.filter((x) => x !== sym) })}
          onAlias={(label, sym) => void update({ aliases: { ...aliases, [label]: sym.trim().toUpperCase() } })}
          onAddFiles={() => setStep("files")}
          onImport={() => void doImport()}
        />
      ) : null}

      {step === "done" && outcome ? (
        <div className="flex flex-col gap-3" data-testid="import-done">
          <p className="flex items-center gap-2 text-[15px] font-medium">
            <CheckCircleIcon size={20} className="text-gain" aria-hidden />
            {outcome.added ? `Imported ${outcome.added.toLocaleString("en-IN")} trade${outcome.added === 1 ? "" : "s"}.` : "Nothing new to import."}
          </p>
          <p className="text-[13px] text-muted-foreground">
            {outcome.duplicates ? `${outcome.duplicates.toLocaleString("en-IN")} were already in your portfolio and were left as they are. ` : ""}
            {outcome.replaced ? `${outcome.replaced} opening balance${outcome.replaced === 1 ? "" : "s"} replaced by the tradebook. ` : ""}
            {outcome.importId ? "You can undo this import from the list below." : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Link href="/app/portfolio" className={buttonClass("primary", "md")}>
              See your portfolio
            </Link>
            <button type="button" className={buttonClass("secondary", "md")} onClick={startOver}>
              Import another file
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BrokerStep({
  broker,
  setBroker,
  portfolios,
  portfolioId,
  setPortfolioId,
  onNext,
}: {
  broker: Broker;
  setBroker: (b: Broker) => void;
  portfolios: { id: string; name: string }[];
  portfolioId: string;
  setPortfolioId: (id: string) => void;
  onNext: () => void;
}) {
  const pfId = useId();
  return (
    <div className="flex flex-col gap-4">
      <fieldset>
        <legend className="mb-2 text-[13px] font-medium">Which broker is the file from?</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {BROKERS.map((b) => (
            <label
              key={b.key}
              className={clsx(
                "flex cursor-pointer flex-col gap-0.5 rounded-lg border px-3 py-2.5 text-[13px] has-[:focus-visible]:outline has-[:focus-visible]:outline-2",
                broker === b.key ? "border-foreground bg-foreground/[0.03]" : "border-border hover:bg-foreground/[0.02]",
              )}
            >
              <input type="radio" name="broker" value={b.key} checked={broker === b.key} onChange={() => setBroker(b.key)} className="sr-only" />
              <span className="font-medium">{b.name}</span>
              <span className="text-[11.5px] text-muted-foreground">{b.known ? "Tradebook columns known" : "Columns matched by name"}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {portfolios.length > 1 ? (
        <div className="flex max-w-xs flex-col gap-1">
          <label htmlFor={pfId} className="eyebrow">
            Into portfolio
          </label>
          <Select id={pfId} value={portfolioId} onChange={(e) => setPortfolioId(e.target.value)}>
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <button type="button" className={buttonClass("primary", "md", "w-fit")} onClick={onNext}>
        Next: choose the file
      </button>
    </div>
  );
}

function ColumnsStep({ file, setColumn, onDone }: { file: Loaded; setColumn: (f: Field, col: number | null) => void; onDone: () => void }) {
  const header = file.rows[file.headerRow] ?? [];
  const samples = file.rows.slice(file.headerRow + 1, file.headerRow + 4);
  const missing = missingFields(file.mapping);
  const needed = (f: Field) => REQUIRED.includes(f) || (f === "symbol" && missing.includes("symbol")) || (f === "price" && missing.includes("price"));
  return (
    <div className="flex flex-col gap-4" data-testid="columns-step">
      <div>
        <p className="text-[14px] font-medium">Which column is which in {file.name}?</p>
        <p className="mt-0.5 max-w-2xl text-[13px] leading-5 text-muted-foreground">
          We didn&apos;t recognise every column. Pick them once and we remember your choice for this broker&apos;s files. A stock can be named by its symbol or
          by the company name.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border border-border" tabIndex={0} role="region" aria-label="The first rows of the file">
        <table className="w-full text-[12px]">
          <thead className="bg-foreground/[0.03]">
            <tr>
              {header.map((h, i) => (
                <th key={i} className="whitespace-nowrap px-2 py-1.5 text-left font-medium">
                  {h || `Column ${i + 1}`}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {samples.map((r, i) => (
              <tr key={i} className="border-t border-border/60">
                {header.map((_, j) => (
                  <td key={j} className="num whitespace-nowrap px-2 py-1 text-muted-foreground">
                    {r[j] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {MAPPABLE.map((f) => (
          <label key={f} className="flex flex-col gap-1 text-[12.5px]">
            <span className="eyebrow">
              {FIELD_LABEL[f]}
              {needed(f) ? " (needed)" : ""}
            </span>
            <Select value={file.mapping[f] ?? ""} onChange={(e) => setColumn(f, e.target.value === "" ? null : Number(e.target.value))}>
              <option value="">Not in this file</option>
              {header.map((h, i) => (
                <option key={i} value={i}>
                  {h || `Column ${i + 1}`}
                </option>
              ))}
            </Select>
          </label>
        ))}
      </div>
      <p className="text-[12px] text-muted-foreground">
        {missing.length
          ? `Still needed: ${missing.map((m) => (m === "symbol" ? "the stock (symbol or name)" : m === "price" ? "the price (or the trade value)" : FIELD_LABEL[m].toLowerCase())).join(", ")}.`
          : "All the columns we need are matched."}
      </p>
      <button type="button" disabled={missing.length > 0} className={buttonClass("primary", "md", "w-fit")} onClick={onDone}>
        Use these columns
      </button>
    </div>
  );
}

function ReviewStep(props: {
  review: Review;
  trades: TradebookRow[];
  skipped: SkippedRow[];
  repeated: number;
  files: string[];
  holdingsUsed: number;
  busy: boolean;
  replace: string[];
  onReplace: (sym: string, on: boolean) => void;
  onExclude: (sym: string, out: boolean) => void;
  onAlias: (label: string, sym: string) => void;
  onAddFiles: () => void;
  onImport: () => void;
}) {
  const { review, trades, skipped } = props;
  const stocks = review.stocks;
  const ready = stocks.filter((x) => !x.excluded && x.ok);
  const blocked = stocks.filter((x) => !x.excluded && !x.ok);
  const toAdd = ready.reduce((a, x) => a + x.added, 0);
  const already = ready.reduce((a, x) => a + x.duplicates, 0);
  const from = trades.reduce((a, t) => (t.date < a ? t.date : a), trades[0]?.date ?? "");
  const to = trades.reduce((a, t) => (t.date > a ? t.date : a), trades[0]?.date ?? "");
  const leftOutRows = skipped.length + review.unknown.reduce((a, u) => a + u.rows, 0) + review.leftOut.reduce((a, l) => a + l.rows, 0);
  const heldAfter = ready.filter((x) => (x.after?.quantity ?? 0) > 0).length;

  const download = () => {
    const q = (s: string) => `"${s.replace(/"/g, "'")}"`;
    const lines = [
      "file,row,reason",
      ...skipped.map((s) => `${q(s.file)},${s.line},${q(s.reason)}`),
      ...review.unknown.map((u) => `,,${q(`${u.rows} trade(s) in ${u.label}: not a stock in our NSE list`)}`),
      ...review.leftOut.map((l) => `,,${q(`${l.rows} trade(s): ${l.reason}`)}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "rows-left-out.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-5" data-testid="review-step">
      <div className="flex flex-col gap-1">
        <p className="text-[15px] font-medium">
          {trades.length.toLocaleString("en-IN")} trade{trades.length === 1 ? "" : "s"} in {stocks.length} stock{stocks.length === 1 ? "" : "s"}, {date(from)} to {date(to)}
        </p>
        <p className="text-[13px] text-muted-foreground">
          From {props.files.join(", ")}.{props.repeated ? ` ${props.repeated} trades were in more than one file and count once.` : ""} Nothing is saved until you import.
        </p>
      </div>

      {leftOutRows ? (
        <div className="rounded-md border border-border px-3 py-2.5 text-[13px]" data-testid="left-out">
          <p className="font-medium">
            {leftOutRows.toLocaleString("en-IN")} row{leftOutRows === 1 ? "" : "s"} left out
          </p>
          <ul className="mt-1 list-disc pl-5 text-[12.5px] text-muted-foreground">
            {summarise(skipped).map(([reason, n]) => (
              <li key={reason}>
                {n} {reason}
              </li>
            ))}
            {review.leftOut.map((l) => (
              <li key={l.reason}>
                {l.rows} {l.reason}
              </li>
            ))}
            {review.unknown.length ? <li>{review.unknown.reduce((a, u) => a + u.rows, 0)} in stocks we couldn&apos;t place (below)</li> : null}
          </ul>
          <button type="button" className="mt-1.5 text-[12.5px] underline" onClick={download}>
            Download the rows left out
          </button>
        </div>
      ) : null}

      {review.unknown.length ? (
        <div className="flex flex-col gap-2 rounded-md border border-border px-3 py-2.5" data-testid="unknown-stocks">
          <p className="text-[13px] font-medium">Stocks we couldn&apos;t place</p>
          <p className="text-[12.5px] text-muted-foreground">Type the NSE symbol to include one, or leave it out. Futures, options and mutual funds can&apos;t be imported.</p>
          {review.unknown.map((u) => (
            <AliasRow key={u.label} label={u.label} rows={u.rows} disabled={props.busy} onMatch={(sym) => props.onAlias(u.label, sym)} />
          ))}
        </div>
      ) : null}

      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Each stock in the file">
        <table className="w-full min-w-[760px] text-[13px]" data-testid="review-stocks">
          <thead>
            <tr className="border-b border-border text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
              <th className="py-2 pr-2 font-medium">Import</th>
              <th className="py-2 pr-2 font-medium">Stock</th>
              <th className="py-2 pr-2 font-medium">Trades</th>
              <th className="py-2 pr-2 text-right font-medium">After the import</th>
              <th className="py-2 font-medium">Check</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map((x) => (
              <StockRow key={x.symbol} x={x} busy={props.busy} replaced={props.replace.includes(x.symbol)} onReplace={props.onReplace} onExclude={props.onExclude} />
            ))}
          </tbody>
        </table>
      </div>

      {review.planLimit != null && blocked.some((x) => x.problem?.startsWith("Your plan holds")) ? (
        <p className="text-[12.5px] text-muted-foreground">
          Your plan holds {review.planLimit} stocks at a time (you hold {props.holdingsUsed} now). Stocks you sold in full don&apos;t count.
        </p>
      ) : null}
      <p className="text-[12px] text-muted-foreground">
        Tradebooks usually don&apos;t list charges, so gains here are before brokerage and taxes unless you add charges to a trade later. Shares are matched oldest
        first, as your broker&apos;s profit and loss report and Indian tax count them.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={props.busy || toAdd === 0 || blocked.length > 0} className={buttonClass("primary", "md")} onClick={props.onImport}>
          {toAdd ? `Import ${toAdd.toLocaleString("en-IN")} trade${toAdd === 1 ? "" : "s"}` : "Nothing new to import"}
        </button>
        <button type="button" className={buttonClass("secondary", "md")} onClick={props.onAddFiles}>
          Add an earlier file
        </button>
        <span className="text-[12.5px] text-muted-foreground" data-testid="review-summary">
          {blocked.length
            ? `${blocked.length} stock${blocked.length === 1 ? " needs" : "s need"} a look first: fix it or leave it out.`
            : `${heldAfter} stock${heldAfter === 1 ? "" : "s"} held afterwards${already ? `; ${already.toLocaleString("en-IN")} trades were imported before and are skipped` : ""}.`}
        </span>
      </div>
    </div>
  );
}

function StockRow({
  x,
  busy,
  replaced,
  onReplace,
  onExclude,
}: {
  x: StockReview;
  busy: boolean;
  replaced: boolean;
  onReplace: (sym: string, on: boolean) => void;
  onExclude: (sym: string, out: boolean) => void;
}) {
  return (
    <tr className={clsx("border-b border-border/60 align-top", x.excluded && "opacity-60")} data-testid={`review-${x.symbol}`}>
      <td className="py-2.5 pr-2">
        <input
          type="checkbox"
          checked={!x.excluded}
          disabled={busy}
          onChange={(e) => onExclude(x.symbol, !e.target.checked)}
          aria-label={`Import ${x.symbol}`}
          className="size-4 accent-primary"
        />
      </td>
      <td className="py-2.5 pr-2">
        <span className="num font-medium">{x.symbol}</span>
        {x.name ? <span className="block text-[11.5px] text-muted-foreground">{x.name}</span> : null}
        {x.note ? <span className="block text-[11.5px] text-muted-foreground">{x.note}</span> : null}
        {x.before?.openingOnly && !x.excluded ? (
          <label className="mt-1.5 flex max-w-72 items-start gap-1.5 text-[12px]">
            <input type="checkbox" checked={replaced} disabled={busy} onChange={(e) => onReplace(x.symbol, e.target.checked)} className="mt-0.5 size-3.5 accent-primary" />
            <span>
              Use the tradebook instead of your opening balance ({qty(x.before.quantity)} at {price(x.before.avgPrice)})
            </span>
          </label>
        ) : null}
      </td>
      <td className="py-2.5 pr-2 text-[12.5px]">
        <span className="num">{x.rows}</span> ({x.buys} buy{x.buys === 1 ? "" : "s"}, {x.sells} sale{x.sells === 1 ? "" : "s"})
        <span className="block text-[11.5px] text-muted-foreground">
          {date(x.from)}
          {x.to !== x.from ? ` to ${date(x.to)}` : ""}
        </span>
      </td>
      <td className="num py-2.5 pr-2 text-right">
        {x.excluded ? (
          <span className="text-muted-foreground">left out</span>
        ) : !x.ok ? (
          "—"
        ) : x.after ? (
          <>
            {qty(x.after.quantity)} at {price(x.after.avgPrice)}
          </>
        ) : (
          <span className="text-muted-foreground">sold in full</span>
        )}
        {x.ok && !x.excluded && x.sales ? (
          <span className={clsx("block text-[11.5px]", x.realized >= 0 ? "text-gain" : "text-loss")}>
            {x.realized >= 0 ? "▲ made " : "▼ lost "}
            {rupees(Math.abs(x.realized))} on {x.sales} sale{x.sales === 1 ? "" : "s"}
          </span>
        ) : null}
      </td>
      <td className="py-2.5 text-[12.5px]">
        {x.excluded ? null : x.ok ? (
          <span className="flex flex-col gap-0.5">
            <span className="text-gain">{x.added ? "Ready" : "Already imported"}</span>
            {x.duplicates && x.added ? <span className="text-muted-foreground">{x.duplicates} already imported, skipped</span> : null}
            {x.handMatches ? (
              <span className="text-muted-foreground">
                {x.handMatches} match a trade you entered yourself (same day and quantity). After importing, check its history for doubles.
              </span>
            ) : null}
            {x.priceWarning ? (
              <span className="flex max-w-96 items-start gap-1.5 text-foreground" data-testid={`price-warning-${x.symbol}`}>
                <WarningCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden />
                {x.priceWarning}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="flex max-w-96 items-start gap-1.5 text-loss">
            <WarningCircleIcon size={14} className="mt-0.5 shrink-0" aria-hidden />
            {x.problem}
          </span>
        )}
      </td>
    </tr>
  );
}

function AliasRow({ label, rows, disabled, onMatch }: { label: string; rows: number; disabled: boolean; onMatch: (sym: string) => void }) {
  const [v, setV] = useState("");
  const id = useId();
  return (
    <form
      className="flex flex-wrap items-center gap-2 text-[12.5px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (v.trim()) onMatch(v);
      }}
    >
      <label htmlFor={id} className="min-w-48">
        <span className="font-medium">{label}</span>{" "}
        <span className="text-muted-foreground">
          ({rows} trade{rows === 1 ? "" : "s"})
        </span>
      </label>
      <input id={id} value={v} onChange={(e) => setV(e.target.value)} placeholder="NSE symbol" className="num h-8 w-32 rounded-md border border-input bg-card px-2 uppercase" />
      <button type="submit" disabled={disabled || !v.trim()} className={buttonClass("secondary", "sm")}>
        Match
      </button>
    </form>
  );
}

/** Undo one import (two presses); says why when a later sale needs its shares. */
export function UndoImport({ id, label }: { id: string; label: string }) {
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<{ error?: string } | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {state?.error ? (
        <span role="alert" className="max-w-72 text-right text-[12px] text-loss">
          {state.error}
        </span>
      ) : null}
      <button
        type="button"
        disabled={pending}
        aria-label={armed ? `Undo, really: ${label}` : `Undo ${label}`}
        onBlur={() => setArmed(false)}
        onClick={async () => {
          if (!armed) return setArmed(true);
          setPending(true);
          setState((await undoImport(id)) ?? null);
          setPending(false);
          setArmed(false);
        }}
        className={clsx("h-7 rounded-md border px-2.5 text-[12px] disabled:opacity-60", armed ? "border-loss bg-loss text-white" : "border-border hover:bg-foreground/[0.04]")}
      >
        {pending ? "Undoing…" : armed ? "Undo the whole import" : "Undo"}
      </button>
    </span>
  );
}

function summarise(skipped: SkippedRow[]): [string, number][] {
  const m = new Map<string, number>();
  for (const s of skipped) {
    const key = s.reason.startsWith("not executed")
      ? "orders not executed (cancelled or rejected)"
      : s.reason.startsWith('"')
        ? "rows where buy or sell was not clear"
        : s.reason.startsWith("the date")
          ? "rows with a date we couldn't read"
          : s.reason;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m];
}
