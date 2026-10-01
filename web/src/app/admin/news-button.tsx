"use client";

import { useActionState } from "react";
import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { fetchNewsNow } from "./actions";

export function FetchNewsButton() {
  const [state, action] = useActionState(fetchNewsNow, undefined);
  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <SubmitButton size="sm" variant="secondary" pendingLabel="Fetching feeds…">
        Fetch news now
      </SubmitButton>
      <FormMessage state={state} />
    </form>
  );
}
