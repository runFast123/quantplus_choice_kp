import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Playfair_Display } from "next/font/google";
import { cookies } from "next/headers";
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
  title: { default: "QuantsPulse — quant research for Indian equities", template: "%s · QuantsPulse" },
  description:
    "Watchlists, portfolio tracking, price alerts and rule-based signals for NSE and BSE stocks. Your holdings stay private — even from your organisation.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#E9E4D8" },
    { media: "(prefers-color-scheme: dark)", color: "#141414" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = (await cookies()).get("qp_theme")?.value === "dark" ? "dark" : "light";
  return (
    <html
      lang="en-IN"
      className={`${inter.variable} ${playfair.variable} ${jetbrains.variable} ${theme}`}
      style={{ colorScheme: theme }}
    >
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
