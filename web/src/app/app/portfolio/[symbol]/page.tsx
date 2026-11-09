import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { buttonClass } from "@/components/ui/button";
import { Delta, Stat } from "@/components/ui/data";
import { Empty, PageHeader, Panel, PlanGate, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, price, qty, rupees } from "@/lib/format";
import { groupSales, heldFor, KIND_LABEL, SOURCE_LABEL, type RealizedPart, type Trade } from "@/lib/ledger";
import { getQuotes } from "@/server/market-data";
import { can, requireSession } from "@/server/session";
import { DeleteTrade, EditTrade } from "../forms";
import { throwIfFailed } from "@/lib/errors";

const SYMBOL = /^[A-Z0-9&\-.]{1,20}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function generateMetadata({ params }: PageProps<"/app/portfolio/[symbol]">): Promise<Metadata> {
  const { symbol } = await params;
  return { title: `${decodeURIComponent(symbol).toUpperCase()} · your trades` };
}

interface Lot {
  buy_txn_id: string;
  portfolio_id: string;
  buy_date: string;
  kind: "opening" | "buy";
  buy_quantity: number;
  buy_price: number;
  open_quantity: number;
  open_price: number;
}

/** One stock in your portfolio: every trade (editable), the purchases still held, and every sale with its gain. */
export default async function StockHistoryPage({ params, searchParams }: PageProps<"/app/portfolio/[symbol]">) {
  const s = await requireSession();
  const symbol = decodeURIComponent((await params).symbol).toUpperCase();
  if (!SYMBOL.test(symbol)) notFound();
  const sp = await searchParams;
  const only = typeof sp.p === "string" && UUID.test(sp.p) ? sp.p : null;

  if (!can(s, "portfolio")) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader eyebrow="Your trades" title={symbol} />
        <PlanGate feature="Portfolio tracking" />
      </div>
    );
  }

  const db = s.supabase;
  let txQ = db.from("portfolio_transactions").select("*").eq("symbol", symbol);
  let lotQ = db.from("portfolio_lots").select("buy_txn_id, portfolio_id, buy_date, kind, buy_quantity, buy_price, open_quantity, open_price").eq("symbol", symbol);
  let relQ = db
    .from("portfolio_realized")
    .select("sell_txn_id, symbol, buy_date, sell_date, quantity, buy_price, sell_price, cost, proceeds, gain, days_held")
    .eq("symbol", symbol);
  if (only) {
    txQ = txQ.eq("portfolio_id", only);
    lotQ = lotQ.eq("portfolio_id", only);
    relQ = relQ.eq("portfolio_id", only);
  }
  const [pfRes, txRes, lotRes, relRes, metaRes, caRes, adjRes, quotes] = await Promise.all([
    db.from("portfolios").select("id, name").order("created_at"),
    txQ.order("trade_date").order("seq"),
    lotQ.order("buy_date"),
    relQ,
    db.from("market_symbols").select("name").eq("symbol", symbol).eq("exchange", "NSE").maybeSingle(),
    db.from("corporate_actions").select("ex_date, factor").eq("symbol", symbol).order("ex_date"),
    db.from("holding_adjustments").select("ex_date, undone_at").eq("symbol", symbol).not("undone_at", "is", null),
    getQuotes(db, [symbol]),
  ]);
  throwIfFailed(pfRes, txRes, lotRes, relRes, metaRes, caRes, adjRes); // a failed read shows the error screen, never "none"
  const portfolios = pfRes.data ?? [];
  const trades = (txRes.data ?? []) as Trade[];
  const lots = ((lotRes.data ?? []) as Lot[]).map((l) => ({ ...l, open_quantity: Number(l.open_quantity), open_price: Number(l.open_price) }));
  const sales = groupSales((relRes.data ?? []) as RealizedPart[]);
  const last = quotes.get(symbol)?.last_price ?? null;
  const name = metaRes.data?.name ?? null;
  const pfName = (id: string) => portfolios.find((p) => p.id === id)?.name ?? "";
  const many = !only && portfolios.length > 1;

  // Splits that fall inside the history (after the first trade), marked when the person undid them.
  const first = trades[0]?.trade_date;
  const undone = new Set((adjRes.data ?? []).map((a) => a.ex_date as string));
  const splits = first ? (caRes.data ?? []).filter((c) => c.ex_date > first) : [];
  type Row = { kind: "trade"; t: Trade } | { kind: "split"; ex_date: string; factor: number };
  const rows: Row[] = [
    ...trades.map((t) => ({ kind: "trade" as const, t })),
    ...splits.map((c) => ({ kind: "split" as const, ex_date: c.ex_date as string, factor: Number(c.factor) })),
  ].sort((a, b) => {
    const da = a.kind === "trade" ? a.t.trade_date : a.ex_date;
    const db2 = b.kind === "trade" ? b.t.trade_date : b.ex_date;
    if (da !== db2) return da < db2 ? -1 : 1;
    if (a.kind !== b.kind) return a.kind === "split" ? -1 : 1;
    return a.kind === "trade" && b.kind === "trade" ? a.t.seq - b.t.seq : 0;
  });

  const open = lots.filter((l) => l.open_quantity > 0);
  const heldQty = open.reduce((a, l) => a + l.open_quantity, 0);
  const invested = open.reduce((a, l) => a + l.open_quantity * l.open_price, 0);
  const value = last != null ? heldQty * last : null;
  const unrealized = value != null ? value - invested : null;
  const realized = sales.reduce((a, x) => a + x.gain, 0);

  const back = (
    <Link href="/app/portfolio" className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
      <ArrowLeftIcon size={14} aria-hidden /> Portfolio
    </Link>
  );

  if (!trades.length) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <PageHeader eyebrow="Your trades" title={symbol} description={name ?? undefined} />
        <Empty
          title={`No trades in ${symbol} yet.`}
          action={
            <Link href="/app/portfolio#record" className={buttonClass("primary", "md")}>
              Record a buy
            </Link>
          }
        >
          Record a buy from your portfolio, and its history and gains show here.
        </Empty>
      </div>
    );
  }

  const tradeLabel = (t: Trade) => `${KIND_LABEL[t.kind].toLowerCase()} of ${date(t.trade_date)}`;

  return (
    <div className="flex flex-col gap-6">
      {back}
      <PageHeader
        eyebrow="Your trades"
        title={symbol}
        description={`${name ? `${name}. ` : ""}Every buy and sell you recorded. Shares are sold oldest first, as your broker's profit and loss report and Indian tax count them.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/app/markets/${encodeURIComponent(symbol)}`} className={buttonClass("secondary", "md")}>
              Chart and research
            </Link>
            {heldQty > 0 ? (
              <Link href={`/app/portfolio?sell=${encodeURIComponent(symbol)}#record`} className={buttonClass("secondary", "md")}>
                Record a sale
              </Link>
            ) : null}
            <Link href="/app/portfolio#record" className={buttonClass("primary", "md")}>
              Record a buy
            </Link>
          </div>
        }
      />

      <section className="panel grid grid-cols-2 md:grid-cols-5 md:divide-x md:divide-border" data-testid="history-stats">
        <Stat className="p-4" label="You hold" value={<span className="num">{qty(heldQty)}</span>} sub={heldQty ? `at ${rupees(invested / heldQty)} on average` : "sold in full"} />
        <Stat className="p-4" label="Invested" value={<span className="num">{rupees(invested)}</span>} sub="in shares you hold" />
        <Stat className="p-4" label="Worth now" value={<span className="num">{value != null ? rupees(value) : "—"}</span>} sub={last != null ? `at the last close, ${price(last)}` : "no price yet"} />
        <Stat
          className="p-4"
          label="On shares you hold"
          value={<Delta value={heldQty ? unrealized : null} kind="inr" />}
          sub={<Delta value={heldQty && invested && unrealized != null ? (unrealized / invested) * 100 : null} />}
        />
        <Stat
          className="p-4"
          label="Realized gain"
          value={<Delta value={sales.length ? realized : null} kind="inr" />}
          sub={sales.length ? `${sales.length} sale${sales.length === 1 ? "" : "s"}, after charges` : "nothing sold yet"}
        />
      </section>

      <Panel title="Trades" meta={`${trades.length} recorded`}>
        <TableWrap>
          <table className="w-full min-w-[820px]" data-testid="trades">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>What</th>
                <th className={thNum}>Qty</th>
                <th className={thNum}>Price</th>
                <th className={thNum}>Charges</th>
                <th className={thNum}>Amount</th>
                <th className={th}>From</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) =>
                r.kind === "split" ? (
                  <tr key={`split-${r.ex_date}`} className={tr}>
                    <td className={td + " num text-muted-foreground"}>{date(r.ex_date)}</td>
                    <td className={td} colSpan={7}>
                      <span className="text-[13px]">
                        Split or bonus issue: each share became {qty(r.factor)} shares
                        {undone.has(r.ex_date) ? <span className="text-muted-foreground"> (you undid this, so it is left out)</span> : null}
                      </span>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.t.id} className={tr}>
                    <td className={td + " num text-muted-foreground"}>{date(r.t.trade_date)}</td>
                    <td className={td}>
                      <span className="font-medium">{KIND_LABEL[r.t.kind]}</span>
                      {r.t.sip ? <span className="ml-1.5 rounded bg-foreground/[0.06] px-1.5 py-0.5 text-[10.5px] text-muted-foreground">SIP</span> : null}
                      {r.t.note ? <span className="mt-0.5 block max-w-64 text-[11.5px] text-muted-foreground">{r.t.note}</span> : null}
                      {many ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{pfName(r.t.portfolio_id)}</span> : null}
                    </td>
                    <td className={tdNum}>{qty(r.t.quantity)}</td>
                    <td className={tdNum}>{price(r.t.price)}</td>
                    <td className={tdNum + " text-muted-foreground"}>{Number(r.t.charges) ? price(r.t.charges) : "—"}</td>
                    <td className={tdNum}>{rupees(Number(r.t.quantity) * Number(r.t.price))}</td>
                    <td className={td + " text-[12px] text-muted-foreground"}>{SOURCE_LABEL[r.t.source]}</td>
                    <td className={td + " text-right"}>
                      <span className="inline-flex items-center gap-1">
                        <EditTrade
                          id={r.t.id}
                          label={tradeLabel(r.t)}
                          tradeDate={r.t.trade_date}
                          quantity={Number(r.t.quantity)}
                          price={Number(r.t.price)}
                          charges={Number(r.t.charges)}
                        />
                        <DeleteTrade id={r.t.id} label={tradeLabel(r.t)} />
                      </span>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </TableWrap>
        <p className="mt-3 text-[12px] leading-5 text-muted-foreground">
          An opening balance is what you held on that date, as you entered it. Editing or deleting a trade works your holding and gains
          out again; a change that would leave a sale bigger than the shares you held is refused.
        </p>
      </Panel>

      {open.length ? (
        <Panel title="Shares you still hold" meta="each purchase, in today's shares">
          <TableWrap>
            <table className="w-full min-w-[640px]" data-testid="lots">
              <thead>
                <tr>
                  <th className={th}>Bought</th>
                  <th className={thNum}>As bought</th>
                  <th className={thNum}>Still held</th>
                  <th className={thNum}>Worth now</th>
                  <th className={thNum}>Gain</th>
                </tr>
              </thead>
              <tbody>
                {open.map((l) => {
                  const now = last != null ? l.open_quantity * last : null;
                  const cost = l.open_quantity * l.open_price;
                  return (
                    <tr key={l.buy_txn_id} className={tr}>
                      <td className={td + " num text-muted-foreground"}>
                        {date(l.buy_date)}
                        {l.kind === "opening" ? <span className="block text-[11px]">opening balance</span> : null}
                      </td>
                      <td className={tdNum}>
                        {qty(l.buy_quantity)} at {price(l.buy_price)}
                      </td>
                      <td className={tdNum}>
                        {qty(l.open_quantity)} at {price(l.open_price)}
                      </td>
                      <td className={tdNum}>{now != null ? rupees(now) : "—"}</td>
                      <td className={tdNum}>
                        <Delta value={now != null ? now - cost : null} kind="inr" />
                        <span className="block text-[11px]">
                          <Delta value={now != null && cost ? ((now - cost) / cost) * 100 : null} />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      ) : null}

      {sales.length ? (
        <Panel title="Sales" meta="after charges, oldest shares sold first">
          <TableWrap>
            <table className="w-full min-w-[640px]" data-testid="stock-sales">
              <thead>
                <tr>
                  <th className={th}>Sold</th>
                  <th className={thNum}>Qty</th>
                  <th className={thNum}>Bought at</th>
                  <th className={thNum}>Sold at</th>
                  <th className={thNum}>Gain</th>
                  <th className={th}>Held</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((x) => (
                  <tr key={x.sellTxnId} className={tr}>
                    <td className={td + " num text-muted-foreground"}>{date(x.sellDate)}</td>
                    <td className={tdNum}>{qty(x.quantity)}</td>
                    <td className={tdNum}>{price(x.avgBuyPrice)}</td>
                    <td className={tdNum}>{price(x.sellPrice)}</td>
                    <td className={tdNum}>
                      <Delta value={x.gain} kind="inr" />
                      <span className="block text-[11px]">
                        <Delta value={x.gainPct} />
                      </span>
                    </td>
                    <td className={td + " text-[12px] text-muted-foreground"}>{heldFor(x)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>
      ) : null}
    </div>
  );
}
