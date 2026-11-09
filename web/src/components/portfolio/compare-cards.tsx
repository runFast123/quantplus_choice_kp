import Link from "next/link";
import { Badge, Delta } from "@/components/ui/data";
import { date, price, qty, rupees } from "@/lib/format";
import type { BuyMatch, SaleMatch } from "@/lib/rule-compare";
import { ruleTag } from "@/lib/rules";

/** "₹2,522.22 more" / "₹811.93 less" / "the same" — the words carry the direction, the chip carries sign + glyph + colour. */
function moreLess(n: number) {
  if (Math.abs(n) < 0.005) return "the same";
  return `${rupees(Math.abs(n))} ${n > 0 ? "more" : "less"}`;
}

function sessions(n: number) {
  return `${n} trading session${n === 1 ? "" : "s"}`;
}

/** Both holding periods on one date line: the rule's and yours. Decorative; the card's sentences say the same. */
function Periods({ rule, you, today }: { rule: [string, string | null]; you: [string, string | null]; today: string }) {
  const t = (d: string) => Date.parse(d);
  const lo = Math.min(t(rule[0]), t(you[0]));
  const hi = Math.max(t(rule[1] ?? today), t(you[1] ?? today), lo + 86_400_000);
  const pos = (d: string) => `${(((t(d) - lo) / (hi - lo)) * 100).toFixed(2)}%`;
  const bar = (p: [string, string | null], label: string, cls: string) => (
    <div className="flex items-center gap-2">
      <span className="w-9 shrink-0 text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">{label}</span>
      <div className="relative h-2 flex-1 rounded-full bg-foreground/[0.06]">
        <span
          className={`absolute inset-y-0 rounded-full ${cls}`}
          style={{ left: pos(p[0]), width: `max(4px, calc(${pos(p[1] ?? today)} - ${pos(p[0])}))` }}
        />
      </div>
    </div>
  );
  return (
    <div aria-hidden className="flex flex-col gap-1.5 pt-1">
      {bar(rule, "Rule", "bg-foreground/70")}
      {bar(you, "You", "bg-foreground/30")}
    </div>
  );
}

