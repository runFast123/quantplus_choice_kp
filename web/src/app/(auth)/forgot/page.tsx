"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { sendReset } from "../actions";

export default function ForgotPage() {
  const [state, action] = useActionState(sendReset, undefined);
  return (
    <>
      <h1 className="display text-[34px] leading-tight">Reset your password.</h1>
      <p className="mb-8 mt-2 text-[14px] text-muted-foreground">
        We&apos;ll email a one-time link. Remembered it?{" "}
        <Link href="/login" className="text-foreground underline decoration-border underline-offset-4">
          Sign in
        </Link>
        .
      </p>
      <form action={action} className="flex flex-col gap-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton size="lg" className="w-full" pendingLabel="Sending…">
          Send reset link
        </SubmitButton>
      </form>
    </>
  );
}
