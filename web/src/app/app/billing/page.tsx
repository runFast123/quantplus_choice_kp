import type { Metadata } from "next";
import clsx from "clsx";
import { CheckIcon, MinusIcon } from "@phosphor-icons/react/ssr";
import { Badge } from "@/components/ui/data";
import { Empty, PageHeader, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, daysUntil, paiseToRupees } from "@/lib/format";
import { FEATURE_ROWS } from "@/lib/plans";
import type { Plan } from "@/lib/types";
import { requireSession } from "@/server/session";

export const metadata: Metadata = { title: "Plan & billing" };

const SUPPORT = process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "support@quantspulse.in";

export default async function BillingPage() {
  const s = await requireSession();
  const [plansRes, payRes] = await Promise.all([
    s.supabase.from("plans").select("*").order("price_paise_yearly"),
    s.supabase.from("payments").select("id, amount_paise, currency, method, status, external_reference, created_at").order("created_at", { ascending: false }),
  ]);
  const plans = (plansRes.data ?? []) as Plan[];
  const ent = s.entitlements;
  const left = ent ? daysUntil(ent.current_period_end) : 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Account" title="Plan & billing" description="Plans are per person, per workspace, billed yearly in rupees." />

      <Panel>
        {ent ? (
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="eyebrow">Current plan</p>
              <p className="display mt-1 text-[30px]">
                {ent.plan_name}{" "}
                <Badge tone={ent.status === "active" ? "ink" : ent.status === "trialing" ? "coral" : "loss"} className="align-middle">
                  {ent.status}
                </Badge>
              </p>
              <p className="mt-1 text-[13px] text-muted-foreground">
                {left > 0
                  ? `${left} day${left === 1 ? "" : "s"} left · ${ent.status === "trialing" ? "trial ends" : "plan ends"} ${date(ent.current_period_end)}`
                  : `Ended ${date(ent.current_period_end)}`}
              </p>
            </div>
            <div className="max-w-sm text-[13px] leading-6 text-muted-foreground">
              To upgrade or renew, pay by UPI or bank transfer and email{" "}
              <a className="text-foreground underline underline-offset-4" href={`mailto:${SUPPORT}?subject=Plan%20activation%20-%20${encodeURIComponent(s.email)}`}>
                {SUPPORT}
              </a>{" "}
              with the reference number. We activate within one working day and it appears below.
            </div>
          </div>
        ) : (
          <Empty title="No plan on this workspace.">Ask the workspace owner, or contact {SUPPORT}.</Empty>
        )}
      </Panel>

      <section aria-label="Plans" className="grid gap-4 lg:grid-cols-3">
        {plans.map((p) => {
          const current = ent?.plan_code === p.code;
          return (
            <div key={p.code} className={clsx("panel flex flex-col p-5", current && "border-foreground")}>
              <div className="flex items-baseline justify-between">
                <p className="display text-[24px]">{p.name}</p>
                {current ? <Badge tone="ink">Current</Badge> : null}
              </div>
              <p className="mt-3">
                <span className="num text-[28px]">{p.price_paise_yearly ? paiseToRupees(p.price_paise_yearly) : "Free"}</span>
                <span className="text-[13px] text-muted-foreground">{p.price_paise_yearly ? " / year" : " · 3 months"}</span>
              </p>
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                {p.max_watchlist_symbols == null ? "Unlimited" : p.max_watchlist_symbols} radar ·{" "}
                {p.max_portfolio_symbols == null ? "unlimited" : p.max_portfolio_symbols || "no"} portfolio symbols
              </p>
              <ul className="mt-4 flex flex-col gap-2 border-t border-border pt-4 text-[13px]">
                {FEATURE_ROWS.map(([key, label]) => {
                  const on = Boolean(p.features?.[key]);
                  return (
                    <li key={key} className={clsx("flex items-center gap-2", !on && "text-muted-foreground")}>
                      {on ? <CheckIcon size={14} weight="bold" aria-label="Included" /> : <MinusIcon size={14} aria-label="Not included" />}
                      {label}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </section>

      <Panel title="Payments">
        {(payRes.data ?? []).length === 0 ? (
          <Empty title="No payments yet." />
        ) : (
          <TableWrap>
            <table className="w-full min-w-[560px]">
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={thNum}>Amount</th>
                  <th className={th}>Method</th>
                  <th className={th}>Reference</th>
                  <th className={th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {(payRes.data ?? []).map((p) => (
                  <tr key={p.id} className={tr}>
                    <td className={td + " num text-muted-foreground"}>{date(p.created_at)}</td>
                    <td className={tdNum}>{paiseToRupees(Number(p.amount_paise))}</td>
                    <td className={td + " uppercase"}>{p.method.replace("_", " ")}</td>
                    <td className={td + " num text-muted-foreground"}>{p.external_reference ?? "—"}</td>
                    <td className={td}>
                      <Badge tone={p.status === "captured" ? "gain" : p.status === "refunded" ? "neutral" : "loss"}>{p.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Panel>
    </div>
  );
}
