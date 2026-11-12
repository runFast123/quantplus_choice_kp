import type { Metadata } from "next";
import { FALLBACK_PLANS, JsonLd, MorePages, ORGANIZATION, PageHead, PricingCards } from "@/components/marketing/sections";
import { SITE_URL } from "@/lib/env";
import { supabaseServer } from "@/lib/supabase/server";
import type { Plan } from "@/lib/types";

const TITLE = "Pricing: Basic, Pro and Pro Plus, in rupees";
const DESCRIPTION =
  "Every account starts on Basic, free for three months: a 10-stock radar, rule-based signals and research on every NSE listing. Pro and Pro Plus add a portfolio, price alerts, scanning and your own AI key.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/pricing" },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: "/pricing", siteName: "QuantsPulse", locale: "en_IN" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default async function PricingPage() {
  const supabase = await supabaseServer();
  const [{ data: claims }, { data }] = await Promise.all([supabase.auth.getClaims(), supabase.from("plans").select("*").order("price_paise_yearly")]);
  const plans = (data?.length ? data : FALLBACK_PLANS) as Plan[];
  return (
    <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-10 md:px-8 md:pt-16">
      <JsonLd
        name="Pricing"
        path="/pricing"
        extra={[
          {
            "@context": "https://schema.org",
            "@type": "SoftwareApplication",
            name: "QuantsPulse",
            applicationCategory: "FinanceApplication",
            operatingSystem: "Web",
            url: SITE_URL,
            publisher: { "@id": ORGANIZATION["@id"] },
            offers: plans.map((p) => ({
              "@type": "Offer",
              name: p.name,
              price: (p.price_paise_yearly / 100).toFixed(2),
              priceCurrency: "INR",
              url: `${SITE_URL}/pricing`,
              description: p.price_paise_yearly ? `${p.name}, billed yearly` : `${p.name}, free for the first three months`,
            })),
          },
        ]}
      />
      <section id="pricing">
        <PageHead eyebrow="Pricing" title="Priced by the year, in rupees." lead="QuantsPulse has three yearly plans in rupees: Basic, free for the first three months, then Pro and Pro Plus for a bigger radar, a portfolio, price alerts, scanning and your own AI key." />
        <PricingCards plans={plans} signedIn={Boolean(claims?.claims?.sub)} />
        <p className="mt-8 text-[12.5px] leading-5 text-muted-foreground">No card needed to start. Prices are per year, in Indian rupees.</p>
      </section>
      <section aria-label="More pages" className="mt-24">
        <MorePages current="/pricing" title="Keep reading" />
      </section>
    </main>
  );
}
