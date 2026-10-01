"use client";

import clsx from "clsx";
import { useOptimistic, useTransition } from "react";
import { setAlertStatus } from "./actions";

export function AlertStatusToggle({ id, armed }: { id: string; armed: boolean }) {
  const [on, setOn] = useOptimistic(armed);
  const [, start] = useTransition();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={on ? "Pause alert" : "Resume alert"}
      onClick={() =>
        start(async () => {
          setOn(!on);
          await setAlertStatus(id, on ? "disabled" : "armed");
        })
      }
      className="inline-flex items-center gap-2 text-[12.5px]"
    >
      <span className={clsx("relative h-[18px] w-8 rounded-full transition-colors", on ? "bg-primary" : "bg-foreground/15")}>
        <span
          className={clsx(
            "absolute top-[2px] size-[14px] rounded-full bg-card shadow-sm transition-transform duration-150",
            on ? "translate-x-[16px]" : "translate-x-[2px]",
          )}
        />
      </span>
      <span className={on ? "" : "text-muted-foreground"}>{on ? "Armed" : "Paused"}</span>
    </button>
  );
}
