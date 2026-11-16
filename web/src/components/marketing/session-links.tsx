"use client";

import type { ComponentProps } from "react";
import { ButtonLink } from "@/components/ui/button";
import { useSignedIn } from "@/lib/supabase/use-signed-in";

/**
 * The few parts of the public pages that depend on being signed in (ADR-058). The pages are prerendered, so the
 * HTML always shows the signed-out buttons (what a crawler should see); these swap once the page is live in the
 * browser. They learn one thing only: whether there is a session.
 */

/** The header's account buttons: "Sign in" + "Open an account", or "Open the desk". Same height either way. */
export function AccountButtons() {
  const signedIn = useSignedIn();
  return (
    <div className="flex items-center gap-2" data-testid="account-buttons">
      {signedIn ? (
        <ButtonLink key="desk" href="/app" size="sm">
          Open the desk
        </ButtonLink>
      ) : (
        <>
          <ButtonLink key="login" href="/login" size="sm" variant="ghost">
            Sign in
          </ButtonLink>
          <ButtonLink key="signup" href="/signup" size="sm">
            Open an account
          </ButtonLink>
        </>
      )}
    </div>
  );
}

/**
 * A button that goes somewhere else (and may read differently) when you are signed in. The signed-out label stays
 * in place, unseen, under the signed-in one, so the button keeps its size and nothing beside it moves.
 */
export function SessionButtonLink({
  signedInHref,
  signedInLabel,
  href,
  children,
  ...rest
}: ComponentProps<typeof ButtonLink> & { signedInHref: string; signedInLabel?: string }) {
  const signedIn = useSignedIn();
  return (
    <ButtonLink href={signedIn ? signedInHref : href} {...rest}>
      {signedIn && signedInLabel ? (
        <span className="grid place-items-center">
          <span aria-hidden className="invisible col-start-1 row-start-1">
            {children}
          </span>
          <span className="col-start-1 row-start-1">{signedInLabel}</span>
        </span>
      ) : (
        children
      )}
    </ButtonLink>
  );
}
