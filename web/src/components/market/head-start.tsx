import clsx from "clsx";
import { Badge, Delta, RangeBar } from "@/components/ui/data";
import { TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { price } from "@/lib/format";
import { BANDS, MIN_TRADES, PERIODS, rowsFor, stageOf, summaryOf, type RuleRow, type Verdict } from "@/lib/head-start";
import type { RuleKey } from "@/lib/rules";

/**
 * "Am I too late?" on the stock page (lib/head-start.ts): where today's price stands against the 1-year low, and what
 * each rule's own trades did when they started from that stage in the tested record. Past results, never a forecast.
 */
export function HeadStart({
  lastPrice,
  low,
  high,
  live = [],
}: {
  lastPrice: number | null;
  low: number | null;
  high: number | null;
  /** Rules with an open signal on this stock: listed first and marked. */
  live?: readonly RuleKey[];
}) {
  const stage = stageOf(lastPrice, low, high);
  if (!stage) {
    return <p className="text-[13px] text-muted-foreground">Needs a year of prices for this stock.</p>;
  }
  const band = BANDS.find((b) => b.key === stage.band)!;
  const rows = rowsFor(stage.band).sort((a, b) => Number(live.includes(b.rule)) - Number(live.includes(a.rule)));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-[15px] leading-6">
          At <span className="num">₹{price(lastPrice)}</span> this stock is{" "}
          <strong className="num font-semibold">{Math.round(stage.run * 100)}%</strong> above its 1-year low of{" "}
          <span className="num">₹{price(low)}</span>, {stage.where} of its 1-year range.
        </p>
        <div className="mt-3 max-w-[420px]">
          <RangeBar low={low} high={high} value={lastPrice} />
          <span className="num mt-1.5 flex justify-between text-[11.5px] text-muted-foreground">
            <span>1-year low ₹{price(low)}</span>
            <span>high ₹{price(high)}</span>
          </span>
        </div>
      </div>

      <div>
        <p className="eyebrow mb-1">Each rule&apos;s past trades from stocks {band.label}</p>
        <TableWrap label="Past trades from this stage">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr>
                <th className={th}>Rule</th>
                <th className={thNum}>Trades</th>
                <th className={thNum}>Made money</th>
                {PERIODS.map((p) => (
                  <th key={p.key} className={thNum} title={p.label}>
                    Median {p.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.rule} row={r} live={live.includes(r.rule)} />
              ))}
            </tbody>
          </table>
        </TableWrap>
      </div>

      <p className="text-[13.5px] leading-6">{summaryOf(rows)}</p>
      <p className="text-[12px] leading-5 text-muted-foreground">
        Each rule&apos;s own plan on each year&apos;s 300 most traded NSE stocks, July 2019 to October 2026 (2019–23 is July 2019 to
        December 2023; 2024–26 is January 2024 to October 2026), after 0.5% costs. The
        median is the middle trade&apos;s result; under it, the rule&apos;s median over all its trades in the same years. Fewer
        than {MIN_TRADES} trades show as too few. In this test, being nearer the 1-year low did not make the rules&apos; trades
        better. Past results, not a forecast or advice.
      </p>
    </div>
  );
}

function Row({ row, live }: { row: RuleRow; live: boolean }) {
  return (
    <tr className={clsx(tr, live && "bg-foreground/[0.03]")}>
      <td className={td}>
        <span className="inline-flex items-center gap-2">
          {row.name}
          {live ? <Badge tone="ink">signal now</Badge> : null}
        </span>
      </td>
      <td className={tdNum}>{row.band.n}</td>
      <td className={tdNum}>{row.band.n >= MIN_TRADES && row.band.win != null ? `${Math.round(row.band.win)}%` : "—"}</td>
      {row.periods.map((p) => (
        <td key={p.key} className={clsx(tdNum, "py-1.5")}>
          {p.verdict === "too few" ? (
            <span className="text-muted-foreground">too few ({p.band.n})</span>
          ) : (
            <span className="inline-flex flex-col items-end leading-4">
              <Delta value={p.band.median} />
              <span className="mt-0.5 text-[11px] text-muted-foreground">
                {word(p.verdict)} rule <span className="num">{signed(p.rule.median)}</span>
              </span>
            </span>
          )}
        </td>
      ))}
    </tr>
  );
}

const word = (v: Verdict) => (v === "about the same" ? "about the same as" : v === "better" ? "better than" : "worse than");
const signed = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`);
