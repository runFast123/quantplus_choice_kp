"use client";

import { PauseIcon, PlayIcon } from "@phosphor-icons/react";
import { useState } from "react";

/** WCAG 2.2.2: moving content needs a way to pause it (not just hover). */
export function TickerPause() {
  const [paused, setPaused] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        const next = !paused;
        setPaused(next);
        e.currentTarget.closest("[data-ticker]")?.setAttribute("data-paused", String(next));
      }}
      aria-pressed={paused}
      aria-label={paused ? "Resume ticker" : "Pause ticker"}
      className="absolute inset-y-0 right-0 z-10 grid w-8 place-items-center border-l border-border bg-card text-muted-foreground hover:text-foreground"
    >
      {paused ? <PlayIcon size={12} weight="fill" aria-hidden /> : <PauseIcon size={12} weight="fill" aria-hidden />}
    </button>
  );
}
