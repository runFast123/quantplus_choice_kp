import clsx from "clsx";
import type { ReactNode } from "react";
import { LockIcon } from "@phosphor-icons/react/ssr";
import { ButtonLink } from "./button";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-border pb-5 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="eyebrow mb-2">{eyebrow}</div> : null}
        <h1 className="display text-[30px] leading-[1.1] text-foreground md:text-[36px]">{title}</h1>
        {description ? <p className="mt-2 max-w-2xl text-[14px] leading-6 text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Panel({
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
  id,
}: {
  title?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section id={id} className={clsx("panel min-w-0", className)}>
      {title || actions ? (
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            {title ? <h2 className="truncate text-[13px] font-semibold tracking-wide text-foreground">{title}</h2> : null}
            {meta ? <span className="truncate text-[12px] text-muted-foreground">{meta}</span> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={clsx("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-2 px-1 py-6">
      <p className="display text-[19px] text-foreground">{title}</p>
      {children ? <p className="max-w-md text-[13px] leading-5 text-muted-foreground">{children}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Shown in place of a feature the current plan doesn't include. */
export function PlanGate({ feature, plan = "Pro" }: { feature: string; plan?: string }) {
  return (
    <div className="@container panel p-5" data-testid="plan-gate">
      <div className="flex flex-col items-start gap-3 @md:flex-row @md:items-center @md:justify-between">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-foreground/[0.06]">
          <LockIcon size={16} weight="regular" aria-hidden />
        </span>
        <div>
          <p className="text-[14px] font-medium">{feature}</p>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Included with {plan}. Upgrading keeps everything you&apos;ve already set up.
          </p>
        </div>
      </div>
      <ButtonLink href="/app/billing" size="sm" className="shrink-0">
        See plans
      </ButtonLink>
      </div>
    </div>
  );
}

/** Wide tables scroll inside their card, never the page. */
export function TableWrap({ children, label = "Table" }: { children: ReactNode; label?: string }) {
  // relative: keeps absolutely-positioned descendants (sr-only labels) inside the
  // scroller instead of stretching the page. tabIndex: keyboard users can scroll it.
  return (
    <div role="group" aria-label={`${label} — scrolls sideways`} tabIndex={0} className="relative -mx-4 overflow-x-auto px-4 [scrollbar-width:thin]">
      {children}
    </div>
  );
}

export const th = "eyebrow h-9 whitespace-nowrap px-3 text-left font-medium first:pl-0 last:pr-0";
export const thNum = th + " text-right";
export const td = "h-10 whitespace-nowrap px-3 first:pl-0 last:pr-0 text-[13px]";
export const tdNum = td + " num text-right";
export const tr = "border-t border-border/80 transition-colors hover:bg-foreground/[0.025]";
