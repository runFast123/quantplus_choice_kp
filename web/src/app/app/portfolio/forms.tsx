"use client";

import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useEchoAction } from "@/components/ui/use-echo-action";
import { FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/errors";
import { useSymbolSearch } from "@/components/market/use-symbol-search";
import { addHolding, createPortfolio, undoHoldingAdjustment, updateHolding } from "./actions";

export function AddHoldingForm({ portfolios }: { portfolios: { id: string; name: string }[] }) {
  const [q, setQ] = useState("");
  const [state, action, , values] = useEchoAction(addHolding, (res) => {
    if (res?.ok) setQ("");
  });
  const { hits } = useSymbolSearch(q, 8);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1.2fr_auto] lg:items-end">
        <div className="flex flex-col gap-1">
          <label htmlFor="holding-symbol" className="eyebrow">
            Symbol
          </label>
          <Input id="holding-symbol" name="symbol" list="holding-symbols" required autoComplete="off" className="num uppercase" placeholder="INFY" defaultValue={values.symbol} onChange={(e) => setQ(e.target.value)} />
        </div>
        <datalist id="holding-symbols">
          {hits.filter((h) => h.segment !== "index").map((h) => (
            <option key={h.symbol} value={h.symbol}>
              {h.name}
            </option>
          ))}
        </datalist>
        <div className="flex flex-col gap-1">
          <label htmlFor="holding-quantity" className="eyebrow">
            Quantity
          </label>
          <Input id="holding-quantity" name="quantity" type="number" inputMode="decimal" step="any" min="0" required className="num" placeholder="10" defaultValue={values.quantity} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="holding-avg-price" className="eyebrow">
            Avg price (₹)
          </label>
          <Input id="holding-avg-price" name="avg_price" type="number" inputMode="decimal" step="0.05" min="0" required className="num" placeholder="1520.00" defaultValue={values.avg_price} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="holding-portfolio" className="eyebrow">
            Portfolio
          </label>
          <Select id="holding-portfolio" name="portfolio_id" defaultValue={values.portfolio_id ?? portfolios[0]?.id ?? ""} key={values.portfolio_id ?? "default"}>
            {portfolios.length === 0 ? <option value="">My Portfolio (new)</option> : null}
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <SubmitButton pendingLabel="Adding…">Add holding</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function EditHolding({ id, quantity, avgPrice, symbol }: { id: string; quantity: number; avgPrice: number; symbol: string }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await updateHolding(prev, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, undefined);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Edit ${symbol}`}
        title={`Edit ${symbol}`}
        className="inline-grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <PencilSimpleIcon size={14} aria-hidden />
      </button>
    );
  }
  return (
    <form action={action} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="id" value={id} />
      <Input name="quantity" aria-label="Quantity" type="number" step="any" min="0" required defaultValue={quantity} className="num h-7 w-20 px-2 text-[12px]" />
      <Input name="avg_price" aria-label="Average price" type="number" step="0.05" min="0" required defaultValue={avgPrice} className="num h-7 w-24 px-2 text-[12px]" />
      <button type="submit" className="h-7 rounded-md bg-primary px-2 text-[12px] text-primary-foreground">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-7 px-1 text-[12px] text-muted-foreground">
        Cancel
      </button>
      {state?.error ? (
        <span role="alert" className="text-[11px] text-loss">
          {state.error}
        </span>
      ) : null}
    </form>
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
