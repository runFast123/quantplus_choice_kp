"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

function Banner() {
  if (!useSearchParams().get("deleted")) return null;
  return (
    <p role="status" className="bg-primary px-5 py-2 text-center text-[13px] text-primary-foreground">
      Your account and personal workspace have been deleted.
    </p>
  );
}

/**
 * The note you land on after deleting your account (`/?deleted=1`). It reads the address in the browser, inside
 * its own Suspense boundary, so the home page itself stays prerendered (ADR-058).
 */
export function DeletedBanner() {
  return (
    <Suspense fallback={null}>
      <Banner />
    </Suspense>
  );
}
