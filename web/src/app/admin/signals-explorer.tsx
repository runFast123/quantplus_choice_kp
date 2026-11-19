"use client";

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRightIcon, ClockIcon, InfoIcon, MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { Badge, Delta, Stat } from "@/components/ui/data";
import { Input, Select } from "@/components/ui/field";
import { TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
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
  type SignalSessions,
  type StockInfo,
} from "@/lib/admin-signals";
import { date, longDate, price } from "@/lib/format";
import { RULES, hasSuperTrendExit, ruleOf, type RuleKey } from "@/lib/rules";
import { checkKey, isCheckRule, type CheckRule } from "@/lib/signal-checks";

/** Table rows before "narrow the filters". */
const MAX_ROWS = 300;
const label = "mb-1 block text-[11.5px] font-medium text-muted-foreground";
const chip = (on: boolean) =>
  `inline-flex items-center gap-1.5 border text-[12px] transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
    on ? "border-foreground bg-foreground text-background" : "border-border hover:border-muted-foreground/50 hover:bg-foreground/[0.04]"
  }`;

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

const scrollToTable = () => {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  document.getElementById("signal-table")?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
};

/**
 * Admin → Signals after the close (ADR-063), in the browser: all ten sessions arrive with the page, so the session
 * picker, the Show buttons and every filter answer at once; the URL follows (replaceState) so a view can be shared.
 * Rule health chips and check tags are drawn on the server and passed in.
 */
