import { SITE_URL } from "@/lib/env";

/** The one-line definition of QuantsPulse, reused word for word (home, structured data, llms.txt) so search and AI
 * engines see one consistent entity. */
export const DEFINITION =
  "QuantsPulse is a research tool for NSE-listed stocks: six published rules check every stock on your watchlist after each market close and show the result as a signal, with a safety stop and a plan. It is research, not investment advice, and it never places orders.";

export const ORGANIZATION = {
  "@context": "https://schema.org",
  "@type": "Organization",
  "@id": `${SITE_URL}/#org`,
  name: "QuantsPulse",
  url: SITE_URL,
  logo: `${SITE_URL}/apple-icon.png`,
  description: DEFINITION,
  areaServed: "IN",
};
