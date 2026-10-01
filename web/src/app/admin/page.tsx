import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "@phosphor-icons/react/ssr";
import { Logo } from "@/components/brand/logo";
import { Badge, Stat } from "@/components/ui/data";
import { inputClass } from "@/components/ui/field";
import { Empty, PageHeader, Panel, TableWrap, td, th, tr } from "@/components/ui/layout";
import { date, dateTime, paiseToRupees, relative } from "@/lib/format";
import { isPlatformAdmin, platformStats, searchUsers } from "@/server/privileged/admin";
import { newsSourceHealth } from "@/server/privileged/news";
import { FetchNewsButton } from "./news-button";
import { requireSession } from "@/server/session";
import { ActivateForm } from "./activate-form";

export const metadata: Metadata = { title: "Platform admin" };

export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  const s = await requireSession();
  // 404 rather than 403: don't advertise that the console exists.
  if (!(await isPlatformAdmin(s.userId))) notFound();

  const q = typeof (await searchParams).q === "string" ? ((await searchParams).q as string).trim() : "";
  const [stats, users, feeds] = await Promise.all([platformStats(s.userId), searchUsers(s.userId, q), newsSourceHealth()]);

  return (
    <div className="linen min-h-dvh">
      <header className="flex h-[52px] items-center justify-between border-b border-border px-4 md:px-6">
        <Logo href="/app" />
        <Link href="/app" className="inline-flex items-center gap-1.5 text-[12.5px] text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon size={13} aria-hidden /> Back to the app
        </Link>
      </header>
      <main className="mx-auto flex max-w-[1400px] flex-col gap-6 px-4 py-6 md:px-6">
        <PageHeader
          eyebrow="Platform"
          title="Admin console"
          description="Plans, payments and member status. Holdings, watchlists, alerts and secrets are deliberately not reachable from here."
        />

        <section className="panel grid grid-cols-2 md:grid-cols-4 md:divide-x md:divide-border">
          <Stat className="p-4" label="Accounts" value={stats.users.toLocaleString("en-IN")} />
          <Stat className="p-4" label="Live subscriptions" value={stats.liveSubscriptions.toLocaleString("en-IN")} />
          <Stat className="p-4" label="Paid (Pro / Pro Plus)" value={stats.paidSubscriptions.toLocaleString("en-IN")} />
          <Stat className="p-4" label="Collected, 30 days" value={paiseToRupees(stats.revenue30dPaise)} />
        </section>

        <Panel
          title="Accounts"
          meta={q ? `matching “${q}”` : "newest first"}
          actions={
            <form className="flex gap-2" role="search">
              <label htmlFor="admin-q" className="sr-only">
                Search accounts
              </label>
              <input id="admin-q" name="q" defaultValue={q} placeholder="Email, name or phone" className={inputClass + " h-8 w-[240px] text-[12.5px]"} />
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
                    <th className={th}>Activate</th>
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
                        {u.tenant_type === "personal" ? "Personal" : u.tenant_name}
                      </td>
                      <td className={td + " py-2.5"}>
                        {u.plan ? (
                          <Badge tone={u.plan_status === "active" ? "ink" : u.plan_status === "trialing" ? "coral" : "neutral"}>
                            {u.plan.replace("_", " ")} · {u.plan_status}
                          </Badge>
                        ) : (
                          "—"
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
        <Panel title="News pipeline" meta="RSS sources · runs on a schedule via /api/cron/news" actions={<FetchNewsButton />}>
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
                    <td className={td}>{f.name}</td>
                    <td className={td + " text-muted-foreground"}>{f.kind}</td>
                    <td className={td + " text-muted-foreground"}>{f.last_fetched_at ? dateTime(f.last_fetched_at) : "never"}</td>
                    <td className={td}>
                      <Badge tone={!f.is_active ? "neutral" : f.last_status === "ok" ? "gain" : f.last_status ? "loss" : "neutral"}>
                        {!f.is_active ? "off" : f.last_status ?? "pending"}
                      </Badge>
                    </td>
                    <td className={td + " num text-right"}>{f.last_item_count ?? "—"}</td>
                    <td className={td + " max-w-[320px] truncate text-muted-foreground"} title={f.last_error ?? undefined}>
                      {f.last_error ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Panel>

        <p className="text-[12px] text-muted-foreground">
          Platform admins are granted only by SQL: <code className="num">insert into private.platform_admins (user_id) values (&apos;…&apos;);</code>
        </p>
      </main>
    </div>
  );
}
