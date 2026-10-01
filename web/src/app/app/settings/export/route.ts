import { NextResponse } from "next/server";
import { getSession } from "@/server/session";

/** Data-access right (§7): RLS scopes export_my_data() to the caller's own rows. */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!s.deviceActive) return NextResponse.json({ error: "inactive_device" }, { status: 403 });

  const { data, error } = await s.supabase.rpc("export_my_data");
  if (error) return NextResponse.json({ error: "export_failed" }, { status: 500 });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="quantspulse-export-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
}
