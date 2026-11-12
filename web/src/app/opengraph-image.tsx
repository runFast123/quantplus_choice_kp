import { ImageResponse } from "next/og";

// The share card for every public page that has none of its own (the research notes have theirs). Raw colours because
// an image has no CSS variables: Zen Linen light (MASTER.md), coral as decoration only.
export const alt = "QuantsPulse: rule-based research on NSE stocks";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#E9E4D8", padding: "56px 64px" }}>
        <div style={{ display: "flex", alignItems: "center", fontSize: 28, color: "#1E1E1E" }}>
          <div style={{ width: 14, height: 14, borderRadius: 7, background: "#F26A4B", marginRight: 12 }} />
          QuantsPulse
        </div>
        <div style={{ fontSize: 64, lineHeight: 1.1, color: "#1E1E1E", marginTop: 48, maxWidth: 1000 }}>
          Six published rules check your NSE stocks after every close.
        </div>
        <div style={{ fontSize: 28, lineHeight: 1.4, color: "#5E5A52", marginTop: 28, maxWidth: 980 }}>
          Signals with a safety stop and a plan, on your broker&apos;s chart. Research, not advice.
        </div>
        <div style={{ display: "flex", marginTop: "auto", fontSize: 22, color: "#5E5A52" }}>End-of-day NSE prices · tested on past prices, after costs</div>
      </div>
    ),
    size,
  );
}
