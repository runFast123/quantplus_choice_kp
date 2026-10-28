import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { syncEodPrices } from "@/server/privileged/eod-sync";

/**
 * Scheduled EOD market price ingestion from Yahoo Finance.
 * Runs daily after market close (17:00 IST / 11:30 UTC & 20:00 IST / 14:30 UTC retry).
 * Authorized with `Authorization: Bearer $CRON_SECRET` only — never a query param, which would
 * put the secret in access logs.
 */
export const maxDuration = 300;
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
