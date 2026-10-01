"use client";

import { useActionState } from "react";
import { FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { resendConfirmation } from "../actions";

/** Sends a fresh confirmation link (links work once and expire). */
export function ResendConfirmation({ email, next }: { email?: string; next?: string }) {
  const [state, action] = useActionState(resendConfirmation, undefined);
  return (
    <form action={action} className="mt-4 flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <label htmlFor="resend-email" className="text-[13px] font-medium">
        Resend confirmation email
      </label>
      <div className="flex gap-2">
        <Input id="resend-email" name="email" type="email" autoComplete="email" required defaultValue={state?.data?.email ?? email} />
        <SubmitButton variant="secondary" pendingLabel="Sending…">
          Send link
        </SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
