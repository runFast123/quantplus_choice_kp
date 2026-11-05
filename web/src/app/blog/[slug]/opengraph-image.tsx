import { ImageResponse } from "next/og";
import { BLOG_DATA } from "@/lib/blog/data";
import { POSTS, postBySlug } from "@/lib/blog/posts";

// The share card of each post: its title and the one number that sums up the test. Raw colours here because an
// image has no CSS variables: Zen Linen light (MASTER.md) and the validated blog series pair.
export const alt = "QuantsPulse research note";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const post = postBySlug((await params).slug)!;
  const d = BLOG_DATA[post.rule];
  const stat = (v: number, label: string, color: string) => (
    <div style={{ display: "flex", flexDirection: "column" }}>
      <div style={{ fontSize: 76, color, lineHeight: 1 }}>{`${Math.round(v)}%`}</div>
      <div style={{ fontSize: 24, color: "#5E5A52", marginTop: 10 }}>{label}</div>
    </div>
  );
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#E9E4D8", padding: "56px 64px" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 26, color: "#1E1E1E" }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#F26A4B", marginRight: 12 }} />
          QuantsPulse research notes
        </div>
        <div style={{ fontSize: 54, lineHeight: 1.15, color: "#1E1E1E", marginTop: 36, maxWidth: 1040 }}>{post.title}</div>
        <div style={{ display: "flex", marginTop: "auto", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 64 }}>
            {stat(d.ours.all.made_money_pct, `${post.ruleName}: trades that made money`, "#2F62A3")}
            {stat(d.usual.all.made_money_pct, post.usualName, "#9A7414")}
          </div>
          <div style={{ fontSize: 22, color: "#5E5A52" }}>NSE stocks, 2019 to 2026, after costs</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
