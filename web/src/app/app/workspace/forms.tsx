"use client";

import { CopyIcon, CheckIcon } from "@phosphor-icons/react";
import { useState, useTransition } from "react";
import { useEchoAction } from "@/components/ui/use-echo-action";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { changeRoleAction, createOrgAction, inviteAction, renameWorkspace } from "./actions";

export function CreateOrgForm() {
  const [state, action, , values] = useEchoAction(createOrgAction);
  const [slug, setSlug] = useState("");
  const [touched, setTouched] = useState(false);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <Field label="Organisation name" htmlFor="org-name">
        <Input
          id="org-name"
          name="name"
          defaultValue={values.name}
          required
          maxLength={120}
          placeholder="Acme Advisory"
          onChange={(e) =>
            !touched &&
            setSlug(
              e.target.value
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, "")
                .slice(0, 48),
            )
          }
        />
      </Field>
      <Field label="Address" htmlFor="org-slug" hint="Lowercase letters, numbers and hyphens.">
        <Input
          id="org-slug"
          name="slug"
          required
          value={slug}
          onChange={(e) => {
            setTouched(true);
            setSlug(e.target.value);
          }}
          className="num"
          placeholder="acme-advisory"
        />
      </Field>
      <div className="flex flex-col gap-3 sm:col-span-2">
        <FormMessage state={state} />
        <SubmitButton className="w-fit" pendingLabel="Creating…">
          Create organisation
        </SubmitButton>
      </div>
    </form>
  );
}

export function InviteForm({ canInviteAdmin }: { canInviteAdmin: boolean }) {
  const [state, action, , values] = useEchoAction(inviteAction);
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3">
      <form action={action} className="grid gap-3 sm:grid-cols-[1fr_140px_auto] sm:items-end">
        <Field label="Email" htmlFor="invite-email">
          <Input id="invite-email" name="email" type="email" required placeholder="colleague@firm.in" defaultValue={values.email} />
        </Field>
        <Field label="Role" htmlFor="invite-role">
          <Select id="invite-role" name="role" defaultValue={values.role ?? "member"} key={values.role ?? "member"}>
            <option value="member">Member</option>
            {canInviteAdmin ? <option value="admin">Admin</option> : null}
          </Select>
        </Field>
        <SubmitButton pendingLabel="Creating…">Create invite</SubmitButton>
      </form>
      <FormMessage state={state} />
      {state?.data?.link ? (
        <div className="flex items-center gap-2">
          <Input readOnly value={state.data.link} className="num text-[12px]" aria-label="Invitation link" onFocus={(e) => e.currentTarget.select()} />
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(state.data!.link);
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            }}
            className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-[13px] hover:bg-accent"
          >
            {copied ? <CheckIcon size={14} aria-hidden /> : <CopyIcon size={14} aria-hidden />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function RoleSelect({ userId, role, disabled }: { userId: string; role: "member" | "admin"; disabled?: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const [value, setValue] = useState(role);
  return (
    <span className="inline-flex flex-col">
      <Select
        aria-label="Role"
        className="h-8 w-[110px] text-[12.5px]"
        value={value}
        disabled={disabled || pending}
        onChange={(e) => {
          const next = e.target.value as "member" | "admin";
          const prev = value;
          setValue(next);
          start(async () => {
            const r = await changeRoleAction(userId, next);
            setError(r?.error);
            if (r?.error) setValue(prev); // show the role that's actually saved
          });
        }}
      >
        <option value="member">Member</option>
        <option value="admin">Admin</option>
      </Select>
      {error ? <span className="mt-1 text-[11px] text-loss">{error}</span> : null}
    </span>
  );
}

export function RenameForm({ name }: { name: string }) {
  const [state, action, , values] = useEchoAction(renameWorkspace);
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex gap-2">
        <label htmlFor="ws-name" className="sr-only">
          Workspace name
        </label>
        <Input id="ws-name" name="name" defaultValue={values.name ?? name} maxLength={120} />
        <SubmitButton variant="secondary">Rename</SubmitButton>
      </div>
      <FormMessage state={state} />
    </form>
  );
}
