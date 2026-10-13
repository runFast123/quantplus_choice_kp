import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  const zipPath = path.join(process.cwd(), "public", "downloads", "quantspulse-terminal.zip");

  if (fs.existsSync(zipPath)) {
    const fileBuffer = fs.readFileSync(zipPath);
    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": 'attachment; filename="quantspulse-terminal.zip"',
        "Content-Length": fileBuffer.length.toString(),
        "Cache-Control": "public, max-age=3600",
      },
    });
  }

  // Fallback redirect to static download URL
  return NextResponse.redirect(new URL("/downloads/quantspulse-terminal.zip", "https://quantplus-ten.vercel.app"));
}
