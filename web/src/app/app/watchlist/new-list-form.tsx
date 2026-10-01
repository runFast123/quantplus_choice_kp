"use client";

import { PlusIcon } from "@phosphor-icons/react";
import { useActionState, useState } from "react";
import type { ActionState } from "@/lib/errors";
import { Input } from "@/components/ui/field";
import { createWatchlist } from "./actions";

export function NewListForm() {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(async (prev: ActionState, fd: FormData) => {
    const r = await createWatchlist(prev, fd);
    if (r?.ok) setOpen(false);
    return r;
  }, undefined);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-[13px] text-muted-foreground hover:border-muted-foreground/60 hover:text-foreground"
      >
        <PlusIcon size={13} aria-hidden /> New list
      </button>
    );
  }
  return (
    <form action={action} className="flex items-center gap-1.5">
      <label htmlFor="new-list" className="sr-only">
        List name
      </label>
      <Input id="new-list" name="name" autoFocus maxLength={80} placeholder="e.g. Banks" className="h-8 w-40 text-[13px]" onKeyDown={(e) => e.key === "Escape" && setOpen(false)} />
      <button type="submit" disabled={pending} className="h-8 rounded-md bg-primary px-3 text-[13px] text-primary-foreground">
        Create
      </button>
      {state?.error ? (
        <span role="alert" className="text-[12px] text-loss">
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
