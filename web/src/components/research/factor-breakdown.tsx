import clsx from "clsx";
import { factorScore } from "@/lib/format";
import type { ResearchFactor } from "@/server/news-data";

/**
 * Each factor's −2…+2 score as a small diverging bar, its weight, and the
 * sentence that produced it — the note explains itself.
 */
export function FactorBreakdown({ factors }: { factors: ResearchFactor[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {factors.map((f) => {
        const pct = (Math.min(2, Math.abs(f.score)) / 2) * 50;
        return (
          <li key={f.key} data-testid="factor" className="grid grid-cols-[110px_88px_1fr] items-start gap-3 py-2.5 first:pt-0 last:pb-0 max-sm:grid-cols-[1fr_88px]">
            <span className="text-[13px] font-medium">
              {f.label}
              <span className="block text-[11px] font-normal text-muted-foreground">{f.weight ? `${Math.round(f.weight * 100)}% weight` : "context only"}</span>
            </span>
            <span role="img" className="flex items-center gap-1.5 pt-1" aria-label={`${f.label} ${factorScore(f.score)} of ±2`}>
              <span className="relative block h-1.5 w-14 rounded-full bg-foreground/[0.07]">
                <span className="absolute inset-y-[-2px] left-1/2 w-px bg-foreground/30" aria-hidden />
                <span
                  className={clsx("absolute inset-y-0 rounded-full", f.score >= 0 ? "bg-gain" : "bg-loss")}
                  style={f.score >= 0 ? { left: "50%", width: `${pct}%` } : { right: "50%", width: `${pct}%` }}
                  aria-hidden
                />
              </span>
              <span className={clsx("num text-[11.5px]", f.score > 0 ? "text-gain" : f.score < 0 ? "text-loss" : "text-muted-foreground")}>
                {factorScore(f.score)}
              </span>
            </span>
            <span className="text-[12.5px] leading-5 text-muted-foreground max-sm:col-span-2">
              {f.detail}
              {f.top_headline ? <span className="mt-0.5 block italic">“{f.top_headline}”</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
