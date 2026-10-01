import { cookies } from "next/headers";
import { WarningIcon } from "@phosphor-icons/react/ssr";
import { MobileNav, Sidebar } from "@/components/shell/sidebar";
import { MarketClock } from "@/components/shell/market-clock";
import { Notifications } from "@/components/shell/notifications";
import { SymbolSearch } from "@/components/shell/symbol-search";
import { TenantSwitcher } from "@/components/shell/tenant-switcher";
import { ThemeToggle } from "@/components/shell/theme-toggle";
import { TickerTape } from "@/components/shell/ticker-tape";
import { UserMenu } from "@/components/shell/user-menu";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { date } from "@/lib/format";
import type { NotificationRow, Quote } from "@/lib/types";
import { DEVICE_COOKIE } from "@/server/device";
import { deviceHash } from "@/server/privileged/account";
import { isPlatformAdmin } from "@/server/privileged/admin";
import { can, displayName, requireSession } from "@/server/session";
import { claimDeviceAction, refreshClaimsAction } from "./shell-actions";

export default async function AppLayout({ children }: LayoutProps<"/app">) {
  const s = await requireSession();
  const store = await cookies();
  const theme = store.get("qp_theme")?.value === "dark" ? "dark" : "light";
  const deviceId = store.get(DEVICE_COOKIE)?.value;

  const [symbolsRes, quotesRes, notesRes, devicesRes, admin] = await Promise.all([
    s.supabase.from("market_symbols").select("symbol, name, exchange").eq("is_active", true).order("symbol").limit(5000),
    s.supabase.from("market_snapshot").select("*").order("symbol"),
    s.supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(20),
    s.supabase.from("user_devices").select("device_hash, label, last_seen_at").eq("is_active", true).maybeSingle(),
    isPlatformAdmin(s.userId),
  ]);

  // Single active device (spec: replaces Firestore activeDeviceId).
  const activeDevice = devicesRes.data;
  if (activeDevice && (!deviceId || deviceHash(deviceId) !== activeDevice.device_hash)) {
    return (
      <div className="linen grid min-h-dvh place-items-center px-5">
        <div className="panel w-full max-w-md p-6">
          <Logo />
          <h1 className="display mt-6 text-[26px]">You&apos;re signed in somewhere else.</h1>
          <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
            QuantsPulse keeps one device active per account. It&apos;s currently{" "}
            <span className="text-foreground">{activeDevice.label ?? "another browser"}</span>, last seen {date(activeDevice.last_seen_at)}.
            Continuing here signs that device out of live features.
          </p>
          <form action={claimDeviceAction} className="mt-6">
            <Button type="submit" className="w-full">
              Use QuantsPulse on this device
            </Button>
          </form>
        </div>
      </div>
    );
  }

  const ent = s.entitlements;
  const planLabel = ent
    ? `${ent.plan_name}${ent.status === "trialing" ? " · trial" : ""} — until ${date(ent.current_period_end)}`
    : "No active plan";

  return (
    <div className="flex min-h-dvh">
      <Sidebar
        locked={{ portfolio: !can(s, "portfolio"), alerts: !can(s, "alerts") }}
        isPlatformAdmin={admin}
        planLabel={planLabel}
      />
      <div className="linen flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-[2px]">
          <div className="flex h-[52px] items-center gap-3 px-4 md:px-6">
            <div className="md:hidden">
              <Logo href="/app" className="[&>span]:hidden" />
            </div>
            <TenantSwitcher memberships={s.memberships} activeTenantId={s.activeTenantId} />
            <div className="hidden flex-1 justify-center sm:flex">
              <SymbolSearch symbols={symbolsRes.data ?? []} />
            </div>
            <div className="ml-auto flex items-center gap-1">
              <MarketClock />
              <span className="mx-2 hidden h-5 w-px bg-border lg:block" />
              <Notifications userId={s.userId} initial={(notesRes.data ?? []) as NotificationRow[]} />
              <ThemeToggle initial={theme} />
              <span className="ml-1">
                <UserMenu name={displayName(s)} email={s.email} />
              </span>
            </div>
          </div>
          <TickerTape quotes={(quotesRes.data ?? []) as Quote[]} />
        </header>

        {s.hookMissing ? (
          <div role="alert" className="mx-4 mt-4 flex flex-col gap-3 rounded-lg border border-coral/50 bg-coral/10 p-4 md:mx-6 md:flex-row md:items-center">
            <WarningIcon size={20} className="shrink-0 text-coral-ink" aria-hidden />
            <p className="flex-1 text-[13px] leading-5">
              <strong className="font-semibold">Workspace claim missing from your session.</strong> Enable the{" "}
              <code className="num rounded bg-foreground/[0.07] px-1">custom_access_token_hook</code> in Supabase → Authentication → Hooks,
              then refresh. Until then, saving watchlists and portfolios will be blocked by row-level security.
            </p>
            <form action={refreshClaimsAction}>
              <Button type="submit" variant="secondary" size="sm">
                Refresh session
              </Button>
            </form>
          </div>
        ) : null}

        <main id="main" className="mx-auto w-full max-w-[1400px] flex-1 px-4 pb-24 pt-6 md:px-6 md:pb-12">
          {children}
        </main>
      </div>
      <MobileNav />
    </div>
  );
}
