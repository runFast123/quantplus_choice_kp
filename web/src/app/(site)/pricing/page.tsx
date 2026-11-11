import type { Metadata } from "next";
import { FALLBACK_PLANS, JsonLd, MorePages, PageHead, PricingCards } from "@/components/marketing/sections";
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
      <JsonLd name="Pricing" path="/pricing" />
      <section id="pricing">
        <PageHead eyebrow="Pricing" title="Priced by the year, in rupees." lead="Every account starts on Basic for three months. Upgrade when the radar gets crowded." />
        <PricingCards plans={plans} signedIn={Boolean(claims?.claims?.sub)} />
        <p className="mt-8 text-[12.5px] leading-5 text-muted-foreground">No card needed to start. Prices are per year, in Indian rupees.</p>
      </section>
      <section aria-label="More pages" className="mt-24">
        <MorePages current="/pricing" />
      </section>
    </main>
  );
}
