import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { date } from "@/lib/format";
import { getSession } from "@/server/session";
import { claimDeviceAction } from "@/app/app/shell-actions";

export const metadata: Metadata = { title: "Signed in elsewhere" };

/**
 * Single active device (spec: replaces Firestore activeDeviceId). Every page
 * and action that calls requireSession() sends a displaced device here.
 */
export default async function DevicePage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (s.deviceActive) redirect("/app");

  return (
    <div className="linen grid min-h-dvh place-items-center px-5">
      <div className="panel w-full max-w-md p-6">
        <Logo />
        <h1 className="display mt-6 text-[26px]">You&apos;re signed in somewhere else.</h1>
        <p className="mt-2 text-[14px] leading-6 text-muted-foreground">
          QuantsPulse keeps one device active per account. It&apos;s currently{" "}
          <span className="text-foreground">{s.activeDevice?.label ?? "another browser"}</span>
          {s.activeDevice?.last_seen_at ? `, last seen ${date(s.activeDevice.last_seen_at)}` : ""}. Continuing here signs that device out.
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
