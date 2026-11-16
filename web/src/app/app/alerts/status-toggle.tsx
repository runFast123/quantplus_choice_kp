"use client";

import clsx from "clsx";
import { useOptimistic, useState, useTransition } from "react";
import { setAlertStatus } from "./actions";

export function AlertStatusToggle({ id, armed }: { id: string; armed: boolean }) {
  const [on, setOn] = useOptimistic(armed);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-start">
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Pause alert" : "Resume alert"}
      onClick={() =>
        start(async () => {
          setOn(!on);
          // a failed save leaves the server state as it was, so the switch flips back on its own; say why
          const r = await setAlertStatus(id, on ? "disabled" : "armed").catch(() => ({ error: "That didn't go through. Try again." }));
          setError(r?.error ?? null);
        })
      }
      className="inline-flex items-center gap-2 whitespace-nowrap text-[12.5px]"
    >
      {/* shrink-0: in a narrow table cell the track was squeezed and the knob sat over the label */}
      <span className={clsx("relative block h-[18px] w-8 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-foreground/25")}>
        <span
          className={clsx(
            "absolute left-0 top-[2px] size-[14px] rounded-full bg-card shadow-sm transition-transform duration-150 motion-reduce:transition-none",
            on ? "translate-x-[16px]" : "translate-x-[2px]",
          )}
        />
      </span>
      <span className={on ? "" : "text-muted-foreground"}>{on ? "Armed" : "Paused"}</span>
    </button>
    {error ? (
      <span role="alert" className="mt-1 max-w-[200px] text-[11px] leading-4 text-loss">
        {error}
      </span>
    ) : null}
    </span>
  );
}
