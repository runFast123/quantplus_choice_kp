"use client";

import { ErrorScreen } from "@/components/ui/error-screen";

/** A public page (home, blog, sign in) that failed to load. */
export default function SiteError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="linen min-h-dvh px-5">
      <ErrorScreen error={error} retry={retry} home={{ href: "/", label: "Go to the home page" }} />
    </div>
  );
}
