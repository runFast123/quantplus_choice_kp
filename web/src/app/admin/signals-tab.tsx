import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowRightIcon, ClockIcon, FunnelIcon, InfoIcon } from "@phosphor-icons/react/ssr";
import { CheckTag } from "@/components/market/check-tag";
import { HealthChip } from "@/components/market/rule-health";
import { buttonClass } from "@/components/ui/button";
import { Badge, Delta, Stat } from "@/components/ui/data";
import { Input, Select } from "@/components/ui/field";
import { Empty, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import {
  SHOW,
  SIZES,
  SORTS,
  applyFilters,
  groupByStock,
  headline,
  parseFilters,
  ruleCounts,
  signalsHref,
  type DaySignal,
  type Filters,
  type Show,
} from "@/lib/admin-signals";
import { date, longDate, price } from "@/lib/format";
import { RULES, hasSuperTrendExit, ruleOf } from "@/lib/rules";
import { checkKey, isCheckRule } from "@/lib/signal-checks";
import { loadDaySignals } from "@/server/admin-signals";

/** Table rows before "narrow the filters". */
const MAX_ROWS = 300;
const label = "mb-1 block text-[11.5px] font-medium text-muted-foreground";

/** What the rule does with this signal in the session after the close, in plain words. */
function nextStep(s: DaySignal, latest: boolean): string {
  const rule = ruleOf(s.strategy);
  if (s.kind === "level") return `Buys the next session only if it trades at ₹${price(s.limit)} or lower`;
  if (s.kind === "exit") return `Sold${s.how ? `: ${s.how}` : ""}`;
  if (rule?.kind === "dip") return `Bought during the session at ₹${price(s.limit ?? s.close)}: the price reached its dip level`;
  return latest ? "Buys at the next open" : "Bought at the next open";
}

const kindBadge = (s: DaySignal) =>
  s.kind === "exit" ? <Badge tone="neutral">EXIT</Badge> : s.kind === "level" ? <Badge tone="coral">LEVEL</Badge> : <Badge tone="ink">BUY</Badge>;

/**
 * Admin → Signals after the close (ADR-063): which stocks each of the seven rules bought, set a dip-buy level on or sold
 * on one session's close, as counts per rule, one card per rule and a filterable table. Read-only research view.
 */
export async function SignalsTab({ db, sp }: { db: SupabaseClient; sp: Record<string, string | string[] | undefined> }) {
  const requested = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  const data = await loadDaySignals(db, requested);
  const f = parseFilters(sp);
  const all = groupByStock(data.signals, data.info);
  const counts = ruleCounts(data.signals);
  const top = headline(all);
  const rows = applyFilters(all, f);
  const shown = rows.slice(0, MAX_ROWS);
  const sectors = [...new Set(all.map((r) => r.sector).filter((x): x is string => Boolean(x)))].sort();
  const day = data.day;
  const href = (patch: Partial<Filters>) => signalsHref(day, f, patch);
  const kindCount: Record<Show, number> = {
    buys: top.buys + top.levels,
    buy: top.buys,
    level: top.levels,
    exit: top.exits,
    all: top.buys + top.levels + top.exits,
  };
  const filtered = Boolean(f.rule || f.segment || f.size || f.sector || f.q || f.multi);

  if (!day) {
    return (
      <Panel title="Signals after the close">
        <Empty title="No sessions stored yet.">The rules run after the daily price load.</Empty>
      </Panel>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="admin-signals">
      <Panel
        title="Signals after the close"
        meta={`${longDate(day)} · the seven rules on every listed stock`}
        actions={data.isLatest ? <Badge tone="gain">Latest close</Badge> : <Badge>Earlier session</Badge>}
      >
        {data.pending ? (
          <p className="mb-3 flex items-start gap-2 rounded-md border border-border bg-foreground/[0.03] p-2.5 text-[12.5px]">
            <ClockIcon size={15} className="mt-0.5 shrink-0" aria-hidden />
            Prices for {date(data.pending)} are in; the rules run on them in the next few minutes. Until then this shows {date(day)}.
          </p>
        ) : null}
        <nav aria-label="Session" className="flex flex-wrap gap-1.5">
          {data.sessions.map((s) => {
            const active = s.day === day;
            return (
              <Link
                key={s.day}
                href={signalsHref(s.day, f)}
                aria-current={active ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] transition-colors ${
                  active ? "border-foreground bg-foreground text-background" : "border-border hover:border-muted-foreground/50 hover:bg-foreground/[0.03]"
                }`}
              >
                <span>{date(s.day)}</span>
                <span className={`num rounded px-1 text-[11px] ${active ? "bg-background/20" : "bg-muted"}`} title="Stocks with a buy or a dip-buy level">
                  {s.stocks}
                </span>
              </Link>
            );
          })}
        </nav>
        <p className="mt-3 flex max-w-[90ch] items-start gap-2 text-[12.5px] leading-5 text-muted-foreground">
          <InfoIcon size={15} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            Prices load after each weekday&apos;s close (about 5 pm IST) and the rules run straight after. The five trend
            rules buy at the next open. The two dip rules set a level for the next session and buy only if the price
            trades there. These are research signals from fixed rules, not advice.
          </span>
        </p>
      </Panel>

      <section className="panel grid grid-cols-2 gap-y-1 md:grid-cols-5 md:divide-x md:divide-border" aria-label="Totals">
        <Stat className="p-4" label="Stocks with a buy" value={top.stocksBuying.toLocaleString("en-IN")} sub="a buy signal or a dip-buy level" />
        <Stat className="p-4" label="Buy signals" value={top.buys.toLocaleString("en-IN")} sub={data.isLatest ? "buy at the next open" : "on this close"} />
        <Stat
          className="p-4"
          label="Dip-buy levels"
          value={top.levels.toLocaleString("en-IN")}
          sub={data.isLatest ? "for the next session" : "kept for the latest close only"}
        />
        <Stat className="p-4" label="On 2+ rules" value={top.multi.toLocaleString("en-IN")} sub="stocks more than one rule picked" />
        <Stat className="p-4" label="Exits" value={top.exits.toLocaleString("en-IN")} sub="trades the rules closed" />
      </section>

      <section aria-label="By rule" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-signal-rules">
        {counts.map((c) => {
          const rule = ruleOf(c.rule)!;
          const picked = [...new Set([...c.buys, ...c.levels])].sort();
          const total = picked.length;
          return (
            <article key={c.rule} className="flex min-w-0 flex-col gap-2.5 rounded-lg border border-border bg-card p-3.5" data-rule={c.rule}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="num text-[10.5px] font-semibold tracking-wider text-muted-foreground">{rule.tag}</span>
                  <h3 className="truncate text-[14px] font-semibold">{rule.name}</h3>
                </div>
                <HealthChip row={data.health.get(c.rule)} prefix="Rule:" />
              </div>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="flex items-baseline gap-1.5">
                  <span className="num text-[26px] leading-none">{c.buys.length}</span>
                  <span className="text-[12px] text-muted-foreground">{rule.kind === "dip" ? "bought" : "buys"}</span>
                </span>
                {rule.kind === "dip" ? (
                  <span className="flex items-baseline gap-1.5">
                    <span className="num text-[26px] leading-none">{c.levels.length}</span>
                    <span className="text-[12px] text-muted-foreground">levels set</span>
                  </span>
                ) : null}
                <span className="flex items-baseline gap-1.5">
                  <span className="num text-[15px] leading-none text-muted-foreground">{c.exits.length}</span>
                  <span className="text-[12px] text-muted-foreground">exits</span>
                </span>
              </div>
              <p className="text-[12px] leading-5 text-muted-foreground">
                <span className="font-medium text-foreground/80">Signal:</span> {rule.why}.
              </p>
              {total ? (
                <ul className="flex flex-wrap gap-1" aria-label={`${rule.name}: stocks`}>
                  {picked.slice(0, 10).map((sym) => (
                    <li key={sym}>
                      <Link
                        href={`/app/markets/${encodeURIComponent(sym)}`}
                        className="num inline-flex h-6 items-center rounded border border-border px-1.5 text-[11.5px] hover:border-foreground"
                      >
                        {sym}
                      </Link>
                    </li>
                  ))}
                  {total > 10 ? (
                    <li>
                      <Link href={href({ rule: c.rule, show: "buys" }) + "#signal-table"} className="inline-flex h-6 items-center px-1 text-[11.5px] underline underline-offset-4">
                        +{total - 10} more
                      </Link>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  No buys on this close
                  {c.rule === "strong_trend" && data.weather && data.weather !== "sunny"
                    ? `: the market was ${data.weather}, and this rule buys only when it is sunny.`
                    : "."}
                </p>
              )}
              <Link
                href={href({ rule: c.rule, show: "all" }) + "#signal-table"}
                className="mt-auto inline-flex items-center gap-1 self-start text-[12px] font-medium text-foreground underline-offset-4 hover:underline"
              >
                Show in the table <ArrowRightIcon size={12} aria-hidden />
              </Link>
            </article>
          );
        })}
        <article className="flex min-w-0 flex-col gap-2 rounded-lg border border-dashed border-border p-3.5 text-[12px] leading-5 text-muted-foreground">
          <h3 className="text-[13px] font-semibold text-foreground">Reading the counts</h3>
          <p>
            <strong className="font-medium text-foreground">Buys</strong>: the rule bought on this close. Trend rules buy at
            the next open; a dip rule&apos;s buy is a fill during the session.
          </p>
          <p>
            <strong className="font-medium text-foreground">Levels</strong>: a dip rule buys the next session only if the
            price trades at the level or lower. Many levels are never reached.
          </p>
          <p>The rule&apos;s health chip compares its last 40 finished trades with its tested record.</p>
        </article>
      </section>

      <Panel
        id="signal-table"
        title="Stocks"
        meta={`${rows.length.toLocaleString("en-IN")} of ${all.length.toLocaleString("en-IN")} stocks on this close`}
        actions={
          filtered ? (
            <Link href={signalsHref(day, parseFilters({ show: f.show, sort: f.sort })) + "#signal-table"} className="text-[12px] underline underline-offset-4">
              Clear filters
            </Link>
          ) : null
        }
      >
        <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Show">
          {(Object.keys(SHOW) as Show[]).map((k) => (
            <Link
              key={k}
              href={href({ show: k }) + "#signal-table"}
              aria-current={f.show === k ? "true" : undefined}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors ${
                f.show === k ? "border-foreground bg-foreground text-background" : "border-border hover:bg-foreground/[0.03]"
              }`}
            >
              {SHOW[k]}
              <span className="num text-[11px] opacity-80">{kindCount[k]}</span>
            </Link>
          ))}
        </div>

        <form method="get" action="/admin" className="mb-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" aria-label="Filter the stocks">
          <input type="hidden" name="tab" value="signals" />
          <input type="hidden" name="day" value={day} />
          {f.show !== "buys" ? <input type="hidden" name="show" value={f.show} /> : null}
          <div>
            <label htmlFor="sig-find" className={label}>
              Stock
            </label>
            <Input id="sig-find" name="find" defaultValue={f.q} placeholder="Symbol or name" className="h-9 text-[13px]" />
          </div>
          <div>
            <label htmlFor="sig-rule" className={label}>
              Rule
            </label>
            <Select id="sig-rule" name="rule" defaultValue={f.rule} className="h-9 text-[13px]">
              <option value="">All seven rules</option>
              {RULES.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="sig-size" className={label}>
              Company size
            </label>
            <Select id="sig-size" name="size" defaultValue={f.size} className="h-9 text-[13px]">
              <option value="">Any size</option>
              {Object.entries(SIZES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="sig-segment" className={label}>
              Board
            </label>
            <Select id="sig-segment" name="segment" defaultValue={f.segment} className="h-9 text-[13px]">
              <option value="">Main board and SME</option>
              <option value="equity">Main board</option>
              <option value="sme">SME</option>
            </Select>
          </div>
          <div>
            <label htmlFor="sig-sector" className={label}>
              Sector
            </label>
            <Select id="sig-sector" name="sector" defaultValue={f.sector} className="h-9 text-[13px]">
              <option value="">Any sector</option>
              {sectors.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="sig-sort" className={label}>
              Sort
            </label>
            <Select id="sig-sort" name="sort" defaultValue={f.sort} className="h-9 text-[13px]">
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-4 xl:col-span-1 xl:flex-col xl:items-stretch xl:gap-1.5">
            <label className="inline-flex h-9 items-center gap-2 text-[12.5px] xl:h-auto">
              <input type="checkbox" name="multi" value="1" defaultChecked={f.multi} className="size-4 accent-foreground" />
              On 2+ rules only
            </label>
            <button type="submit" className={buttonClass("primary", "sm")}>
              <FunnelIcon size={14} aria-hidden /> Apply
            </button>
          </div>
        </form>

        {shown.length === 0 ? (
          <Empty title={all.length ? "No stock matches these filters." : "No signals on this close."}>
            {all.length ? (
              <Link href={signalsHref(day, parseFilters({})) + "#signal-table"} className="text-foreground underline underline-offset-4">
                Clear the filters
              </Link>
            ) : (
              "The rules found nothing on this close."
            )}
          </Empty>
        ) : (
          <TableWrap label="Stocks and their signals">
            <table className="w-full min-w-[980px]">
              <thead>
                <tr>
                  <th className={th}>Stock</th>
                  <th className={th}>Rule</th>
                  <th className={th}>Signal</th>
                  <th className={th}>What the rule does</th>
                  <th className={thNum}>Signal close</th>
                  <th className={thNum}>Safety stop</th>
                  <th className={thNum}>Latest price</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) =>
                  r.signals.map((s, i) => {
                    const rule = ruleOf(s.strategy)!;
                    const tagged = isCheckRule(s.strategy) && s.kind !== "exit" && data.tags.has(checkKey(s.strategy, s.symbol, s.checkDay));
                    const first = i === 0;
                    const span = r.signals.length;
                    return (
                      <tr key={`${r.symbol}-${s.strategy}-${s.kind}-${i}`} className={first ? tr + " align-top" : "align-top"}>
                        {first ? (
                          <td rowSpan={span} className={td + " whitespace-normal py-2.5"}>
                            <Link href={`/app/markets/${encodeURIComponent(r.symbol)}`} className="num text-[13.5px] font-semibold hover:underline">
                              {r.symbol}
                            </Link>
                            <span className="block max-w-[220px] truncate text-[11.5px] text-muted-foreground" title={r.name}>
                              {r.name}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                              <span className="num">{r.rank ? `#${r.rank}` : "Unranked"}</span>
                              {r.segment === "sme" ? <Badge>SME</Badge> : null}
                              {r.sector ? <span className="max-w-[150px] truncate">· {r.sector}</span> : null}
                            </span>
                            {r.rules.length >= 2 ? (
                              <span className="mt-1 inline-flex">
                                <Badge tone="ink">{r.rules.length} rules</Badge>
                              </span>
                            ) : null}
                          </td>
                        ) : null}
                        <td className={td + " py-2.5"}>
                          <span className="num mr-1.5 text-[10.5px] font-semibold tracking-wider text-muted-foreground">{rule.tag}</span>
                          {rule.name}
                        </td>
                        <td className={td + " py-2.5"}>
                          <span className="flex flex-wrap items-center gap-1">
                            {kindBadge(s)}
                            {tagged && isCheckRule(s.strategy) ? <CheckTag rule={s.strategy} /> : null}
                          </span>
                        </td>
                        <td className={td + " whitespace-normal py-2.5 text-[12.5px]"}>
                          <span>{nextStep(s, data.isLatest)}</span>
                          {s.kind === "exit" ? (
                            <span className="ml-1.5">
                              <Delta value={s.resultPct} />
                            </span>
                          ) : null}
                        </td>
                        <td className={tdNum + " py-2.5"}>{s.close == null ? "—" : `₹${price(s.close)}`}</td>
                        <td className={tdNum + " py-2.5"}>
                          {s.kind === "exit" ? (
                            "—"
                          ) : hasSuperTrendExit(s.strategy) ? (
                            <span className="text-muted-foreground" title="SuperTrend breakout has no safety stop: it sells at the next open after SuperTrend turns down">
                              None
                            </span>
                          ) : s.stop == null ? (
                            "—"
                          ) : (
                            `₹${price(s.stop)}`
                          )}
                        </td>
                        {first ? (
                          <td rowSpan={span} className={tdNum + " py-2.5"}>
                            <span className="block">{r.last == null ? "—" : `₹${price(r.last)}`}</span>
                            <Delta value={r.changePct} className="text-[11.5px]" />
                          </td>
                        ) : null}
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </TableWrap>
        )}
        {rows.length > MAX_ROWS ? (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Showing the first {MAX_ROWS} of {rows.length.toLocaleString("en-IN")} stocks. Narrow the filters to see the rest.
          </p>
        ) : null}
      </Panel>
    </div>
  );
}
