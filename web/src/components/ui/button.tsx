import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "coral";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium select-none " +
  "transition-all duration-200 ease-out active:scale-[0.985] active:translate-y-0.5 " +
  "disabled:opacity-50 disabled:pointer-events-none";

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow active:shadow-none",
  secondary: "border border-border bg-card text-foreground shadow-sm hover:bg-accent hover:border-muted-foreground/40 hover:shadow active:shadow-none",
  ghost: "text-foreground hover:bg-foreground/[0.06] active:bg-foreground/[0.1]",
  danger: "border border-loss/40 text-loss hover:bg-loss-soft active:border-loss",
  coral: "bg-coral text-coral-foreground shadow-sm hover:brightness-95 hover:shadow active:shadow-none",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-5 text-[15px]",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return clsx(base, variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function ButtonLink({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}
