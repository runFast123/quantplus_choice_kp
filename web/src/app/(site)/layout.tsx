import { SiteFooter, SiteNav } from "@/components/marketing/site-nav";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Every public page: home, How it works, Chrome extension, Pricing, Questions and Research (ADR-055). One shared
 * layout so the header and the liquid navbar stay mounted between pages; template.tsx animates the page itself.
 */
export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const { data } = await (await supabaseServer()).auth.getClaims();
  return (
    <div className="linen min-h-dvh">
      <SiteNav signedIn={Boolean(data?.claims?.sub)} />
      {children}
      <SiteFooter />
    </div>
  );
}
