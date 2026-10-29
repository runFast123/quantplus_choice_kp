import "server-only";

import webpush from "web-push";
import { toPushPayload } from "@/lib/push-payload";
import { assertMember, PrivilegedError } from "./guards";
import { serviceRole } from "./service-role";

/**
 * Browser push for in-app notifications (Web Push + VAPID, keys in env). Notifications are
 * claimed once by svc_claim_push_batch and sent to their owner's browsers; payloads are
 * encrypted for each browser by the protocol, so the push service can't read them.
 */
export interface PushReport {
  claimed: number;
  sent: number;
  removed: number;
  failed: number;
  skipped?: string;
}

type Sub = { id: string; user_id: string; tenant_id: string; endpoint: string; p256dh: string; auth: string; created_at: string; failures: number };

function configure(): boolean {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

type Outcome = "sent" | "gone" | "failed";

async function sendOne(sub: Sub, payload: object): Promise<Outcome> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24, urgency: "normal", timeout: 10_000 },
    );
    return "sent";
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    // 404/410: the browser dropped the subscription (signed out, cleared data, uninstalled).
    return status === 404 || status === 410 ? "gone" : "failed";
  }
}

/** Record outcomes: drop dead subscriptions, count failures (drop after 5), stamp successes. */
async function settle(outcomes: Map<string, { sub: Sub; outcome: Outcome }>) {
  const db = serviceRole();
  const now = new Date().toISOString();
  const gone = [...outcomes.values()].filter((o) => o.outcome === "gone" || (o.outcome === "failed" && o.sub.failures + 1 >= 5));
  const failed = [...outcomes.values()].filter((o) => o.outcome === "failed" && o.sub.failures + 1 < 5);
  const ok = [...outcomes.values()].filter((o) => o.outcome === "sent").map((o) => o.sub.id);
  if (gone.length) await db.from("push_subscriptions").delete().in("id", gone.map((o) => o.sub.id));
  if (ok.length) await db.from("push_subscriptions").update({ last_success_at: now, failures: 0 }).in("id", ok);
  for (const o of failed) await db.from("push_subscriptions").update({ failures: o.sub.failures + 1 }).eq("id", o.sub.id);
  return gone.length;
}

/** Push every notification not yet handled (last two days). Safe to run from several jobs at once. */
export async function deliverPendingPush(limit = 500): Promise<PushReport> {
  if (!configure()) return { claimed: 0, sent: 0, removed: 0, failed: 0, skipped: "VAPID keys not set" };
  const db = serviceRole();
  const { data: batch, error } = await db.rpc("svc_claim_push_batch", { p_limit: limit });
  if (error) throw new Error(`push claim failed: ${error.message}`);
  const rows = (batch ?? []) as { notification_id: string; user_id: string; type: string; title: string; body: string | null; data: Record<string, unknown> | null; created_at: string }[];
  if (!rows.length) return { claimed: 0, sent: 0, removed: 0, failed: 0 };

  const users = [...new Set(rows.map((r) => r.user_id))];
  const { data: subs } = await db
    .from("push_subscriptions")
    .select("id, user_id, tenant_id, endpoint, p256dh, auth, created_at, failures")
    .in("user_id", users);
  const byUser = new Map<string, Sub[]>();
  for (const s of (subs ?? []) as Sub[]) {
    // One browser can be subscribed from several workspaces: send to it once.
    const list = byUser.get(s.user_id) ?? [];
    if (!list.some((x) => x.endpoint === s.endpoint)) list.push(s);
    byUser.set(s.user_id, list);
  }

  const jobs: { sub: Sub; payload: object }[] = [];
  for (const r of rows) {
    for (const sub of byUser.get(r.user_id) ?? []) {
      // Only what happened after this browser was turned on.
      if (sub.created_at > r.created_at) continue;
      jobs.push({ sub, payload: toPushPayload({ id: r.notification_id, type: r.type, title: r.title, body: r.body, data: r.data }) });
    }
  }

  const outcomes = new Map<string, { sub: Sub; outcome: Outcome }>();
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < jobs.length; i += 20) {
    const part = jobs.slice(i, i + 20);
    const results = await Promise.all(part.map((j) => sendOne(j.sub, j.payload)));
    results.forEach((outcome, k) => {
      const sub = part[k].sub;
      if (outcome === "sent") sent++;
      if (outcome === "failed") failed++;
      // Worst outcome per subscription wins (gone > failed > sent).
      const prev = outcomes.get(sub.id)?.outcome;
      if (!prev || prev === "sent" || (prev === "failed" && outcome === "gone")) outcomes.set(sub.id, { sub, outcome });
    });
  }
  const removed = await settle(outcomes);
  return { claimed: rows.length, sent, removed, failed };
}

/** "Send a test" from Settings: the caller's own browsers in the active workspace only. */
export async function sendTestPush(userId: string, tenantId: string): Promise<{ sent: number }> {
  if (!configure()) throw new PrivilegedError("Browser notifications aren't set up on this server yet.");
  await assertMember(userId, tenantId);
  const db = serviceRole();
  const { data } = await db
    .from("push_subscriptions")
    .select("id, user_id, tenant_id, endpoint, p256dh, auth, created_at, failures")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId);
  const subs = (data ?? []) as Sub[];
  if (!subs.length) throw new PrivilegedError("Turn on notifications in this browser first.");
  const payload = {
    title: "QuantsPulse notifications are on",
    body: "You'll get price alerts, exit signals and research changes here, after each market close.",
    url: "/app/alerts",
    tag: "test",
  };
  const outcomes = new Map<string, { sub: Sub; outcome: Outcome }>();
  for (const sub of subs) outcomes.set(sub.id, { sub, outcome: await sendOne(sub, payload) });
  await settle(outcomes);
  return { sent: [...outcomes.values()].filter((o) => o.outcome === "sent").length };
}
