import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

export const inputClass =
  "h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground " +
  "placeholder:text-muted-foreground/70 transition-colors duration-150 " +
  "hover:border-muted-foreground/50 focus:border-foreground focus:outline-none focus-visible:outline-none " +
  "aria-[invalid=true]:border-loss disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={clsx(inputClass, className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={clsx(inputClass, "appearance-none bg-[length:12px] pr-8", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[12px] text-loss" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-[12px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function FormMessage({ state }: { state?: { error?: string; message?: string } }) {
  if (!state?.error && !state?.message) return null;
  return (
    <p
      role={state.error ? "alert" : "status"}
      className={clsx(
        "rounded-md border px-3 py-2 text-[13px]",
        state.error ? "border-loss/30 bg-loss-soft text-loss" : "border-gain/30 bg-gain-soft text-gain",
      )}
    >
      {state.error ?? state.message}
    </p>
  );
}
