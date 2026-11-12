import type { Metadata } from "next";
import { FAQ, FaqList, JsonLd, MorePages, PageHead } from "@/components/marketing/sections";

const TITLE = "Questions: advice, data, the extension, privacy";
const DESCRIPTION =
  "Is it investment advice? Where do the NSE prices come from? How does the Chrome extension work with your broker? Can your firm see your portfolio? Plain answers to the questions people ask.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "/faq" },
  openGraph: { type: "website", title: TITLE, description: DESCRIPTION, url: "/faq", siteName: "QuantsPulse", locale: "en_IN" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function FaqPage() {
  return (
    <main className="mx-auto max-w-[1240px] px-5 pb-24 pt-10 md:px-8 md:pt-16">
      <JsonLd
        name="Questions"
        path="/faq"
        extra={[
          {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: FAQ.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
          },
        ]}
      />
      <PageHead
        eyebrow="Questions"
        title="Questions people ask about QuantsPulse"
        lead="Short answers: QuantsPulse is research, not investment advice; prices are end-of-day NSE closes from Yahoo Finance, loaded about 5 pm IST each weekday; the Chrome extension only reads your broker's page; and nobody at your firm, or ours, can open your portfolio."
      />
      <div className="mt-12 grid gap-4 md:grid-cols-[220px_1fr]">
        <span aria-hidden />
        <div className="reveal">
          <FaqList level={2} />
        </div>
      </div>
      <section aria-label="More pages" className="mt-24">
        <MorePages current="/faq" title="Keep reading" />
      </section>
    </main>
  );
}
