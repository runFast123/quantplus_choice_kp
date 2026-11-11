import type { Metadata } from "next";
import { ExtensionBody, JsonLd, MorePages, PageHead } from "@/components/marketing/sections";

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
      <JsonLd name="Chrome extension" path="/chrome-extension" />
      <PageHead
        eyebrow="Chrome extension"
        title="Your research desk, overlaid on your broker's charts."
        lead="No more switching tabs. The QuantsPulse Chrome extension adds a small signal bar to your broker's chart, and a side panel with the details."
      />
      <ExtensionBody />
      <section aria-label="More pages" className="mt-24">
        <MorePages current="/chrome-extension" />
      </section>
    </main>
  );
}
