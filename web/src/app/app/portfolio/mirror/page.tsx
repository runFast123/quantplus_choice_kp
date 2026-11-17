import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon, FileArrowUpIcon } from "@phosphor-icons/react/ssr";
import { buttonClass } from "@/components/ui/button";
import { Delta } from "@/components/ui/data";
import { Empty, PageHeader, Panel, PlanGate } from "@/components/ui/layout";
import { AFTER_SESSIONS, BIG_MOVE, MIN_SIDE, MIN_TRADES, RUNUP_SESSIONS, sentences, type Example } from "@/lib/behaviour-mirror";
import { date, rupees } from "@/lib/format";
import { loadMirror } from "@/server/behaviour-mirror";
import { can, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Your trading habits" };

const TITLE = "Your trading habits";
const DESCRIPTION =
  "Four habits read from your own buys and sales: how long you keep winners and losers, what stocks did after you sold, buying after a run-up, and the size of your wins and losses. Past facts about your trades, not advice.";

/** The Behaviour mirror (lib/behaviour-mirror.ts). */
export default async function MirrorPage() {
  const s = await requireSession();
  const back = (
    <Link href="/app/portfolio" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon size={14} aria-hidden /> Portfolio
    </Link>
  );
  if (!can(s, "portfolio") || !can(s, "behaviour_mirror")) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <PageHeader eyebrow="Portfolio" title={TITLE} description={DESCRIPTION} />
        <PlanGate feature="Your trading habits" />
      </div>
    );
  }

  const m = await loadMirror(s.supabase);
  if (!m.stocks) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <PageHeader eyebrow="Portfolio" title={TITLE} description={DESCRIPTION} />
        <Empty
          title="No trades to read yet."
          action={
            <Link href="/app/portfolio/import" className={buttonClass("primary", "md")}>
              <FileArrowUpIcon size={16} aria-hidden /> Import your tradebook
            </Link>
          }
        >
          Import your broker&apos;s tradebook, or record your buys and sales, and your habits show here.
        </Empty>
      </div>
    );
  }

  const say = sentences(m);
  const tooFew = (what: string) => `Needs at least ${MIN_TRADES} ${what} (${MIN_SIDE} on each side) before it says anything.`;

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader eyebrow="Portfolio" title={TITLE} description={DESCRIPTION} />

      <div className="stagger grid gap-4 lg:grid-cols-2">
        <Habit
          title="Winners and losers: how long you kept them"
          figure={
            m.holding.lossDays != null && m.holding.winDays != null ? (
              <Pair a={["Losers", m.holding.lossDays, "days"]} b={["Winners", m.holding.winDays, "days"]} />
            ) : null
          }
          sentence={say.holding ?? tooFew("closed trades")}
          how={`${m.holding.trades} closed trades (${m.holding.winners} winners, ${m.holding.losers} losers, after charges). Calendar days from the buy to the sale; the middle trade of each side. Opening balances have no real buy date and are left out.`}
        />
        <Habit
          title={`After you sold: the next ${AFTER_SESSIONS} trading days`}
          figure={
            m.after.medianPct != null ? (
              <div className="flex flex-col gap-0.5">
                <span className="text-[12.5px] text-muted-foreground">
                  The shares you sold were worth, {AFTER_SESSIONS} trading days later (not your profit or loss)
                </span>
                <span className="display text-[28px]">
                  <span className="num">{rupees(Math.abs(m.after.rupees))}</span>{" "}
                  <span className="text-[18px] text-muted-foreground">{m.after.rupees >= 0 ? "more than you sold them for" : "less than you sold them for"}</span>
                </span>
              </div>
            ) : null
          }
          sentence={say.after ?? `Needs at least ${MIN_TRADES} sales with ${AFTER_SESSIONS} trading days of prices after them.`}
          how={`${m.after.counted} of ${m.after.sales} sales have ${AFTER_SESSIONS} trading days of stored prices after them. Your sale price and the later close are both in today's shares (splits and bonuses).`}
          examplesTitle="The sales the stock rose most after"
          examples={m.after.medianPct != null ? m.after.examples.filter((e) => (e.rupees ?? 0) > 0) : []}
          exampleText={(e) => (
            <>
              {e.symbol}, sold {date(e.day)}: <Delta value={e.value * 100} /> {AFTER_SESSIONS} trading days later (
              <span className="num">{rupees(e.rupees ?? 0)}</span>)
            </>
          )}
        />
        <Habit
          title="Buying after a run-up"
          figure={
            m.runUp.afterMedian != null && m.runUp.otherMedian != null ? (
              <Pair a={["After a run-up", m.runUp.afterMedian * 100, "pct"]} b={["Your other buys", m.runUp.otherMedian * 100, "pct"]} />
            ) : null
          }
          sentence={say.runUp ?? tooFew("purchases with 20 trading days of prices before them")}
          how={`A purchase counts as after a run-up when the stock rose ${BIG_MOVE * 100}% or more in the ${RUNUP_SESSIONS} trading days before it. Its result is what it made so far: parts sold after charges, the rest at the last close; the middle purchase of each group. ${m.runUp.counted} of your ${m.runUp.buys} purchases have the prices needed.`}
          examplesTitle="The biggest run-ups you bought after"
          examples={m.runUp.afterMedian != null ? m.runUp.examples : []}
          exampleText={(e) => (
            <>
              {e.symbol}, bought {date(e.day)} after a <span className="num">{Math.round(e.value * 100)}%</span> rise in {RUNUP_SESSIONS} trading days
            </>
          )}
        />
        <Habit
          title="The size of your wins and losses"
          figure={
            m.size.avgWin != null && m.size.avgLoss != null ? (
              <Pair a={["Average win", m.size.avgWin * 100, "pct"]} b={["Average loss", m.size.avgLoss * 100, "pct"]} />
            ) : null
          }
          sentence={say.size ?? tooFew("closed trades")}
          how={`${m.size.trades} closed trades, each one's gain after charges over what it cost.`}
          examplesTitle="Your three largest losses"
          examples={m.size.bigLosses}
          exampleText={(e) => (
            <>
              {e.symbol}, sold {date(e.day)}: <Delta value={e.value * 100} /> (<Delta value={e.rupees ?? 0} kind="inr" showGlyph={false} />)
            </>
          )}
        />
      </div>

      <p className="text-[12px] leading-5 text-muted-foreground">
        From your own records{m.firstBuy ? ` since ${date(m.firstBuy)}` : ""} and the stored daily closes (stocks outside the 500 largest keep about 13
        months of prices, so older trades in them may not count). These describe what happened, not what to do next. For your trades next to
        the rules&apos; plans, see{" "}
        <Link href="/app/portfolio/compare" className="underline underline-offset-2 hover:text-foreground">
          your trades next to the rules
        </Link>
        .
      </p>
    </div>
  );
}

