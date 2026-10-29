import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { deliverPendingPush } from "@/server/privileged/push";

/**
 * Sends browser push for notifications the database created (price alerts, exit signals,
 * research stance changes, plan expiry). Runs after the pg_cron notifier; the market-eod and
 * news jobs also deliver at their end. `Authorization: Bearer $CRON_SECRET` only.
 */
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization") ?? "";
  if (!secret || !header.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function run(req: NextRequest) {
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await deliverPendingPush();
  return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
}

export const GET = run;
export const POST = run;
