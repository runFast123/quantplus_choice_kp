"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signUp } from "../actions";

export function SignupForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signUp, undefined);

  if (state?.ok) {
    return (
      <div className="panel p-5">
        <p className="display text-[22px]">Check your inbox.</p>
        <p className="mt-2 text-[14px] text-muted-foreground">{state.message} Open it on this device to finish setting up.</p>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field label="Full name" htmlFor="full_name">
        <Input id="full_name" name="full_name" autoComplete="name" required defaultValue={state?.data?.full_name} />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required defaultValue={state?.data?.email} />
      </Field>
      <Field label="Password" htmlFor="password" hint="At least 8 characters.">
        <Input id="password" name="password" type="password" autoComplete="new-password" minLength={8} required />
      </Field>

      <fieldset className="mt-1 flex flex-col gap-2.5">
        <legend className="sr-only">Consents</legend>
        <label className="flex items-start gap-2.5 text-[13px] leading-5 text-muted-foreground">
          <input type="checkbox" name="terms" className="mt-0.5 size-4 accent-[var(--primary)]" required />
          <span>
            I agree to the{" "}
            <Link href="/legal/terms" className="text-foreground underline underline-offset-4">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/legal/privacy" className="text-foreground underline underline-offset-4">
              Privacy Policy
            </Link>
            .
          </span>
        </label>
        <label className="flex items-start gap-2.5 text-[13px] leading-5 text-muted-foreground">
          <input type="checkbox" name="marketing" className="mt-0.5 size-4 accent-[var(--primary)]" />
          <span>Send me the occasional product note. Optional — no market tips, ever.</span>
        </label>
      </fieldset>

      <FormMessage state={state} />
      <SubmitButton size="lg" className="mt-1 w-full" pendingLabel="Creating account…">
        Create account
      </SubmitButton>
    </form>
  );
}
