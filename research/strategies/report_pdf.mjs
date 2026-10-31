// Prints data/report.html to a PDF with the installed Chrome (the e2e suite's browser). Usage: node report_pdf.mjs <out.pdf> <repo root>
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const [out, repo] = process.argv.slice(2);
const require = createRequire(join(repo, "web/package.json"));
const pw = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const chromium = pw.chromium ?? pw.default.chromium;
const here = dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
await page.setContent(readFileSync(join(here, "data", "report.html"), "utf8"), { waitUntil: "load" });
await page.pdf({ path: out, format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log("pdf", out);
