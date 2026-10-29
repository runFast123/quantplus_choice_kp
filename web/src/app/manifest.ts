import type { MetadataRoute } from "next";

/**
 * Install metadata: lets QuantsPulse be added to a home screen, which iOS requires before a web
 * app may show push notifications. Icons come from scripts/brand-icons.mts.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QuantsPulse",
    short_name: "QuantsPulse",
    description: "Rule-based research, watchlists and price alerts for NSE stocks.",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    background_color: "#E9E4D8",
    theme_color: "#E9E4D8",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
