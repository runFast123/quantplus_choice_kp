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
  /** An action may answer with `{ error }` (ActionState); the message is shown under the button. */
  onConfirm: () => Promise<{ error?: string } | void | undefined> | { error?: string } | void;
  children: ReactNode;
  confirmLabel?: string;
  label: string;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        aria-label={armed ? `${confirmLabel}: ${label}` : label}
        title={label}
        disabled={pending}
        onBlur={() => setArmed(false)}
        onClick={() => {
          if (!armed) {
            setError(null);
            return setArmed(true);
          }
          start(async () => {
            try {
              const r = await onConfirm();
              setError(r && r.error ? r.error : null);
            } catch {
              setError("That didn't go through. Check your connection and try again.");
            }
            setArmed(false);
          });
        }}
        className={clsx(
          "inline-flex h-7 items-center justify-center rounded-md px-2 text-[12px] transition-[background-color,color,transform] duration-150 active:scale-[0.97] motion-reduce:active:scale-100",
          armed ? "bg-loss text-white" : "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
          className,
        )}
      >
        {pending ? "…" : armed ? confirmLabel : children}
      </button>
      {error ? (
        <span role="alert" className="mt-1 max-w-[220px] text-right text-[11px] leading-4 text-loss">
          {error}
        </span>
      ) : null}
    </span>
  );
}
