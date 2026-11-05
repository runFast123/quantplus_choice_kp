import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/env";

// Search and answer engines may read the public pages; the signed-in app, the console and the API are off limits.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app", "/admin", "/api/", "/auth/", "/invite/", "/device"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
