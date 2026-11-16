import { SiteFooter, SiteNav } from "@/components/marketing/site-nav";

/**
 * Every public page: home, Method, Chrome extension, Pricing, Questions and Research (ADR-055). One shared
 * layout so the header and the liquid navbar stay mounted between pages; template.tsx animates the page itself.
 * It reads nothing from the request, so these pages are prerendered (ADR-058); the header's account buttons find
 * out about a session in the browser.
 */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="linen min-h-dvh">
      <SiteNav />
      {children}
      <SiteFooter />
    </div>
  );
}
