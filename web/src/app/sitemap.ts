import type { MetadataRoute } from "next";
import { POSTS } from "@/lib/blog/posts";
import { SITE_URL } from "@/lib/env";

// The day the public pages' copy last changed: bump it with a copy change, so crawlers re-read them.
const SITE_UPDATED = "2026-11-12";

// Public pages only: the signed-in app (/app, /admin) is private and not listed.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE_URL, lastModified: SITE_UPDATED, changeFrequency: "weekly", priority: 1 },
    // one page per topic (ADR-055)
    { url: `${SITE_URL}/method`, lastModified: SITE_UPDATED, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/chrome-extension`, lastModified: SITE_UPDATED, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/pricing`, lastModified: SITE_UPDATED, changeFrequency: "monthly", priority: 0.9 },
    { url: `${SITE_URL}/faq`, lastModified: SITE_UPDATED, changeFrequency: "monthly", priority: 0.8 },
    { url: `${SITE_URL}/blog`, lastModified: SITE_UPDATED, changeFrequency: "weekly", priority: 0.8 },
    ...POSTS.map((p) => ({ url: `${SITE_URL}/blog/${p.slug}`, lastModified: p.updated, changeFrequency: "monthly" as const, priority: 0.7 })),
    { url: `${SITE_URL}/legal/terms`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/legal/privacy`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
