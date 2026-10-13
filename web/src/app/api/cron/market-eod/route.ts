import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { syncEodPrices } from "@/server/privileged/eod-sync";

/**
 * Scheduled EOD market price ingestion from Yahoo Finance.
 * Runs daily after market close (17:00 IST / 11:30 UTC & 20:00 IST / 14:30 UTC retry).
 * Authorized with `Authorization: Bearer $CRON_SECRET` or `?token=$CRON_SECRET`.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorised(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  // 1. Authorization: Bearer <secret>
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Bearer ")) {
    const a = Buffer.from(header.slice(7));
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }

  // 2. Query param ?token=<secret>
  const token = req.nextUrl.searchParams.get("token") ?? "";
  if (token) {
    const a = Buffer.from(token);
    const b = Buffer.from(secret);
    if (a.length === b.length && timingSafeEqual(a, b)) return true;
  }

  return false;
}

async function run(req: NextRequest) {
  if (!authorised(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const scopeParam = (req.nextUrl.searchParams.get("scope") || "active") as "active" | "top" | "all";
  const daysParam = Number(req.nextUrl.searchParams.get("days") || 10);

  try {
    const report = await syncEodPrices({
      scope: scopeParam === "all" || scopeParam === "top" ? scopeParam : "active",
      days: Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 10,
      triggerDownstream: true,
    });
    return NextResponse.json(report, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("Cron market-eod error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "EOD sync failed" },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export const GET = run;
export const POST = run;
