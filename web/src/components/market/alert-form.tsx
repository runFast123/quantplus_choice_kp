"use client";

import { useActionState, useEffect, useRef } from "react";
import { createAlert } from "@/app/app/alerts/actions";
import { FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function AlertForm({ symbol, lastPrice, compact }: { symbol?: string; lastPrice?: number | null; compact?: boolean }) {
  const [state, action] = useActionState(createAlert, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="flex flex-col gap-3">
      <div className={compact ? "grid grid-cols-[1fr_1.2fr] gap-2" : "grid gap-3 sm:grid-cols-[1fr_140px_160px_auto] sm:items-end"}>
        {symbol ? (
          <input type="hidden" name="symbol" value={symbol} />
        ) : (
          <label className="flex flex-col gap-1">
            <span className="eyebrow">Symbol</span>
            <Input name="symbol" required placeholder="e.g. TCS" className="num uppercase" autoCapitalize="characters" />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="eyebrow">When price is</span>
          <Select name="condition" defaultValue="above">
            <option value="above">Above</option>
            <option value="below">Below</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="eyebrow">Price (₹)</span>
          <Input
            name="trigger_price"
            type="number"
            inputMode="decimal"
            step="0.05"
            min="0.05"
            required
            className="num"
            placeholder={lastPrice ? lastPrice.toFixed(2) : "0.00"}
          />
        </label>
        <SubmitButton className={compact ? "col-span-2" : undefined} pendingLabel="Setting…">
          Set alert
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
