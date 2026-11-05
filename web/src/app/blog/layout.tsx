import { SiteFooter, SiteNav } from "@/components/marketing/site-nav";
import { supabaseServer } from "@/lib/supabase/server";

export default async function BlogLayout({ children }: { children: React.ReactNode }) {
  const { data } = await (await supabaseServer()).auth.getClaims();
  return (
    <div className="linen min-h-dvh">
      <SiteNav signedIn={Boolean(data?.claims?.sub)} />
      {children}
      <SiteFooter />
    </div>
  );
}
