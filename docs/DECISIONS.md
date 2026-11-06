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

### ADR-036 · RSI dip and KK dip replace RSI reversal and the KK breakout import
**Date** 2026-10-31 · **Status** accepted
- **Context:** graded on 2019–2026 prices (ADR-035's method), RSI reversal and the KK buys lost money after costs and
  were wrong 58–63 % of the time; KK's signals were also a one-off import that ended on 24 Aug 2026, and the chart
  recomputed the old KK rule in the browser for every other stock. The owner asked to fix both, not retire them.
- **Diagnosis:** both bought falling stocks (84 % of RSI reversal signals were under the 200-day average), bought
  strength after the bounce had started, and used fixed % levels that ignore each stock's normal daily move.
- **Decision (migration 35):** two "dip in an uptrend" rules, chosen on 2019–23 and confirmed on 2024–26 (every nearby
  setting was also profitable in both periods): `rsi_dip` (RSI(2) < 10) and `kk_dip` (a push 1 % under the 20-day
  low), both only above the 200-day average; buy the next session only at close − 1 × ATR14 (a limit, filled when the
  low trades 0.2 % through it); sell at the first close above the 5-day average or after 10 sessions; safety stop
  5 × ATR14. Tested: RSI dip 3,058 trades, 64 % made money, +0.67 % a trade; KK dip 1,070, 68 %, +0.77 %
  (2024–26: 60 % / +0.59 % and 67 % / +1.46 %), after a 0.5 % cost. The 500 largest companies only.
- **Stored** like every rule: the buy on the fill day (with `fill`, so the grader uses it) and the exit; the pending
  level in `public.signal_watch` (next session only). RSI reversal's block is removed from
  `refresh_market_analytics`; old RSI reversal and KK signals stay as history (labelled "(old rule)").
- **Checked:** the SQL and an independent Python version produce the same 987 buys and 975 exits on a read-only copy
  of the live candles (fills equal to the paisa).
- **Not done:** KK shorts. Shorting into a push over the 20-day high only in falling stocks, on a rally, covering on
  the first dip, cut the wrong rate from ~65 % to ~40 %, but no version made money after costs in either period
  (`research/strategies/improve_short.py`), and Indian cash shares can't be held short overnight. 90 % of KK dip
  signals coincide with an RSI dip on the same stock within 3 sessions: KK dip is the deeper subset.

### ADR-037 · SMA 20/50 trend replaces the plain 20/50 cross
**Date** 2026-10-31 · **Status** accepted
- **Context:** the owner asked to improve SMA 20/50, the weakest rule left. The old rule bought every 20/50 cross and sold on
  the cross back down: on 2019–26 prices (the ADR-035 method) 43 % of trades made money (37 % in 2024–26); on the stored
  live signals 29 %. It whipsawed, fired in falling stocks, and the cross-down exit gave back most gains.
- **Research:** 24 variants written down before running (`research/strategies/improve_sma.py`): 6 entry filters × 4 exits.
  The exit mattered most; a leader filter (6-month return in the top 30 %) helped next. Chosen on 2019–23 by the owner's
  goal, the fewest losing trades (≥ 150 a year, positive average): the leader's cross with Strong trend's plan. The
  average-trade criterion written in the script header would have picked the leader's cross with the old exit
  (+12.9 % a trade in 2019–23 but 53 % / 60 % of trades losing); both are reported.
- **Decision (migration 38):** `sma_trend` = the 20-day average closes above the 50-day (exact decimal averages) and the stock's
  126-session return ranks in the top 30 % of the 500 largest companies that day (`public.market_leaders`, cume_dist ≥ 0.7,
  ranked once per session); next-open entry, safety stop 4 × ATR14 under the close, review after 60 sessions. Tested:
  1,221 trades, 52 % made money, +5.6 % a trade (2024–26: 46 %, +2.3 %), after a 0.5 % cost. The old cross stops producing
  signals; its history stays ("(old rule)").
- **Checked:** the SQL and an independent Python version (integer-paise averages) produce the same 834 signals on a
  read-only copy of the live candles.
- **Limits:** about half of trend trades lose; they work because winners (~+22 %) are about twice the losers (~−11 %).
  2024–26, a flat-to-falling market, was weaker for every long-only trend rule.

### ADR-038 · Signal checks: the rules check their own record (display only), nothing auto-tunes
**Date** 2026-11-02 · **Status** accepted
- **Context:** the owner asked for the four rules to adapt to the market by themselves, to an industrial standard, and for
  a team of four agents to compete and agree. A shared dataset (7,337 trades of the four live rules, 2019-07–2026-10, each
  year's top 300, 0.5 % cost), one scorer (`research/strategies/team/evaluate.py`) and walk-forward rules (each quarter
  learns only from trades already finished) were fixed first (`team/BRIEF.md`).
- **Round 1 (one method each):** regime switching (pause a rule in market states where it lost), re-optimising settings
  quarterly, a rule × weather health card, and meta-labelling (a model of each signal's chance). No method beat the static
  rules on accuracy against a fair random-skip test. Two traps were found that affect any adaptive method: trades that
  finished recently are mostly stop-outs for the 60-session trend rules (9 % made money vs 54 % for the whole cohort), so
  only complete cohorts may be used; and evidence must be counted in episodes (months, years), not trades.
- **Rounds 2–3:** each member critiqued the others, re-tested on complete cohorts and on stocks ranked 301–500 (data none
  had used), and voted. The re-optimiser's one stable finding (5 × ATR, 90 sessions) failed a clean test chosen on
  2019–23 and checked on 2024–26: the rules keep 4 × ATR / 60. Market-state labels flipped between periods and forecast
  worse than a rule's own record. A look-ahead in the meta-label's same-day count (filled trades are known only the next
  day) was found and fixed; the result held.
- **Decision (D***, `team/FINAL.md`, all four agreed; migration 39):** two display-only checks, nothing hidden or skipped.
  *Strong trend*: tag *weak* when the last 30 finished trades in the same weather lost money over 20 sessions (t < −1).
  *RSI dip*: a logistic regression on 25 close-of-day features, refitted each quarter on complete cohorts with
  forward-only calibration (slope clipped ≥ 0, in force only above 1e-6), tags the top third. Only the tag with evidence is
  shown (High, Weak): a Low label covered ~80 % of 2025–26 dips that made the rule's usual rate. KK dip and SMA trend get
  no tag (inconclusive / no support). The public record names the years each tag was wrong; the 2025 RSI reversal and
  the Strong trend check's thin month count are shown, not hidden.
- **How it runs:** the database computes features and scores daily (`svc_refresh_signal_checks`, after every analytics
  batch); the refit is Python (`pipelines/eod/checks_refit.py`, a byte-for-byte copy of the team's `tier_model.py`) at
  each quarter start, reading the stored training set (research record + live trades closed since, with the features they
  were scored on). Checks are frozen once written. Parity on the live candles: 98.9 % same RSI dip label, 100 % Strong
  trend.
- **Not done, and why:** skipping Low RSI dips (+3–4 points per rule in research) waits for two live quarters of
  separation counted by month; automatic changes to rule settings stay out (past best settings barely kept winning:
  rank correlation 0.06–0.27); the 27-setting grid and the KK dip / SMA trend self-tests are a quarterly research job.
- **Known differences from the research:** live prices are split-adjusted only (research also dividend-adjusted, ≤ ~2 %
  on long ratios); `rs_rank` comes from `market_leaders` (ties and the ≥ 300-session rule differ slightly); the first
  RSI dips after the live history began (Jul–Aug 2025) lack a 200-day slope and use the training median, as the research
  does for missing values.

### ADR-048 · Chart replay: a separate chart that adds bars one at a time, with the rules' signals and practice trades
**Date** 2026-11-06 · **Status** accepted
- **Context:** the owner asked for a replay like TradingView's on the stock page, simple and smooth: see how a stock and
  the rules' trades unfolded, and practise.
- **Decision:** `ChartReplay` replaces the price chart while Replay is on (the main chart's many overlays stay as they
  are). It builds its own lightweight-charts instance and moves through time with `series.update` (forward),
  `series.pop` (back) and `setData` only for jumps over 40 bars; playback is paced by `requestAnimationFrame` with the
  leftover time carried (`barsDue`), capped at one second's bars after a hidden tab. Moving averages are computed once
  over the whole history (`computeSma`, one value per bar) and revealed with the bars, so no value uses a later day;
  rule markers come from the chart's rule bar and appear on their bar. Practice trades are long only, one at a time,
  whole shares of ₹1 lakh at the day's close, in memory only. Speeds are trading days a second (1, 2, 5, 10, 20).
- **Limits:** daily bars only (no intraday replay; we have no intraday data, ADR-026); no drawing tools, short selling or
  saved practice sessions; the 200-day trend's regression line and the main chart's trade view are not drawn in replay.

### ADR-047 · Tradebook import: read in the browser, matched by column name, checked by a dry run, saved in one go
**Date** 2026-11-05 · **Status** accepted
- **Context:** people already have years of trades at their broker; typing them in is not realistic, and the rule
  comparison (step D) needs them. Only Zerodha's tradebook columns could be confirmed (date, buy/sell, quantity,
  price, trade id in every version; their order has changed); Groww, Upstox, Angel One and Choice publish no format, and
  guides disagree on where their reports live.
- **Decision:** the file is read in the browser (CSV, or .xlsx with a small built-in reader; nothing is uploaded or
  stored). Columns are matched by name against the names brokers use, the header row is found below any title rows,
  and the person matches columns by hand only when a needed one is missing (remembered per broker on that device). The
  server matches each stock again (symbol, broker spelling, company name, a single successor for a renamed stock) and
  the database checks the whole file with a dry run that is rolled back, one stock at a time, so each stock's result
  or problem is shown before anything is saved. The import is one call, all or nothing; references (the broker's trade
  id, or a hash of the row with a count for identical fills) make a second import or an overlapping file add nothing.
  An opening balance entered by hand is replaced by the tradebook only when chosen (pre-chosen when the tradebook gives
  the same shares) and is kept on the import, so Undo restores it. Splits come from the stored history
  (`--splits-history` backfill).
- **Limits:** no ISINs in our list, so a file with only ISINs needs symbols or names; tradebooks rarely have charges;
  intraday short sales (sell then buy back) work within a day; no derivatives. A broker that changes its column names
  to ones we don't know falls back to matching by hand.

### ADR-046 · The portfolio ledger: dated trades, oldest-first lots, holdings worked out from them
**Date** 2026-11-05 · **Status** accepted
- **Context:** a holding was a quantity and an average price that five code paths overwrote, so the app could not
  say when someone bought, what they made on shares sold, or how their money grew; the contract note import deleted a
  holding sold in full, with its profit. The planned features (tradebook import, closed positions, growth, and setting
  each buy beside the rules' trades) all need dated buys and sells.
- **Decision:** migration 51. `portfolio_transactions` holds every opening balance, buy and sell; a statement trigger
  replays each touched position (`private.rebuild_position`) into `portfolio_lots`, `portfolio_realized` and the
  `holdings` row, which everything else keeps reading. Lots are matched **oldest first** (FIFO), the method of
  Zerodha Console's P&L and of Indian tax on demat shares, and the only one that gives each purchase its own result
  (needed for the rule comparison); the average shown is the price paid without charges, as brokers show it, and
  charges count in gains. Within a day: splits, opening balances, buys, sells (an intraday sell-then-buy-back is one
  lot). Splits are read from `corporate_actions` during the replay, not stored as trades, so trades can be entered in
  any order (a tradebook spanning a split imports at once); `private.corporate_action_ledger` records that a split was
  seen (announced once, ADR-045's rules) or undone. A sell larger than the shares held fails the write. Existing
  holdings become opening balances dated their last edit; an opening balance means "held as of that date" and the app
  must date it the day it is entered. The symbol limit still counts held stocks only (a closed position has no holding).
- **Limits:** splits only as Yahoo reports them (ADR-045); no dividends, rights issues or demergers; Pro still holds
  15 stocks at a time, which a large tradebook import must explain (step C). Since migration 52 clients only read
  holdings; the app records trades. A holdings CSV adds new stocks as opening balances and does not merge into a held
  one (it cannot know whether the file repeats shares already recorded).

### ADR-045 · Holdings you can trust: split and bonus adjustments with undo, exit messages that say what they are
**Date** 2026-11-05 · **Status** accepted
- **Context:** the first step of making QuantsPulse a place to keep a portfolio. Three things broke trust. (1) When a
  stock split or gave bonus shares, Yahoo's history was rescaled but the holding kept its old quantity and average, so
  the portfolio showed a large loss that never happened. (2) An exit message said "Exit signal on X … You hold this
  stock" and named only the retired rules (the live ones read "kk dip"); it read like an instruction to sell. (3) The
  dip rules close trades within ten sessions, so a long-term holder was messaged far too often.
- **Decision:** migration 50. The EOD pipeline stores every split or bonus Yahoo reports in `corporate_actions` (new
  shares per old share); the notifier rescales holdings last edited before that ex-date's session opened (an edit after
  it already has the new numbers), last 30 days only, keeping the money put in and whole shares whole, records the
  before and after in `holding_adjustments` and messages the owner, who can undo it once from the portfolio while the
  holding is unchanged. Exit messages name the rule and why its trade closed and end "This is the rule's own research
  trade, not advice. Your holding is unchanged." `notification_prefs` lets each person pick the rules that message them
  (Settings → Notifications); with no row, only the three trend rules do. Every plan gets this (no plan gate): it fixes
  numbers the person already has.
- **Limits:** only splits and bonuses Yahoo reports; a price break the pipeline repairs itself (ADR-043) is not applied
  to holdings, and demergers, rights issues and the cash paid for fractional bonus shares are not recorded. A holding
  entered after the ex-date with numbers from an old statement is not adjusted.

### ADR-044 · One Pine script per rule; research notes that test each rule against the usual way
**Date** 2026-11-05 · **Status** accepted
- **Context:** "Copy Pine script" on a stock page gave one script for the retired rules (golden cross + RSI 14 reversal,
  with a "fast swing" mode), whatever rule the chart showed. The owner asked for the chosen rule's script only, and for
  five plain-language blog posts that show why each rule is more reliable than the usual way of using its indicator.
- **Decision:** `lib/pine-script.ts` writes one Pine v6 script per live rule that follows the SQL bar by bar (signal,
  next-open or dip-limit entry, safety stop rounded to the paisa, 60-session / 10-session / bounce exit, one trade at a
  time); the copy button sits in the chart's rule bar and copies the chosen rule (a menu for All / Clean). Checked: a
  Python port of the scripts' state machines gave the same trades as the research code (= live SQL) on 150 stock-rule
  runs, and all five passed TradingView's own editor checks (0 errors, 0 warnings, as a guest). Two parts cannot be
  copied exactly and the scripts say so: market weather is read from NSE:NIFTY and NSE:INDIAVIX; the SMA 20/50 leader
  rank (top 30 % of the 500 largest) becomes "6-month return beats the Nifty 50's by 15 points or more" (an input;
  agreed with the rank on 90 % of crossover days, 2019–26). The blog (`/blog`) is static content in TS with every number
  read from `compare_blog.py`'s output: the usual version of each indicator was chosen before seeing results (Strong
  trend's second baseline, the common "sell under the 50-day" exit, was added after and the post says so), the same
  universe and costs as ADR-035, and where the usual way wins on a measure (the average trade of both moving-average
  rules, 2019–23) the post says it. SEO/GEO: a 40–90 word direct answer, H2 sections, comparison table, FAQ with
  `FAQPage` JSON-LD, `BlogPosting` + `BreadcrumbList`, canonical, OG image per post, sitemap and robots.
- **Limits:** a TradingView chart starts its history on another day, so the first signal or two can differ; the blog's
  numbers are research on past prices (re-run `compare_blog.py` + `blog_ts.py` to refresh them). URL slugs keep
  hyphens (search engines read them as word breaks); the reader-facing text has none (`posts.test.mts`).

### ADR-043 · Nightly reliability: rules continue their record, leaders ranked once, an on-time trigger
**Date** 2026-11-04 · **Status** accepted
- **Context:** a system review after ADR-040/041 found: (1) every busy-based rule rebuilt its trade chain from the oldest
  stored candle, which the nightly trim moves, so trades could be written again over stored ones (reproduced on the
  live-candle copy); (2) the 4 Nov pipeline timed out because `refresh_leaders` re-ranked the market in every batch on a
  partly loaded day; (3) RSI crossings from the Sep 2024 cold start survived ADR-041's longer history; (4) GitHub ran
  the Market EOD schedule 5–8 hours late every day from 28 Oct.
- **Decision:** migration 45 — each rule resumes after the stock's last stored signal (`private.rule_resume`; an open buy
  is followed to its exit) and writes only later rows; the record is append-only and what a rule buys and sells is
  unchanged (`rebuild_rule_signals` deletes first, so a rebuild still runs on everything). Migration 46 — leaders are
  ranked only while a ranked stock lacks the latest session's rank. Migration 47 — crossings of the 500 largest rebuilt.
  Migration 49 — the evening checks, kept records and research notes also run in the database cron after the late
  loads (they outgrew the API's 8 s limit on a cold cache); the pipeline's research step is batched and non-fatal.
  Migration 48 — no bare DELETE in a function (API sessions run `safeupdate`; test 18 checks every function). `eod.py`
  repairs every series a long backfill fetches (ADR-041's load had stored 7 stocks' unadjusted prices; repaired and
  rebuilt) and splits a batch that hits the statement limit. The schedule left :00/:30, and the app's Vercel crons can start
  the workflow through GitHub's dispatch API (optional token, Actions: write on this repository only).
- **Limits:** a candle revised by Yahoo inside an open trade can make the rerun miss that buy (then the next buy after it
  is written); the price audit and rule health would show it. Without the dispatch token the GitHub schedule (late) is
  still the only full load; the 17:00 cron loads the 33 benchmarks.

### ADR-042 · Fast reads: kept records, a one-stock research lookup, nightly clean-up
**Date** 2026-11-04 · **Status** accepted
- **Context:** the owner found pages slow. Measured on production: Signals 2.5–3.6 s, the stock page 2.6–3.8 s, Dry Run
  1.0–3.3 s, the rest under 0.9 s. The database answered from memory 99.7 % of the time, but two record views scanned
  every stored signal's JSON on each view (135–150 ms warm, 2.6 s cold) and research_latest probed all 3,627 symbols for
  one stock (955 ms cold).
- **Decision (migration 44):** the records are kept in `strategy_trade_summary` / `strategy_scorecard_summary`, refreshed
  once an evening by `svc_refresh_signal_checks` (the views stay live for the refresh and the tests); `research_latest`
  returns the symbol from `market_symbols` so a filter reaches the index; `private.retention_derived()` (02:55 UTC daily)
  deletes RSI crossings older than the stock's stored candles, leader ranks older than 1,260 days and rule health older
  than two years. Signals are never deleted: they are the record.
- **Not adopted:** an EMA version of 200-day trend with the stop counted on the close (tested 4 Nov 2026: 2024–26 41 in
  100 made money, +0.1 %, below a random day above the EMA; the SMA version 49 in 100, +2.3 %). The owner kept the live
  SMA rule (ADR-040) unchanged.

### ADR-041 · ~3.4 years of history for the 500 largest, and the five rules rebuilt on it
**Date** 2026-11-04 · **Status** accepted (live after the owner's go-ahead)
- **Context:** the owner saw stock charts with few or no past signals from the five rules (Strong trend and 200-day
  trend most of all) and asked for the past record to be shown, as evidence of how well the rules read the market. Two
  years were stored (ADR-034) and the rules spent the first of them warming up (200-day trend needs 300 sessions, Strong
  trend 252, the dips a 200-day average), so 200-day trend's first possible signal was January 2026, Strong trend's
  October 2025.
- **Decision (migration 43):** keep 1,250 days for the 500 largest companies and NIFTY, NIFTY500 and INDIAVIX (the trigger
  raises newcomers too; the cap on `history_days` goes from 1,000 to 2,000), back-fill once from Yahoo, and rebuild the
  five rules on everything stored (`private.rebuild_rule_signals` per 20 stocks via `supabase/scripts/rebuild-rules.mjs`):
  delete their signals, run every rule again, give rows written again their old ids (no second exit notification),
  grade, then the signal checks and a year of rule health. The old rules' signals are not touched.
- **Checked:** on PGlite with the live-candle copy the rebuild reproduces exactly the signals of a normal run (no row
  lost or added) in 51 s for 511 stocks; tests `09_history_top500`, `17_rule_history`.
- **Cost:** about +55 MB (candles, leaders, signals) on the free tier, 330 MB before. All seven years would not fit.
- **Alternatives rejected:** importing the research signals (2019–26) as stored signals — the chart can't draw a signal
  without its candles, and it would mix a research record with the stored-price one; seven years of candles — over the
  free tier.

### ADR-040 · 200-day trend: a fifth rule from a moving average and a linear-regression line
**Date** 2026-11-03 · **Status** accepted (live after the owner's go-ahead)
- **Context:** the owner asked for a rule that signals only when a stock closes above its 200-day average and the
  linear regression of that average is flat, rising or about to rise (TradingView's Linear Regression Channel), and for
  the rule count to be odd (five).
- **Research:** 48 variants written down before running (`research/strategies/improve_lr.py`): crossing vs first day
  all conditions hold; slope rising / flat (≥ −0.25 % per 20 sessions) / turning up; a 50- or 100-session line; with or
  without Pearson's R ≥ 0.5 on the last 100 closes; the 60-session plan or a sell-when-the-trend-turns exit. Chosen on
  2019–23 by the ADR-037 criterion (fewest losing trades, ≥ 150 a year, positive average). "About to rise" and "rising
  only" were no better than "flat or rising"; the R test added about 5 points; the trend exit won big in 2020–23 and lost
  since. A start-of-history artifact (a stock's first measurable day counting as a turn) was fixed before choosing.
- **Decision (migration 41):** `ma200_trend` = the first session on which close > 200-day average, the 100-session
  least-squares slope of that average × 20 ≥ −0.25 % of it, and corr(close, time) over 100 sessions ≥ 0.5, after a
  measurable session on which they did not all hold; 500 largest companies; next-open entry, safety stop 4 × ATR14,
  review after 60 sessions (shared with the other trend rules). Tested Mar 2020 – Oct 2026 (needs 300 sessions):
  1,906 trades, 56 % made money, +5.9 % a trade; 2024–26 47 % (+1.7 %) vs 42 % (+0.75 %) for a random entry on days above
  the 200-day average and 42 % for the bare 200-day cross. Only 11 % of its buys fall within a week of a Strong trend or
  SMA trend buy in the same stock. It joins rule health with its tested rate; it has no signal check.
- **Checked:** the SQL and an independent Python version produce the same 666 signals on the live-candle copy.
- **Not chosen:** adding the market-leader filter (better in 2024–26, ~50 %, worse in 2019–23, 60 %) — for the quarterly
  review, not switched on after the fact.
- **Limits:** the edge over a random day is small and was nil in the 2020, 2021 and 2024 rallies; about half of recent
  trades lose; winners (~+18 %) carry it. In TradingView's script `trend = sign(start − end)` is negative when the line
  rises; QuantsPulse uses the plain slope.

### ADR-039 · Rule health: each rule is checked daily against its tested record; drift is flagged, never auto-fixed
**Date** 2026-11-02 · **Status** accepted
- **Context:** the owner asked for the rules to "find their mistakes and improve day by day". ADR-038 showed that no
  automatic filter or re-tuning beat the fixed rules when tested fairly, so improving means noticing drift early and
  explaining it, with any change still going through a pre-registered test.
- **Decision (migration 40):** after every close, for each of the four rules, the last 40 finished trades are compared
  with the rule's tested made-money rate (`rule_expectations`, Jul 2019 – Oct 2026). The normal range is the 90 %
  binomial band for that many trades (a control chart). Status: below / within / above / too_few (< 20 trades). Every
  losing trade gets one plain cause from the Nifty 500 over the same days: whole market fell (≥ 3 %), stock fell on its
  own, or a small loss (under 1.5 % after costs). History is kept per day (`rule_health`) so drift is visible over time.
- **What it does not do:** it never changes, pauses or hides a rule. A rule below its range for two checks in a row goes
  on the quarterly review (PLAYBOOK §S); a fix needs the same pre-registered, out-of-sample test as ADR-038.
- **Caveats shown to users:** trades that finish on the same days share one market move, so the band is a guide, not a
  verdict; a run better than usual is not a reason to expect more. Expectations are the long-run tested rate, not the
  2024–26 rate, so a weak market shows up as *below* rather than being absorbed into the baseline.
- **Alternatives rejected:** auto-pausing a rule below range (round 1 of ADR-038: pausing by market state lost to the
  static rule); a rolling expectation (it would hide slow decay); win/loss streak alarms (too noisy at 40 trades).

