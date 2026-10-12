import "server-only";

import type { PlanCode, SubscriptionStatus, TenantType } from "@/lib/types";
import { PrivilegedError } from "./guards";
import { serviceRole } from "./service-role";

/** Platform admins are granted only by direct SQL (§2 rule 6); this only reads. */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const { data } = await serviceRole().rpc("svc_is_platform_admin", { p_user: userId });
  return data === true;
}

export interface AdminUserRow {
  user_id: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  tenant_id: string;
  tenant_name: string;
  tenant_type: TenantType;
  plan: PlanCode | null;
  plan_status: SubscriptionStatus | null;
  plan_expires_at: string | null;
  created_at: string;
  last_sign_in_at: string | null;
}

export async function searchUsers(actorId: string, query: string): Promise<AdminUserRow[]> {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const { data, error } = await serviceRole().rpc("svc_admin_user_search", { p_query: query, p_limit: 50 });
  if (error) throw new PrivilegedError(error.message);
  return (data ?? []) as AdminUserRow[];
}

/**
 * Wraps public.admin_activate_plan — one transaction for subscription +
 * payment + audit (§5.11). p_actor comes from the verified JWT and the
 * function re-checks platform-admin status itself.
 */
export async function activatePlan(
  actorId: string,
  input: {
    userId: string;
    tenantId: string;
    plan: PlanCode;
    months: number;
    amountPaise: number;
    method: "upi" | "bank_transfer" | "cash" | "other";
    reference?: string;
  },
) {
  const { data, error } = await serviceRole().rpc("admin_activate_plan", {
    p_actor: actorId,
    p_user: input.userId,
    p_tenant: input.tenantId,
    p_plan: input.plan,
    p_months: input.months,
    p_amount_paise: input.amountPaise,
    p_method: input.method,
    p_reference: input.reference || null,
  });
  if (error) throw new PrivilegedError(error.message);
  return data as { current_period_end: string; plan_code: PlanCode };
}

export async function platformStats(actorId: string) {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const db = serviceRole();
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [users, live, paid, revenue] = await Promise.all([
    db.from("profiles").select("user_id", { count: "exact", head: true }),
    db.from("subscriptions").select("id", { count: "exact", head: true }).in("status", ["trialing", "active"]),
    db.from("subscriptions").select("id", { count: "exact", head: true }).eq("status", "active").neq("plan_code", "basic"),
    db.from("payments").select("amount_paise").eq("status", "captured").gte("created_at", since),
  ]);
  return {
    users: users.count ?? 0,
    liveSubscriptions: live.count ?? 0,
    paidSubscriptions: paid.count ?? 0,
    revenue30dPaise: (revenue.data ?? []).reduce((s, r) => s + Number(r.amount_paise), 0),
  };
}

export interface DatabaseTableStat {
  name: string;
  category: "market" | "signals" | "content" | "platform" | "compliance";
  count: number;
  latestDate: string | null;
  status: "healthy" | "fresh" | "warning" | "idle";
  description: string;
}

export interface DatabaseInventory {
  tables: DatabaseTableStat[];
  segments: { equity: number; etf: number; index: number; sme: number; other: number };
  latestEodDate: string | null;
  isEodFresh: boolean;
  totalStorageRecords: number;
}

