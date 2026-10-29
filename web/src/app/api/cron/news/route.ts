import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { ingestNews } from "@/server/privileged/news";
import { deliverPendingPush } from "@/server/privileged/push";

/**
 * Scheduled news ingestion. Call with `Authorization: Bearer $CRON_SECRET`
 * (Vercel Cron sends this automatically when CRON_SECRET is set). Anything
 * else gets a 401 that reveals nothing.
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
  if (!authorised(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const report = await ingestNews({ searchSymbols: Number(process.env.NEWS_SEARCH_SYMBOLS ?? 8) });
  // Research notes were rebuilt: push any stance changes they raised.
  const push = await deliverPendingPush().catch((e: unknown) => ({ error: e instanceof Error ? e.message : "push failed" }));
  return NextResponse.json({ ...report, push }, { headers: { "cache-control": "no-store" } });
}

export const GET = run;
export const POST = run;
