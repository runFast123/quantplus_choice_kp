import { expect, test } from "./helpers/fixtures";

/**
 * The Chrome extension's endpoints. The extension's background worker gets an access token from the
 * website's cookie session; that token must reach only a chrome-extension:// origin. Quotes must show
 * stored rule signals only, and a trade plan only while the latest signal is an open long entry.
 */
const EXT = "chrome-extension://abcdefghijklmnopabcdefghijklmnop";
const KINDS = ["buy", "sell", "exit", "cover"];
const STRATEGIES = ["sma_20_50_cross", "rsi_reversal", "kk_breakout", "strong_trend", "rsi_dip", "kk_dip"];

test.describe("extension API", () => {
  test("signed out: no quote, no session, no cross-site access", async ({ request }) => {
    expect((await request.get("/api/extension/quote?symbol=TCS")).status()).toBe(401);
    const s = await request.get("/api/extension/session", { headers: { origin: "https://evil.example" } });
    expect(await s.json()).toMatchObject({ authenticated: false });
    expect(s.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("the session token goes to the extension and never to a web page", async ({ proPage }) => {
    const fromExtension = await proPage.request.get("/api/extension/session", { headers: { origin: EXT } });
    const ext = await fromExtension.json();
    expect(ext.authenticated).toBe(true);
    expect(typeof ext.token).toBe("string");
    expect(fromExtension.headers()["access-control-allow-origin"]).toBe(EXT);
    expect(fromExtension.headers()["access-control-allow-credentials"]).toBe("true");

    const fromSite = await proPage.request.get("/api/extension/session", { headers: { origin: "https://evil.example" } });
    const site = await fromSite.json();
    expect(site.token).toBeUndefined();
    expect(fromSite.headers()["access-control-allow-origin"]).toBeUndefined();

    // The token works as a Bearer, from any origin (content scripts run with the broker's origin)…
    const quote = await proPage.request.get("/api/extension/quote?symbol=TCS", {
      headers: { authorization: `Bearer ${ext.token}`, origin: "https://kite.zerodha.com" },
    });
    expect(quote.status()).toBe(200);
    expect(quote.headers()["access-control-allow-origin"]).toBe("*");
    // …but that origin never gets cookie credentials.
    expect(quote.headers()["access-control-allow-credentials"]).toBeUndefined();
  });

  test("the extension asks with POST (Chrome sends its Origin only then) and gets the token; a page does not", async ({ proPage }) => {
    const ext = await (await proPage.request.post("/api/extension/session", { headers: { origin: EXT } })).json();
    expect(ext.authenticated).toBe(true);
    expect(typeof ext.token).toBe("string");
    const page = await proPage.request.post("/api/extension/session", { headers: { origin: "https://evil.example" } });
    expect((await page.json()).token).toBeUndefined();
    expect(page.headers()["access-control-allow-origin"]).toBeUndefined();
  });

  test("quotes show stored rule signals only, and a plan only for an open long entry", async ({ proPage }) => {
    const { token } = await (await proPage.request.get("/api/extension/session", { headers: { origin: EXT } })).json();
    for (const symbol of ["TCS", "INFY", "RELIANCE", "HDFCBANK", "SBIN", "NIFTY"]) {
      const res = await proPage.request.get(`/api/extension/quote?symbol=${symbol}`, { headers: { authorization: `Bearer ${token}` } });
      expect(res.status(), symbol).toBe(200);
      const q = await res.json();
      for (const sig of q.recentSignals ?? []) {
        expect(KINDS, `${symbol} kind`).toContain(sig.kind);
        expect(STRATEGIES, `${symbol} strategy`).toContain(sig.strategy);
        if (sig.kind === "exit" || sig.kind === "cover") expect(sig.stop, `${symbol} exit has no stop`).toBeNull();
      }
      if (q.latestSignal) {
        // The panel's story: the stored signal plus what the rule saw and how far price has moved since.
        const { rule, sessionsSince, moveSincePct, ...stored } = q.latestSignal;
        expect(stored).toEqual(q.recentSignals[0]);
        expect(typeof rule, `${symbol} rule`).toBe("string");
        expect(sessionsSince === null || sessionsSince >= 0).toBe(true);
        expect(moveSincePct === null || typeof moveSincePct === "number").toBe(true);
      } else {
        expect(q.recentSignals ?? []).toEqual([]);
      }
      // ~3 months of closes, oldest first, for the price line.
      expect(q.history.length, `${symbol} history`).toBeGreaterThan(20);
      expect(q.history.length).toBeLessThanOrEqual(63);
      const dates = q.history.map((h: { date: string }) => h.date);
      expect([...dates].sort()).toEqual(dates);
      if (q.tradePlan) {
        expect(q.latestSignal?.kind, `${symbol} plan needs an open long`).toBe("buy");
        expect(q.tradePlan.entry).toBe(q.latestSignal.price);
        expect(q.tradePlan.stop).toBe(q.latestSignal.stop);
      }
    }
  });
});
