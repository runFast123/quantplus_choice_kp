import Link from "next/link";
import { Badge } from "@/components/ui/data";
import { TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, price, strategyLabel } from "@/lib/format";
import { STAY_IN_RECORD, STAY_IN_WIN_2024, type StayIn } from "@/lib/stay-in";
import { reviewDate } from "@/lib/strong-trend";

const pct = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;

/**
 * The Stay-in Plan card on the stock page (lib/stay-in.ts): where the plan stands for the latest trend-rule buy, the
 * line that would end it, the tested record next to today's 60-session plan, and its caveats. Research, not advice.
 */
export function StayInCard({ state, held, messages }: { state: StayIn; held: boolean; messages: boolean }) {
  const rule = strategyLabel[state.signal.strategy] ?? state.signal.strategy;
  const above = state.sma200 != null && state.last != null ? ((state.last - state.sma200) / state.sma200) * 100 : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 text-[14px] leading-6">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={state.status === "running" ? "ink" : "neutral"}>{state.status === "running" ? "still holding" : "ended"}</Badge>
          <span>After the {rule} buy of {date(state.from)}.</span>
        </p>
        {state.status === "running" ? (
          <p>
            Today&apos;s plan sells on the 60th session (around {date(reviewDate(state.signal.generated_at).toISOString())}). The Stay-in
            Plan holds instead until the first close below the 200-day average
            {state.sma200 != null ? (
              <>
                , now <span className="num">₹{price(state.sma200)}</span>
                {above != null ? (
                  <>
                    {" "}
                    (the price is <span className="num">{Math.abs(above).toFixed(1)}%</span> {above >= 0 ? "above" : "below"} it)
                  </>
                ) : null}
              </>
            ) : null}
            {state.stop != null ? (
              <>
                , and keeps the same safety stop of <span className="num">₹{price(state.stop)}</span>
              </>
            ) : null}
            .
            {above != null && above < 0 ? (
              <>
                {" "}
                <strong className="font-semibold">The price is already below that line</strong>, so unless it closes back above it, the Stay-in
                Plan sells at the next close.
              </>
            ) : null}
          </p>
        ) : (
          <p>
            It ended on {date(state.endedOn!)}: {state.how === "stop" ? "the price reached the safety stop" : "the stock closed below its 200-day average"}.
            A new trend-rule buy starts it again.
          </p>
        )}
      </div>

      <TableWrap label="The Stay-in Plan's tested record">
        <table className="w-full min-w-[440px]">
          <thead>
            <tr>
              <th className={th}>Period</th>
              <th className={thNum}>60-session plan</th>
              <th className={thNum}>Stay-in Plan</th>
            </tr>
          </thead>
          <tbody>
            {STAY_IN_RECORD.map((r) => (
              <tr key={r.period} className={tr}>
                <td className={td}>{r.period}</td>
                <td className={`${tdNum} py-1.5`}>
                  {pct(r.plan.cagr)} a year
                  <span className="block text-[11px] text-muted-foreground">worst fall {r.plan.fall.toFixed(1)}%</span>
                </td>
                <td className={`${tdNum} py-1.5`}>
                  {pct(r.stay.cagr)} a year
                  <span className="block text-[11px] text-muted-foreground">worst fall {r.stay.fall.toFixed(1)}%</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>

      <p className="text-[12px] leading-5 text-muted-foreground">
        The four trend rules&apos; buys in each year&apos;s 300 most traded NSE stocks, as a portfolio of 10 equal slots, after 0.5% costs. The
        rule was written down before the test and passed its check years. The caveats: only about {STAY_IN_WIN_2024}% of Stay-in trades made
        money in 2024–26, so a few long winners carried it; that period had {STAY_IN_RECORD[1].stay.trades} portfolio trades, and part of its
        gain is in positions still open in October 2026. Past research, not advice. The rule&apos;s own 60-session record is unchanged.
      </p>

      {held ? (
        <p className="text-[13px]" data-testid="stay-in-messages">
          {messages ? "You get a message when the Stay-in Plan sells a stock you hold." : "Messages when it sells are off."}{" "}
          <Link href="/app/settings?tab=notifications" className="underline underline-offset-2 hover:text-foreground">
            {messages ? "Change in Settings" : "Turn them on in Settings"}
          </Link>
          .
        </p>
      ) : null}
    </div>
  );
}
