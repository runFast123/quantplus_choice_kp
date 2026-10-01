"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { signIn } from "../actions";
import { ResendConfirmation } from "./resend-form";

export function LoginForm({ next }: { next?: string }) {
  const [state, action] = useActionState(signIn, undefined);
  return (
    <>
    <form action={action} className="flex flex-col gap-4" noValidate>
      <input type="hidden" name="next" value={next ?? "/app"} />
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          defaultValue={state?.data?.email}
          aria-invalid={Boolean(state?.error)}
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        hint={
          <Link href="/forgot" className="underline decoration-border underline-offset-4 hover:decoration-foreground">
            Forgot your password?
          </Link>
        }
      >
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={Boolean(state?.error)} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton size="lg" className="mt-1 w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
    {/* Sibling, not nested: forms can't contain forms. */}
    {state?.data?.unconfirmed ? <ResendConfirmation email={state.data.email} next={next} /> : null}
    </>
  );
}
