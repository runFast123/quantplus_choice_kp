"use client";

import { PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react";
import clsx from "clsx";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useEchoAction } from "@/components/ui/use-echo-action";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/errors";
import { qty } from "@/lib/format";
import { istToday } from "@/lib/ledger";
import { useSymbolSearch } from "@/components/market/use-symbol-search";
import { createPortfolio, deleteHolding, deleteTrade, recordTrade, undoHoldingAdjustment, updateTrade } from "./actions";

type Side = "buy" | "sell";

/**
 * Record a buy or a sell. A sale shows what it made after charges; the database works the holding out from the
 * trades (oldest shares sold first).
 */
export function RecordTradeForm({
  portfolios,
  held,
  initial,
}: {
  portfolios: { id: string; name: string }[];
  held: { symbol: string; quantity: number }[];
  initial?: { kind?: Side; symbol?: string };
}) {
  const [kind, setKind] = useState<Side>(initial?.kind ?? "buy");
  const [q, setQ] = useState(initial?.symbol ?? "");
  const [state, action, , values] = useEchoAction(recordTrade, (res) => {
    if (res?.ok) setQ("");
  });
  const { hits } = useSymbolSearch(kind === "buy" ? q : "", 8);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);
  const today = istToday();
  const holding = held.find((h) => h.symbol === q.trim().toUpperCase());

  return (
    <form ref={form} action={action} className="flex flex-col gap-3" id="record">
      <fieldset className="flex w-fit rounded-md border border-border p-0.5" aria-label="Buy or sell">
        {(["buy", "sell"] as const).map((k) => (
          <label
            key={k}
            className={clsx(
              "cursor-pointer rounded px-3 py-1 text-[13px] transition-colors has-[:focus-visible]:outline has-[:focus-visible]:outline-2",
              kind === k ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
            {k === "buy" ? "Buy" : "Sell"}
          </label>
        ))}
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_0.9fr_1fr_1.1fr_auto] lg:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="trade-symbol" className="eyebrow">
            Symbol
          </label>
          <Input
            id="trade-symbol"
            name="symbol"
            list="trade-symbols"
            required
            autoComplete="off"
            className="num uppercase"
            placeholder="INFY"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <datalist id="trade-symbols">
          {kind === "sell"
            ? held.map((h) => (
                <option key={h.symbol} value={h.symbol}>
                  {`you hold ${qty(h.quantity)}`}
                </option>
              ))
            : hits
                .filter((h) => h.segment !== "index")
                .map((h) => (
                  <option key={h.symbol} value={h.symbol}>
                    {h.name}
                  </option>
                ))}
        </datalist>
        <div className="flex flex-col gap-1">
          <label htmlFor="trade-date" className="eyebrow">
            Date
          </label>
          <Input id="trade-date" name="trade_date" type="date" required max={today} defaultValue={values.trade_date ?? today} className="num" />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="trade-quantity" className="eyebrow">
            Quantity
          </label>
          <Input id="trade-quantity" name="quantity" type="number" inputMode="decimal" step="any" min="0" required className="num" placeholder="10" defaultValue={values.quantity} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="trade-price" className="eyebrow">
            Price per share (₹)
          </label>
          <Input id="trade-price" name="price" type="number" inputMode="decimal" step="0.01" min="0" required className="num" placeholder="1520.00" defaultValue={values.price} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="trade-portfolio" className="eyebrow">
            Portfolio
          </label>
          <Select id="trade-portfolio" name="portfolio_id" defaultValue={values.portfolio_id ?? portfolios[0]?.id ?? ""} key={values.portfolio_id ?? "default"}>
            {portfolios.length === 0 ? <option value="">My Portfolio (new)</option> : null}
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <SubmitButton pendingLabel="Saving…">{kind === "buy" ? "Record buy" : "Record sell"}</SubmitButton>
      </div>

      {kind === "sell" && q ? (
        <p className="text-[12px] text-muted-foreground" aria-live="polite">
          {holding ? `You hold ${qty(holding.quantity)} ${holding.symbol}. The oldest shares are sold first.` : `You don't hold ${q.toUpperCase()} in this portfolio.`}
        </p>
      ) : null}

      <details className="group text-[13px]">
        <summary className="w-fit cursor-pointer text-muted-foreground hover:text-foreground">Charges, note and SIP</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-[0.8fr_2fr_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <label htmlFor="trade-charges" className="eyebrow">
              Charges (₹)
            </label>
            <Input id="trade-charges" name="charges" type="number" inputMode="decimal" step="0.01" min="0" className="num" placeholder="0.00" defaultValue={values.charges} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="trade-note" className="eyebrow">
              Note
            </label>
            <Input id="trade-note" name="note" maxLength={200} placeholder="Why you bought or sold" defaultValue={values.note} />
          </div>
          <label className="flex items-center gap-2 pb-2">
            <input type="checkbox" name="sip" className="size-4 accent-primary" defaultChecked={values.sip === "on"} />
            Part of a monthly SIP
          </label>
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Charges are brokerage, STT, GST and stamp duty from your contract note. They count in your gains, not in the average price.
        </p>
      </details>
      <FormMessage state={state} />
    </form>
  );
}

/** Correct one stored trade in place. */
export function EditTrade({
  id,
  label,
  tradeDate,
  quantity,
  price,
  charges,
}: {
  id: string;
  label: string;
  tradeDate: string;
  quantity: number;
  price: number;
  charges: number;
}) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await updateTrade(prev, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, undefined);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${label}`}
        title={`Edit ${label}`}
        className="inline-grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <PencilSimpleIcon size={14} aria-hidden />
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-wrap items-center justify-end gap-1.5">
      <input type="hidden" name="id" value={id} />
      <Input name="trade_date" aria-label="Date" type="date" required max={istToday()} defaultValue={tradeDate} className="num h-7 w-36 px-2 text-[12px]" />
      <Input name="quantity" aria-label="Quantity" type="number" step="any" min="0" required defaultValue={quantity} className="num h-7 w-20 px-2 text-[12px]" />
      <Input name="price" aria-label="Price per share" type="number" step="0.01" min="0" required defaultValue={price} className="num h-7 w-24 px-2 text-[12px]" />
      <Input name="charges" aria-label="Charges" type="number" step="0.01" min="0" defaultValue={charges} className="num h-7 w-20 px-2 text-[12px]" />
      <button type="submit" className="h-7 rounded-md bg-primary px-2 text-[12px] text-primary-foreground">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-7 px-1 text-[12px] text-muted-foreground">
        Cancel
      </button>
      {state?.error ? (
        <span role="alert" className="basis-full text-right text-[11.5px] text-loss">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}

/** Delete one stored trade (two presses); says why when the ledger refuses (a later sale needs it). */
export function DeleteTrade({ id, label }: { id: string; label: string }) {
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-1.5">
      {error ? (
        <span role="alert" className="max-w-56 text-right text-[11.5px] text-loss">
          {error}
        </span>
      ) : null}
      <ConfirmButton
        label={`Delete ${label}`}
        confirmLabel="Delete"
        onConfirm={async () => {
          const r = await deleteTrade(id);
          setError(r?.error);
        }}
      >
        <TrashIcon size={14} aria-hidden />
      </ConfirmButton>
    </span>
  );
}

/** Remove a stock and all of its trades (two presses). */
export function RemoveHolding({ id, symbol }: { id: string; symbol: string }) {
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-1.5">
      {error ? (
        <span role="alert" className="max-w-56 text-right text-[11.5px] text-loss">
          {error}
        </span>
      ) : null}
      <ConfirmButton
        label={`Remove ${symbol}`}
        confirmLabel="Remove all its trades"
        onConfirm={async () => {
          const r = await deleteHolding(id);
          setError(r?.error);
        }}
      >
        <TrashIcon size={15} aria-hidden />
      </ConfirmButton>
    </span>
  );
}

/** Undo one split or bonus adjustment; says why when it can't. */
export function UndoAdjustment({ id, symbol }: { id: string; symbol: string }) {
  const [pending, start] = useTransition();
  const [state, setState] = useState<ActionState>();
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-2">
      {state?.error ? (
        <span role="alert" className="text-[12px] text-loss">
          {state.error}
        </span>
      ) : null}
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => setState(await undoHoldingAdjustment(id)))}
        aria-label={`Undo the change to ${symbol}`}
        className="h-7 rounded-md border border-border px-2.5 text-[12px] hover:bg-foreground/[0.04] disabled:opacity-60"
      >
        {pending ? "Undoing…" : "Undo"}
      </button>
    </span>
  );
}

export function NewPortfolioForm() {
  const [state, action, , values] = useEchoAction(createPortfolio);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label htmlFor="pf-name" className="sr-only">
          Portfolio name
        </label>
        <Input id="pf-name" name="name" placeholder="e.g. Long-term" maxLength={80} defaultValue={values.name} />
        <SubmitButton variant="secondary">Create</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
