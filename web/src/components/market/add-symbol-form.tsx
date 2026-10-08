"use client";

import { useEffect, useRef, useState } from "react";
import { useEchoAction } from "@/components/ui/use-echo-action";
import { addToRadar } from "@/app/app/watchlist/actions";
import { FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { useSymbolSearch } from "./use-symbol-search";

export function AddSymbolForm({ watchlistId, disabled }: { watchlistId?: string; disabled?: boolean }) {
  const [state, action, , values] = useEchoAction(addToRadar);
  const [q, setQ] = useState("");
  const { hits } = useSymbolSearch(q, 8);
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
          defaultValue={values.symbol}
          list="symbol-suggestions"
          required
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="characters"
          onChange={(e) => setQ(e.target.value)}
          placeholder="Add a symbol — e.g. HDFCBANK"
          className="num uppercase"
        />
        <datalist id="symbol-suggestions">
          {hits.map((h) => (
            <option key={h.symbol} value={h.symbol}>
              {h.name}
            </option>
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
