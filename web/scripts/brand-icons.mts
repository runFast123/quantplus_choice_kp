/**
 * Renders the QuantsPulse mark (a Q whose tail ends in the coral signal dot) to every PNG the
 * app and the Chrome extension need. The SVG source of truth is src/app/icon.svg; LogoMark in
 * src/components/brand/logo.tsx draws the same geometry with theme tokens.
 *
 *   npx tsx scripts/brand-icons.mts        (uses the installed Chrome, like the e2e suite)
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "@playwright/test";

const INK = "#E6E4D7";
const BG = "#2E2E2E";
const CORAL = "#F26A4B";
const MARK = `
  <circle cx="14.5" cy="14.5" r="7.2" fill="none" stroke="${INK}" stroke-width="2.6"/>
  <path d="M16.6 16.6L22.2 22.2" stroke="${INK}" stroke-width="2.6" stroke-linecap="round"/>
  <circle cx="24.5" cy="24.5" r="2.7" fill="${CORAL}"/>`;

// The tail cuts into the bowl (a Q), not out from its edge (a magnifier).
// rounded: the tile with transparent corners (favicon look). bleed: full square, for platforms that
// mask the icon themselves (Apple touch icon, Android maskable) — the mark shrinks into the safe zone.
type Variant = "rounded" | "bleed" | "mono";
// mono: white silhouette on transparent — Android tints notification badges and reads only alpha.
const svg = (variant: Variant) =>
  variant === "mono"
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${MARK.replaceAll(INK, "#FFFFFF").replace(CORAL, "#FFFFFF")}</svg>`
    : variant === "rounded"
    ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect x="1" y="1" width="30" height="30" rx="7" fill="${BG}"/>${MARK}</svg>`
    : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${BG}"/><g transform="translate(16 16) scale(0.78) translate(-16 -16)">${MARK}</g></svg>`;

const root = join(import.meta.dirname, "..");
const outputs: { file: string; size: number; variant: Variant }[] = [
  { file: "src/app/apple-icon.png", size: 180, variant: "bleed" },
  { file: "public/icons/icon-192.png", size: 192, variant: "rounded" },
  { file: "public/icons/icon-512.png", size: 512, variant: "rounded" },
  { file: "public/icons/icon-maskable-512.png", size: 512, variant: "bleed" },
  { file: "public/icons/badge-72.png", size: 72, variant: "mono" },
  ...[16, 32, 48, 128].map((size) => ({ file: `../extension/icons/icon${size}.png`, size, variant: "rounded" as const })),
];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const { file, size, variant } of outputs) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<html><body style="margin:0;background:transparent">${svg(variant).replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`,
  );
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  await page.locator("svg").screenshot({ path, omitBackground: true });
  console.log(`${file} (${size}px, ${variant})`);
}
await browser.close();