export function BuyCard({ m, today, showSymbol = true }: { m: BuyMatch; today: string; showSymbol?: boolean }) {
  const lessPer = m.paidLessPerShare;
  const whenText =
    m.when === "same day"
      ? "on the same day as you"
      : m.when === "earlier"
        ? `${sessions(m.sessionsApart)} before you`
        : `${sessions(m.sessionsApart)} after you`;
  return (
    <article className="panel flex flex-col gap-3 p-4" data-testid="compare-buy">
      <header className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        {showSymbol ? (
          <Link href={`/app/portfolio/${encodeURIComponent(m.symbol)}`} className="num font-medium text-foreground hover:underline">
            {m.symbol}
          </Link>
        ) : null}
        <Badge tone="ink">{ruleTag(m.strategy)}</Badge>
        <span>{m.ruleName}</span>
        <span className="ml-auto">Your buy of {date(m.buyDate)}</span>
      </header>

      <div>
        <p className="display text-[19px] leading-snug text-foreground" data-testid="made-more">
          {m.madeMore == null ? (
            "What the rule's trade made isn't known yet."
          ) : (
            <>
              You would have made {moreLess(m.madeMore)} <Delta value={m.madeMore} kind="inr" className="ml-1 align-middle text-[13px]" />
            </>
          )}
        </p>
        <p className="mt-1 text-[13px] leading-5 text-muted-foreground" data-testid="paid-less">
          {Math.abs(lessPer) < 0.005
            ? "The rule paid the same price as you."
            : `You would have paid ${rupees(Math.abs(lessPer))} a share ${lessPer > 0 ? "less" : "more"} (${rupees(Math.abs(m.paidLessTotal))} on your ${qty(m.quantity)} shares).`}
        </p>
      </div>

      <div className="grid gap-3 text-[13px] leading-5 sm:grid-cols-2">
        <div>
          <p className="eyebrow mb-1">{m.ruleName}</p>
          <p>
            Bought {date(m.ruleBuyDate)} at <span className="num">{price(m.rulePrice)}</span>, {whenText}.
          </p>
          <p>
            {m.ruleOpen ? (
              "Still holding."
            ) : (
              <>
                Sold {date(m.ruleSellDate)} at <span className="num">{price(m.ruleSellPrice)}</span>
                {m.ruleReason ? ` (${m.ruleReason})` : ""}.
              </>
            )}
          </p>
          <p className="text-muted-foreground">
            Your {rupees(m.money)} in its trade: <Delta value={m.ruleGain} kind="inr" />
            {m.ruleReturnPct != null ? (
              <>
                {" "}
                (<Delta value={m.ruleReturnPct} />)
              </>
            ) : null}
            {m.ruleOpen ? " so far" : ""}
          </p>
        </div>
        <div>
          <p className="eyebrow mb-1">You</p>
          <p>
            Bought {date(m.buyDate)}: <span className="num">{qty(m.quantity)}</span> at <span className="num">{price(m.price)}</span>.
          </p>
          <p>
            {m.yourStatus === "held" ? "Still held." : m.yourStatus === "sold" ? `Sold by ${date(m.yourLastSale)}.` : `Partly sold, last on ${date(m.yourLastSale)}.`}
          </p>
          <p className="text-muted-foreground">
            After charges: <Delta value={m.yourGain} kind="inr" />
            {m.yourStatus !== "sold" ? " so far" : ""}
          </p>
        </div>
      </div>

      <Periods rule={[m.ruleBuyDate, m.ruleSellDate]} you={[m.buyDate, m.yourStatus === "sold" ? m.yourLastSale : null]} today={today} />

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2 text-[11.5px] text-muted-foreground">
        <span>Past research, not advice.</span>
        <Link href={`/app/markets/${encodeURIComponent(m.symbol)}`} className="hover:text-foreground hover:underline">
          See it on the chart
        </Link>
      </footer>
    </article>
  );
}

export function SaleCard({ m, showSymbol = true }: { m: SaleMatch; showSymbol?: boolean }) {
  return (
    <article className="panel flex flex-col gap-2 p-4" data-testid="compare-sale">
      <header className="flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
        {showSymbol ? (
          <Link href={`/app/portfolio/${encodeURIComponent(m.symbol)}`} className="num font-medium text-foreground hover:underline">
            {m.symbol}
          </Link>
        ) : null}
        <Badge tone="ink">{ruleTag(m.strategy)}</Badge>
        <span>{m.ruleName}</span>
        <span className="ml-auto">Your sale of {date(m.sellDate)}</span>
      </header>
      <p className="display text-[19px] leading-snug text-foreground" data-testid="sale-more">
        {m.madeMore == null ? (
          "The rule's sale price isn't known yet."
        ) : (
          <>
            Selling with the rule, you would have made {moreLess(m.madeMore)}
            {m.ruleOpen ? " so far" : ""} <Delta value={m.madeMore} kind="inr" className="ml-1 align-middle text-[13px]" />
          </>
        )}
      </p>
      <p className="text-[13px] leading-5">
        You sold <span className="num">{qty(m.quantity)}</span> at <span className="num">{price(m.price)}</span>. {m.ruleName} had bought on{" "}
        {date(m.ruleBuyDate)} and{" "}
        {m.ruleOpen ? (
          <>
            is still holding; the last close is <span className="num">{price(m.ruleSellPrice)}</span>.
          </>
        ) : (
          <>
            sold on {date(m.ruleSellDate)} at <span className="num">{price(m.ruleSellPrice)}</span>
            {m.ruleReason ? ` (${m.ruleReason})` : ""}.
          </>
        )}
      </p>
      <footer className="border-t border-border pt-2 text-[11.5px] text-muted-foreground">Past research, not advice.</footer>
    </article>
  );
}
