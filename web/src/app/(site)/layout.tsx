import { SiteFooter, SiteNav } from "@/components/marketing/site-nav";
import { supabaseServer } from "@/lib/supabase/server";

/** How it works, Chrome extension, Pricing and Questions: one page each (ADR-055). Research has the same shell in blog/. */
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
