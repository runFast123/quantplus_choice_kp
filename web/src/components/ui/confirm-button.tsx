"use client";

import clsx from "clsx";
import { useState, useTransition, type ReactNode } from "react";

/**
 * Two-step destructive button: first press arms it, second confirms.
 * Avoids a modal for small, reversible-ish actions like removing a row.
 */
export function ConfirmButton({
  onConfirm,
  children,
  confirmLabel = "Confirm",
  label,
  className,
}: {
  onConfirm: () => Promise<void> | void;
  children: ReactNode;
  confirmLabel?: string;
  label: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      aria-label={armed ? `${confirmLabel}: ${label}` : label}
      title={label}
      disabled={pending}
      onBlur={() => setArmed(false)}
      onClick={() => {
        if (!armed) return setArmed(true);
        start(async () => {
          await onConfirm();
          setArmed(false);
        });
      }}
      className={clsx(
        "inline-flex h-7 items-center justify-center rounded-md px-2 text-[12px] transition-colors",
        armed ? "bg-loss text-white" : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
        className,
      )}
    >
      {pending ? "…" : armed ? confirmLabel : children}
    </button>
  );
}
