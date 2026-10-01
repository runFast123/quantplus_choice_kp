import Link from "next/link";
import { price } from "@/lib/format";
import type { Quote } from "@/lib/types";
import { Delta } from "@/components/ui/data";

/** Last-close tape. Pauses on hover; static under reduced motion. */
export function TickerTape({ quotes }: { quotes: Quote[] }) {
  const items = quotes.filter((q) => q.last_price != null);
  if (!items.length) return null;
  const row = (hidden: boolean) =>
    items.map((q) => (
      <Link
        key={(hidden ? "b" : "a") + q.symbol}
        href={`/app/markets/${encodeURIComponent(q.symbol)}`}
        tabIndex={hidden ? -1 : undefined}
        aria-hidden={hidden || undefined}
        className="inline-flex items-baseline gap-2 px-4 text-[12px] hover:text-foreground"
      >
        <span className="num font-medium text-foreground">{q.symbol}</span>
        <span className="num text-muted-foreground">{price(q.last_price)}</span>
        <Delta value={q.change_pct} className="text-[11.5px]" />
      </Link>
    ));
  return (
    <div className="relative h-8 overflow-hidden border-b border-border bg-card/60" role="region" aria-label="Last close prices">
      <div className="animate-marquee flex h-8 w-max items-center whitespace-nowrap motion-reduce:animate-none">
        {row(false)}
        {row(true)}
      </div>
      <div className="pointer-events-none absolute inset-y-0 left-0 w-10 bg-gradient-to-r from-background to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background to-transparent" />
    </div>
  );
}
