"use client";

import Link from "next/link";
import { useActionState } from "react";
import { askMyAi } from "@/app/app/research/actions";
import { SubmitButton } from "@/components/ui/submit-button";

export function AiRead({ symbol, ready, reason }: { symbol: string; ready: boolean; reason?: string }) {
  const [state, action] = useActionState(askMyAi, undefined);

  if (!ready) {
    return (
      <p className="text-[12.5px] leading-5 text-muted-foreground">
        {reason}{" "}
        <Link href="/app/integrations" className="text-foreground underline underline-offset-4">
          Integrations
        </Link>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      <form action={action}>
        <input type="hidden" name="symbol" value={symbol} />
        <SubmitButton variant="secondary" size="sm" pendingLabel="Reading the tape…">
          Ask my AI for a read
        </SubmitButton>
      </form>
      {state?.error ? (
        <p role="alert" className="text-[12.5px] text-loss">
          {state.error}
        </p>
      ) : null}
      {state?.text ? (
        <figure className="rounded-md border border-border bg-background/50 p-4">
          <div className="whitespace-pre-line text-[13.5px] leading-6">{state.text}</div>
          <figcaption className="mt-3 text-[11.5px] text-muted-foreground">
            Written by <span className="num">{state.model}</span> with your key from the facts above. Not stored. Not advice.
          </figcaption>
        </figure>
      ) : null}
    </div>
  );
}
