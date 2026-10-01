"use client";

import { useActionState, useOptimistic, useState, useTransition } from "react";
import { useEchoAction } from "@/components/ui/use-echo-action";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { changePassword, deleteMyAccount, setConsent, updateProfile } from "./actions";

export function ProfileForm({ fullName, phone, email }: { fullName: string; phone: string; email: string }) {
  const [state, action, , values] = useEchoAction(updateProfile);
  return (
    <form action={action} className="flex max-w-lg flex-col gap-4">
      <Field label="Email" htmlFor="email" hint="Your sign-in address. Contact support to change it.">
        <Input id="email" value={email} readOnly disabled />
      </Field>
      <Field label="Full name" htmlFor="full_name">
        <Input id="full_name" name="full_name" defaultValue={values.full_name ?? fullName} maxLength={120} autoComplete="name" />
      </Field>
      <Field label="Mobile" htmlFor="phone" hint="Used only for payment follow-ups.">
        <Input id="phone" name="phone" defaultValue={values.phone ?? phone} inputMode="tel" autoComplete="tel" placeholder="+91" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-fit">Save profile</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, action] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="flex max-w-lg flex-col gap-4">
      <Field label="New password" htmlFor="password">
        <Input id="password" name="password" type="password" minLength={8} autoComplete="new-password" required />
      </Field>
      <Field label="Confirm" htmlFor="confirm">
        <Input id="confirm" name="confirm" type="password" minLength={8} autoComplete="new-password" required />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-fit">Update password</SubmitButton>
    </form>
  );
}

export function ConsentSwitch({ purpose, granted, required, title, body, since }: {
  purpose: string;
  granted: boolean;
  required?: boolean;
  title: string;
  body: string;
  since?: string;
}) {
  const [on, setOn] = useOptimistic(granted);
  const [, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="flex items-start justify-between gap-6 py-4">
      <div>
        <p className="text-[14px] font-medium">
          {title}
          {required ? <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">required</span> : null}
        </p>
        <p className="mt-0.5 max-w-xl text-[13px] leading-5 text-muted-foreground">{body}</p>
        {since ? <p className="mt-1 text-[11.5px] text-muted-foreground">{since}</p> : null}
        {error ? (
          <p role="alert" className="mt-1 text-[12px] text-loss">
            {error}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={title}
        disabled={required && on}
        onClick={() =>
          start(async () => {
            setOn(!on);
            const r = await setConsent(purpose, !on);
            setError(r?.error);
          })
        }
        className="relative mt-1 h-[22px] w-10 shrink-0 rounded-full transition-colors disabled:opacity-60 data-[on=true]:bg-primary data-[on=false]:bg-foreground/15"
        data-on={on}
      >
        <span className={`absolute top-[3px] size-4 rounded-full bg-card shadow-sm transition-transform duration-150 ${on ? "translate-x-[21px]" : "translate-x-[3px]"}`} />
      </button>
    </div>
  );
}

export function DeleteAccountForm() {
  const [state, action] = useActionState(deleteMyAccount, undefined);
  return (
    <form action={action} className="flex max-w-lg flex-col gap-3">
      <Field label='Type "DELETE" to confirm' htmlFor="confirm-delete">
        <Input id="confirm-delete" name="confirm" autoComplete="off" className="num" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton variant="danger" className="w-fit" pendingLabel="Deleting…">
        Delete my account
      </SubmitButton>
    </form>
  );
}
