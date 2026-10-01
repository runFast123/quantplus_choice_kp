"use client";

import { PencilSimpleIcon } from "@phosphor-icons/react";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import type { ActionState } from "@/lib/errors";
import { addHolding, createPortfolio, updateHolding } from "./actions";

export function AddHoldingForm({ portfolios, suggestions }: { portfolios: { id: string; name: string }[]; suggestions: string[] }) {
  const [state, action] = useActionState(addHolding, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1.2fr_1fr_1fr_1.2fr_auto] lg:items-end">
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Symbol</span>
          <Input name="symbol" list="holding-symbols" required autoComplete="off" className="num uppercase" placeholder="INFY" />
          <datalist id="holding-symbols">
            {suggestions.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Quantity</span>
          <Input name="quantity" type="number" inputMode="decimal" step="any" min="0" required className="num" placeholder="10" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Avg price (₹)</span>
          <Input name="avg_price" type="number" inputMode="decimal" step="0.05" min="0" required className="num" placeholder="1520.00" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Portfolio</span>
          <Select name="portfolio_id" defaultValue={portfolios[0]?.id ?? ""}>
            {portfolios.length === 0 ? <option value="">My Portfolio (new)</option> : null}
            {portfolios.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <SubmitButton pendingLabel="Adding…">Add holding</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}

export function EditHolding({ id, quantity, avgPrice, symbol }: { id: string; quantity: number; avgPrice: number; symbol: string }) {
  const [open, setOpen] = useState(false);
  const [, action] = useActionState(async (prev: ActionState, fd: FormData) => {
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
      <Input name="quantity" aria-label="Quantity" type="number" step="any" min="0" defaultValue={quantity} className="num h-7 w-20 px-2 text-[12px]" />
      <Input name="avg_price" aria-label="Average price" type="number" step="0.05" min="0" defaultValue={avgPrice} className="num h-7 w-24 px-2 text-[12px]" />
      <button type="submit" className="h-7 rounded-md bg-primary px-2 text-[12px] text-primary-foreground">
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="h-7 px-1 text-[12px] text-muted-foreground">
        Cancel
      </button>
    </form>
  );
}

export function NewPortfolioForm() {
  const [state, action] = useActionState(createPortfolio, undefined);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label htmlFor="pf-name" className="sr-only">
          Portfolio name
        </label>
        <Input id="pf-name" name="name" placeholder="e.g. Long-term" maxLength={80} />
        <SubmitButton variant="secondary">Create</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