export async function getDatabaseInventory(actorId: string): Promise<DatabaseInventory> {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const db = serviceRole();

  const [
    snapRes,
    symbolsRes,
    candlesRes,
    signalsRes,
    rsiRes,
    newsArticlesRes,
    newsSourcesRes,
    researchRes,
    auditRes,
    paymentsRes,
    devicesRes,
  ] = await Promise.all([
    db.from("market_snapshot").select("as_of", { count: "exact" }).order("as_of", { ascending: false }).limit(1),
    db.from("market_symbols").select("segment", { count: "exact" }),
    db.from("market_candles").select("ts", { count: "exact", head: true }),
    db.from("trading_signals").select("generated_at", { count: "exact" }).order("generated_at", { ascending: false }).limit(1),
    db.from("rsi_events").select("ts", { count: "exact", head: true }),
    db.from("news_articles").select("published_at", { count: "exact" }).order("published_at", { ascending: false }).limit(1),
    db.from("news_sources").select("id, is_active", { count: "exact" }),
    db.from("research_notes").select("created_at", { count: "exact" }).order("created_at", { ascending: false }).limit(1),
    db.from("audit_log").select("created_at", { count: "exact" }).order("created_at", { ascending: false }).limit(1),
    db.from("payments").select("created_at", { count: "exact" }).order("created_at", { ascending: false }).limit(1),
    db.from("user_devices").select("id", { count: "exact", head: true }),
  ]);

  const latestEodDate = snapRes.data?.[0]?.as_of ?? null;
  let isEodFresh = false;
  if (latestEodDate) {
    const eodTime = new Date(latestEodDate).getTime();
    const daysAgo = (Date.now() - eodTime) / 86400000;
    // Fresh if within 3 calendar days (accommodates weekend gap)
    isEodFresh = daysAgo <= 3.5;
  }

  // Count segments
  const segments = { equity: 0, etf: 0, index: 0, sme: 0, other: 0 };
  for (const s of symbolsRes.data ?? []) {
    const seg = (s.segment ?? "").toLowerCase();
    if (seg === "equity") segments.equity++;
    else if (seg === "etf") segments.etf++;
    else if (seg === "index") segments.index++;
    else if (seg === "sme") segments.sme++;
    else segments.other++;
  }

  const activeFeeds = (newsSourcesRes.data ?? []).filter((s) => s.is_active).length;

  const tables: DatabaseTableStat[] = [
    {
      name: "market_symbols",
      category: "market",
      count: symbolsRes.count ?? 0,
      latestDate: null,
      status: "healthy",
      description: "Tracked universe: NSE Equities, Major ETFs, Indices, and SME boards.",
    },
    {
      name: "market_snapshot",
      category: "market",
      count: snapRes.count ?? 0,
      latestDate: latestEodDate,
      status: isEodFresh ? "fresh" : "warning",
      description: "Live snapshot with latest close price, change, volume, Wilder RSI, and 52W range.",
    },
    {
      name: "market_candles",
      category: "market",
      count: candlesRes.count ?? 0,
      latestDate: latestEodDate,
      status: "healthy",
      description: "Partitioned historical daily OHLCV candlestick records from verified NSE sources.",
    },
    {
      name: "trading_signals",
      category: "signals",
      count: signalsRes.count ?? 0,
      latestDate: signalsRes.data?.[0]?.generated_at ?? null,
      status: "healthy",
      description: "Quantitative rule-based strategies: SMA Cross, RSI Oversold Bounce, Asymmetric Targets.",
    },
    {
      name: "rsi_events",
      category: "signals",
      count: rsiRes.count ?? 0,
      latestDate: null,
      status: "healthy",
      description: "Tracked RSI momentum milestones: Overbought (>=70) & Oversold (<=30) cycles.",
    },
    {
      name: "news_articles",
      category: "content",
      count: newsArticlesRes.count ?? 0,
      latestDate: newsArticlesRes.data?.[0]?.published_at ?? null,
      status: "healthy",
      description: "Deduplicated syndicated RSS headlines and AI-ready stock entity linkings.",
    },
    {
      name: "news_sources",
      category: "content",
      count: newsSourcesRes.count ?? 0,
      latestDate: null,
      status: activeFeeds > 0 ? "healthy" : "warning",
      description: `${activeFeeds} active syndication feeds configured (Moneycontrol, Business Standard, Corporate).`,
    },
    {
      name: "research_notes",
      category: "content",
      count: researchRes.count ?? 0,
      latestDate: researchRes.data?.[0]?.created_at ?? null,
      status: "healthy",
      description: "Synthesized multi-factor stance: Momentum, Value, Sector, and Risk classification.",
    },
    {
      name: "payments",
      category: "platform",
      count: paymentsRes.count ?? 0,
      latestDate: paymentsRes.data?.[0]?.created_at ?? null,
      status: "healthy",
      description: "Captured subscription transactions with GST/tax compliance record preservation.",
    },
    {
      name: "audit_log",
      category: "compliance",
      count: auditRes.count ?? 0,
      latestDate: auditRes.data?.[0]?.created_at ?? null,
      status: "healthy",
      description: "Cryptographically append-only immutable security ledger for platform operations.",
    },
    {
      name: "user_devices",
      category: "compliance",
      count: devicesRes.count ?? 0,
      latestDate: null,
      status: "healthy",
      description: "Active single-session device heartbeats enforcing single-active-device security.",
    },
  ];

  const totalStorageRecords = tables.reduce((acc, t) => acc + t.count, 0);

  return {
    tables,
    segments,
    latestEodDate,
    isEodFresh,
    totalStorageRecords,
  };
}

