"use client";

import { ErrorScreen } from "@/components/ui/error-screen";

/** A signed-in page that failed to load: shown inside the app's menu, with Try again. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} home={{ href: "/app", label: "Go to Overview" }} />;
}
