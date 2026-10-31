# Decision log (ADRs)

Newest last. Don't silently reverse one — add a new entry that supersedes it.

---

### ADR-001 · Next.js is the Node backend
**Date** 2026-10-01 · **Status** accepted
The spec calls for a Node backend. Server Actions + Route Handlers in `web/` fill that role (per-request RLS client,
privileged modules, encryption). One deployable, one auth cookie, no CORS. A separate worker service is still
expected for market pipelines, broker sync and live alert matching.

### ADR-002 · Zen Linen theme (21st.dev) as the visual base
**Date** 2026-10-01 · **Status** accepted
Owner chose 21st.dev "Zen Linen" (serafimcloud). Tokens copied verbatim; the theme's `@theme inline` font/radius
mapping bug fixed. Added finance tokens `--gain/--loss` validated with the dataviz palette checker
(light `#0F7B5C/#C2410C`, dark `#2BA383/#E0663F`). The ui-ux-pro-max generator's slate/green palette was rejected as generic.

### ADR-003 · Service-only RPC bridge to the `private` schema
**Date** 2026-10-01 · **Status** accepted
`private` must stay unexposed (spec §5.1), which also hides it from the service role over PostgREST. Narrow
`svc_*` SECURITY DEFINER functions, executable only by `service_role`, are the bridge (same pattern as
`admin_activate_plan`). Alternative (direct Postgres connection from Node) rejected: second credential, pooling.

### ADR-004 · Unique keys on child rows include `user_id, tenant_id`
**Date** 2026-10-01 · **Status** accepted
With the spec's `unique (portfolio_id, symbol, exchange)`, Postgres checks uniqueness before the ownership FK, so
inserting into another user's portfolio returned *duplicate key* vs *foreign key* — revealing whether they hold a
symbol. Keys widened to `(portfolio_id, user_id, tenant_id, symbol, exchange)` (same for watchlist items). Same
semantics because the composite FK pins user/tenant. Caught by isolation test 3.

### ADR-005 · Symbol limits count distinct symbols
**Date** 2026-10-01 · **Status** accepted
Spec counted watchlist rows. A symbol already tracked (in another list, or an upsert) no longer consumes a slot.

### ADR-006 · End-of-day notifier in SQL
**Date** 2026-10-01 · **Status** accepted (interim)
No tick worker exists yet. `private.run_eod_notifier()` via pg_cron evaluates alerts on the daily high/low, notifies
holders of exit signals and sends plan-expiry reminders. To be complemented (not replaced) by a live tick worker.

### ADR-007 · Broker connect = manual token paste for now
**Date** 2026-10-01 · **Status** superseded by ADR-025
Per-broker OAuth flows (Kite Connect, SmartAPI, Upstox…) are separate integrations. The storage, encryption, status
and expiry model is built; the UI asks for a client ID + access token. Replace per broker with OAuth.

