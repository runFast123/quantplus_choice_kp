import type { Metadata } from "next";
import { ShieldCheckIcon } from "@phosphor-icons/react/ssr";
import { Button } from "@/components/ui/button";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Badge } from "@/components/ui/data";
import { Empty, PageHeader, Panel, TableWrap, td, tdNum, th, thNum, tr } from "@/components/ui/layout";
import { date, dateTime, isoDaysAgo, isoNow, paiseToRupees, relative } from "@/lib/format";
import type { PlanCode, SubscriptionStatus, TenantRole } from "@/lib/types";
import { isTenantAdmin, requireSession } from "@/server/session";
import { leaveWorkspace, removeMember, revokeInvitation } from "./actions";
import { CreateOrgForm, InviteForm, RenameForm, RoleSelect } from "./forms";

export const metadata: Metadata = { title: "Workspace" };

type DirRow = {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  role: TenantRole;
  plan: PlanCode | null;
  plan_status: SubscriptionStatus | null;
  plan_expires_at: string | null;
  total_paid_paise: number;
  last_sign_in_at: string | null;
};

const EVENT_LABEL: Record<string, string> = {
  onboarding_completed: "Onboarded",
  radar_symbol_added: "Radar adds",
  holding_added: "Holdings added",
  alert_created: "Alerts set",
};

