import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "./login-form";
import { ResendConfirmation } from "./resend-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams;
  return (
    <>
      <h1 className="display text-[34px] leading-tight">Welcome back.</h1>
      <p className="mb-8 mt-2 text-[14px] text-muted-foreground">
        New here?{" "}
        <Link href="/signup" className="text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground">
          Open an account
        </Link>{" "}
        — Basic is free for three months.
      </p>
      {error === "link" ? (
        <div className="mb-6">
          <p role="alert" className="rounded-md border border-loss/30 bg-loss-soft px-3 py-2 text-[13px] text-loss">
            That link has expired or was already used — each link works once. If you haven&apos;t confirmed your email yet, get a
            fresh link below. Otherwise just sign in.
          </p>
          <ResendConfirmation />
        </div>
      ) : null}
      <LoginForm next={typeof next === "string" ? next : undefined} />
    </>
  );
}