function Habit({
  title,
  figure,
  sentence,
  how,
  examples = [],
  examplesTitle,
  exampleText,
}: {
  title: string;
  figure: ReactNode;
  sentence: string;
  how: string;
  examples?: Example[];
  examplesTitle?: string;
  exampleText?: (e: Example) => ReactNode;
}) {
  return (
    <Panel title={title}>
      <div className="flex flex-col gap-3">
        {figure}
        <p className={figure ? "text-[14px] leading-6" : "text-[13.5px] leading-6 text-muted-foreground"}>{sentence}</p>
        {examples.length && exampleText ? (
          <div className="border-t border-border pt-3">
            {examplesTitle ? <p className="eyebrow mb-1.5">{examplesTitle}</p> : null}
            <ul className="flex flex-col gap-1.5 text-[13px]">
              {examples.map((e) => (
                <li key={`${e.symbol}-${e.day}`}>{exampleText(e)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-[11.5px] leading-5 text-muted-foreground">{how}</p>
      </div>
    </Panel>
  );
}

type Figure = [label: string, value: number, kind: "days" | "pct"];

/** Two figures side by side, each with its label (never color alone). */
function Pair({ a, b }: { a: Figure; b: Figure }) {
  const cell = ([label, value, kind]: Figure) => (
    <div className="flex flex-col gap-0.5">
      <span className="text-[12.5px] text-muted-foreground">{label}</span>
      {kind === "pct" ? (
        <Delta value={value} className="display text-[28px]" />
      ) : (
        <span className="display num text-[28px]">
          {Math.round(value)}
          <span className="ml-1 text-[14px] text-muted-foreground">days</span>
        </span>
      )}
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-4">
      {cell(a)}
      {cell(b)}
    </div>
  );
}