export interface PaymentRow {
  id: string;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  amount_paise: number;
  currency: string;
  method: string;
  status: string;
  external_reference: string | null;
  created_at: string;
}

export async function getRecentPayments(actorId: string, limit = 25): Promise<PaymentRow[]> {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const db = serviceRole();
  const { data: pms, error } = await db
    .from("payments")
    .select("id, user_id, amount_paise, currency, method, status, external_reference, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error || !pms) return [];
  const userIds = [...new Set(pms.map((p) => p.user_id).filter(Boolean) as string[])];
  let profilesMap = new Map<string, { email: string; full_name: string | null }>();
  if (userIds.length > 0) {
    const { data: profs } = await db.from("profiles").select("user_id, email, full_name").in("user_id", userIds);
    if (profs) {
      profilesMap = new Map(profs.map((pr) => [pr.user_id, { email: pr.email, full_name: pr.full_name }]));
    }
  }
  return pms.map((p) => {
    const prof = p.user_id ? profilesMap.get(p.user_id) : null;
    return {
      id: p.id,
      user_id: p.user_id,
      user_email: prof?.email ?? null,
      user_name: prof?.full_name ?? null,
      amount_paise: Number(p.amount_paise),
      currency: p.currency,
      method: p.method,
      status: p.status,
      external_reference: p.external_reference,
      created_at: p.created_at,
    };
  });
}

export interface AuditLogRow {
  id: number;
  action: string;
  actor_user_id: string | null;
  target_type: string | null;
  target_id: string | null;
  created_at: string;
  ip_hash: string | null;
  metadata: Record<string, unknown>;
}

export async function getRecentAuditLogs(actorId: string, limit = 25): Promise<AuditLogRow[]> {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const db = serviceRole();
  const { data, error } = await db
    .from("audit_log")
    .select("id, action, actor_user_id, target_type, target_id, created_at, ip_hash, metadata")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []) as AuditLogRow[];
}

export async function triggerMarketAnalytics(actorId: string, days = 10) {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const db = serviceRole();
  const { data, error } = await db.rpc("svc_refresh_market_analytics", { p_days: days });
  if (error) throw new PrivilegedError(error.message);
  return data as { rsi_events: number; signals: number; ledgers: number; quotes: number };
}

export async function triggerResearchRefresh(actorId: string) {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const db = serviceRole();
  const { data, error } = await db.rpc("svc_refresh_research");
  if (error) throw new PrivilegedError(error.message);
  return { rows: Number(data ?? 0) };
}

export async function triggerEodNotifier(actorId: string) {
  if (!(await isPlatformAdmin(actorId))) throw new PrivilegedError("NOT_AUTHORIZED");
  const db = serviceRole();
  const { data, error } = await db.rpc("svc_run_eod_notifier");
  if (error) throw new PrivilegedError(error.message);
  return data as Record<string, unknown>;
}

