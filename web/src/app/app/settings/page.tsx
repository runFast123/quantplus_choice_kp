import type { Metadata } from "next";
import Link from "next/link";
import clsx from "clsx";
import { DownloadSimpleIcon } from "@phosphor-icons/react/ssr";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/data";
import { PageHeader, Panel } from "@/components/ui/layout";
import { CONSENT_COPY } from "@/lib/consents";
import { date, dateTime, relative } from "@/lib/format";
import { requireSession } from "@/server/session";
import { ConsentSwitch, DeleteAccountForm, PasswordForm, ProfileForm } from "./forms";

export const metadata: Metadata = { title: "Settings" };

const TABS = [
  { key: "profile", label: "Profile" },
  { key: "security", label: "Security" },
  { key: "privacy", label: "Privacy" },
  { key: "data", label: "Your data" },
] as const;

export default async function SettingsPage({ searchParams }: PageProps<"/app/settings">) {
  const s = await requireSession();
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.tab) ? (sp.tab as (typeof TABS)[number]["key"]) : "profile";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Account" title="Settings" />
      <nav aria-label="Settings sections" className="-mt-2 flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/app/settings?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={clsx(
              "-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-[13.5px] transition-colors",
              tab === t.key ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "profile" ? (
        <Panel title="Profile">
          <ProfileForm fullName={s.profile?.full_name ?? ""} phone={s.profile?.phone ?? ""} email={s.email} />
        </Panel>
      ) : null}

      {tab === "security" ? <SecurityTab /> : null}
      {tab === "privacy" ? <PrivacyTab /> : null}
      {tab === "data" ? <DataTab /> : null}
    </div>
  );
}

async function SecurityTab() {
  const s = await requireSession();
  const { data: devices } = await s.supabase.from("user_devices").select("id, label, is_active, last_seen_at, created_at").order("last_seen_at", { ascending: false });
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Password">
        <PasswordForm />
      </Panel>
      <Panel title="Devices" meta="one active at a time">
        <ul className="flex flex-col divide-y divide-border">
          {(devices ?? []).map((d) => (
            <li key={d.id} className="flex items-center justify-between py-2.5 text-[13px] first:pt-0">
              <span>
                <span className="block">{d.label ?? "Unknown device"}</span>
                <span className="text-[11.5px] text-muted-foreground">
                  First seen {date(d.created_at)} · last {relative(d.last_seen_at)}
                </span>
              </span>
              {d.is_active ? <Badge tone="gain">Active</Badge> : <Badge>Signed out</Badge>}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted-foreground">Signing in on a new browser makes it the active device. We store a hash of a random device id — never a fingerprint.</p>
      </Panel>
    </div>
  );
}

async function PrivacyTab() {
  const s = await requireSession();
  const { data } = await s.supabase.from("user_consents").select("purpose, version, granted_at, withdrawn_at").order("granted_at", { ascending: false });
  const latest = new Map<string, { version: string; granted_at: string; withdrawn_at: string | null }>();
  for (const c of data ?? []) if (!latest.has(c.purpose)) latest.set(c.purpose, c);

  return (
    <Panel title="Consents" meta="recorded with a timestamp and the version you agreed to">
      <div className="divide-y divide-border">
        {Object.entries(CONSENT_COPY).map(([purpose, copy]) => {
          const c = latest.get(purpose);
          const granted = Boolean(c && !c.withdrawn_at);
          return (
            <ConsentSwitch
              key={purpose}
              purpose={purpose}
              granted={granted}
              required={copy.required}
              title={copy.title}
              body={copy.body}
              since={c ? (granted ? `Granted ${dateTime(c.granted_at)} · v${c.version}` : `Withdrawn ${dateTime(c.withdrawn_at)}`) : undefined}
            />
          );
        })}
      </div>
    </Panel>
  );
}

async function DataTab() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Export">
        <p className="mb-4 max-w-md text-[13px] leading-6 text-muted-foreground">
          Download everything you&apos;ve stored in this workspace — profile, consents, portfolios, holdings, watchlists, alerts, subscriptions, payments and
          connection metadata — as JSON. Secrets are never included.
        </p>
        <a href="/app/settings/export" className={buttonClass("secondary", "md", "w-fit")} download>
          <DownloadSimpleIcon size={16} aria-hidden /> Download my data
        </a>
      </Panel>
      <Panel title="Delete account" className="border-loss/40">
        <p className="mb-4 max-w-md text-[13px] leading-6 text-muted-foreground">
          Disconnects brokers, deletes uploaded files, your personal workspace and everything in it, then your login. Payment records are kept without your
          name for tax law. This can&apos;t be undone.
        </p>
        <DeleteAccountForm />
      </Panel>
    </div>
  );
}
