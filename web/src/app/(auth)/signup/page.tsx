import type { Metadata } from "next";
import Link from "next/link";
import { safeNext } from "@/lib/safe-next";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Open an account" };

export default async function SignupPage({ searchParams }: PageProps<"/signup">) {
  const { next } = await searchParams;
  const target = typeof next === "string" ? safeNext(next, "") : "";
  return (
    <>
      <h1 className="display text-[34px] leading-tight">Open an account.</h1>
      <p className="mb-8 mt-2 text-[14px] text-muted-foreground">
        Basic is free for three months — a 10-stock Market Radar and research on every NSE listing. Already have one?{" "}
        <Link href={target ? `/login?next=${encodeURIComponent(target)}` : "/login"} className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Sign in
        </Link>
        .
      </p>
      <SignupForm next={target || undefined} />
    </>
  );
}