### ADR-008 · Joining an organisation starts a Basic trial in that workspace
**Date** 2026-10-01 · **Status** accepted (pending spec Open Decision #4)
Subscriptions are per user per tenant; without one, a new member has no features in the org. Mirrors signup.

### ADR-009 · Database tests run on PGlite with a Supabase shim
**Date** 2026-10-01 · **Status** accepted
No Docker on the dev machine. `supabase/tests/harness` stubs `auth`, `storage`, `cron`, roles and default grants,
then runs the real migrations and plain-SQL tests. The same test files run on staging.

### ADR-010 · npm registry mirror
**Date** 2026-10-01 · **Status** accepted (environmental)
`registry.npmjs.org` times out on the office network; `.npmrc` points to `registry.yarnpkg.com` (same packages).

### ADR-011 · Single active device via hashed random cookie
**Date** 2026-10-01 · **Status** accepted
A random `qp_did` cookie (httpOnly) identifies the browser; only its SHA-256 is stored. No fingerprinting.
Registering happens on sign-in/confirm; another device sees a "use this device" takeover screen.

### ADR-012 · Consent withdrawal side-effects run across all workspaces
**Date** 2026-10-01 · **Status** accepted (broker part removed by ADR-025)
Withdrawing `ai_processing` deletes the user's AI keys in every tenant (privileged) — RLS alone would only reach the
active tenant.

### ADR-013 · News from public RSS, linked by rules, toned by a published word list
**Date** 2026-10-01 · **Status** accepted
Owner asked for RSS-driven news feeding research. Feeds are fetched by a service-role pipeline, deduped by normalised
URL hash, matched to stocks by name / curated alias / ticker (with a sibling-entity guard: "NTPC Green" is not NTPC),
and scored with a transparent lexicon whose matched terms are shown to users. Only headline, <=600-char summary and
link are kept — never article bodies.

### ADR-014 · Identify honestly; don't defeat bot protection
**Date** 2026-10-01 · **Status** accepted
User-agent is `QuantsPulseBot`. Moneycontrol and Business Standard return 403 to crawlers and NSE's archive drops
non-browser clients; these sources are disabled (migration 18) rather than spoofing a browser. NSE filings need a
licensed data feed or written permission.

### ADR-015 · Research notes are rule-based and self-explaining
**Date** 2026-10-01 · **Status** accepted
`refresh_research_notes()` scores five factors (trend 30, momentum 20, range 10, signal 15, news 25; filings shown,
unweighted) on -2..+2, composite -100..+100, stance at +/-25. Every factor stores the sentence that produced it. AI is
optional on top (BYOK), never the source of the stance.

### ADR-016 · BYOK AI: Anthropic via the official SDK; nothing stored
**Date** 2026-10-01 · **Status** accepted
Default model `claude-opus-5-5` with `fallbacks: "default"` (refusal-fallback beta), `effort: low`. OpenAI/Gemini need
the user to set a default model. Headlines are passed as delimited data. Only metering goes to `ai_usage_logs`; a
rejected key is marked `invalid`.

### ADR-017 · Mark vs ink colour tokens
**Date** 2026-10-01 · **Status** accepted (supersedes part of ADR-002)
Validated chart colours (`--gain/--loss`) stay for marks; text and badges use darker `--gain-ink/--loss-ink` (light
`#0B6A4E/#A8380B`) and `--coral-ink`, which clear 4.5:1 on linen. Tailwind `text-gain` maps to ink. Found by axe.

### ADR-018 · Secrets: split by blast radius, scanned at commit, build and CI
**Date** 2026-10-01 · **Status** accepted
The web runtime gets no DB password (migrations use `supabase/.env`). Pre-commit hook checks formats and exact local
values; postbuild scans the browser bundle; CI scans history. See `docs/SECURITY.md`.

### ADR-019 · Plan limits confirmed
**Date** 2026-10-01 · **Status** accepted (resolves spec Open Decision #1)
Basic: 10 radar symbols, no portfolio. Pro: 15 / 15. Pro Plus: unlimited. Enforced by `enforce_symbol_limit` and RLS
feature gates; covered by isolation test 12 and e2e `writes.spec.ts`.

### ADR-020 · E2E on the system Chrome; write tests gated on the auth hook
**Date** 2026-10-01 · **Status** accepted
Playwright uses `channel: "chrome"` (no browser download on this network). Disposable users are created and deleted
via the admin API. Tests that write tenant-scoped data skip with an explicit reason until the access-token hook is on.

### ADR-021 · Device rule lives in requireSession()
**Date** 2026-10-01 · **Status** accepted (supersedes the layout-only check in ADR-011)
Layouts don't re-render on client navigation and server actions never run the layout, so a displaced device kept
working. `requireSession()` now redirects inactive devices to `/device`; route handlers check `deviceActive`.

### ADR-022 · Notification dedupe in a private ledger
**Date** 2026-10-01 · **Status** accepted
Dedupe keyed on rows users can delete re-sent notifications. `private.notification_ledger (user, tenant, kind, ref)`
records what was sent; notifier and research refresh insert there first (`on conflict do nothing`).

### ADR-023 · Alerts count prices from the session after they're set
**Date** 2026-10-01 · **Status** accepted
EOD candles carry only the day's high/low, not when they happened. An alert is evaluated against a candle only if that
session opened (close − 6h15m = 09:15 IST) after the alert's `updated_at`; alerts created mid-session start with the next
session. Expired plans neither fire nor re-arm alerts.

### ADR-024 · Redirect targets go through safeNext()
**Date** 2026-10-01 · **Status** accepted
Prefix checks (`startsWith("/") && !startsWith("//")`) let `/\evil.com` and `/\t/evil.com` through. All user-supplied
redirect targets are parsed with the URL API against a sentinel origin (`lib/safe-next.ts`).

### ADR-025 · No broker connections
**Date** 2026-10-01 · **Status** accepted · supersedes ADR-007
Owner changed the plan: QuantsPulse does not connect to brokers. Holdings are entered by hand (or imported later).
Migration 23 drops the tables, secrets, RPCs, enum, consent purpose and plan feature; the app has no broker code. This
also removes the only reason to hold third-party trading credentials. Reintroducing brokers needs a new ADR.

### ADR-026 · End-of-day prices from Yahoo Finance via yfinance (interim)
**Date** 2026-10-01 · **Status** accepted (interim — replace with a licensed feed before charging for data)
- **Why:** owner asked for real data now. GreekSoft was evaluated: it is an enterprise broker platform with no public
  or free API tier (access via a sales demo or through a broker that licenses it), so it can't be used today.
- **How:** `pipelines/eod/eod.py` runs after the close on GitHub Actions with the service role. Indicators are SQL
  (`private.refresh_market_analytics`) so real and dev data share one implementation. Candles stamped 10:00 UTC
  (15:30 IST); split-adjusted `Close`, not dividend-adjusted. Today's bar ignored before 15:45 IST.
- **Risks, accepted for now:** yfinance is unofficial (scrapes Yahoo, can break or be rate-limited); Yahoo's terms
  permit personal, non-commercial use only — **not** a paid product. Corporate actions Yahoo doesn't adjust (e.g. the
  Tata Motors demerger) need a `HISTORY_FROM` cut-off. Only `fetch()` touches the vendor, so moving to NSE bhavcopy
  under licence, a data vendor (TrueData, Global Datafeeds) or GreekSoft (if licensed) is a one-function change.

### ADR-027 · Cover the whole NSE market, sized for the free tier
**Date** 2026-10-03 · **Status** accepted
- **What:** every NSE equity Yahoo's screener lists (main board + SME), curated ETFs and NSE indices (~3,600).
  Derivatives (F&O), currency and commodities are not covered — Yahoo has no NSE data for them.
- **Shape:** quotes are materialised in `market_quotes` by the analytics refresh rather than computed per request;
  analytics and research run per symbol batch (PostgREST 8 s limit); lists are paginated and search is server-side.
- **Storage:** core symbols keep 760 days of candles, others 400 (enough for the 52-week range, SMA 200 and a one-year
  SIP backtest); daily RSI rows 40 days; research notes 10 days. Target < 250 MB on the 500 MB free tier.
- **News:** automatic headline matching only for the 500 largest companies and indices; the long tail is reached by
  per-company search (top 300 + anything a user watches or holds) and curated aliases, to keep false links out.
- **Sectors:** Yahoo's eleven sectors for every symbol (one filter vocabulary), replacing the hand-written labels.

### ADR-028 · Public Syndication for Moneycontrol, Business Standard & Corporate Filings
**Date** 2026-10-09 · **Status** accepted
- **Context:** Direct legacy XML endpoints for Moneycontrol were deprecated by the publisher in mid-2024, Business Standard returned Akamai 403 to non-browser UAs, and NSE's archive dropped non-browser TLS connections (ADR-014).
- **Decision:** Use Google News public RSS syndication queries targeted to the publishers' domains and Indian market tags (`site:moneycontrol.com`, `site:business-standard.com`, and Indian exchange announcements). These endpoints cleanly identify `QuantsPulseBot`, return up-to-the-minute articles, and avoid browser spoofing or bot circumvention while delivering 100% live feeds for all sources.

### ADR-029 · Chrome extension signs in through the website's cookie session
**Date** 2026-10-29 · **Status** accepted
- **Context:** the site keeps the Supabase session in cookies (`@supabase/ssr`), so the extension can't read it from
  `localStorage`, and it must not run its own refresh-token flow (rotating the same refresh token from two places would
  revoke the user's web session).
- **Decision:** the extension's background worker calls `GET /api/extension/session` with the site's cookies. `proxy.ts`
  refreshes the session as for any request, and the route returns the current access token — only when the `Origin` is
  `chrome-extension://…` (a page can't forge it, and other origins get no CORS access). The worker keeps the token in
  `chrome.storage.local`, renews it shortly before expiry or after a 401, and is the only place that fetches quotes.
- **Amended 2026-10-30:** the worker asks with **POST**. Chrome leaves the `Origin` header off an extension's GET to a
  host it has permissions for (measured: GET has none, POST carries `chrome-extension://…`), so with GET the route never
  returned a token and the extension could not sign in. GET still answers the sign-in check.
- **Limits:** tokens go only to the production site or localhost (allowlist in the extension). Content scripts can still
  read the stored token; moving it to `chrome.storage.session` is a follow-up. A dedicated, revocable extension token
  (pairing flow) would replace this if the extension ships on the Chrome Web Store.

### ADR-030 · Alerts leave the app as browser push (Web Push), not email — for now
**Date** 2026-10-29 · **Status** accepted
- **Context:** alerts, exit signals and stance changes only showed in the in-app bell. Email needs a provider account and a
  verified sending domain, and the app has no custom domain yet (BRD open decision 7).
- **Decision:** standard Web Push with VAPID keys (env, server-only private key) via the `web-push` library — no third-party
  account. The database keeps writing `notifications` as before; `svc_claim_push_batch` hands each one out once
  (`FOR UPDATE SKIP LOCKED`), and `privileged/push.ts` sends it to the owner's browsers after the EOD and news jobs and on a
  Vercel cron after the pg_cron notifier. Payloads are encrypted per browser by the protocol.
- **Limits:** push arrives after the close (prices are EOD). iPhone needs the app added to the Home Screen first
  (`app/manifest.ts`). Email can be added later as a second channel on the same claim function.

### ADR-031 · Daily setup scanner: rule tags on the last close, computed in the database
**Date** 2026-10-29 · **Status** accepted
- **What:** each active symbol's latest daily close is tagged with the chart setups it matched — 20-day closing-high
  breakout, bull flag, reclaimed 20-day average, oversold (RSI < 30), oversold bounce — stored in `market_quotes.setups`
  and filterable in Markets. Rules adapted from the MIT-licensed scanner in
  https://github.com/Jakeschincariol/day-trader-skill (`trader-scanner`, daily mode); our own SQL, not their code.
- **Why in SQL:** it runs next to the RSI it needs, on candles already in the database, for all ~3,600 symbols per
  batch, through the same wrapper the EOD pipelines and the pg_cron backstop already call. No new data or vendor.
- **Choices:** RSI comes from the stored full-history series (more exact than a short window); no price/volume floor
  (the screener's segment filter does that job); fewer than 30 sessions → no tags. The skill's intraday
  opening-range scan is not used: QuantsPulse has end-of-day data only (ADR-026).
- **Copy:** a setup is "matched a rule", never a recommendation (AGENTS rule 13).

### ADR-032 · Odds before the trade: a daily-bar Time Machine in the browser
**Date** 2026-10-29 · **Status** accepted
- **What:** with a signal's trade view open, `TradeOdds` replays the next 5/10/20 sessions 10,000 times (seed 19, so
  repeatable) and re-runs the same rule on every earlier entry of it on that stock, then states one verdict.
- **Method:** adapted from the MIT-licensed Time Machine in https://github.com/Jakeschincariol/day-trader-skill
  (`trader-timemachine`), on daily bars instead of 5-minute ones (ADR-026: EOD only). Each simulated day is a real day
  drawn from the stock's own 250 sessions before the entry (no look-ahead), applied relative to the previous close; a
  day touching both sides counts as the stop; the verdict compares the target's share of decided paths with
  break-even at its R (1 / (1 + R)), with the original's 5 and 15 point thresholds. Our own TypeScript, not their code.
- **Why in the browser:** the chart already holds the candles and signals; 200k draws take milliseconds; nothing to store.
- **Copy:** a simulation, not a prediction; fewer than 10 past trades is flagged as too few; never advice.

### ADR-033 · Dry Run: the user's own plan on past prices, never a recommendation
**Date** 2026-10-30 · **Status** accepted
- **Context:** the owner wanted a "counselor" that tells a user with ₹2–3 lakh which stocks to buy and why. Telling people
  what to buy is investment advice / research under SEBI's Investment Adviser and Research Analyst regulations, which
  need registration; a disclaimer doesn't change what the feature does, and the BRD keeps personalised advice out of
  scope (AGENTS rule 13).
- **Decision:** build the practice version. The user chooses the amount and the stocks (the list is the day's fresh
  rule buys among the 500 largest companies, or any stock by search), and the page only does arithmetic on those
  choices: whole-share sizing after a cash share, the same amounts replayed from the first common day against the
  NIFTY 50, the worst day / week / fall, and seven general guardrails (concentration, sectors, stops, loss at stops,
  traded value, SME, cash). A disclosure gate must be accepted first (remembered in the browser), and the fixed
  disclosure sits at the top and bottom. Default order is newest match first, never "best".
- **Never:** "buy", "best stocks", a system-chosen split, return promises, or questions about income/goals.
- **Limits:** the replay looks back with stocks picked today (said on screen). Many stocks' history in the database
  starts 25 Sept 2025, which shortens the replay (also said on screen; backfill is on the roadmap). Legal review of
  the wording is still owed before launch (BRD open decision 8). Phase 2 (saved practice plans, weekly report) needs a
  user-data table with RLS and an isolation test.

### ADR-034 · Two years of history for the 500 largest companies (amends ADR-027)
**Date** 2026-10-30 · **Status** accepted
- **Context:** ADR-027 kept 760 days for ~80 core symbols and 400 days for the rest, with a nightly retention job deleting
  older candles. Dry Run replays (ADR-033) and the odds pool (ADR-032) were cut to ~13 months for most listed stocks.
  The database was 254 MB of the 500 MB free tier (candles 135 MB).
- **Decision:** 760 days for every symbol ranked in the top 500 by market cap: a trigger on `market_symbols` raises
  `history_days` when `mcap_rank` ≤ 500 (insert, rank change or the universe upsert) and never lowers it; the universe
  sync mirrors the rule; the top 500 were backfilled with `eod.py --days 760`. About +25 MB.
- **Not done:** two years for all ~3,600 symbols (~+165 MB, ~420 MB total) — too close to the free-tier limit.


### ADR-035 · Strong trend: the one tested rule with an edge, plus a grade for every signal
**Date** 2026-10-31 · **Status** accepted
- **Context:** the owner asked for signal rules that tell users which stocks to look at and when. Seven years of daily NSE
  prices (Jul 2019 – Oct 2026; rules chosen on 2019–23, checked on 2024–26; each year's 300 most traded stocks, so no
  hindsight about which companies later became big; 0.5 % round-trip cost; compared with random entries and with simply
  holding the same stocks) showed that the three existing rules have no reliable edge: SMA 20/50 did about as well as
  random picks, RSI reversal and KK (whose stored record also has a 20-year file) lost money after costs. Of ten
  candidate patterns, only momentum (a new 52-week high on heavy volume) kept beating the average stock in both periods.
  Market-condition filters, ATR stops and a walk-forward "signal checker" (gradient boosting retrained quarterly on
  graded signals) lowered the wrong-signal rate by 2–10 points at most, and not at all for RSI.
- **Decision:** add `strong_trend` (migration 33, SQL like the other rules): close above the previous 252 sessions' highest
  close, volume ≥ 2× the previous 50 sessions' average, close above the 50-day average, market weather "sunny"; the 500
  largest companies only (the tested universe was large, liquid stocks). Plan: next-open entry, safety stop 4 × ATR14
  below the close, review after 60 sessions, no fixed target (stops of 2–5 ATR and none were compared on 2019–23:
  wider stops won more often; 4 ATR kept a guard against collapses; taking profit at a target cut gains in half).
  The exit is stored as a signal, so the existing pairing, chart and notifier work unchanged.
- **Market weather** (`public.market_weather`): sunny = Nifty 50 above its 200-day average with the 50-day above it and
  India VIX ≤ 22; stormy = Nifty below with the 50-day below, or VIX > 22; else mixed. Shown on the Signals page.
- **Grading** (`public.signal_outcomes`, `public.strategy_scorecard`): every entry signal of every rule is graded from
  stored candles after 5, 20 and 60 sessions and against the Nifty 500 over the same sessions; nothing filtered, before
  costs. The Signals page shows the record next to the rules, with the tested record of Strong trend
  (`lib/strong-trend.ts`, from `research/strategies/record.py`).
- **Checked:** an independent Python implementation and the SQL produced the same 360 signals on a read-only copy of
  the live candles (`research/strategies/expect_live.py`, `pglite_live.mjs`).
- **Not done:** the signal checker (researched, not shown: its gains were too small to change what users see);
  improving RSI reversal and KK (next); KK's stored signals stop on 24 Aug 2026 (a one-off import).
