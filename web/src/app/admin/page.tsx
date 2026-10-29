import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  CreditCardIcon,
  DatabaseIcon,
  NewspaperIcon,
  ShieldCheckIcon,
  SquaresFourIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/ssr";
import { Logo } from "@/components/brand/logo";
import { Badge, Stat } from "@/components/ui/data";
import { inputClass } from "@/components/ui/field";
import { Empty, PageHeader, Panel, TableWrap, td, th, tr } from "@/components/ui/layout";
import { date, dateTime, paiseToRupees, relative } from "@/lib/format";
import { nseSession } from "@/lib/market";
import {
  getDatabaseInventory,
  getRecentAuditLogs,
  getRecentPayments,
  isPlatformAdmin,
  platformStats,
  searchUsers,
} from "@/server/privileged/admin";
import { newsSourceHealth } from "@/server/privileged/news";
import { requireSession } from "@/server/session";
import { ActivateForm } from "./activate-form";
import { MaintenanceOperations } from "./maintenance-panel";
import { FetchNewsButton } from "./news-button";

export const metadata: Metadata = { title: "Platform admin" };

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const s = await requireSession();
  // 404 rather than 403: don't advertise that the console exists.
  if (!(await isPlatformAdmin(s.userId))) notFound();

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const currentTab = typeof sp.tab === "string" && ["overview", "database", "accounts", "billing", "news", "audit"].includes(sp.tab)
    ? sp.tab
    : "overview";

  const [stats, users, feeds, dbInventory, payments, auditLogs] = await Promise.all([
    platformStats(s.userId),
    searchUsers(s.userId, q),
    newsSourceHealth(),
    getDatabaseInventory(s.userId),
    getRecentPayments(s.userId, 30),
    getRecentAuditLogs(s.userId, 30),
  ]);

  const session = nseSession();

  return (
    <div className="linen min-h-dvh">
      {/* Top Header */}
      <header className="flex h-[56px] items-center justify-between border-b border-border px-4 md:px-6 bg-background/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="flex items-center gap-4">
          <Logo href="/app" />
          <div className="hidden sm:flex items-center gap-2 pl-3 border-l border-border text-[11.5px]">
            {/* Database Pooler status */}
            <span className="inline-flex items-center gap-1.5 rounded-full bg-gain/10 border border-gain/20 px-2 py-0.5 text-gain font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-gain" />
              DB Pooler Online
            </span>
            {/* NSE Clock */}
            <span className="inline-flex items-center gap-1 text-muted-foreground px-1.5">
              <span>NSE:</span>
              <strong className="text-foreground font-medium">{session.label}</strong>
            </span>
            {/* EOD Data freshness */}
            <span className={`inline-flex items-center gap-1 px-1.5 ${dbInventory.isEodFresh ? "text-muted-foreground" : "text-coral-ink font-medium"}`}>
              <span>EOD:</span>
              <strong className="num">{dbInventory.latestEodDate ? date(dbInventory.latestEodDate) : "—"}</strong>
              {dbInventory.isEodFresh ? (
                <CheckCircleIcon size={12} className="text-gain inline" aria-hidden />
              ) : (
                <WarningCircleIcon size={12} className="text-coral-ink inline" aria-hidden />
              )}
            </span>
          </div>
        </div>
        <Link href="/app" className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeftIcon size={13} aria-hidden /> Back to the app
        </Link>
      </header>

      <main className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 md:px-6">
        <PageHeader
          eyebrow="QuantsPulse Platform"
          title="Admin & Operations Console"
          description="System health, live database storage inventory, market data pipelines, user subscriptions, and compliance logs."
        />

        {/* Navigation Tabs Bar */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border pb-1">
          {[
            { id: "overview", label: "Overview & Operations", icon: SquaresFourIcon },
            { id: "database", label: "Database & Pipelines", icon: DatabaseIcon, count: dbInventory.tables.length },
            { id: "accounts", label: "Accounts & Plans", icon: UsersThreeIcon, count: stats.users },
            { id: "billing", label: "Financial Ledger", icon: CreditCardIcon, count: payments.length },
            { id: "news", label: "News Feeds", icon: NewspaperIcon, count: feeds.length },
            { id: "audit", label: "Audit & Security", icon: ShieldCheckIcon, count: auditLogs.length },
          ].map((tabItem) => {
            const Icon = tabItem.icon;
            const isActive = currentTab === tabItem.id;
            return (
              <Link
                key={tabItem.id}
                href={`/admin?tab=${tabItem.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-[12.5px] font-medium transition-colors border-b-2 -mb-1 ${
                  isActive
                    ? "border-foreground text-foreground bg-foreground/[0.04]"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-foreground/[0.02]"
                }`}
              >
                <Icon size={14} aria-hidden />
                <span>{tabItem.label}</span>
                {tabItem.count != null && (
                  <span className={`num text-[11px] px-1.5 py-0.5 rounded-full ${isActive ? "bg-foreground/10 text-foreground" : "bg-muted text-foreground"}`}>
                    {tabItem.count}
                  </span>
                )}
              </Link>
            );
          })}
        </div>

        {/* =========================================================================
            TAB 1: OVERVIEW & SYSTEM OPERATIONS
           ========================================================================= */}
        {currentTab === "overview" && (
          <div className="flex flex-col gap-6">
            {/* Top KPI Metrics */}
            <section className="panel grid grid-cols-2 md:grid-cols-4 md:divide-x md:divide-border">
              <Stat className="p-4" label="Total Accounts" value={stats.users.toLocaleString("en-IN")} />
              <Stat className="p-4" label="Live Subscriptions" value={stats.liveSubscriptions.toLocaleString("en-IN")} />
              <Stat className="p-4" label="Paid (Pro / Pro Plus)" value={stats.paidSubscriptions.toLocaleString("en-IN")} />
              <Stat className="p-4" label="Collected, 30 Days" value={paiseToRupees(stats.revenue30dPaise)} />
            </section>

            {/* 1-Click Operations Control Center */}
            <Panel
              title="System Operations & Maintenance"
              meta="Execute verified server pipelines without opening terminal scripts or writing raw SQL"
            >
              <MaintenanceOperations />
            </Panel>

            {/* Storage Matrix & Universe Snapshot */}
            <div className="grid gap-6 md:grid-cols-2">
              <Panel
                title="Universe Coverage & Segments"
                meta="Tracked Indian equities and indices (ADR-027)"
                actions={
                  <Link href="/admin?tab=database" className="text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-4">
                    View Database Tables →
                  </Link>
                }
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-1">
                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <span className="text-[11px] text-muted-foreground uppercase font-semibold">Equities</span>
                    <div className="num text-[20px] font-semibold mt-1">{dbInventory.segments.equity.toLocaleString("en-IN")}</div>
                    <span className="text-[11px] text-muted-foreground">NSE Main Board</span>
                  </div>
                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <span className="text-[11px] text-muted-foreground uppercase font-semibold">SME Board</span>
                    <div className="num text-[20px] font-semibold mt-1">{dbInventory.segments.sme.toLocaleString("en-IN")}</div>
                    <span className="text-[11px] text-muted-foreground">NSE Emerge</span>
                  </div>
                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <span className="text-[11px] text-muted-foreground uppercase font-semibold">ETFs</span>
                    <div className="num text-[20px] font-semibold mt-1">{dbInventory.segments.etf.toLocaleString("en-IN")}</div>
                    <span className="text-[11px] text-muted-foreground">Gold, Indices, Liquid</span>
                  </div>
                  <div className="rounded-lg border border-border bg-card/40 p-3">
                    <span className="text-[11px] text-muted-foreground uppercase font-semibold">Indices</span>
                    <div className="num text-[20px] font-semibold mt-1">{dbInventory.segments.index.toLocaleString("en-IN")}</div>
                    <span className="text-[11px] text-muted-foreground">NIFTY, BANKNIFTY…</span>
                  </div>
                </div>
                <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>Total Managed Storage Records:</span>
                  <strong className="num text-foreground text-[13px]">{dbInventory.totalStorageRecords.toLocaleString("en-IN")} rows</strong>
                </div>
              </Panel>

              <Panel
                title="EOD Data & Analytics Freshness"
                meta="Yahoo Finance Daily NSE Candles pipeline (ADR-026)"
              >
                <dl className="grid grid-cols-2 gap-y-3.5 text-[12.5px] py-1">
                  <div>
                    <dt className="text-muted-foreground text-[11.5px]">EOD Snapshot Date</dt>
                    <dd className="num font-semibold text-foreground text-[14px] mt-0.5">
                      {dbInventory.latestEodDate ? date(dbInventory.latestEodDate) : "—"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-[11.5px]">Data Freshness State</dt>
                    <dd className="mt-0.5">
                      <Badge tone={dbInventory.isEodFresh ? "gain" : "coral"}>
                        {dbInventory.isEodFresh ? "● Fresh / Active" : "⚠ Stale / Needs Pipeline Run"}
                      </Badge>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-[11.5px]">Active News Feeds</dt>
                    <dd className="num font-semibold text-foreground mt-0.5">
                      {feeds.filter((f) => f.is_active && f.last_status === "ok").length} / {feeds.length} Online
                    </dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground text-[11.5px]">Trading Signals Stored</dt>
                    <dd className="num font-semibold text-foreground mt-0.5">
                      {(dbInventory.tables.find((t) => t.name === "trading_signals")?.count ?? 0).toLocaleString("en-IN")} Signals
                    </dd>
                  </div>
                </dl>
              </Panel>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 2: DATABASE STORAGE INVENTORY
           ========================================================================= */}
        {currentTab === "database" && (
          <div className="flex flex-col gap-6">
            <Panel
              title="Postgres Database Inventory & Schema Tables"
              meta={`${dbInventory.tables.length} Core System Tables · Total ${dbInventory.totalStorageRecords.toLocaleString("en-IN")} Records`}
            >
              <TableWrap>
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr>
                      <th className={th}>Table Name</th>
                      <th className={th}>Category</th>
                      <th className={th + " text-right"}>Record Count</th>
                      <th className={th}>Latest Timestamp</th>
                      <th className={th}>Status</th>
                      <th className={th}>Purpose & Integrity Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dbInventory.tables.map((t) => (
                      <tr key={t.name} className={tr}>
                        <td className={td + " font-medium"}>
                          <code className="num font-mono text-[12.5px] bg-muted/60 px-1.5 py-0.5 rounded">{t.name}</code>
                        </td>
                        <td className={td}>
                          <span className="uppercase text-[10px] tracking-wider px-2 py-0.5 rounded font-bold bg-muted text-foreground">
                            {t.category}
                          </span>
                        </td>
                        <td className={td + " num text-right font-semibold text-[13px]"}>
                          {t.count.toLocaleString("en-IN")}
                        </td>
                        <td className={td + " num text-muted-foreground text-[12px]"}>
                          {t.latestDate ? dateTime(t.latestDate) : "—"}
                        </td>
                        <td className={td}>
                          <Badge tone={t.status === "fresh" ? "gain" : t.status === "warning" ? "coral" : "ink"}>
                            {t.status}
                          </Badge>
                        </td>
                        <td className={td + " text-[12px] text-muted-foreground max-w-[360px]"}>
                          {t.description}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </Panel>

            <Panel title="System Architecture & Database Facts" meta="Core constraints and operational specifications">
              <div className="grid gap-4 sm:grid-cols-3 text-[12.5px]">
                <div className="rounded-lg border border-border p-3.5 bg-card/30">
                  <h4 className="font-semibold text-foreground mb-1">EOD Candles Partitioning</h4>
                  <p className="text-muted-foreground text-[12px]">
                    <code className="num">market_candles</code> is partitioned by symbol for fast queries across 760 daily candles without sequential table scans.
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3.5 bg-card/30">
                  <h4 className="font-semibold text-foreground mb-1">Append-Only Audit Log</h4>
                  <p className="text-muted-foreground text-[12px]">
                    <code className="num">audit_log</code> is strictly guarded by a PostgreSQL trigger preventing any <code className="num">UPDATE</code> or <code className="num">DELETE</code> operations.
                  </p>
                </div>
                <div className="rounded-lg border border-border p-3.5 bg-card/30">
                  <h4 className="font-semibold text-foreground mb-1">Privacy Isolation (§3)</h4>
                  <p className="text-muted-foreground text-[12px]">
                    Financial holdings, portfolio amounts, price alerts, and BYOK AI keys are private to the individual user and deliberately excluded from this console.
                  </p>
                </div>
              </div>
            </Panel>
          </div>
        )}

        {/* =========================================================================
            TAB 3: ACCOUNTS & PLANS MANAGEMENT
           ========================================================================= */}
        {currentTab === "accounts" && (
          <Panel
            title="User Accounts & Workspaces"
            meta={q ? `matching “${q}” (${users.length} found)` : `Total ${stats.users.toLocaleString("en-IN")} accounts · newest first`}
            actions={
              <form className="flex gap-2" role="search">
                <label htmlFor="admin-q" className="sr-only">
                  Search accounts
                </label>
                <input
                  id="admin-q"
                  name="q"
                  defaultValue={q}
                  placeholder="Search by email, name or phone"
                  className={inputClass + " h-8 w-[260px] text-[12.5px]"}
                />
              </form>
            }
          >
            {users.length === 0 ? (
              <Empty title="No accounts found." />
            ) : (
              <TableWrap>
                <table className="w-full min-w-[980px]">
                  <thead>
                    <tr>
                      <th className={th}>Account</th>
                      <th className={th}>Workspace</th>
                      <th className={th}>Plan</th>
                      <th className={th}>Expires</th>
                      <th className={th}>Joined</th>
                      <th className={th}>Last sign-in</th>
                      <th className={th}>Activate / Extend</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u) => (
                      <tr key={u.user_id + u.tenant_id} className={tr + " align-top"}>
                        <td className={td + " py-2.5"}>
                          <span className="block font-medium">{u.full_name || "—"}</span>
                          <span className="block text-[11.5px] text-muted-foreground">{u.email}</span>
                          {u.phone ? <span className="num block text-[11.5px] text-muted-foreground">{u.phone}</span> : null}
                        </td>
                        <td className={td + " py-2.5"}>
                          <span className="text-[12px]">{u.tenant_type === "personal" ? "Personal" : u.tenant_name}</span>
                        </td>
                        <td className={td + " py-2.5"}>
                          {u.plan ? (
                            <Badge tone={u.plan_status === "active" ? "ink" : u.plan_status === "trialing" ? "coral" : "neutral"}>
                              {u.plan.replace("_", " ")} · {u.plan_status}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-[12px]">None</span>
                          )}
                        </td>
                        <td className={td + " num py-2.5 text-muted-foreground"}>{date(u.plan_expires_at)}</td>
                        <td className={td + " num py-2.5 text-muted-foreground"}>{date(u.created_at)}</td>
                        <td className={td + " py-2.5 text-muted-foreground"}>{relative(u.last_sign_in_at)}</td>
                        <td className={td + " whitespace-normal py-2.5"}>
                          <ActivateForm userId={u.user_id} tenantId={u.tenant_id} email={u.email} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Panel>
        )}

        {/* =========================================================================
            TAB 4: FINANCIAL & PAYMENTS LEDGER
           ========================================================================= */}
        {currentTab === "billing" && (
          <div className="flex flex-col gap-6">
            <section className="panel grid grid-cols-2 md:grid-cols-3 md:divide-x md:divide-border">
              <Stat className="p-4" label="30-Day Collections" value={paiseToRupees(stats.revenue30dPaise)} />
              <Stat className="p-4" label="Total Captured Transactions" value={payments.length.toLocaleString("en-IN")} />
              <Stat
                className="p-4"
                label="Average Transaction"
                value={payments.length > 0 ? paiseToRupees(Math.round(stats.revenue30dPaise / (payments.length || 1))) : "₹0"}
              />
            </section>

            <Panel
              title="Recent Captured Payments Ledger"
              meta="GST & tax compliance transaction preservation"
            >
              {payments.length === 0 ? (
                <Empty title="No payment records captured yet." />
              ) : (
                <TableWrap>
                  <table className="w-full min-w-[850px]">
                    <thead>
                      <tr>
                        <th className={th}>Transaction ID</th>
                        <th className={th}>Account</th>
                        <th className={th + " text-right"}>Amount</th>
                        <th className={th}>Payment Method</th>
                        <th className={th}>Status</th>
                        <th className={th}>UTR / Reference</th>
                        <th className={th}>Date & Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {payments.map((p) => (
                        <tr key={p.id} className={tr}>
                          <td className={td + " font-mono num text-[12px] text-muted-foreground"}>
                            {p.id.slice(0, 8)}…
                          </td>
                          <td className={td}>
                            <span className="font-medium text-[12.5px] block">{p.user_name || "—"}</span>
                            <span className="text-[11.5px] text-muted-foreground block">{p.user_email || "Deleted User"}</span>
                          </td>
                          <td className={td + " num text-right font-semibold text-[13px]"}>
                            {paiseToRupees(p.amount_paise)}
                          </td>
                          <td className={td}>
                            <Badge tone="neutral">
                              {p.method.replace("_", " ").toUpperCase()}
                            </Badge>
                          </td>
                          <td className={td}>
                            <Badge tone={p.status === "captured" ? "gain" : p.status === "refunded" ? "coral" : "neutral"}>
                              {p.status}
                            </Badge>
                          </td>
                          <td className={td + " num text-muted-foreground text-[12px]"}>
                            {p.external_reference || "—"}
                          </td>
                          <td className={td + " num text-muted-foreground text-[12px]"}>
                            {dateTime(p.created_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Panel>
          </div>
        )}

        {/* =========================================================================
            TAB 5: SYNDICATED NEWS FEEDS MONITOR
           ========================================================================= */}
        {currentTab === "news" && (
          <Panel
            title="News Pipeline & RSS Sources"
            meta="Scheduled via /api/cron/news · Moneycontrol, Business Standard, Corporate Announcements"
            actions={<FetchNewsButton />}
          >
            <TableWrap>
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr>
                    <th className={th}>Source</th>
                    <th className={th}>Kind</th>
                    <th className={th}>Last run</th>
                    <th className={th}>Status</th>
                    <th className={th + " text-right"}>Items</th>
                    <th className={th}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {feeds.map((f) => (
                    <tr key={f.code} className={tr}>
                      <td className={td + " font-medium"}>{f.name}</td>
                      <td className={td + " text-muted-foreground"}>{f.kind}</td>
                      <td className={td + " text-muted-foreground num"}>{f.last_fetched_at ? dateTime(f.last_fetched_at) : "never"}</td>
                      <td className={td}>
                        <Badge tone={!f.is_active ? "neutral" : f.last_status === "ok" ? "gain" : f.last_status ? "loss" : "neutral"}>
                          {!f.is_active ? "off" : f.last_status ?? "pending"}
                        </Badge>
                      </td>
                      <td className={td + " num text-right font-semibold"}>{f.last_item_count ?? "—"}</td>
                      <td className={td + " max-w-[320px] truncate text-muted-foreground text-[12px]"} title={f.last_error ?? undefined}>
                        {f.last_error ?? "All articles successfully parsed & linked"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </Panel>
        )}

        {/* =========================================================================
            TAB 6: SECURITY & AUDIT ACTIVITY LOG
           ========================================================================= */}
        {currentTab === "audit" && (
          <Panel
            title="Cryptographic Immutable Audit Log"
            meta="Security ledger for account actions, plan activations, and membership changes"
          >
            {auditLogs.length === 0 ? (
              <Empty title="No audit events recorded yet." />
            ) : (
              <TableWrap>
                <table className="w-full min-w-[800px]">
                  <thead>
                    <tr>
                      <th className={th}>Audit ID</th>
                      <th className={th}>Action</th>
                      <th className={th}>Actor ID</th>
                      <th className={th}>Target</th>
                      <th className={th}>IP Hash</th>
                      <th className={th}>Date & Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id} className={tr}>
                        <td className={td + " font-mono num text-[12px] text-muted-foreground"}>
                          #{log.id}
                        </td>
                        <td className={td}>
                          <Badge tone="ink">
                            {log.action}
                          </Badge>
                        </td>
                        <td className={td + " font-mono num text-[12px] text-muted-foreground"}>
                          {log.actor_user_id ? `${log.actor_user_id.slice(0, 8)}…` : "system"}
                        </td>
                        <td className={td + " text-[12px]"}>
                          {log.target_type ? `${log.target_type}: ` : ""}
                          <span className="font-mono text-muted-foreground">{log.target_id ? `${log.target_id.slice(0, 8)}…` : "—"}</span>
                        </td>
                        <td className={td + " font-mono num text-[11.5px] text-muted-foreground"}>
                          {log.ip_hash ? `${log.ip_hash.slice(0, 8)}…` : "—"}
                        </td>
                        <td className={td + " num text-muted-foreground text-[12px]"}>
                          {dateTime(log.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Panel>
        )}

        <footer className="border-t border-border pt-4 flex flex-col sm:flex-row items-baseline justify-between text-[11.5px] text-muted-foreground gap-2">
          <p>
            Platform admins are granted only by SQL: <code className="num bg-muted px-1.5 py-0.5 rounded">insert into private.platform_admins (user_id) values (&apos;…&apos;);</code>
          </p>
          <p className="font-mono">
            Session pooler: aws-0-ap-northeast-2.pooler.supabase.com
          </p>
        </footer>
      </main>
    </div>
  );
}
