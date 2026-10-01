"use client";

import { useActionState, useEffect, useRef } from "react";
import { addToRadar } from "@/app/app/watchlist/actions";
import { FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";

export function AddSymbolForm({ watchlistId, disabled, suggestions }: { watchlistId?: string; disabled?: boolean; suggestions: string[] }) {
  const [state, action] = useActionState(addToRadar, undefined);
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) form.current?.reset();
  }, [state]);

  return (
    <form ref={form} action={action} className="flex flex-col gap-2">
      {watchlistId ? <input type="hidden" name="watchlist_id" value={watchlistId} /> : null}
      <div className="flex gap-2">
        <label htmlFor="add-symbol" className="sr-only">
          Symbol
        </label>
        <Input
          id="add-symbol"
          name="symbol"
          list="symbol-suggestions"
          required
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="characters"
          placeholder="Add a symbol — e.g. HDFCBANK"
          className="num uppercase"
        />
        <datalist id="symbol-suggestions">
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <SubmitButton disabled={disabled} pendingLabel="Adding…">
          Add
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