export function SignalsExplorer({
  data,
  initialDay,
  initialFilters,
  health,
  checkTags,
}: {
  data: SignalSessions;
  initialDay: string | null;
  initialFilters: Filters;
  health: Partial<Record<RuleKey, ReactNode>>;
  checkTags: Record<CheckRule, ReactNode>;
}) {
  const [day, setDay] = useState(initialDay && data.byDay[initialDay] ? initialDay : data.latestRun);
  const [f, setF] = useState(initialFilters);
  const set = (patch: Partial<Filters>) => setF((cur) => ({ ...cur, ...patch }));
  // Typing stays smooth on a slow phone: the table catches up a frame later.
  const view = useDeferredValue(f);

  useEffect(() => {
    window.history.replaceState(window.history.state, "", signalsHref(day, f) + window.location.hash);
  }, [day, f]);

  const info = useMemo(() => new Map<string, StockInfo>(Object.entries(data.info)), [data.info]);
  const tags = useMemo(() => new Set(data.tags), [data.tags]);
  const signals = useMemo(() => (day ? (data.byDay[day] ?? []) : []), [data.byDay, day]);
  const all = useMemo(() => groupByStock(signals, info), [signals, info]);
  const counts = useMemo(() => ruleCounts(signals), [signals]);
  const top = useMemo(() => headline(all), [all]);
  const rows = useMemo(() => applyFilters(all, view), [all, view]);
  const sectors = useMemo(() => [...new Set(all.map((r) => r.sector).filter((x): x is string => Boolean(x)))].sort(), [all]);

  if (!day) {
    return (
      <section className="panel p-6 text-center text-[13px] text-muted-foreground">
        No sessions stored yet. The rules run after the daily price load.
      </section>
    );
  }

  const isLatest = day === data.latestRun;
  const weather = data.sessions.find((s) => s.day === day)?.weather ?? null;
  const shown = rows.slice(0, MAX_ROWS);
  const filtered = Boolean(f.rule || f.segment || f.size || f.sector || f.q || f.multi);
  const kindCount: Record<Show, number> = {
    buys: top.buys + top.levels,
    buy: top.buys,
    level: top.levels,
    exit: top.exits,
    all: top.buys + top.levels + top.exits,
  };
  const clear = () => setF(parseFilters({ show: f.show, sort: f.sort }));

  return (
    <div className="flex flex-col gap-6" data-testid="admin-signals">
      <section className="panel min-w-0">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 flex-[1_1_auto] items-baseline gap-2">
            <h2 className="shrink-0 text-[13px] font-semibold tracking-wide">Signals after the close</h2>
            <span className="min-w-0 truncate text-[12px] text-muted-foreground">{longDate(day)} · the seven rules on every listed stock</span>
          </div>
          {isLatest ? <Badge tone="gain">Latest close</Badge> : <Badge>Earlier session</Badge>}
        </div>
        <div className="p-4">
          {data.pending ? (
            <p className="mb-3 flex items-start gap-2 rounded-md border border-border bg-foreground/[0.03] p-2.5 text-[12.5px]">
              <ClockIcon size={15} className="mt-0.5 shrink-0" aria-hidden />
              Prices for {date(data.pending)} are in; the rules run on them in the next few minutes. Until then the latest
              close here is {date(data.latestRun)}.
            </p>
          ) : null}
          <div role="group" aria-label="Session" className="flex flex-wrap gap-1.5">
            {data.sessions.map((s) => {
              const on = s.day === day;
              return (
                <button key={s.day} type="button" aria-pressed={on} onClick={() => setDay(s.day)} className={`${chip(on)} rounded-md px-2.5 py-1`}>
                  <span>{date(s.day)}</span>
                  <span className={`num rounded px-1 text-[11px] ${on ? "bg-background/20" : "bg-muted"}`} title="Stocks with a buy or a dip-buy level">
                    {s.stocks}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 flex max-w-[90ch] items-start gap-2 text-[12.5px] leading-5 text-muted-foreground">
            <InfoIcon size={15} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Prices load after each weekday&apos;s close (about 5 pm IST) and the rules run straight after. The five trend
              rules buy at the next open. The two dip rules set a level for the next session and buy only if the price
              trades there. These are research signals from fixed rules, not advice.
            </span>
          </p>
        </div>
      </section>

      <section className="panel grid grid-cols-2 gap-y-1 md:grid-cols-5 md:divide-x md:divide-border" aria-label="Totals">
        <Stat className="p-4" label="Stocks with a buy" value={top.stocksBuying.toLocaleString("en-IN")} sub="a buy signal or a dip-buy level" />
        <Stat className="p-4" label="Buy signals" value={top.buys.toLocaleString("en-IN")} sub={isLatest ? "buy at the next open" : "on this close"} />
        <Stat
          className="p-4"
          label="Dip-buy levels"
          value={top.levels.toLocaleString("en-IN")}
          sub={isLatest ? "for the next session" : "kept for the latest close only"}
        />
        <Stat className="p-4" label="On 2+ rules" value={top.multi.toLocaleString("en-IN")} sub="stocks more than one rule picked" />
        <Stat className="p-4" label="Exits" value={top.exits.toLocaleString("en-IN")} sub="trades the rules closed" />
      </section>

      <section aria-label="By rule" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-signal-rules">
        {counts.map((c) => {
          const rule = ruleOf(c.rule)!;
          const picked = [...new Set([...c.buys, ...c.levels])].sort();
          const total = picked.length;
          const active = f.rule === c.rule;
          return (
            <article
              key={c.rule}
              data-rule={c.rule}
              className={`flex min-w-0 flex-col gap-2.5 rounded-lg border bg-card p-3.5 transition-colors duration-150 ${active ? "border-foreground" : "border-border"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="num text-[10.5px] font-semibold tracking-wider text-muted-foreground">{rule.tag}</span>
                  <h3 className="truncate text-[14px] font-semibold">{rule.name}</h3>
                </div>
                {health[c.rule] ?? null}
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
                        prefetch={false}
                        href={`/app/markets/${encodeURIComponent(sym)}`}
                        className="num inline-flex h-6 items-center rounded border border-border px-1.5 text-[11.5px] transition-colors hover:border-foreground"
                      >
                        {sym}
                      </Link>
                    </li>
                  ))}
                  {total > 10 ? (
                    <li>
                      <button
                        type="button"
                        onClick={() => {
                          set({ rule: c.rule, show: "buys" });
                          scrollToTable();
                        }}
                        className="inline-flex h-6 items-center px-1 text-[11.5px] underline underline-offset-4"
                      >
                        +{total - 10} more
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="text-[12px] text-muted-foreground">
                  No buys on this close
                  {c.rule === "strong_trend" && weather && weather !== "sunny" ? `: the market was ${weather}, and this rule buys only when it is sunny.` : "."}
                </p>
              )}
              <button
                type="button"
                aria-pressed={active}
                onClick={() => {
                  set({ rule: active ? "" : c.rule, show: active ? f.show : "all" });
                  if (!active) scrollToTable();
                }}
                className="mt-auto inline-flex items-center gap-1 self-start text-[12px] font-medium underline-offset-4 hover:underline"
              >
                {active ? "Show every rule" : "Show in the table"} <ArrowRightIcon size={12} aria-hidden />
              </button>
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

      <section id="signal-table" className="panel min-w-0 scroll-mt-20">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-[13px] font-semibold tracking-wide">Stocks</h2>
            <span className="text-[12px] text-muted-foreground" aria-live="polite">
              {rows.length.toLocaleString("en-IN")} of {all.length.toLocaleString("en-IN")} stocks on this close
            </span>
          </div>
          {filtered ? (
            <button type="button" onClick={clear} className="inline-flex items-center gap-1 text-[12px] underline underline-offset-4">
              <XIcon size={12} aria-hidden /> Clear filters
            </button>
          ) : null}
        </div>
        <div className="p-4">
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Show">
            {(Object.keys(SHOW) as Show[]).map((k) => (
              <button key={k} type="button" aria-pressed={f.show === k} onClick={() => set({ show: k })} className={`${chip(f.show === k)} rounded-full px-3 py-1`}>
                {SHOW[k]}
                <span className="num text-[11px] opacity-80">{kindCount[k]}</span>
              </button>
            ))}
          </div>

          <div className="mb-4 grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7" role="search" aria-label="Filter the stocks">
            <div className="relative">
              <label htmlFor="sig-find" className={label}>
                Stock
              </label>
              <MagnifyingGlassIcon size={14} aria-hidden className="pointer-events-none absolute bottom-[11px] left-2.5 text-muted-foreground" />
              <Input
                id="sig-find"
                type="search"
                value={f.q}
                onChange={(e) => set({ q: e.target.value.slice(0, 40) })}
                placeholder="Symbol or name"
                autoComplete="off"
                className="h-9 pl-8 text-[13px]"
              />
            </div>
            <div>
              <label htmlFor="sig-rule" className={label}>
                Rule
              </label>
              <Select id="sig-rule" value={f.rule} onChange={(e) => set({ rule: e.target.value as Filters["rule"] })} className="h-9 text-[13px]">
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
              <Select id="sig-size" value={f.size} onChange={(e) => set({ size: e.target.value as Filters["size"] })} className="h-9 text-[13px]">
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
              <Select id="sig-segment" value={f.segment} onChange={(e) => set({ segment: e.target.value as Filters["segment"] })} className="h-9 text-[13px]">
                <option value="">Main board and SME</option>
                <option value="equity">Main board</option>
                <option value="sme">SME</option>
              </Select>
            </div>
            <div>
              <label htmlFor="sig-sector" className={label}>
                Sector
              </label>
              <Select id="sig-sector" value={f.sector} onChange={(e) => set({ sector: e.target.value })} className="h-9 text-[13px]">
                <option value="">Any sector</option>
                {/* A sector chosen on another session stays selectable even when this close has none. */}
                {[...new Set([...sectors, ...(f.sector ? [f.sector] : [])])].map((s) => (
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
              <Select id="sig-sort" value={f.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"] })} className="h-9 text-[13px]">
                {Object.entries(SORTS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </div>
            <label className="inline-flex h-9 items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={f.multi} onChange={(e) => set({ multi: e.target.checked })} className="size-4 accent-foreground" />
              On 2+ rules only
            </label>
          </div>

          {shown.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <p className="text-[13px] font-medium">{all.length ? "No stock matches these filters." : "No signals on this close."}</p>
              {all.length ? (
                <button type="button" onClick={() => setF(parseFilters({}))} className="text-[12.5px] underline underline-offset-4">
                  Clear the filters
                </button>
              ) : (
                <p className="text-[12.5px] text-muted-foreground">The rules found nothing on this close.</p>
              )}
            </div>
          ) : (
            <TableWrap label="Stocks and their signals">
              <table className={`w-full min-w-[980px] transition-opacity duration-150 ${view !== f ? "opacity-70" : ""}`}>
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
                      const tagged = isCheckRule(s.strategy) && s.kind !== "exit" && tags.has(checkKey(s.strategy, s.symbol, s.checkDay));
                      const first = i === 0;
                      const span = r.signals.length;
                      return (
                        <tr key={`${r.symbol}-${s.strategy}-${s.kind}-${i}`} className={first ? tr + " align-top" : "align-top"}>
                          {first ? (
                            <td rowSpan={span} className={td + " whitespace-normal py-2.5"}>
                              <Link prefetch={false} href={`/app/markets/${encodeURIComponent(r.symbol)}`} className="num text-[13.5px] font-semibold hover:underline">
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
                              {tagged && isCheckRule(s.strategy) ? checkTags[s.strategy] : null}
                            </span>
                          </td>
                          <td className={td + " whitespace-normal py-2.5 text-[12.5px]"}>
                            <span>{nextStep(s, isLatest)}</span>
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
        </div>
      </section>
    </div>
  );
}
