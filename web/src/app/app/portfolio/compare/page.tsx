import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeftIcon, FileArrowUpIcon } from "@phosphor-icons/react/ssr";
import { BuyCard, SaleCard } from "@/components/portfolio/compare-cards";
import { CompareExport } from "@/components/portfolio/compare-export";
import { buttonClass } from "@/components/ui/button";
import { Delta } from "@/components/ui/data";
import { Select } from "@/components/ui/field";
import { Empty, PageHeader, Panel, PlanGate, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { Pager, pageParam } from "@/components/ui/pager";
import { date } from "@/lib/format";
import { istToday } from "@/lib/ledger";
import { comparisonCsv, MATCH_SESSIONS, type BuyMatch, type SaleMatch } from "@/lib/rule-compare";
import { isRule, RULES } from "@/lib/rules";
import { loadComparison } from "@/server/rule-compare";
import { can, requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Your trades next to the rules" };

const PAGE_SIZE = 20;
const SYMBOL = /^[A-Z0-9&\-.]{1,20}$/;
const TITLE = "Your trades next to the rules";
const DESCRIPTION =
  "For each of your buys and sales, what our rules did in the same stock at the time, worked out on the rule's whole trade with your money and your charges.";

/** Step D (ADR-050): each of your buys and sales next to the rules' trades in the same stock, as past facts. */
export default async function ComparePage({ searchParams }: PageProps<"/app/portfolio/compare">) {
  const s = await requireSession();
  const back = (
    <Link href="/app/portfolio" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon size={14} aria-hidden /> Portfolio
    </Link>
  );
  if (!can(s, "portfolio")) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <PageHeader eyebrow="Portfolio" title={TITLE} description={DESCRIPTION} />
        <PlanGate feature="Your trades next to the rules" />
      </div>
    );
  }

  const sp = await searchParams;
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const rule = isRule(str("rule")) ? str("rule") : "";
  const stock = SYMBOL.test(str("stock").toUpperCase()) ? str("stock").toUpperCase() : "";
  const show = ["buys", "sales"].includes(str("show")) ? str("show") : "";
  const outcome = ["better", "worse"].includes(str("outcome")) ? str("outcome") : "";
  const page = pageParam(sp.page);

  const c = await loadComparison(s.supabase);
  const { summary } = c;
  const today = istToday();

  if (summary.yourBuys === 0 && summary.openings === 0) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <PageHeader eyebrow="Portfolio" title={TITLE} description={DESCRIPTION} />
        <Empty
          title="No trades to compare yet."
          action={
            <Link href="/app/portfolio/import" className={buttonClass("primary", "md")}>
              <FileArrowUpIcon size={16} aria-hidden /> Import your tradebook
            </Link>
          }
        >
          Import your broker&apos;s tradebook, or record your buys, and each one shows here next to what our rules did in the same stock.
        </Empty>
      </div>
    );
  }

  const keep = (m: BuyMatch | SaleMatch) =>
    (!rule || m.strategy === rule) &&
    (!stock || m.symbol === stock) &&
    (!outcome || (m.madeMore != null && (outcome === "better" ? m.madeMore > 0 : m.madeMore < 0)));
  type Item = { key: string; day: string; buy?: BuyMatch; sale?: SaleMatch };
  const items: Item[] = [
    ...(show === "sales" ? [] : c.buys.filter(keep).map((m) => ({ key: m.id, day: m.buyDate, buy: m }))),
    ...(show === "buys" ? [] : c.sales.filter(keep).map((m) => ({ key: m.id, day: m.sellDate, sale: m }))),
  ].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : a.key < b.key ? -1 : 1));
  const shown = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const stocks = [...new Set([...c.buys, ...c.sales].map((m) => m.symbol))].sort();
  const params = Object.fromEntries(Object.entries({ rule, stock, show, outcome }).filter(([, v]) => v));
  const filtered = Object.keys(params).length > 0;
  const since = summary.recordsFrom ? date(summary.recordsFrom) : null;
  const compared = summary.yourBuys - summary.beforeRecords;

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        eyebrow="Portfolio"
        title={TITLE}
        description={DESCRIPTION}
        actions={<CompareExport csv={comparisonCsv(c)} disabled={!c.buys.length && !c.sales.length} />}
      />

      <section className="panel flex flex-col gap-2 p-4 text-[14px] leading-6" data-testid="compare-summary">
        <p>
          {compared > 0 ? (
            <>
              Of your <span className="num">{compared}</span> buy{compared === 1 ? "" : "s"}
              {since ? ` since ${since}` : ""}, a rule was in the stock for <span className="num">{summary.matchedBuys}</span>.{" "}
              {summary.noRule ? (
                <>
                  Your other <span className="num">{summary.noRule}</span> had no rule trade nearby.
                </>
              ) : null}
            </>
          ) : (
            "None of your buys fall in the period our rules' records cover yet."
          )}
        </p>
        {summary.beforeRecords || summary.openings ? (
          <p className="text-[13px] text-muted-foreground">
            {summary.beforeRecords
              ? `${summary.beforeRecords} buy${summary.beforeRecords === 1 ? " is" : "s are"} from before our rules' records start${since ? ` (${since})` : ""}. `
              : ""}
            {summary.openings
              ? `${summary.openings} opening balance${summary.openings === 1 ? " has" : "s have"} no buy date or price, so ${summary.openings === 1 ? "it isn't" : "they aren't"} compared.`
              : ""}
          </p>
        ) : null}
      </section>

      {summary.perRule.length ? (
        <Panel title="By rule" meta="each rule's trades next to the same buys of yours">
          <TableWrap>
            <table className="w-full min-w-[720px]" data-testid="compare-rules">
              <thead>
                <tr>
                  <th className={th}>Rule</th>
                  <th className={thNum}>Your buys it matched</th>
                  <th className={thNum}>Rule paid less on</th>
                  <th className={thNum}>Rule&apos;s trades made</th>
                  <th className={thNum}>Your same buys made</th>
                  <th className={thNum}>Rule did better on</th>
                </tr>
              </thead>
              <tbody>
                {summary.perRule.map((r) => (
                  <tr key={r.strategy} className={tr}>
                    <td className={td}>
                      <Link href={`/app/portfolio/compare?rule=${r.strategy}`} className="hover:underline">
                        {r.ruleName}
                      </Link>
                    </td>
                    <td className={tdNum}>{r.buys}</td>
                    <td className={tdNum}>
                      {r.paidLess} of {r.buys}
                    </td>
                    <td className={tdNum}>
                      <Delta value={r.priced ? r.ruleGain : null} kind="inr" />
                    </td>
                    <td className={tdNum}>
                      <Delta value={r.priced ? r.yourGain : null} kind="inr" />
                    </td>
                    <td className={tdNum}>{r.priced ? `${r.ruleBetter} of ${r.priced}` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
            A buy can match more than one rule, so the rows don&apos;t add up to your total. Amounts are after the same charges as
            your trades; trades still open are valued at the last close.
          </p>
        </Panel>
      ) : null}

      <form action="/app/portfolio/compare" className="flex flex-wrap items-end gap-2" role="search" aria-label="Filter the comparison">
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          Rule
          <Select name="rule" defaultValue={rule}>
            <option value="">All rules</option>
            {RULES.map((r) => (
              <option key={r.key} value={r.key}>
                {r.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          Stock
          <Select name="stock" defaultValue={stock}>
            <option value="">All stocks</option>
            {stocks.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          Show
          <Select name="show" defaultValue={show}>
            <option value="">Buys and sales</option>
            <option value="buys">Buys</option>
            <option value="sales">Sales</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-muted-foreground">
          Outcome
          <Select name="outcome" defaultValue={outcome}>
            <option value="">Any</option>
            <option value="better">The rule did better</option>
            <option value="worse">The rule did worse</option>
          </Select>
        </label>
        <button type="submit" className={buttonClass("primary", "md")}>
          Show
        </button>
        {filtered ? (
          <Link href="/app/portfolio/compare" className={buttonClass("ghost", "md")}>
            Clear
          </Link>
        ) : null}
      </form>

      {shown.length ? (
        <section className="flex flex-col gap-3" aria-label="Matches" data-testid="compare-list">
          <p className="text-[12px] text-muted-foreground">
            {items.length} match{items.length === 1 ? "" : "es"}, newest first
          </p>
          {shown.map((it) => (it.buy ? <BuyCard key={it.key} m={it.buy} today={today} /> : <SaleCard key={it.key} m={it.sale!} />))}
          <Pager path="/app/portfolio/compare" params={params} page={page} pageSize={PAGE_SIZE} total={items.length} />
        </section>
      ) : (
        <Empty title={filtered ? "Nothing matches these filters." : "No rule trades next to yours yet."}>
          {filtered ? (
            <Link href="/app/portfolio/compare" className="text-foreground underline underline-offset-4">
              Show everything
            </Link>
          ) : (
            "When one of our rules trades a stock around the day you buy or sell it, the two trades show here side by side."
          )}
        </Empty>
      )}

      <Panel title="How we match">
        <ul className="flex list-disc flex-col gap-1.5 pl-5 text-[13px] leading-5 text-muted-foreground">
          <li>
            A rule counts for one of your buys when its trade was open on your buy date (it had bought and not yet sold), or when it
            bought within the next {MATCH_SESSIONS} trading sessions. The rule is fixed in advance, and every rule that matches is
            shown, whether it did better or worse.
          </li>
          <li>
            &ldquo;You would have paid less&rdquo; is the difference in price per share, times your shares. &ldquo;You would have
            made more&rdquo; puts your same money through the rule&apos;s whole trade, to its sale (or the last close while it is
            open), less the same charges as your trade, and sets it against what that buy of yours made, oldest shares sold first.
          </li>
          <li>For a sale, a rule counts when it was holding the stock that day: what you would have got selling when it sold.</li>
          <li>
            The rules&apos; records start {since ?? "in December 2023"} and cover the 500 largest NSE companies. Splits and bonus issues
            between the dates are allowed for. Opening balances have no buy date or price, so they aren&apos;t compared.
          </li>
          <li>These are past results on past prices. They don&apos;t promise future ones, and they are research, not advice.</li>
        </ul>
      </Panel>
    </div>
  );
}
