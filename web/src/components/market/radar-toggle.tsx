"use client";

import clsx from "clsx";
import { CheckIcon, PlusIcon } from "@phosphor-icons/react";
import { useActionState, useOptimistic, useTransition } from "react";
import { addToRadar, removeSymbolFromRadar } from "@/app/app/watchlist/actions";

/** Compact add/remove control used in tables and on the symbol page. */
export function RadarToggle({
  symbol,
  exchange = "NSE",
  onRadar,
  size = "sm",
}: {
  symbol: string;
  exchange?: string;
  onRadar: boolean;
  size?: "sm" | "md";
}) {
  const [optimistic, setOptimistic] = useOptimistic(onRadar);
  const [state, add] = useActionState(addToRadar, undefined);
  const [pending, start] = useTransition();

  const label = optimistic ? `Remove ${symbol} from radar` : `Add ${symbol} to radar`;
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        aria-pressed={optimistic}
        aria-label={label}
        title={label}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setOptimistic(!optimistic);
            if (optimistic) await removeSymbolFromRadar(symbol);
            else {
              const fd = new FormData();
              fd.set("symbol", symbol);
              fd.set("exchange", exchange);
              add(fd);
            }
          })
        }
        className={clsx(
          "inline-flex items-center justify-center gap-1.5 rounded-md border transition-colors duration-150",
          size === "sm" ? "size-7" : "h-9 px-3 text-[13px]",
          optimistic
            ? "border-primary bg-primary text-primary-foreground hover:opacity-90"
            : "border-border bg-card text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground",
        )}
      >
        {optimistic ? <CheckIcon size={14} weight="bold" aria-hidden /> : <PlusIcon size={14} aria-hidden />}
        {size === "md" ? (optimistic ? "On radar" : "Add to radar") : null}
      </button>
      {state?.error ? (
        <span role="alert" className="mt-1 max-w-[220px] text-right text-[11px] text-loss">
          {state.error}
        </span>
      ) : null}
    </span>
  );
}
