import type { Metadata } from "next";
import { ExtensionBody, JsonLd, MorePages, ORGANIZATION, PageHead } from "@/components/marketing/sections";
import { SITE_URL } from "@/lib/env";

const TITLE = "Chrome extension: signals on your broker's chart";
const DESCRIPTION =
  "See each NSE stock's latest rule signal, safety stop and plan on Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan, Fyers, TradingView and more. It only reads the page and never places orders.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/chrome-extension" },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: "/chrome-extension", siteName: "QuantsPulse", locale: "en_IN" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function ChromeExtensionPage() {
  return (
    <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-10 md:px-8 md:pt-16">
      <JsonLd
        name="Chrome extension"
        path="/chrome-extension"
        extra={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "QuantsPulse Chrome extension",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Google Chrome",
            url: `${SITE_URL}/chrome-extension`,
            description: DESCRIPTION,
            publisher: { "@id": ORGANIZATION["@id"] },
            offers: { "@type": "Offer", price: "0", priceCurrency: "INR", description: "Free download; signals need a QuantsPulse account" },
          },
        ]}
      />
      <PageHead
        eyebrow="Chrome extension"
        title="Your research desk, overlaid on your broker's charts."
        lead="The QuantsPulse Chrome extension shows a stock's latest rule signal, its safety stop and its plan on your broker's chart, with a side panel for the details. It only reads the page: it never sees your broker password and never places orders."
      />
      <ExtensionBody />
      <section aria-label="More pages" className="mt-24">
        <MorePages current="/chrome-extension" title="Keep reading" />
      </section>
    </main>
  );
}
