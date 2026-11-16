import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Playfair_Display } from "next/font/google";
import { ThemeSync } from "@/components/shell/theme-sync";
import { SITE_URL } from "@/lib/env";
import { THEME_SCRIPT } from "@/lib/theme";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
  style: ["normal", "italic"],
  display: "swap",
});
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "QuantsPulse — quant research for Indian equities", template: "%s · QuantsPulse" },
  description:
    "Watchlists, portfolio tracking, price alerts and rule-based signals for NSE stocks. Your holdings stay private — even from your organisation.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E9E4D8" },
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
  ],
};

/**
 * No request data is read here, so pages under this layout can be prerendered (ADR-058). The theme is the
 * `qp_theme` cookie: the inline script puts `light` / `dark` and `color-scheme` on <html> before the first paint,
 * so the server sends the same HTML to everyone. `suppressHydrationWarning` lets React keep what the script set.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-IN" className={`${inter.variable} ${playfair.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
