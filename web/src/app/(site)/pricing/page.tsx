import type { Metadata } from "next";
import { FALLBACK_PLANS, JsonLd, MorePages, ORGANIZATION, PageHead, PricingCards } from "@/components/marketing/sections";
import { SITE_URL } from "@/lib/env";
import { supabasePublic } from "@/lib/supabase/public";
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

// Prerendered, and rebuilt in the background at most once an hour (ADR-058): a price change shows within the hour.
export const revalidate = 3600;

/** The plan list is public (anon may read `plans`), so no cookies; the built-in list if the database can't be reached. */
async function publicPlans(): Promise<Plan[]> {
  try {
    const { data } = await supabasePublic().from("plans").select("*").order("price_paise_yearly").abortSignal(AbortSignal.timeout(8000));
    if (data?.length) return data as Plan[];
  } catch {
    // fall through: the page must build and revalidate without the database
  }
  return FALLBACK_PLANS;
}

export default async function PricingPage() {
  const plans = await publicPlans();
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
        <PricingCards plans={plans} />
        <p className="mt-8 text-[12.5px] leading-5 text-muted-foreground">No card needed to start. Prices are per year, in Indian rupees.</p>
      </section>
      <section aria-label="More pages" className="mt-24">
        <MorePages current="/pricing" title="Keep reading" />
      </section>
    </main>
  );
}