export default async function WorkspacePage() {
  const s = await requireSession();
  const tenant = s.activeTenant;
  const orgs = s.memberships.filter((m) => m.tenants.type === "organization");

  if (!tenant || tenant.type === "personal") {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader
          eyebrow="Workspaces"
          title="Your personal workspace"
          description="Everything you track lives here by default. Organisations let an advisory firm, desk or broker partner manage plans and members together — without ever seeing each other's holdings."
        />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel title="Start an organisation" id="new">
            <CreateOrgForm />
          </Panel>
          <Panel title="What admins can and can't see">
            <PrivacyMatrix />
          </Panel>
        </div>
        {orgs.length ? (
          <Panel title="Organisations you belong to">
            <ul className="flex flex-col gap-2 text-[13px]">
              {orgs.map((o) => (
                <li key={o.tenant_id} className="flex items-center justify-between">
                  <span>{o.tenants.name}</span>
                  <span className="capitalize text-muted-foreground">{o.role}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[12px] text-muted-foreground">Switch with the workspace menu at the top left.</p>
          </Panel>
        ) : null}
      </div>
    );
  }

  const admin = isTenantAdmin(s);
  const owner = s.activeRole === "owner";
  const since = isoDaysAgo(30);

  const [dirRes, invRes, usageRes, auditRes] = admin
    ? await Promise.all([
        s.supabase.rpc("tenant_member_directory", { p_tenant: tenant.id }),
        s.supabase.from("tenant_invitations").select("id, email, role, expires_at, accepted_at, created_at").is("accepted_at", null).order("created_at", { ascending: false }),
        s.supabase.rpc("tenant_feature_usage", { p_tenant: tenant.id, p_from: since, p_to: isoNow() }),
        s.supabase.from("audit_log").select("id, action, actor_user_id, target_type, target_id, metadata, created_at").eq("tenant_id", tenant.id).order("created_at", { ascending: false }).limit(25),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];

  const members = (dirRes.data ?? []) as DirRow[];
  const nameOf = new Map(members.map((m) => [m.user_id, m.full_name || m.email]));
  const usage = (usageRes.data ?? []) as { user_id: string; event_type: string; events: number; last_used_at: string }[];
  const usageByUser = new Map<string, { total: number; last: string; byType: Record<string, number> }>();
  for (const u of usage) {
    const row = usageByUser.get(u.user_id) ?? { total: 0, last: u.last_used_at, byType: {} };
    row.total += Number(u.events);
    row.byType[u.event_type] = Number(u.events);
    if (u.last_used_at > row.last) row.last = u.last_used_at;
    usageByUser.set(u.user_id, row);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={`Organisation · you are ${s.activeRole}`}
        title={tenant.name}
        description={tenant.slug ? <span className="num">{tenant.slug}</span> : undefined}
        actions={
          !owner ? (
            <form action={leaveWorkspace}>
              <Button type="submit" variant="danger" size="sm">
                Leave workspace
              </Button>
            </form>
          ) : null
        }
      />

      {!admin ? (
        <Panel title="Membership">
          <p className="text-[13px] leading-6 text-muted-foreground">
            You&apos;re a member of {tenant.name}. Admins here can see your name, email, plan and how often you use features — never your
            holdings, watchlists, alerts, broker connections or AI keys.
          </p>
        </Panel>
      ) : (
        <>
          <Panel title="Members" meta={`${members.length}`}>
            <TableWrap>
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr>
                    <th className={th}>Member</th>
                    <th className={th}>Role</th>
                    <th className={th}>Plan</th>
                    <th className={th}>Expires</th>
                    <th className={thNum}>Paid</th>
                    <th className={th}>Last sign-in</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((m) => (
                    <tr key={m.user_id} className={tr}>
                      <td className={td}>
                        <span className="block font-medium">{m.full_name || "—"}</span>
                        <span className="block text-[11.5px] text-muted-foreground">{m.email}</span>
                      </td>
                      <td className={td}>
                        {m.role === "owner" || m.user_id === s.userId ? (
                          <span className="capitalize">{m.role}</span>
                        ) : (
                          <RoleSelect userId={m.user_id} role={m.role as "member" | "admin"} disabled={!owner && m.role === "admin"} />
                        )}
                      </td>
                      <td className={td}>
                        {m.plan ? (
                          <Badge tone={m.plan_status === "active" ? "ink" : "neutral"}>
                            {m.plan.replace("_", " ")} · {m.plan_status}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={td + " num text-muted-foreground"}>{date(m.plan_expires_at)}</td>
                      <td className={tdNum}>{paiseToRupees(Number(m.total_paid_paise))}</td>
                      <td className={td + " text-muted-foreground"}>{relative(m.last_sign_in_at)}</td>
                      <td className={td + " text-right"}>
                        {m.role !== "owner" && m.user_id !== s.userId && (owner || m.role === "member") ? (
                          <ConfirmButton label={`Remove ${m.email}`} confirmLabel="Remove" onConfirm={removeMember.bind(null, m.user_id)}>
                            Remove
                          </ConfirmButton>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
            <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <ShieldCheckIcon size={14} aria-hidden /> Holdings, watchlists, alerts and keys are never visible here — by database policy, not just by design.
            </p>
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel title="Invite someone">
              <InviteForm canInviteAdmin={owner} />
              {(invRes.data ?? []).length ? (
                <ul className="mt-5 flex flex-col divide-y divide-border border-t border-border">
                  {(invRes.data ?? []).map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-3 py-2.5 text-[13px]">
                      <span className="min-w-0">
                        <span className="block truncate">{i.email}</span>
                        <span className="text-[11.5px] text-muted-foreground">
                          {i.role} · {new Date(i.expires_at) < new Date() ? "expired" : `expires ${date(i.expires_at)}`}
                        </span>
                      </span>
                      <ConfirmButton label={`Revoke invite for ${i.email}`} confirmLabel="Revoke" onConfirm={revokeInvitation.bind(null, i.id)}>
                        Revoke
                      </ConfirmButton>
                    </li>
                  ))}
                </ul>
              ) : null}
            </Panel>

            <Panel title="Feature usage" meta="last 30 days · counts only">
              {usageByUser.size === 0 ? (
                <Empty title="No activity yet." />
              ) : (
                <TableWrap>
                  <table className="w-full min-w-[420px]">
                    <thead>
                      <tr>
                        <th className={th}>Member</th>
                        <th className={thNum}>Actions</th>
                        <th className={th}>Most used</th>
                        <th className={th}>Last</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...usageByUser.entries()].map(([uid, u]) => {
                        const top = Object.entries(u.byType).sort((a, b) => b[1] - a[1])[0];
                        return (
                          <tr key={uid} className={tr}>
                            <td className={td}>{nameOf.get(uid) ?? "Former member"}</td>
                            <td className={tdNum}>{u.total}</td>
                            <td className={td + " text-muted-foreground"}>{top ? `${EVENT_LABEL[top[0]] ?? top[0]} (${top[1]})` : "—"}</td>
                            <td className={td + " text-muted-foreground"}>{relative(u.last)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              )}
              <p className="mt-3 text-[12px] text-muted-foreground">We record that a feature was used, never which stock it was used on.</p>
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
            <Panel title="Audit log" meta="latest 25">
              {(auditRes.data ?? []).length === 0 ? (
                <Empty title="Nothing logged yet." />
              ) : (
                <ol className="flex flex-col">
                  {(auditRes.data ?? []).map((a) => (
                    <li key={a.id} className="flex items-baseline justify-between gap-4 border-b border-border/70 py-2 text-[13px] last:border-0">
                      <span className="min-w-0">
                        <span className="num">{a.action}</span>
                        <span className="text-muted-foreground"> · {nameOf.get(a.actor_user_id) ?? "system"}</span>
                      </span>
                      <span className="num shrink-0 text-[11.5px] text-muted-foreground">{dateTime(a.created_at)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </Panel>
            {owner ? (
              <Panel title="Settings">
                <RenameForm name={tenant.name} />
              </Panel>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function PrivacyMatrix() {
  const rows: [string, boolean][] = [
    ["Name, email and plan status", true],
    ["Feature usage counts", true],
    ["Holdings and portfolios", false],
    ["Watchlists and alerts", false],
    ["Broker connections", false],
    ["AI keys", false],
  ];
  return (
    <ul className="flex flex-col gap-2 text-[13px]">
      {rows.map(([label, visible]) => (
        <li key={label} className="flex items-center justify-between gap-3">
          <span>{label}</span>
          <Badge tone={visible ? "neutral" : "ink"}>{visible ? "Visible" : "Never"}</Badge>
        </li>
      ))}
    </ul>
  );
}
