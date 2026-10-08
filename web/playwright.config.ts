import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests against a running build (`npm run build` first).
 * Uses the locally installed Google Chrome (channel "chrome") — no browser
 * download needed. Test users are created and deleted automatically.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
// Point at a deployment instead of a local build: E2E_BASE_URL=https://quantplus-ten.vercel.app
const REMOTE = process.env.E2E_BASE_URL;
const BASE_URL = REMOTE ?? `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  fullyParallel: false,
  workers: 2,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    channel: "chrome",
    trace: process.env.CI ? "retain-on-failure" : "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome", viewport: { width: 390, height: 844 } }, grep: /@mobile/ },
  ],
  webServer: REMOTE
    ? undefined
    : {
        command: `npx.cmd next start -p ${PORT}`,
        url: `http://localhost:${PORT}/login`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
