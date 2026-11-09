"use client";

import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/ui/button";

/**
 * What a page shows when it fails to load (the route's error.tsx), in place of Next's bare "Application error".
 * Production hides the server's message; `digest` matches the line in the server logs, so it's shown as a reference.
 */
export function ErrorScreen({
  error,
  retry,
  home,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  home: { href: string; label: string };
}) {
  const [trying, setTrying] = useState(false);
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-lg flex-col items-start gap-3 px-1 py-16" data-testid="error-screen">
      <p className="display text-[28px] leading-tight text-foreground">This page didn&apos;t load.</p>
      <p className="text-[14px] leading-6 text-muted-foreground">
        That&apos;s on our side, and nothing you saved was lost. It&apos;s usually a slow moment on the server, so trying
        again tends to work.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={trying}
          onClick={() => {
            setTrying(true);
            retry();
            setTimeout(() => setTrying(false), 1500);
          }}
        >
          <ArrowClockwiseIcon size={16} aria-hidden className={trying ? "motion-safe:animate-spin" : undefined} />
          {trying ? "Trying again…" : "Try again"}
        </Button>
        <ButtonLink href={home.href} variant="secondary">
          {home.label}
        </ButtonLink>
      </div>
      {error.digest ? <p className="num mt-4 text-[12px] text-muted-foreground">Reference {error.digest}</p> : null}
    </div>
  );
}
