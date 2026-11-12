"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// The home page's old in-page links, now their own pages (ADR-055). A #fragment never reaches the server, so this
// forwards bookmarks and shared links like /#pricing in the browser.
const MOVED: Record<string, string> = {
  "#how": "/method",
  "#terminal": "/chrome-extension",
  "#pricing": "/pricing",
  "#faq": "/faq",
};

export function LegacyHashRedirect() {
  const router = useRouter();
  useEffect(() => {
    const to = MOVED[window.location.hash];
    if (to) router.replace(to);
  }, [router]);
  return null;
}
