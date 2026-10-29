# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Newest first.
**Every change adds a line under _Unreleased_** — what changed, why, and where. Agents: read this before
building something; it may already exist (then check `docs/CODEMAP.md`).
## [Unreleased]

### Added — Daily setup scanner (`supabase/`, `web/`; ADR-031)
- **Nightly tags (migration 31)**: every active stock's last close is checked against five rules — 20-day closing high,
  bull flag, reclaimed 20-day average, oversold (RSI < 30), oversold bounce — and tagged in `market_quotes.setups`.
  Runs inside `svc_refresh_market_analytics` (EOD pipelines) and the `market-analytics` cron. First live run: 658 stocks
  tagged (266 oversold, 206 bounce, 172 reclaim, 95 breakout, 41 flag). Rules adapted from the MIT-licensed
  `trader-scanner` skill (credited in ADR-031).
- **Markets**: a "Setup today" filter, a Setups column, and the rule stated under the filters ("a rule match on a chart, not a
  recommendation"). **Stock page**: "Matched on the last close" with links to every stock that matched the same rule.
  **Market Radar**: setup badges under the signal.
- Tests: `supabase/tests/08_setups.sql` (five fixture charts, clearing on refresh, grants, wrapper), `lib/setups.test.mts`,
  `e2e/setups.spec.ts`.

### Fixed — Off-site redirect test hung on "network idle" (`web/e2e/auth.spec.ts`)
- After signing in, the test waited for `networkidle`, which on some runs never fires for the signed-in shell (it hung on
  `/app` until the 135 s limit, though the redirect itself was correct). It now waits for the URL to leave `/login` — any
  destination, so an off-site redirect still fails the hostname check. 3/3 green against production, ~20 s each.

### Added — Phase 3: browser push alerts, setup checklist, freshness note, page-shaped loading; new logo (`web/`, `extension/`, `supabase/`)
- **New mark (`components/brand/logo.tsx`, `app/icon.svg`, `scripts/brand-icons.mts`)**: a Q whose tail ends in the coral signal
  dot replaces the five-step pulse, which blurred at favicon size. The tail cuts into the bowl so it reads as a Q, not a magnifier.
  One script renders the Apple touch icon, install icons (incl. maskable), a white notification badge and the extension icons.
  Extension 1.2.1 uses it in the toolbar, side panel and chart overlay.
- **Browser push (ADR-030)**: migration 30 adds `push_subscriptions` (own rows only), `notifications.pushed_at` and
  `svc_claim_push_batch` (each notification handed out once; existing ones marked handled so nobody gets a backlog).
  `server/privileged/push.ts` sends after the EOD and news jobs and on `/api/cron/push` (18:15 IST weekdays); dead browsers are
  dropped. Settings → Notifications turns it on/off per browser, lists your browsers and sends a test. `public/sw.js` shows the
  notification and opens the stock (or billing) on click. `export_my_data()` lists push browsers (never their keys).
- **Installable (`app/manifest.ts`)**: name, theme, icons — also what iPhone needs before it allows web push.
- **Setup checklist (`components/onboarding/first-run.tsx`)**: on the overview — add 3 stocks, set an alert (if on the plan), turn
  on notifications, add the Chrome extension (detected in the browser). Hides when done or dismissed.
- **Freshness note (`components/shell/market-clock.tsx`, `lib/market.ts`)**: the header shows "EOD 28 Oct · next today 17:00";
  `nextEodUpdate` skips weekends and NSE holidays.
- **Loading (`components/ui/skeleton.tsx`)**: static, page-shaped placeholders for the stock page, portfolio, research and news; the
  default `/app` skeleton no longer pulses in a loop.
- **Secret scanners**: `VAPID_SUBJECT` (the public site URL) is excluded like `NEXT_PUBLIC_SITE_URL`.
- Tests: `supabase/tests/07_push.sql` (isolation, claim once, export), `lib/push-payload.test.mts`, `nextEodUpdate` cases,
  `e2e/onboarding.spec.ts`.
- **Found, not changed**: `npm audit` flags Next.js 16.3.8 (critical, fixed after 16.4.0) and zod 4.6.5 (high, fixed in 4.6.6).

### Added — Price chart phase 2: trade view, signal explanations, smooth pan, new-signal marking (`web/`)
- **Trade view (`web/src/components/charts/price-chart.tsx`)**: selecting a signal in the timeline shows its whole round trip —
  entry, stop (−1R) and target lines labelled on the price axis, a risk zone (entry→stop) and reward zone (entry→furthest target)
  shaded from entry to the exit (or today if still open), and a "▲ Long · 1R = ₹75.20 (3.7%)" label. Exits and covers find the
  entry before them; shorts draw risk above and reward below. Screen readers get the same as one sentence.
- **Signals explain themselves**: the hover readout and every timeline chip (tooltip) say what the rule saw and how a closed trade
  ended ("…dipped at least 1% below its 20-day low, then traded back above that day's high within 5 sessions", "The stop was hit.
  Result −1.00R."). Same sentences as the Chrome extension.
- **Smooth pan**: focusing a signal eases the chart to its trade over ~260 ms (instant under reduced motion), and a chart rebuild
  (range, style, overlays) keeps the trade in frame instead of resetting.
- **New since last visit**: signals newer than the last time this symbol's chart was opened in this browser get a "New" tag in the
  timeline and a single ring on the chart (plays once, never loops; hidden under reduced motion).
- **One classifier (`web/src/lib/signal-trade.ts`)**: `signalAction` / `isWinningExit` replace three copies of the buy/sell/exit/
  cover logic in the chart (same order of checks, so no marker changes). `describeSignal` in `extension-signals.ts` now uses the
  shared `ruleSentence`.
- **CSS (`globals.css`)**: `.animate-fade-quick` (150 ms opacity) for overlays that sit on exact prices; `.signal-ring` (one-shot).
- Tests: `lib/signal-trade.test.mts` (pairing, short side, wrong-side stops, explanations); `e2e/chart-trade-view.spec.ts` (zones on
  the right sides, explainer, clearing, "New" once per visit).

### Changed — Chrome extension 1.2.0: side panel redesign, phase 1 (`extension/`, `web/`)
- **Layout (`extension/sidepanel/*`)**: one long scroll became a sticky quote header plus three tabs — **Signal**, **Plan**,
  **Levels** — remembered between sessions, with arrow-key navigation and a sliding indicator (180 ms; off under reduced motion).
- **Quote**: price and change, a 3-month price line (1.5 px ink, end dot by direction, 8 px signal dots by buy/sell) with a
  hover/arrow-key tooltip for any day and a text summary for screen readers, plus "EOD · 27 Oct close" so nobody reads it as live.
- **Signal tab**: the latest signal as a short story — badge, what the rule saw in one sentence (`describeSignal`), sessions since
  it fired, signal price, stop and move since — and the last five signals as a timeline.
- **Plan tab**: a price ladder with Stop / Entry / T1 / T2 / T3 at their real distances, risk and reward rails, % from entry, and a
  "Now" marker at the last close; labels never collide. Still shown only for an open long entry. Disclaimer kept.
- **Levels tab**: SMA 20/50/200 with a diverging bar for distance above/below, the 52-week range with a position pin, RSI (14) on a
  0–100 track with the 30–70 band. The "ALPHA TARGET / NODE LEVEL" tag is dropped (jargon).
- **States**: placeholder blocks instead of "Fetching…" (static, no shimmer), and clear empty, signed-out and error views; errors
  say whether the symbol isn't covered or the server didn't answer, with Retry.
- **Design system**: Zen Linen tokens from MASTER.md (validated gain/loss ink and mark colours, light + dark), Phosphor icons
  (inline sprite) instead of emoji/Unicode, type scale 11/12/13/16/22 (was 17 sizes from 8.5 px), click-to-copy on every price with
  a toast. axe (WCAG 2.1 AA) clean on every tab and state, light and dark, at 320–360 px.
- **Settings → options page (`extension/options/`)**: overlay on/off and style, and the server as a choice of two (production or
  localhost); switching server clears the token and re-checks sign-in.
- **Server (`web/src/server/privileged/extension.ts`, `web/src/lib/extension-signals.ts`)**: the quote adds `history` (≤63 daily
  closes) and, on `latestSignal`, `rule`, `sessionsSince` and `moveSincePct`. KK wording follows `simulateKkStrategy` (a ≥1% push past
  the 20-day extreme, confirmed by crossing that bar's other end).
- Tests: `describeSignal` unit tests; `extension-api.spec.ts` checks the new fields; the zip test covers the options page.

### Fixed — Flaky off-site redirect e2e test (`web/e2e/auth.spec.ts`)
- "sign-in never redirects off-site" does four full sign-ins (~32 s against production) and sometimes hit the 45 s default
  timeout; it's now `test.slow()`. The redirect assertions are unchanged.

### Fixed — Chrome extension 1.1.0: sign-in, honest signals and plans, token safety (`extension/`, `web/`)
- **Sign-in sync never worked (`extension/background.js`, `content-scripts/auth-sync.js`, `web/src/app/api/extension/session/route.ts`)**:
  `auth-sync.js` looked for the Supabase session in `localStorage`, but the site keeps it in cookies (`@supabase/ssr`), and a
  stored token was never renewed (locked after ~1 h). The background worker now asks `/api/extension/session` with the site's
  cookies and stores the access token, renewing it 2 min before expiry and once after a 401. The endpoint returns the token
  only to a `chrome-extension://` origin. `auth-sync.js` now just triggers that check (no storage or cookie reads).
- **Invented signals (`web/src/server/privileged/extension.ts`)**: when a stock had no stored signal the server made one up
  ("SMA 20/50 Golden Trend", "Trend Breakdown") with an invented stop. Removed: only stored rule signals are shown (AGENTS #13).
  The HUD's "Mean-reversion Equilibrium / Range" stand-in label is now "No recent rule signal".
- **Short entries shown as EXIT (`web/src/lib/extension-signals.ts`, side panel, HUD)**: 4,321 KK breakdown entries and their
  covers are stored as `signal_type = exit`. Signals now carry the trade action (`buy` / `sell` / `exit` / `cover` from
  `payload.action`) and render as "SELL (SHORT)" / "COVER". Exits and covers carry no stop.
- **Trade plan contradicted the signal**: the plan used the last BUY even after a later exit, or the last price with an
  SMA-based stop for stocks with no signal. A plan is now shown only while the latest signal is a long entry, built from that
  signal's own entry and stop; otherwise the panel says why there is none.
- **Token could leave QuantsPulse**: the settings field accepted any server and the HUD fetched from the broker page's origin
  with the token. Only `https://quantplus-ten.vercel.app` and `http://localhost:3000` are accepted (background, panel, HUD),
  and every quote goes through the background worker.
- **CORS (`web/src/lib/extension-cors.ts`)**: `/api/extension/*` reflected any origin with credentials. Now only extension
  origins get credentials; `/quote` allows other origins without credentials (Bearer only); `/session` gives them nothing.
- **Smaller fixes**: unstyled "Go" button; "▼ -1.50% (₹-38.10)" → "▼ −1.50% (−₹38.10)"; signal labels escaped before HTML
  insertion; manifest/README no longer claim "real-time" (EOD data); version 1.1.0.
- **Download zip (`web/public/downloads/quantspulse-terminal.zip`)**: repackaged with `/` paths and LF endings — the old zip had
  `content-scripts\detector.js`-style names that unpack as flat files on macOS/Linux, so the extension wouldn't load there.
  `extension-syntax.test.mts` now fails if the zip is stale or uses backslashes.
- Tests: `lib/extension-signals.test.mts` (mapping + CORS), `e2e/extension-api.spec.ts` (token only to the extension, no
  stand-in signals, plan only for an open long).

### Fixed — Neutral-state badges failed WCAG contrast (`web/src/components/market/`, `app/app/signals`, `app/admin`)
- `text-muted-foreground` on `bg-muted` is 4.11:1 (needs 4.5:1). It only renders in neutral states, so axe passed until the
  market turned neutral on 2026-10-29 ("Consolidating / Neutral" breadth on `/app`, "Equilibrium" on `/app/markets/INFY`;
  production failed `e2e/a11y.spec.ts` the same way). The nine badges with that pairing now use `text-foreground`
  (`market-breadth-card`, `quantum-audit`, `trade-plan`, signals page, admin console).

### Fixed — EOD sync data integrity, screener ranking, contract-note validation, cron auth (`web/`, `pipelines/eod/`)
- **Native EOD sync wrote unsettled and BSE bars (`web/src/server/privileged/eod-sync.ts`)**: `includeToday` now defaults to
  `false` (settled sessions only, like `last_settled_day` in `eod.py`), so a run before 15:45 IST can't store a partial bar
  that fires alerts and issues signals that are never rewritten. Removed the `.BO` fallback that merged BSE prices into the
  NSE series (and could pick up a different company's ticker; ADR-027 is NSE-only). OHLC validation now matches
  `to_candles()`: a stale open is clamped into the day's range instead of widening high/low (which faked alert crossings),
  inconsistent bars are dropped, and Yahoo's flat zero-volume holiday bars are skipped.
- **Admin "Include today" checkbox couldn't be turned off (`web/src/app/admin/actions.ts`, `maintenance-panel.tsx`)**: an
  unchecked box is absent from the form and was read as "on". Absence now means off, and the box defaults to unchecked.
- **RELIANCE and TCS sank to the end of "Largest first" (`pipelines/eod/universe.py`, `eod.py`, `test_universe.py`)**: Yahoo's
  screener omits `marketCap` on a varying ~1,000 of ~3,600 quotes per call, and `merge()` overwrote good ranks with null
  (166 active equities were unranked, incl. the two largest). `merge()` now keeps the last known rank when Yahoo omits it.
  Ranks already blanked were restored by a universe sync on 2026-10-28 (RELIANCE #1, TCS #5; the 149 still unranked are
  names Yahoo gives no market cap for). Caught by `e2e/writes.spec.ts` (TCS not on page 1).
- **`eod.py` crashed on a Windows console (`pipelines/eod/eod.py`)**: the `→`/`—` progress lines raised `UnicodeEncodeError`
  under cp1252 after the universe writes, aborting the price load. `main()` now sets `errors="replace"` on stdout.
- **Contract-note trades applied unvalidated (`web/src/app/app/portfolio/actions.ts`)**: `applyParsedTrades` receives the
  reviewed trades from the client, so they're now re-validated with zod (positive finite quantity/price, symbol format,
  ≤ 250 rows). Holdings are always stored as NSE (a BSE row never priced), and SELL delete/update errors are reported.
- **Cron secret accepted in the URL (`web/src/app/api/cron/market-eod/route.ts`)**: removed `?token=$CRON_SECRET` (it lands in
  access logs); only `Authorization: Bearer` is accepted, which Vercel Cron and `market-eod.yml` already send.

### Fixed & Enhanced — Multi-Directional Chart Signals & Strategy Count Parity (`web/`, `scripts/`)
- **Strategy Count Badge Mathematical Parity (`web/src/components/charts/price-chart.tsx`)**:
  - Fixed count divergence where `All Plans` displayed a sum that didn't match individual strategy badges (e.g. showing `(96)` when plans showed `(7)`, `(9)`, `(17)`):
    - Removed double-counting where client-side simulated markers were added to already-ingested database signals.
    - Synchronized individual strategy counts so `kkCount + smaCount + rsiCount === totalCount` with 100% mathematical consistency.
    - Added transparent directional counts to `▲ Buy (N)` and `▼ Exit (N)` filter buttons, ensuring every count on screen matches the exact number of markers rendered on the chart.
- **Multi-Directional Chart Signal Rendering Parity (`web/src/components/charts/price-chart.tsx`, `web/src/lib/backtest-engine.ts`, `web/src/lib/trade-plan.ts`)**:
  - Investigated and resolved chart signal display discrepancies where SELL (short breakdown) trades and milestone exits were misrendered or inverted:
    - **Entry vs Exit Directional Distinction**: Explicitly distinguished `action: "buy"` (long entry, arrow up below bar, gain), `action: "sell"` (short breakdown entry, arrow down above bar, loss), `action: "exit"` (long target/stop exit, arrow down above bar), and `action: "cover"` (short target/stop cover, arrow up below bar).
    - **Milestone Labels & Color-Coding**: Resolved label inversion where short covers hitting $+2.0R$ were displayed as green BUY arrows. Now accurately displays `T2 +2R Cover` (gain), `T1 +0.75R Cover` (gain), `SL Cover` (loss), and `5d Cover`.
    - **Active Signal HUD & Timeline Ribbon**: Enhanced crosshair hover HUD and timeline chip strip to render distinctive badges (`▲ BUY`, `▼ SELL`, `★ TARGET`, `★ COVER`, `▼ EXIT`) with R-multiples, P&L percentages, and trade holding durations.
- **Full Nifty 500 Equities Database Signal Ingestion (`scripts/ingest_kk_signals.py`, `web/src/app/app/markets/[symbol]/page.tsx`)**:
  - Resolved PostgREST pagination limit (default 1,000 rows) by implementing recursive pagination across all 3,615 active NSE symbols with explicit corporate name overrides.
  - Ingested 16,687 rich trading signals spanning 2024–2026 across all 500 Nifty equities into Supabase `public.trading_signals`, covering both BUY breakouts and SELL breakdowns with complete target milestone payloads.
  - Increased symbol page `trading_signals` query limit from 40 to 200, ensuring complete historical coverage across multi-year chart views.

### Fixed & Aligned — KK Breakout Empirical Signal Parity, Database Ingestion & Multi-Strategy Precision Audit (`web/`, `scripts/`)
- **Empirical Signal & Target Anchoring Parity (`web/src/lib/backtest-engine.ts`, `web/src/lib/backtest-engine.test.mts`)**:
  - Investigated and resolved divergence between `kk_eod_results_fixed.json` (44,856 empirical trades over 2006–2026 across Nifty 500) and the backtest engine:
    - **Target Anchoring**: Targets ($T1 = \text{trigger} + 0.75R$, $T2 = \text{trigger} + 2.00R$) are now strictly anchored to the planned entry trigger (signal bar extreme), rather than `entryFillPrice`. This eliminates target distortion on confirmation days with opening gaps.
    - **Signal Confirmation Loop**: Removed the `i = maxConfBar + 1` skip when a signal went unconfirmed, advancing bar-by-bar (`i++`). This ensures valid breakout signals occurring during pending confirmation windows are never dropped.
    - **Exact Realized R-Multiple & Slippage Math**: Aligned realized $R$ calculation to match `kk_eod_results_fixed.json` down to 7 decimal places: computes per-leg realized $R$ on actual fill price ($(\text{fill} - \text{exit}) / R_{\text{planned}}$ for SELL and $(\text{exit} - \text{fill}) / R_{\text{planned}}$ for BUY) across all result types (`TARGET_2_HIT`, `TARGET_1_HIT_TIME_EXIT`, `SL_HIT_AFTER_TARGET_1`, `SL_HIT`, and `TIME_EXIT`).
    - **Trade Holding Duration**: Aligned holding window to 5 full sessions after the entry day (`entryBar + 5`).
    - **Multi-Directional Support**: Added support for both BUY and SELL signals (`direction: "both"`) and dual-color chart markers (`KK 20d Breakout Buy` vs `KK 20d Breakdown Sell`).
  - Added targeted unit test in `web/src/lib/backtest-engine.test.mts` validating target anchoring on gap fill and exact R calculation.
- **Database Signal Ingestion & Signals Desk Integration (`scripts/ingest_kk_signals.py`, `web/src/app/app/signals/page.tsx`, `web/src/lib/format.ts`)**:
  - Ingested 7,549 verified historical signals from `kk_eod_results_fixed.json` into Supabase `public.trading_signals` for covered NSE equities.
  - Added `kk_breakout` to `STRATEGIES` on `/app/signals`, enabling filtering by KK 20d Breakout with live quote tracking, asymmetric trade plan milestones, and sentiment exhaustion alerts.
  - Registered `kk_breakout` in `strategyLabel` and `signalDisplayName` in `web/src/lib/format.ts`.
- **Comprehensive Audit of Other Trading Strategies (`web/src/lib/backtest-engine.ts`, `supabase/migrations/`)**:
  - **SMA 20/50 Cross**: Verified exact mathematical parity between TypeScript backtest engine (`f1 <= s1 && f0 > s0` Golden Cross / `f1 >= s1 && f0 < s0` Death Cross) and Supabase PostgreSQL migration (`s20[i] > s50[i] and s20[i-1] <= s50[i-1]`).
  - **RSI Reversal**: Synchronized Wilder RSI 14 boundary comparison operators in `simulateCustomStrategy` (`r1 < rsiOversold && r0 >= rsiOversold` for Buy, `r1 > rsiOverbought && r0 <= rsiOverbought` for Exit) with PostgreSQL `refresh_market_analytics`. Refactored `simulateTechnicalStrategy` to compute true Wilder RSI crossings.
  - **Breakout (Donchian Channel)**: Verified 20-day high breakout entry and 10-day low channel exit logic for lookahead bias and execution accuracy.

### Added — Strategy-Isolated Signal Charts & Dynamic KK 20d Breakout Overlays (`web/`)
- **Strategy Signal Isolation & Multi-Plan Conflict Resolution (`web/src/components/charts/price-chart.tsx`, `web/src/components/charts/market-chart-view.tsx`)**:
  - Resolved trading UX conflict where signals from multiple disparate plans (e.g., SMA Golden Cross trend following, RSI mean-reversion, and Breakout swings) were interleaved on the same candlestick chart, causing confusion.
  - Added an intuitive **Trading Plan / Strategy Isolator** to `PriceChart`:
    - `KK 20d Breakout`: Isolates the chart to 20-bar extreme breakout entry arrows, target milestones, and disciplined exits.
    - `SMA 20/50`: Isolates to Golden and Death cross trend signals.
    - `RSI Reversal`: Isolates to Oversold bounce and Overbought exhaustion levels.
    - `All Plans`: Displays signals across all plans with explicit strategy badges (`[KK 20d]`, `[SMA]`, `[RSI]`).
    - `Clean (Off)`: Completely disables signal markers for pure price action and candlestick pattern inspection.
  - Added dynamic client-side KK Breakout overlay calculation via `generateKkChartMarkers(candles)` in `web/src/lib/backtest-engine.ts`, rendering breakout BUY arrows, $+0.75R$ T1 partial scale-outs, $+2.0R$ T2 targets, stop losses, and 5-day time-stop exits directly on the candlestick chart for all symbols without requiring server round-trips.
  - Added comprehensive unit tests in `web/src/lib/backtest-engine.test.mts` validating `generateKkChartMarkers` output structure, timestamps, and parameters.
  - Added dedicated Playwright E2E suite (`web/e2e/strategy-plan.spec.ts`) validating strategy isolator radio controls, signal chip selection, Clean Mode signal suppression, BacktestLab 4-stage empirical architecture, and trade log milestone execution.
  - Hardened strategy filter count pills for WCAG 2.1 AA color contrast compliance, ensuring axe accessibility passes cleanly in both light and dark modes.

### Added — KK 20-Day Asymmetric Breakout Strategy & Simulator Integration (`web/`)
- **KK 20-Bar Extreme Extension & Asymmetric Breakout Strategy Engine (`web/src/lib/backtest-engine.ts`, `web/src/lib/backtest-engine.test.mts`)**:
  - Implemented `simulateKkStrategy` and extended `simulateCustomStrategy` with the `"kk_breakout"` systematic quantitative model (derived from 20-year empirical backtest `kk_eod_results_fixed.json` spanning 44,856 trades across Nifty 500 equities).
  - Exact core mechanics preserved:
    - **Signal Bar Detection**: Identifies 20-period extremes with configurable extension buffer (default: $\ge 1.0\%$).
    - **Confirmation Window**: Waits up to 5 trading sessions (`confirmation_window_bars: 5`) for an extreme breakout to trigger market fill.
    - **Asymmetric Milestone Targets**: Calculates Target 1 ($+0.75R$) with automatic 50% partial position scale-out, Target 2 ($+2.00R$) for asymmetric payoff ($+1.375R$ net), and initial Stop Loss ($-1.0R$).
    - **Disciplined Time Stop**: Liquidates remaining units at market close after 5 sessions (`trade_window_bars: 5`) if targets or stop loss are not reached (`TIME_EXIT` or `TARGET_1_HIT_TIME_EXIT`).
    - **Setup Filtering**: Defaults to `Long Only (Cash Delivery)` (which delivered +1,030.33 R alpha over 2006–2026) with optional `Both (Long & Short)` for the F&O derivatives segment.
  - Added TradingView **Pine Script v5 generator** (`generateBacktestPineScript`) for `kk_breakout` enabling 1-click export to TradingView charts.
  - Added unit test suite validating signal generation, entry fills, target scale-out math, and Pine Script generation.
- **Interactive BacktestLab UI Integration (`web/src/components/market/backtest-lab.tsx`)**:
  - Added `"KK 20d Breakout"` to the interactive strategy model selector on the Stock Research desk (`/app/markets/[symbol]`).
  - Added interactive parameter adjustment controls for Lookback Period (10d, 20d, 30d, 50d), Extension Buffer (0.5%, 1.0%, 1.5%, 2.0%), Confirmation Window (3d, 5d, 7d), Holding Window (3d, 5d, 7d, 10d), and Setup Direction.
  - Added an intuitive **Architecture Guidance Card** displaying the 4 sequential trade milestones (Signal Bar, 5d Confirmation, 50% Trim @ +0.75R, and Target 2 / 5d Time Exit) ensuring users understand the strategy without confusion.
  - Enriched Trade Log table with `Signal` pills, `Milestone Result` status badges (`Target 2 Hit +1.38R`, `T1 Hit + Time Exit`, `5d Time Exit`, `Stop Loss -1.0R`, `SL after T1 -0.13R`), and `Realized R` multiples.
  - Enriched CSV trade export with Signal, Milestone Result, and Realized R data columns.

### Fixed, Hardened & Polished — Full-History Chart SMAs, Multi-Fill Import Merging, WCAG 2.2 AA Accessibility & Zen Linen Motion System (`web/`, `extension/`)
- **Chart SMA Continuity, Signal Candle Focus & Accessible Data Table (`web/src/components/charts/price-chart.tsx`, `web/src/components/charts/market-chart-view.tsx`, `web/src/components/charts/tradingview-widget.tsx`)**:
  - Fixed moving average truncation on shorter time horizons (`1M`, `3M`, `6M`, `1Y`): `SMA 20`, `SMA 50`, and `SMA 200` are now computed over the full historical candle series before slicing to the visible range so moving averages plot continuously from the leftmost visible bar.
  - Fixed daily `%` change lookup on the leftmost visible candle by resolving the prior session against the full `candles` array.
  - Decoupled `selectedSignal` from the Lightweight Charts creation `useEffect` and added a dedicated range-focus effect so clicking a signal pill in the Signals Timeline smoothly zooms/pans to the signal's candle and displays its OHLCV values without destroying and recreating the chart canvas.
  - Added an accessible, toggleable **Daily OHLCV Table** (`Table`) in `PriceChart` (`MASTER.md` §Charts & WCAG 2.1 AA chart fallback).
  - Restored the unified **Signals Chart** / **TradingView Pro** view switcher in `MarketChartView` and initialized `TradingViewWidget` theme state from `document.documentElement` on mount to prevent double iframe initialization in light mode.
- **Portfolio CSV & Contract Note Multi-Fill Merging & Validation (`web/src/app/app/portfolio/actions.ts`, `web/src/app/app/portfolio/page.tsx`)**:
  - Updated `importHoldingsCsv` and `applyParsedTrades` to track newly inserted holdings in `existingMap` within the same batch so multiple rows or partial fills for the same symbol in a single CSV or contract note merge accurately at the volume-weighted average price (or reduce/close on intraday `SELL`) instead of failing unique constraints.
  - Enforced `segment === "index"` and `!is_active` validation on `BUY` trades in `applyParsedTrades`.
  - Enabled `<EditHolding />` inline editing for all portfolio holdings (including CSV and Contract Note imported positions, not only `source === "manual"`).
- **WCAG 2.1 / 2.2 AA Accessibility, ARIA & Hydration Hardening (`web/src/components/shell/symbol-search.tsx`, `web/src/components/market/quantum-audit.tsx`, `web/src/components/portfolio/csv-import.tsx`, `web/src/components/portfolio/contract-note-modal.tsx`, `web/src/app/app/layout.tsx`)**:
  - Fixed `SymbolSearch` `isMac` detection using `useSyncExternalStore` to prevent SSR/Client hydration mismatches on macOS/iOS, guarded `aria-activedescendant` when `totalItems === 0`, and restricted global `/` and `Ctrl+K` listeners to the visible search input instance (`offsetParent !== null`).
  - Added missing `role="tab"` and `aria-selected` attributes to filter buttons inside `role="tablist"` in `QuantumAudit`.
  - Added `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `Escape`-key dismissal, and backdrop-click dismissal to `CsvImportModal` and `ContractNoteModal`.
  - Added an accessible `Skip to main content` link in `AppLayout` and `scroll-padding-top: 6rem` on `html` (`focus-not-obscured`).
- **Zen Linen Design Tokens, Copy Accuracy & Motion System (`web/src/app/globals.css`, `web/src/app/page.tsx`, `web/src/components/ui/button.tsx`, `extension/`)**:
  - Replaced remaining hardcoded hex colors in `web/src/app/page.tsx`, `web/src/components/charts/price-chart.tsx`, and `web/src/components/ui/button.tsx` with semantic CSS tokens (`--coral-foreground`, `--sma-20`, `--sma-50`, `--sma-200`, `--gain`, `--loss`).
  - Corrected landing page hero subcopy to accurately reflect Basic plan entitlements (`public.plans`) and aligned `TerminalSpecimen` target labels with `0.75R` and `2.0R`.
  - Added `.animate-scale-in`, `.animate-slide-up`, and `.bar-fill` micro-interaction utilities plus comprehensive `@media (prefers-reduced-motion: reduce)` guards across `web/src/app/globals.css`, `extension/sidepanel/sidepanel.css`, and `extension/content-scripts/detector.js`.

### Fixed & Hardened — Trade Plan State Sync, Dynamic CORS Headers, Alias Routing & CSS Animation Integrity (`web/`)
- **Trade Plan Prop Synchronization & Clean Keying (`web/src/components/market/trade-plan.tsx`, `web/src/app/app/markets/[symbol]/page.tsx`)**:
  - Fixed persistent state retention issue when navigating between symbols in `/app/markets/[symbol]`: bound `<TradePlan key={q.symbol} />` and added prop synchronization so switching stocks immediately clears previous entry/stop levels and recalculates fresh asymmetric targets for the active stock.
  - Added user feedback warning when Stop Loss is configured greater than or equal to Entry Price in the interactive position calculator.
  - Corrected invalid Tailwind badge classes (`py-0.2` → `py-0.5`) across `<TradePlan>`, `<QuantumAudit>`, and platform console admin tabs.
- **Dynamic CORS Credentials Support (`web/src/app/api/extension/session/route.ts`, `web/src/app/api/extension/quote/route.ts`)**:
  - Dynamically reflected request `Origin` in `Access-Control-Allow-Origin` with `Vary: Origin` to comply with browser CORS specifications when requests use `credentials: 'include'`, preventing browser request rejections on extension authentication checks.
- **Index Alias Redirection & Command Palette Link Resolution (`web/src/app/app/markets/[symbol]/page.tsx`, `web/src/components/shell/symbol-search.tsx`, `web/src/lib/market.ts`)**:
  - Added automatic alias redirection for popular Indian index names (`FINNIFTY` → `NIFTYFINSERV`, `NIFTY50` → `NIFTY`, `NIFTYBANK` → `BANKNIFTY`, `MIDCPNIFTY` → `NIFTYMIDCAP50`) preventing 404 not found errors.
  - Updated Nifty Financial Services quick benchmark in the global command palette (`symbol-search.tsx`) to link directly to canonical `NIFTYFINSERV`.
  - Added TradingView ticker mapping for `NIFTYFINSERV` and `FINNIFTY` (`NSE:CNXFIN`) in `toTradingViewSymbol`.
- **CSS Animation & Micro-Interaction Fixes (`web/src/app/globals.css`, `web/src/components/portfolio/ai-diagnostic.tsx`)**:
  - Added `.animate-fadeIn` alias to `.animate-fade-in` in `globals.css` so modal dialogs, calculators, and audit cards trigger the smooth 21st.dev fade-in animation.
  - Streamlined "Integrations" link copy in the BYOK diagnostic notice.

### Added & Improved — Advanced AI Portfolio Health Check (BYOK), Desk Reordering & BacktestLab Hardening (`web/`)
- **Advanced AI Portfolio Health Check (BYOK) (`web/src/lib/portfolio-health.ts`, `web/src/components/portfolio/ai-diagnostic.tsx`, `web/src/server/privileged/ai.ts`, `web/src/app/app/portfolio/`)**:
  - **Deterministic Quantitative Health Engine (`portfolio-health.ts`)**:
    - Calculates Herfindahl-Hirschman Index (HHI) concentration, Effective N holdings count (`N_eff`), single-stock allocation alerts (>15%), and sector concentration caps (>35%).
    - Computes momentum dispersion (overbought RSI ≥ 70 vs oversold RSI ≤ 30) and underwater cost-basis drag (>10% unrealized loss).
    - Generates a composite 0-100 institutional health score weighted across Diversification (30%), Sector Exposure (25%), Momentum Dispersion (25%), and Loss Containment (20%).
  - **Targeted AI Diagnostic Modes (`ai.ts`, `actions.ts`, `ai-diagnostic.tsx`)**:
    - Added 4 BYOK diagnostic focus modes: `Comprehensive Diagnostic`, `Risk & Downside Audit`, `Trimming & Rebalancing Plan`, and `Cost-Basis & Tax Drag Audit`.
    - Injects deterministic quantitative KPIs, portfolio concentration metrics, and sector allocations directly into member-encrypted BYOK LLM prompts (Claude 3.7 / GPT-4o / Gemini 2.0).
  - **Portfolio Health HUD & Interactive Actions (`ai-diagnostic.tsx`)**:
    - Instant quantitative health rating HUD showing composite score, HHI rating, Effective N, and dynamic risk/opportunity chips without waiting for LLM generation.
    - Animated multi-stage diagnostic synthesis progress indicators.
    - Formatted AI analysis with interactive ticker links directly navigating to `/app/markets/[symbol]`.
    - Added 1-click **Copy Brief** and **Export Markdown (.md)** actions for local archival.
- **Overview Desk Hierarchy & Layout Reordering (`web/src/app/app/page.tsx`)**:
  - Restructured Overview workspace hierarchy to place **Market Radar** (watchlist equities, user signals, and top headlines) at the top immediately below the summary KPIs.
  - Positioned **Market Breadth & Movers** (`MarketBreadthCard`) full-width directly below Market Radar, providing clear macro market sentiment without displacing user-tracked symbols.
- **BacktestLab Responsive Metric Grid & Parameter Wrapping (`web/src/components/market/backtest-lab.tsx`)**:
  - Replaced cramped 8-column metric row (`lg:grid-cols-8`) with a responsive 4-column grid (`grid-cols-2 sm:grid-cols-4`) with `truncate` and `min-w-0`, preventing horizontal text collisions on high-res and standard screens.
  - Added `flex-wrap` and `min-w-0` to parameter button strips and input groups, eliminating sideways page scroll.

- **Advanced Quantitative Strategy Backtester (`backtest-engine.ts`, `backtest-lab.tsx`)**:
  - Implemented `simulateCustomStrategy` supporting three systematic models:
    - **Dual Moving Average Crossover**: Configurable fast SMA (default 20) and slow SMA (default 50) with golden-cross entries and death-cross exits.
    - **Wilder RSI Mean Reversion**: 14-period smoothed RSI with oversold entry thresholds (e.g. RSI ≤ 30) and overbought/exhaustion exits (e.g. RSI ≥ 70).
    - **Donchian Channel Breakout**: N-period rolling high breakout entry and rolling low exit.
  - Added institutional risk parameters: Stop Loss % (1% - 15%), Take Profit % (2% - 30%), and flexible starting capital presets (`₹25,000`, `₹50,000`, `₹1,00,000`, `₹5,00,000`).
  - Added daily marked-to-market equity curve calculation and maximum peak-to-trough drawdown (`maxDrawdownPct`) metrics.
- **Interactive SVG Equity Curve & Metrics HUD (`backtest-lab.tsx`)**:
  - Rendered a lightweight responsive SVG equity curve comparing systematic strategy performance against a Buy & Hold benchmark.
  - Built interactive hover inspection slice displaying exact date, strategy equity, and benchmark value with delta badge.
  - Metric summary cards: Net Strategy Return, Buy & Hold Return, Strategy Alpha, Win Rate %, Profit Factor, Max Drawdown %, Payoff Ratio, and Average Holding Duration.
- **Filterable Systematic Trade Log with CSV & Pine Script v5 Export**:
  - Full trade execution ledger with filter tabs (`All`, `Wins`, `Losses`), trade duration in days, P&L in ₹ and %, and trigger badges (`strategy`, `stop_loss`, `take_profit`, `end_of_period`).
  - 1-click **Export CSV** action downloading trades directly into a spreadsheet-ready `.csv` file.
  - 1-click **TradingView Pine v5** generator copying clean Pine Script v5 strategy code matching the exact user-configured parameters for live deployment on TradingView.


### Added & Improved — Market Breadth Radar, Global Command Palette, Sector Pulse & E2E Hardening (`web/`)
- **Interactive Market Breadth & Sentiment Radar (`web/src/components/market/market-breadth-card.tsx`, `web/src/app/app/page.tsx`)**:
  - Added an institutional Advance/Decline ratio bar (`up` vs `down`) calculating market breadth and real-time bias (`Broad Advance`, `Risk-Off Drag`, `Consolidating`).
  - Integrated top NSE 500 movers (top 3 gainers and losers) with live `<Delta>` pills and 1-click ticker jumps directly into the signed-in Overview desk.
- **Global Command Palette with Keyboard Navigation (`web/src/components/shell/symbol-search.tsx`)**:
  - Upgraded the top symbol search into a global command palette supporting `Ctrl+K`, `Cmd+K`, and `/` hotkeys with accessible `<kbd>` indicator badges.
  - Added quick benchmark shortcuts (`NIFTY`, `BANKNIFTY`, `FINNIFTY`, `RELIANCE`, `TCS`, `HDFCBANK`) and desk navigation links (`Market Radar`, `Signals`, `Portfolio`, `Research`, `Integrations`).
- **Interactive Position Sizing & Asymmetric Payoff Ladder (`web/src/components/market/trade-plan.tsx`)**:
  - Enhanced the trade plan position calculator with quick capital preset chips (`₹25k`, `₹50k`, `₹100k`, `₹250k`, `₹500k`), risk percentage presets (`0.5%`, `1.0%`, `1.5%`, `2.0%`), and a reset action.
  - Rendered complete asymmetric target payoff spectrum (Stop Loss, T1 +0.75R de-risking, T2 +2.0R systematic target, T3 +3.0R runner).
- **Sector Pulse Rotator (`web/src/components/market/sector-pulse.tsx`, `web/src/app/app/markets/page.tsx`)**:
  - Added horizontal sector rotation strip across all 11 Indian equity sectors (Automobile, Banking, Financials, IT, Pharma, Energy, Metals, FMCG, Realty, Media, Telecom) with 1-click filtering and reset controls.
- **Accessibility & Mobile Layout Hardening (`web/src/components/`, `web/e2e/`)**:
  - Refactored SMA overlay indicators in [`price-chart.tsx`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/components/charts/price-chart.tsx) with solid high-contrast dots and `text-foreground` labels, satisfying WCAG 2.1 AA 4.5:1 color contrast.
  - Fixed mobile horizontal overflow across all pages by enabling responsive header wrapping in [`layout.tsx`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/components/ui/layout.tsx) (`Panel`) and removing restrictive `shrink-0` from `<h2>` titles.
  - Consolidated single-message AI reason rendering on [`markets/[symbol]/page.tsx`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/app/app/markets/[symbol]/page.tsx) to prevent duplicate text strict-mode violations.
  - Fully verified across all 91 Playwright end-to-end tests (90 passed, 0 failures), 67 unit tests, and the 29-migration PGlite isolation suite.


### Added & Improved — AI Model Auto-Detection & Dynamic Provider Selector (`web/src/app/app/integrations/`)
- **Dynamic Provider-Specific Model Selector (`forms.tsx`)**:
  - Replaced the error-prone freeform text input with a curated, provider-tailored dropdown for Anthropic, OpenAI, and Google Gemini.
  - Pre-populates recommended default models (e.g. Claude 3.7 Sonnet for Anthropic, GPT-4o for OpenAI, Gemini 2.0 Flash for Gemini) so members never need to memorize complex model strings.
  - Added "Custom model ID…" fallback option for custom fine-tuned or unlisted enterprise model IDs.
- **Live Model Auto-Detection with API Key Verification (`actions.ts`, `forms.tsx`)**:
  - Introduced [`fetchProviderModelsAction`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/app/app/integrations/actions.ts): queries the official models API of Anthropic (`/v1/models`), OpenAI (`/v1/models`), or Google Gemini (`/v1beta/models`) directly via server-side fetch with the entered key.
  - Added an interactive **"Auto-detect models"** action on the key field that instantly validates the key and updates the dropdown with all active, authorized models available to the member's account.
  - Displays inline real-time status feedback (`✓ Key verified (N models loaded)` or `✕ Key rejected by provider`).
- **Browser Autofill Prevention**:
  - Eliminated accidental email/username auto-population into the model field (e.g. browser autofill inserting emails into model inputs) by switching to a `<Select>` element and tagging the API key input with `autoComplete="new-password"` and `data-lpignore="true"`.

### Improved & Hardened — Chrome DevTools Extension Audit & Industry-Standard Logic Upgrades (`extension/`, `web/`)
- **Chrome DevTools Audit Completed (Zero Errors, Zero Warnings)**:
  - Audited the Chrome extension runtime across background service worker (`background.js`), side panel controller (`sidepanel.html`/`sidepanel.js`), and content script (`detector.js`) using Chrome DevTools Protocol via Chromium.
  - Result: **0 runtime errors, 0 uncaught exceptions, 0 warnings**.
- **Industry-Standard Logic & Resilience Upgrades (`extension/background.js`)**:
  - **Session & Startup Lifecycle**: Registered `chrome.runtime.onStartup` alongside `onInstalled` so toolbar click side panel behavior persists reliably when Chrome reboots or restores sessions.
  - **Intelligent In-Memory Caching (30s TTL)**: Added high-speed quote caching (`quoteCache = new Map()`) to eliminate redundant network round-trips when rapid-flipping between charts or watchlist instruments.
  - **Network Retry Resilience**: Added transient network retry logic (`fetchWithRetry`) with backoff before failing requests on intermittent connection hiccups.
- **Institutional Trading UX Upgrades (`extension/sidepanel/`)**:
  - **Pro Keyboard Shortcuts**: Added `/` and `Ctrl+K` / `Cmd+K` global shortcuts to instantly focus the symbol search input; `Escape` clears focus or closes open settings drawers. Added `<kbd>/</kbd>` shortcut indicator badge.
- **Fixed Side Panel Load State & Added Compile-Time CI Guard (`extension/sidepanel/sidepanel.js`, `web/src/lib/extension-syntax.test.mts`)**:
  - Fixed a missing closing brace on `loadSymbol` in `sidepanel.js` which previously caused a V8 compilation `SyntaxError: Unexpected token ')'` that aborted side panel script execution upon opening and left the UI frozen on the default "No active chart detected" placeholder.
  - Added [`web/src/lib/extension-syntax.test.mts`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/lib/extension-syntax.test.mts) checking manifest validity and running `node -c` compilation on all extension scripts during `npm run test:unit` to guarantee zero syntax regressions.
  - Re-packaged and verified [`web/public/downloads/quantspulse-terminal.zip`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/public/downloads/quantspulse-terminal.zip).

### Improved & Polished — 21st.dev Inspired Micro-Animations & Fluid Visual Interactions (`web/src/`, `extension/`)
- **21st.dev "Zen Linen" Smooth Motion & Micro-Interactions**:
  - Queried 21st.dev MCP catalog for modern micro-interaction patterns by `serafimcloud` and top community designers.
  - Upgraded [`Button`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/components/ui/button.tsx) with tactile micro-interactions: added smooth cubic-bezier transitions, micro-scale down on active click (`active:scale-[0.985] active:translate-y-0.5`), and subtle shadow depth.
  - Added live pulse dot support to [`Badge`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/components/ui/data.tsx) (`pulse?: boolean`), rendering a gentle radar ping animation (`animate-ping-soft`) for live production, active signals, and connected states.
  - Enhanced [`MarketClock`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/components/shell/market-clock.tsx) with a soft pulsing live ring during active NSE cash market sessions.
  - Introduced `.panel-interactive` class in [`globals.css`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/app/globals.css) and [`layout.tsx`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/components/ui/layout.tsx): smooth card elevation (`translateY(-2px)`), subtle border tone tint, and shadow bloom on hover without jarring layout shifts.
  - Enhanced table rows (`tr`) with smooth `duration-150 ease-out` hover background fades.
  - Added modern focus rings to form inputs and selects with subtle tone border transitions.
  - Refined [`TickerTape`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/src/components/shell/ticker-tape.tsx) and sidebar navigation with smooth hover highlights and edge fade masks.
  - Enhanced Chrome Extension Side Panel ([`extension/sidepanel/sidepanel.css`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/extension/sidepanel/sidepanel.css)) with smooth card hover transitions and a live pulsing auth indicator dot. Repackaged into [`quantspulse-terminal.zip`](file:///c:/Users/kaival.trapasia/Desktop/Quantpluse_kp/web/public/downloads/quantspulse-terminal.zip).

### Added & Secured — Chrome Extension Public Distribution & Account-Gated Signal Protection (`extension/`, `web/`)
- **Public 1-Click Extension Distribution**:
  - Replaced manual developer/repository clone workflows with direct 1-click ZIP package download (`quantspulse-terminal.zip`, 48 KB) available via `/api/extension/download` and `/downloads/quantspulse-terminal.zip`.
  - Added primary download buttons and clear 3-step setup guides to the marketing homepage (`web/src/app/page.tsx`) and the integrations desk (`web/src/app/app/integrations/page.tsx`).
  - Generalized `extension/README.md` for public consumers with simple unpack-and-load instructions for Google Chrome, Brave, Edge, and Opera.
- **Strict Authentication Guard & Anti-Theft Protection (`web/src/app/api/extension/`)**:
  - Protected `/api/extension/quote` with server-side authentication verification. Requests lacking a valid Supabase JWT or cookie session return `401 Unauthorized` with `{ error: "account_required", login_url, signup_url }`.
  - Created `/api/extension/session` route enabling the extension to test and confirm account validity via Bearer token or session cookies.
- **Web-to-Extension Auth Synchronization Bridge (`extension/content-scripts/auth-sync.js`)**:
  - Created background sync bridge running on QuantsPulse web domains (`quantplus-ten.vercel.app` and `localhost:3000`). Automatically detects the member's active Supabase session from `localStorage` and securely persists `qpAuthToken`, `qpUser`, and `qpAuthenticated` in `chrome.storage.local`.
  - Listens for tab login/logout events and dispatches `QP_AUTH_STATUS_CHANGED` across the browser.
- **Locked Extension States & Real-Time Auto-Unlock (`extension/`)**:
  - **Locked On-Chart HUD (`renderHudLocked`)**: When an unauthenticated user or non-member opens a broker chart, the HUD renders a sleek lock pill (`🔒 Account Required · Sign In to Unlock Signals` + `3 Mo Free` trial link) while completely hiding all proprietary trend signals, 1.0R risk stops, and profit targets.
  - **Locked Side Panel (`#auth-gate`)**: Unauthenticated users see a branded lock view with 1-click links to `/login` and `/signup`, plus an interactive `Check Login Status` verification button.
  - **Zero-Reload Live Unlock**: When a member signs in on the website, `QP_AUTH_UPDATE` signals open broker tabs to instantly transition from the locked view to active live signals without requiring page refresh.

### Added & Secured — Landing & Integrations Experience with Core Algorithm IP Protection (`web/src/app/`, `web/src/components/`)
- **Intellectual Property Protection for Core Trading Logic**:
  - Removed open Pine Script source code display and public code generator panels from the marketing landing page (`web/src/app/page.tsx`) to protect the platform's proprietary quantitative algorithms, moving average parameters, and risk/target formulas from unauthorized exposure and scraping.
  - Encapsulated `PineScriptGeneratorPanel` (`web/src/components/market/pine-script-generator-panel.tsx`): removed exposed raw `<pre>` code text blocks on screen. The indicator package is now presented as a protected platform asset that copies directly to the member's clipboard for pasting into TradingView without rendering raw algorithmic source on screen.
- **QuantsPulse Chrome Extension Terminal Showcase (`web/src/app/page.tsx`)**:
  - Added dedicated `#terminal` section highlighting the Chrome Extension Heads-Up Display (HUD) and slide-over research panel with live on-chart specimens across 23+ Indian brokers (Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan, TradingView).
  - Outlined on-chart HUD capabilities: live signals (`ACTIVE LONG` / `EXIT`), Entry base, 1.0R trailing stop, and scale-out targets (T1 +3%, T2 +6%, T3 +12%) with 0 broker credentials or trading key requirements.
- **Enhanced Integrations Desk (`web/src/app/app/integrations/page.tsx`)**:
  - Restructured the integrations portal into 4 comprehensive operational modules: Chrome Extension Terminal with installation instructions, Protected TradingView Indicator Integration, Multi-Broker CSV Portfolio Import (Zerodha, Groww, Angel One, ICICI Direct, Upstox), and Bring-Your-Own-Key (BYOK) AI encryption.
- **Updated Marketing Dateline, Steps & FAQs**:
  - Updated marketing dateline to feature 3,600+ listings, 17:00 IST automated settlement, broker HUD overlays, TradingView chart integration, and 1-click CSV imports.
  - Added FAQs covering Chrome Extension broker compatibility, TradingView charts, and CSV portfolio imports.

### Fixed — Chrome Extension Symbol & HUD Sync on Chart Switching (`extension/`)
- **Resolved Stale Symbol Bug when Switching Charts on Broker Platforms**:
  - Fixed an issue where switching instruments/charts on the same broker terminal (Choice FinX, TradingView, Zerodha Kite, Groww, etc.) caused the extension on-chart HUD and Side Panel to remain stuck on the previously detected symbol.
  - **Eliminated Watchlist Row-0 Trap**: Previously, un-scoped queries (e.g. `.scrip-name`, `div[class*='symbolName']`, `[data-name='symbol-title']`) matched the first row of the broker's watchlist table in document order rather than the active selected row, repeatedly locking the detected symbol to row 0. Replaced with `extractActiveWatchlistItem` scoped exclusively to active/selected elements (`.instrument.selected`, `.active`, `[aria-selected='true']`).
  - **Prioritized Live On-Chart Elements Over Stale URL Parameters**: In TradingView and broker chart wrappers, the active toolbar button (`#header-toolbar-symbol-search`) and legend series title (`[data-name='legend-source-title']`, `.pane-legend-line`) now take highest precedence over static URL search parameters that may not update during client-side charting changes.
  - **Enhanced Multi-Token Ticker Parsing**: Upgraded `extractTickerFromText` to extract tickers from legend strings containing multiple tokens (e.g. `"TCS, 1D, NSE O:3850..."`), preventing regex failures on multi-token chart headers.
  - **Enabled CharacterData & Attribute DOM Observers**: MutationObserver in `extension/content-scripts/detector.js` now watches `characterData: true` and `attributes: true` with filters on `data-symbol-full`, `aria-label`, and `class`, detecting in-place chart changes that do not alter the DOM node hierarchy.
  - **Hooked HTML5 History API for Instant SPA Navigation**: Added hooks for `history.pushState`, `history.replaceState`, `popstate`, and `hashchange` to trigger immediate debounced symbol re-probing whenever single-page broker applications navigate client-side.
  - **Unblocked Multi-Frame & Storage Sync Deadlocks**:
    - Fixed a blocking condition in `detector.js` storage listener where `matchesCurrent` discarded incoming quote updates if `quote.symbol !== lastDetectedSymbol`, which incorrectly prevented new symbol updates from applying.
    - Updated `renderHud` in subframes to resolve and render into the top window's HUD root if hosted at the parent level.
    - Added direct `chrome.runtime.onMessage` listener, `tabs.onActivated`, and `tabs.onUpdated` event handlers in `sidepanel.js` to ensure the side panel immediately syncs on chart changes.
    - Prioritized on-chart frame extraction results in `sidepanel.js` over background iframe fallbacks.

### Added — Automated EOD Market Price Ingestion & Admin Manual Sync Engine (`web/src/`, `pipelines/eod/`)
- **Native TypeScript EOD Market Price Sync Engine**:
  - Implemented `syncEodPrices` in `web/src/server/privileged/eod-sync.ts` directly fetching and reconciling daily candles from Yahoo Finance v8 chart API without requiring external Python environments on serverless hosts.
  - Automatically identifies active universe (symbols watched in radars, held in portfolios, or monitored in price alerts, plus benchmarks) or full NSE universe (~3,600 symbols).
  - Implemented dual-exchange backfill fallback: automatically queries BSE (`.BO`) to patch missing or NaN candles if Yahoo's NSE (`.NS`) feed experienced upstream gaps.
  - Enabled active market bar acceptance (`includeToday`): captures today's live trading bar during market hours so symbols immediately show today's active prices rather than remaining frozen on prior days.
  - Added `--live` parameter to `pipelines/eod/eod.py` allowing command-line ingestion of the current session's candles.
  - Automatically chains into downstream database pipelines: triggers `svc_refresh_market_analytics` (RSI & SMAs), `svc_refresh_research` (valuation/factor stances), and `svc_run_eod_notifier` (trailing stops and alert delivery).
- **Automated Vercel Cron Scheduling (`web/vercel.json`)**:
  - Added daily automated schedules to `vercel.json`:
    - `30 11 * * 1-5`: Mon–Fri at 11:30 UTC = **17:00 IST** (immediately after daily session settles).
    - `30 14 * * 1-5`: Mon–Fri at 14:30 UTC = **20:00 IST** (evening settlement retry).
- **Secured Cron Route Handler (`/api/cron/market-eod`)**:
  - Added timing-safe authorization via `CRON_SECRET` for Vercel Cron and external webhook triggers.
- **Admin Console Manual Sync Panel (`web/src/app/admin/`)**:
  - Added prominent **EOD Market Price Ingestion Engine** controls to the Admin Maintenance Panel (`web/src/app/admin/maintenance-panel.tsx`).
  - Allows platform admins to manually trigger 1-click syncs anytime across:
    - *Watched & Held Active Universe* (~50–200 symbols, fast sync in ~15–30s).
    - *Top 100 Large Caps + Indices*.
    - *Full NSE Universe* (~3,600 symbols).
    - *Custom Tickers* with arbitrary scrip input.
  - Added backfill window selection (5 days, 10 days, 30 days) and instant execution summary.
- **Enhanced GitHub Workflow Resilience (`.github/workflows/market-eod.yml`)**:
  - Added dual-path execution supporting Python `pipelines/eod/eod.py` when direct database secrets exist, and fallback webhook to `/api/cron/market-eod` when `CRON_SECRET` is set, with clear diagnostic notices.

### Fixed — TradingView Pine Script Indicator Strategy Alignment with QuantsPulse Core Engine (`extension/`)
- **Resolved Indicator vs Platform Strategy Discrepancy**:
  - Identified cause of signal mismatch between TradingView Pine Script and QuantsPulse web portal: the Pine Script generator previously evaluated fast candle breakouts (`ta.crossover(close, sma20)`) and trend breaks (`ta.crossunder(close, sma20)`), creating rapid whipsaw buy/exit triggers during sideways consolidation. In contrast, the QuantsPulse platform database calculates macro `sma_20_50_cross` (20/50 SMA Golden/Death cross) and `rsi_reversal` (14-day RSI oversold 30 bounce / overbought 70 exit).
  - Upgraded `generateCleanPineScript` in both `extension/content-scripts/detector.js` and `extension/sidepanel/sidepanel.js` with dual Strategy Modes:
    1. **`QuantsPulse Core (Platform Match)`** (Default): Exact mathematical match with backend PostgreSQL `svc_refresh_market_analytics`, evaluating `sma_20_50_cross` and `rsi_reversal` with identical targets and stops.
    2. **`Fast Swing (Price vs SMA20)`**: Available for traders seeking fast price crossovers against the 20-period moving average.
  - Eliminated false whipsaw exit signals during tight consolidation periods, ensuring signals pasted into TradingView match the main portal charts identically.

### Added — Production-Grade Admin Console Operations, Database Inventory & Financial Ledger (`web/src/app/admin/`, `web/src/server/privileged/`)
- **System Health & Market Session Header**:
  - Added live telemetry badges showing active database connection pooler status (`aws-0-ap-northeast-2.pooler.supabase.com:5432`), NSE Cash Market session clock (IST time, Open/Closed/Pre-Open status, Next bell countdown), and EOD market price dataset freshness.
- **Tabbed Operational Architecture**:
  - Replaced single long page layout with high-clarity tabbed navigation: `Overview & Operations`, `Database & Pipelines`, `Accounts & Plans`, `Financial Ledger`, `News Feeds`, and `Audit & Security`.
- **Database Storage & Universe Inventory**:
  - Added `getDatabaseInventory()` in `src/server/privileged/admin.ts` querying live table record counts across 11 core application tables (`prices_daily`, `market_symbols`, `trading_signals`, `research_notes`, `news_articles`, `profiles`, `tenants`, `watchlists`, `holdings`, `price_alerts`, `audit_log`).
  - Added universe segment distribution breakdown (Main Board EQ, SME, Indices, ETFs) and storage matrix with automated growth warning triggers.
- **1-Click Pipeline & Maintenance Operations**:
  - Added interactive operations panel with zero-code 1-click execution:
    1. *Recalculate Market Analytics*: Triggers `svc_refresh_market_analytics` RPC to recalculate 14-day Wilder RSI and 20/50/200 SMA across active symbols.
    2. *Rebuild Research Notes & Stances*: Triggers `svc_refresh_research` RPC to update valuation/momentum algorithmic stances.
    3. *Dispatch EOD Alerts & Exit Signals*: Triggers `svc_run_eod_notifier` RPC to evaluate trailing stops and user price alert thresholds.
    4. *Ingest Live RSS Feeds*: Triggers `ingestNews` pipeline across registered RSS feeds.
  - Implemented pending execution states and clear success/error action feedback.
- **Plan Activation Duration Presets**:
  - Added quick preset buttons (`1 Mo`, `3 Mo`, `6 Mo`, `12 Mo`) to the manual workspace plan activation form that auto-calculate expiration dates and INR pricing amounts (`₹1,499`, `₹3,999`, `₹6,999`, `₹11,999`).
- **Financial Ledger & Immutable Audit Trail**:
  - Added `getRecentPayments()` displaying recent plan activations, Razorpay reference IDs, amounts, and statuses.
  - Added `getRecentAuditLogs()` rendering platform-level audit security events with actor email, action type, IP address, and timestamp.
  - Enforced ADR-025 / §3 rule 3 compliance: user holdings, portfolios, watchlists, and BYOK AI keys remain strictly private and unexposed.

### Added — Prominent Buy & Exit Arrow Signal Markers in On-Chart HUD & Sidepanel (`extension/`, `web/`)
- **Rendered On-Chart Buy (`▲ BUY`) and Exit (`▼ EXIT`) Arrow Signal Markers in Extension HUD**:
  - Replicated the visual indicator arrow markers from the main QuantsPulse portal charts (`price-chart.tsx`) directly inside the floating On-Chart HUD overlay across all display modes (`compact`, `signal_only`, and `full` card).
  - Designed crisp vector arrow badges (`▲ BUY` in Gain Emerald `#0B6A4E` / `#34D399` and `▼ EXIT` in Loss Cinnabar `#A8380B` / `#F87171`) with matching directional markers, high-contrast typography, and trigger price badges.
  - Added mini arrow signal chips right in the HUD header adjacent to the active symbol tag for instant visibility.
- **Added Recent Signal Markers Sequence Timeline**:
  - Extended `/api/extension/quote` payload with `recentSignals`, passing historical buy/exit strategy signals.
  - Rendered a horizontal timeline of recent arrow signals in both the Full HUD Card and Sidepanel (`[▲ BUY @ ₹...] ➔ [▼ EXIT @ ₹...]`), allowing traders to trace recent signal progression on their charts.
  - Implemented dynamic trend fallback baseline when a symbol lacks historical `trading_signals` records in the database, ensuring valid directional signals are always available.
- **Enhanced Sidepanel Signal Card**:
  - Upgraded `#signal-badge` in `sidepanel.html` and `sidepanel.js` with matching SVG upward/downward arrows and high-contrast pill styling.
  - Added `#signal-history-row` in sidepanel displaying recent alternating chart arrow signals.

### Fixed — False 'ALERT' Symbol Extraction & Prioritized TradingView Official Router (`extension/`)
- **Eliminated False Positive 'ALERT' Symbol Extraction**:
  - Identified root cause where TradingView's top toolbar contains an "Alert" button (`#header-toolbar-alerts`) that matched over-broad button queries (`div[class*='text-'][class*='button-']`), causing the word `"Alert"` to be extracted as the active ticker instead of the charted equity (`HDFCBANK`).
  - Purged all generic button selectors from `tvHeaders` in both `detector.js` and `sidepanel.js`, strictly restricting queries to elements explicitly carrying `symbol` in their ID, class, data-name, title, or aria-label attributes (`#header-toolbar-symbol-search`, `[data-name='header-toolbar-symbol-search']`, `button[id*='symbol-search']`, `button[aria-label*='Symbol']`, etc.).
  - Added full toolbar button action terms (`ALERT`, `ALERTS`, `REPLAY`, `COMPARE`, `PUBLISH`, `UPGRADE`, `UNDO`, `REDO`, `SAVED`, `LAYOUT`, `LAYOUTS`, `SNAPSHOT`, etc.) to the `EXCLUDED` and `EX` exclusion sets.
- **Prioritized Official TradingView URL Router Parameter (`?symbol=`)**:
  - Positioned TradingView's official router parameter (`?symbol=NSE:HDFCBANK`) at the absolute top of the detection ladder on `tradingview.com`, guaranteeing instant, 100% accurate symbol resolution that updates seamlessly as the user switches charts without relying on DOM scraping.
- **Enhanced Legend Attribute Inspection**:
  - Expanded legend series title element inspection to read `data-symbol-full` and `title` attributes before visible text content, ensuring canonical exchange tickers (`NSE:HDFCBANK`) are captured even when user preferences format the legend with full company names (`HDFC Bank Limited · 1D · NSE`).
- **Fixed `parseTabMeta` Symbol Extraction**:
  - Resolved gap in `parseTabMeta` where colon-separated symbols (`?symbol=NSE:HDFCBANK`) and `/symbols/` paths in URL metadata were bypassed when Choice tokens were absent.

### Fixed — False 'ONLINE' Symbol Extraction & Prioritized On-Chart TradingView Engine Detection (`extension/`)
- **Eliminated False Positive 'ONLINE' Symbol Extraction**:
  - Identified root cause where Choice FinX web portals with titles such as `"Choice FinX - Trade Online"` or `"Online Trading"` triggered un-guarded title token fallbacks (`title.split(...)`), taking the word `"ONLINE"` as a ticker before any chart inspection took place.
  - Expanded `EXCLUDED` and `EX` exclusion dictionaries across `detector.js` and `sidepanel.js` with comprehensive web and broker UI terms (`ONLINE`, `TRADE`, `TRADING`, `PLATFORM`, `BROKER`, `BROKING`, `PORTAL`, `APP`, `FREE`, `DEMAT`, etc.).
  - Added strict title parser (`extractTickerFromTitle`) restricting page title extraction strictly to structured formats (known indices, `NSE:TICKER`, bracketed `(TICKER)`, or tickers followed by live price/change), completely preventing arbitrary marketing words from being interpreted as symbols.
  - Restricted token splitting in `extractTickerFromText` strictly to short UI labels (≤ 3 tokens like `"Q NIFTY"` or `"RELIANCE EQ"`), eliminating word extraction from full sentences.
- **Inverted Detection Priority Ladder (Chart Authoritative Truth First)**:
  - Reordered detection order across both `detector.js` and `sidepanel.js` so that the **Embedded TradingView Chart Header Toolbar Button** (e.g. `Q NIFTY`, `RELIANCE`) and **Chart Legend Series Title** (`Nifty 50 · 1D · NSE`) are inspected first with highest authority.
  - Demoted page title analysis from step 1 to the final fallback step (step 6).
- **Added Choice FinX Exchange Security Token Mapping**:
  - Implemented `CHOICE_INDEX_TOKENS` and `resolveChoiceToken()` mapping Choice FinX URL segment/token parameters (e.g. `symbols=1@26000` -> `NIFTY`, `1@26009` -> `BANKNIFTY`, `1@26037` -> `NIFTYFINSERV`, `1@26014` -> `NIFTYMIDCAP50`, `1` -> `SENSEX`, `12` -> `BANKEX`) for instant pre-render index detection.
- **Enhanced Empty / Error State Recovery**:
  - Replaced generic error text in `showError()` with interactive quick-switch buttons for major Indian symbols (`NIFTY`, `BANKNIFTY`, `RELIANCE`, `TCS`), allowing instant one-click recovery.

### Fixed — Extension Infinite Reload Loops, Cross-Tab Fighting & UI Flashing (`extension/`)
- **Eliminated Cross-Tab Symbol Ping-Pong Loops**:
  - Added visibility guard `if (document.hidden) return;` at the entry of `detectSymbol()` and attached a `visibilitychange` listener in `detector.js`. Inactive/background tabs no longer broadcast periodic detections, eliminating the infinite battle where background tabs continuously overrode the foreground chart symbol.
- **Removed Storage Event Hijacking & Inter-Frame Collisions**:
  - Removed global `storage.onChanged` symbol override in `detector.js` that previously caused all open tabs to re-detect and broadcast back whenever any tab changed storage.
  - Restricted `activeQuoteData` HUD updates in `detector.js` strictly to quotes matching the active chart's symbol or currently visible tab, preventing HUD thrashing.
  - Guarded subframes (`window !== window.top`) to only scan if the frame contains actual chart/scrip indicators, avoiding outer page header ticker banners (like persistent `NIFTY 50` tickers) from conflicting with inner iframe chart instruments.
  - Eliminated generic `<header>` and `[class*='top-bar']` querySelectors on broker portals that previously picked up static site-wide ticker banners instead of active charts.
- **Normalized Canonical Index Symbols**:
  - Standardized `KNOWN_INDICES` and ticker cleaners across `detector.js` and `sidepanel.js` to canonical database symbols (`NIFTYFINSERV`, `NIFTYMIDCAP50`, `NIFTY100`), eliminating alias ping-pong where `FINNIFTY` triggered repeated re-fetches against canonical responses.
- **Removed Background Worker Idle Wakeup Re-Injection**:
  - Removed top-level `injectIntoExistingTabs()` call in `background.js` outside `onInstalled`. The Manifest V3 service worker no longer re-injected content scripts into all tabs every time it woke up from idle.
- **Optimized Sidepanel Rendering & Debounced State**:
  - Added in-flight request guard (`isLoading`) and non-destructive smooth updating in `loadSymbol()`: the sidepanel no longer wipes content or flashes the loading spinner when refreshing an already loaded symbol.
  - Avoided writing to `chrome.storage.local` when the detected symbol hasn't changed, preventing cascading `storage.onChanged` cycles.

### Fixed — Universal Broker Index Detection & Choice FinX Multi-Frame Sync (`extension/`, `web/`)
- **Resolved Broker Index Detection Failure (Choice FinX, Zerodha Kite, Upstox, Dhan, etc.)**:
  - Identified root cause where `choiceindia.com` and other broker domains were omitted from `isSupportedFinanceUrl()` in `sidepanel.js`, causing the active tab inspector to bypass the Choice FinX charting tab and fall back to stale TradingView tabs or cache.
  - Added full multi-broker coverage across `manifest.json`, `background.js`, `detector.js`, and `sidepanel.js` for **Choice FinX** (`choiceindia.com`), **Zerodha Kite**, **Groww**, **Dhan**, **Angel One**, **Upstox**, **Fyers**, **Kotak Neo**, **ICICI Direct**, **Motilal Oswal**, **Paytm Money**, **5paisa**, **Sharekhan**, **HDFC Sky**, **Axis Direct**, **Shoonya**, and **Alice Blue**.
- **Multi-Word Indian Index Parsing (`KNOWN_INDICES`)**:
  - Implemented prioritized phrase-matching dictionary (`KNOWN_INDICES`) before word tokenization, ensuring multi-word index descriptions (e.g. `Nifty Bank · 15 · NSE`, `Bank Nifty`, `CNX Bank`) resolve cleanly to `BANKNIFTY` without being mistakenly truncated to `NIFTY`.
  - Added support for `BANKNIFTY`, `NIFTY`, `FINNIFTY` (mapped to `NIFTYFINSERV`), `MIDCPNIFTY` (mapped to `NIFTYMIDCAP50`), `NIFTYJR` (mapped to `NIFTY100`), `SENSEX`, and `BANKEX`.
- **Embedded Broker Chart Iframe Direct Injection (`all_frames: true`)**:
  - Enabled `"all_frames": true` in `manifest.json` content scripts and `allFrames: true` in `chrome.scripting.executeScript`, ensuring detector scripts hook directly inside nested charting canvas windows (such as Choice FinX `/tv/tv-charts` or broker-hosted TradingView chart frames).
  - Added direct messaging probe (`POLL_DETECTED_SYMBOL`) between side panel and active broker content scripts for instant symbol sync upon opening or clicking refresh.
- **Backend Index Tolerance & Alias Resolution** (`web/src/server/privileged/extension.ts`):
  - Expanded `cleanExtensionSymbol` with Indian index aliases (`FINNIFTY` -> `NIFTYFINSERV`, `MIDCPNIFTY` -> `NIFTYMIDCAP50`, `NIFTYJR` -> `NIFTY100`, `NIFTY BANK` -> `BANKNIFTY`).
  - Added fallback quote search across `market_snapshot` without hardcoded exchange constraints so index requests succeed regardless of whether `NSE` or `BSE` is passed.

### Fixed — Chrome Extension Context Invalidation, Lag Debounce & HUD Body Portal (`extension/`)
- **Eliminated `Extension context invalidated` Runtime Errors**:
  - Implemented `isExtensionValid()` lifecycle guard and `safeSendMessage` / `safeStorageGet` / `safeStorageSet` wrappers in `detector.js`, catching context teardown whenever the unpacked extension is reloaded at `chrome://extensions`.
  - Added auto-cleanup (`destroyContentScript()`) that cleanly disconnects all `MutationObserver`s, clears all `setInterval` / `setTimeout` timers, and detaches event listeners when an orphaned context is detected, preventing rogue background callbacks from throwing unhandled exceptions.
  - Added singleton guard `window.__qp_detector_loaded` at the entry of `detector.js` preventing duplicate instances from being evaluated in the same document.
  - Removed duplicate `chrome.scripting.executeScript` injections from `pushHudDirectToTabs` in `sidepanel.js` and `tabs.onActivated` / `tabs.onUpdated` in `background.js`, stopping runaway script re-injection loops.
- **Fixed TradingView Glitching & Main-Thread Lag**:
  - Debounced symbol detection with a 300ms scheduler (`scheduleDetect`), stopping high-frequency TradingView canvas mutations from flooding the main thread with repetitive DOM inspection.
- **Fixed Edge-Case Ticker Tokenization & State Resilience**:
  - Refined `extractTickerFromText` and `parseTabMeta` regular expressions (`/[\s,·|_\/\(\)]+/`) to preserve hyphens in tickers, preventing hyphenated symbols like `BAJAJ-AUTO` and `M&M-FIN` from being truncated into separate tokens.
  - Added null-safe fallbacks in `sidepanel.js` for stocks without active trade plans or sentiment audits, clearing static placeholder targets with clean em-dashes (`—`) instead of stale template numbers.
  - Reset `isDragging = false` in `destroyContentScript()` to prevent stuck drag states if context teardown occurs mid-gesture.
  - Returned `false` by default in `background.js` `onMessage` handler for unhandled message types, preventing dangling message ports and timeout errors.

### Enhanced — Stateful Clean Pine Script v5 Engine & Multi-Layout On-Chart HUD (`extension/`)
- **Stateful Clean Pine Script v5 Engine**:
  - Eliminated repeating "EXIT" signal clutter with an internal state machine (`tradeState`: Cash vs In-Trade) guaranteeing clean alternating `▲ BUY` -> `▼ EXIT` cycles.
  - Eliminated stepped staircase lines extending into empty space: active target lines (T1, T2, T3) and stop loss now plot strictly during active positions and cleanly terminate on exit.
  - Added a native **TradingView Executive Dashboard Table** in the top-right corner displaying live Trade Status, Entry & Return %, Stop Loss (1.0R), Targets (0.75R/2.0R), RSI, and Trend.
  - Added TradingView user settings (`input.*`) allowing users to toggle dashboard table, signal arrows, targets, stops, and SMAs with one click.
- **Multi-Layout On-Chart HUD Customizer (Option 1)**:
  - Added an interactive customizer drawer (`⚙`) on the HUD and Side Panel letting users choose between 4 distinct layouts: **Full Terminal Card**, **Compact Bar (32px)**, **Targets Roadmap Only**, or **Signal Badge Only**.
  - Added granular component checkboxes (Signal Card, Targets T1-T3, Key Levels, RSI Sentiment) and quick-snap corner docking (`↗ Top-Right`, `↖ Top-Left`, `↘ Bottom-Right`, `↙ Bottom-Left`).
  - Saved preferences immediately to `localStorage` and `chrome.storage.local` across all tabs and symbols.

### Added — Live On-Chart Signal HUD & Native TradingView Pine Script Indicator (`extension/`)
- **Direct On-Chart Floating Signal HUD** (`extension/content-scripts/detector.js`):
  - Injects a responsive, non-intrusive floating HUD overlay directly on broker charts (**TradingView**, **Zerodha Kite**, **Groww**, **Dhan**, **Angel One**).
  - Uses **isolated Shadow DOM** so styling never conflicts with or distorts broker chart layouts.
  - Features draggable repositioning (with `localStorage` coordinate memory), 1-click collapse/minimize to a compact 32px status chip, and minimize-to-bubble.
  - Displays real-time quantitative signal badge (`▲ BUY SIGNAL` / `▼ EXIT SIGNAL` / `⚖ CONSOLIDATION`), entry price, protective stop loss, asymmetric trade plan targets (Stop 1R, T1 0.75R, T2 2.0R, T3 3.0R), SMAs, and RSI sentiment.
- **Native Pine Script Indicator Generator**:
  - Added 1-click **"📋 Copy TradingView Pine Script"** in both the on-chart HUD and the Side Panel.
  - Generates verified Pine Script v5 code ready to paste into TradingView's Pine Editor to paint native signal arrows and target levels directly on candlesticks.
- **Overlay Control & Settings**:
  - Added "Show Live Signal HUD on Broker Charts" preference toggle in the side panel settings drawer and `chrome.storage.local`.
- **Background Relay Proxy** (`extension/background.js`):
  - Background service worker proxies `FETCH_QUOTE_DATA` requests to bypass any host-page Content Security Policy (CSP) on TradingView or broker domains.

### Fixed & Enhanced — Chrome Extension Proactive Tab Sync & TradingView DOM Detection (`extension/`)
- **Proactive Tab Sync & In-Page Injection**: Fixed empty state on newly opened side panels by adding `"scripting"` permissions, auto-injecting `detector.js` into pre-existing open financial tabs on startup/install, and querying active tabs directly upon panel load.
- **TradingView DOM Priority over Query Strings**: Prioritized active header toolbar button (`#header-toolbar-symbol-search`), dynamic document title, chart legend, and active watchlist items over URL search parameters, resolving desyncs where TradingView's query string lagged behind chart clicks (e.g. `HINDUNILVR` clicked while URL still had `MANALIPETC`).
- **Interactive Sync Refresh**: Re-wired header "↻" refresh button to immediately re-probe the active tab DOM with spin animation feedback, and added click/keyup listeners for instantaneous detection on TradingView watchlist changes.

### Added — QuantsPulse Indian Equities Terminal Chrome Extension (`extension/`)
- Built complete Manifest V3 Chrome Extension utilizing the native **Chrome Side Panel API** (`chrome.sidePanel`).
- **Auto Ticker Detection** (`extension/content-scripts/detector.js`): Automatically detects active stock tickers across **TradingView**, **Zerodha Kite**, **Groww**, **Dhan**, **Angel One**, **Google Finance**, and **Yahoo Finance**.
- **Docked Side Panel Terminal** (`extension/sidepanel/`): Renders live quotes, active Buy/Exit signals, Asymmetric Trade Plan milestone targets (Stop 1R, T1 0.75R, T2 2.0R, T3 3.0R), Key Technical Levels (SMA 20/50/200, 52W range), and RSI Sentiment Audit directly beside the chart.
- **Backend API** (`web/src/app/api/extension/quote/route.ts` & `web/src/server/privileged/extension.ts`): High-speed CORS-enabled endpoint providing quantitative analysis payloads for any NSE stock.
- Styled strictly with **Zen Linen** design system tokens (light/dark mode, Inter & JetBrains Mono typography, Coral accents, ink gain/loss).

### Fixed & Restored — Live News Feeds for Moneycontrol, Business Standard & Corporate Announcements
- Restored active status (`is_active = true`, `status = ok`) for **Moneycontrol · Market reports**, **Moneycontrol · Business**, **Business Standard · Markets**, and **NSE · Corporate announcements** via public syndication RSS feeds (ADR-028).
- Fixed the previous `0 items` issue caused by deprecated legacy XML endpoints and WAF bot-blocking: feeds now ingest 100 items per source with zero errors.
- Enhanced `web/src/server/privileged/news.ts` to support syndicated corporate announcements in addition to direct NSE PDF links, linking regulatory announcements directly to covered NSE equities.
- Added migration `supabase/migrations/20261001000029_news_feeds_live_syndication.sql` (applied and verified).

### Changed — Full-Width Chart Layout & Reorganized Key Levels & Alerts (`/app/markets/[symbol]`)
- Made the TradingView Chart full width (`100%` widescreen) by removing the constricting `xl:grid-cols-[minmax(0,1fr)_340px]` sidebar layout.
- Increased chart canvas height to `h-[420px] md:h-[480px] lg:h-[520px]` to provide expansive desktop breathing room for candles, volume, and Buy/Exit signals.
- Relocated **Key levels**, **Price alert**, and **Your position** (when held) directly below the chart in a clean, responsive multi-column grid (`grid-cols-1 md:grid-cols-2 lg:grid-cols-3`).
- Positioned the full-width **Trade plan & targets** milestone roadmap beneath the stats row, followed by Research Notes and Quantum Audit.
- Cleaned up UI controls conforming strictly to Zen Linen design system rules (zero emojis, token-only styling).

### Added & Verified — Quantitative Signal Logic & Sentiment Exit Node Protocol
- Added `getAlphaLevel` and `computeExitNodeHistory` in `web/src/lib/trade-plan.ts` conforming to user sentiment exit scan protocol (PDF §6 & `QuantAnalysis`):
  - Enforces minimum +1.5% consecutive step (`eventPrice > lastRefPrice * 1.015`), RSI threshold (`RSI >= 60`), and Alpha Level tiering (`SENTIMENT PEAK` for RSI ≥ 80, `NODE LEVEL 2` for RSI ≥ 70, `ALPHA TARGET` otherwise).
  - Validated with unit tests in `web/src/lib/trade-plan.test.mts` matching the exact multi-node worked example from the user specification (59/59 unit tests passing).
- Enhanced `<QuantumAudit>` (`web/src/components/market/quantum-audit.tsx`) with historical sentiment exit logs rendering in the expandable roadmap drawer.
- Integrated quantitative discount gap analysis (>10% below cost basis) and portfolio breadth evaluation (13–15 stocks optimal diversification target) into `portfolioHealthReadWithMyKey` in `web/src/server/privileged/ai.ts`.

### Added & Fixed — Unified Single TradingView Chart View (`/app/markets/[symbol]`)
- Eliminated confusing dual-chart tab switcher ("TradingView Signals" vs "BSE Live Widget"): unified the market page into **one single, crystal-clear TradingView Chart**.
- All verified Indian stock candles, Volume, SMA 20/50/200 overlays, and Buy (`▲`) & Exit (`▼`) strategy signals now live in a single, focused workspace.
- Added direct "TradingView Web ↗" launcher link in the header for fast access to TradingView's full external workstation.
- Fixed symbol fallback issue where Indian stocks defaulted to Apple Inc (`AAPL`) in the embed widget: added `toTradingViewWidgetSymbol` in `web/src/lib/market.ts` routing to `BSE:${symbol}` for free iframe compatibility.
- Fixed strategy label mismatch: added `signalDisplayName` in `web/src/lib/format.ts` ensuring exit signals are accurately labeled "SMA Death Cross" or "RSI Overbought Pullback" (rather than erroneously saying "Golden Cross").
- Replaced bulky 8-card ledger grid with an ultra-compact **Signals Timeline Ribbon** (~36px height) using high-contrast pills (`▲ BUY` / `▼ EXIT`) that click to highlight candle parameters.
- Streamlined chart controls into a single compact header row with tight padding and unified pill styling.
- Fixed signal label overlap and collisions on candlesticks:
  - Implemented `deduplicateChartSignals` (`web/src/lib/trade-plan.ts`) merging multiple same-day triggers (e.g. `MA + RSI`) and proximity filtering consecutive exit runs in "Clean Triggers" mode.
  - Replaced long overlapping text banners with clean, high-visibility arrow glyphs (`▲` and `▼`) with optional compact label toggle.
  - Added **Active Signal HUD**: Real-time crosshair banner displaying signal details upon hovering any trigger candle.
- Upgraded `<PriceChart>` (`web/src/components/charts/price-chart.tsx`) with full TradingView Lightweight Charts features:
  - High-visibility QuantsPulse **Buy / Exit strategy markers** directly on the candlesticks (`▲ Buy`, `▼ Exit`) with signal filters (All / Buy / Exit).
  - Built-in interactive **technical indicator overlays**: SMA 20 (Amber), SMA 50 (Sky Blue), SMA 200 (Purple), and Volume histogram.
  - Interactive **Chart Type switcher**: Candlesticks vs Area/Line chart.
  - Active signal detection in hover crosshair readout showing trigger strategy and price.
  - Quick launcher linking directly to the official TradingView web chart for the exact symbol (`https://in.tradingview.com/chart/?symbol=NSE:${symbol}`).
- Updated `<MarketChartView>` (`web/src/components/charts/market-chart-view.tsx`) with explicit **TradingView Signals** (primary verified NSE data with signals) and **BSE Live Widget** tabs.
- Added 8 unit tests across `market.test.mts` and `trade-plan.test.mts` (56/56 passing).

### Added — Official NSE Holiday Calendar & Session Accuracy (`lib/market.ts`)
- Integrated official NSE Cash Market trading holiday calendar for 2025, 2026, and 2027 into `web/src/lib/market.ts`.
- `nseSession(now)` detects all national and exchange holidays (Republic Day, Holi, Good Friday, Independence Day, Gandhi Jayanti, etc.) and returns precise labels (e.g., `Closed · Gandhi Jayanti`).
- Integrated special support for Diwali evening Muhurat Trading sessions (18:15 to 19:15 IST).
- Added 7 dedicated unit test cases in `web/src/lib/market.test.mts`.

### Added — Contract Note Ingestion via BYOK AI (`/app/portfolio`)
- Implemented `parseContractNoteWithMyKey` in `web/src/server/privileged/ai.ts` and `<ContractNoteModal>` in `web/src/components/portfolio/contract-note-modal.tsx`.
- Securely parses broker contract notes (Zerodha, Groww, Angel One, ICICI Direct, HDFC Securities, Upstox) using the user's BYOK LLM key without saving documents or plaintext prompts.
- Review table before applying trades; automatically merges BUYs with existing holdings at the volume-weighted average price and deducts SELLs.

### Added — Interactive Backtest Lab (`/app/markets/[symbol]`)
- Built pure simulation engine in `web/src/lib/backtest-engine.ts` with unit tests in `web/src/lib/backtest-engine.test.mts`.
- Integrated `<BacktestLab>` (`web/src/components/market/backtest-lab.tsx`) replacing static ledger tables:
  - Dynamic SIP vs Lump Sum calculator with quick installment presets (₹5k, ₹10k, ₹25k, ₹50k) and custom inputs.
  - Rule Strategy Simulation (SMA 20/50 Golden Cross and SMA 20 Pullback) displaying Win Rate %, Total Return %, Profit Factor, and Max Drawdown %.
  - Complete historical trade breakdown log.
- **1-Click Alert Arming on Trade Plan**: Added direct 1-click price alert buttons to each milestone card (Stop Loss 1R, Target 1 0.75R, Target 2 2.0R, Target 3 3.0R) in `TradePlan` (`web/src/components/market/trade-plan.tsx`) via `quickArmAlert`.
- **Indian Broker CSV Importer**: Integrated smart holdings importer (`web/src/components/portfolio/csv-import.tsx`) supporting Zerodha Console/Kite, Groww, Angel One, Upstox, Dhan, and generic CSV/TSV exports:
  - Automatically identifies broker-specific header columns (Instrument, Qty, Avg Cost, etc.).
  - Strips exchange suffixes (`-EQ`, `.NS`, `.BO`, `-BE`) and currency prefixes (`₹`, `Rs`, `INR`).
  - Merges positions with existing holdings using weighted average buy prices ($q_{new} = q_0 + q_1$, $avg = \frac{q_0 p_0 + q_1 p_1}{q_0 + q_1}$).
  - Live client-side preview table validating symbols against the NSE market registry prior to import.
  - Unit-tested with 5 dedicated test cases in `web/src/lib/csv-parser.test.mts` (37/37 test suite passing).

### Added — BYOK AI Intelligence & Interactive Research Expansion
- **Portfolio Health & Concentration Diagnostic (`/app/portfolio`)**:
  - Implemented `portfolioHealthReadWithMyKey` in `web/src/server/privileged/ai.ts` and `<AiPortfolioDiagnostic>` in `web/src/components/portfolio/ai-diagnostic.tsx`.
  - Computes Herfindahl-Hirschman Index (HHI), single-stock concentration risk, sector weight imbalances, and portfolio-wide RSI momentum alignment.
  - Synthesizes risk diagnosis using the user's own BYOK key (Claude, OpenAI, Gemini) with zero stored prompts or telemetry.
- **Interactive Symbol AI Research Chat (`/app/markets/[symbol]`)**:
  - Implemented `symbolResearchChatWithMyKey` and `<SymbolAiChat>` (`web/src/components/research/symbol-ai-chat.tsx`).
  - Provides interactive Q&A grounded exclusively in verified market facts, moving averages, RSI exhaustion nodes, signals, and recent headlines.
  - Pre-baked research prompts for fast analysis with zero hallucinations.
- Integrated automated sentiment exhaustion scanning into `/app/alerts`:
  - Monitors all held and watched stocks across the user's account against critical RSI exhaustion boundaries.
  - Automatically raises alerts for stocks entering Node 3 Sentiment Peak ($\ge 80$) or Node 2 Overbought ($\ge 70$) with clear scale-out warnings, or Node 0 Oversold Accumulation ($\le 30$).
  - One-click navigation directly to the stock's Trade Plan and sizing calculator.

### Added — Quantum Sentiment Audit Scanner (Portfolio & Market Radar)
- Interactive `<QuantumAudit>` component (`web/src/components/market/quantum-audit.tsx`):
  - Audits all portfolio holdings and Market Radar stocks simultaneously against their entry base, current LTP, and RSI exhaustion nodes.
  - Displays instant KPI overview: total audited count, Sentiment Peak (Node 3) alerts, Overbought (Node 2) alerts, Momentum Expansion (Node 1) runners, and Oversold Accumulation (Node 0) mean-reversion setups.
  - Interactive source tabs (`Portfolio Holdings` vs `Market Radar`) and node category filters (`Exhaustion`, `Momentum`, `Oversold`).
  - Action guidance per position (e.g., partial profit de-risking and trailing stop advice on overbought exhaustion).
  - Expandable Asymmetric Target Roadmap drawer revealing $T_1 (+0.75R)$, $T_2 (+2.0R)$, and $T_3 (+3.0R)$ levels.
- Embedded `<QuantumAudit>` into `/app/portfolio` (audits user's actual holdings against purchase price base) and `/app/watchlist` (audits watched radar symbols).
- Implemented `auditStockSentiment` in `web/src/lib/trade-plan.ts` with 3 dedicated unit tests (29/29 test suite passing).

### Added — Signals Desk Milestone Tracker & Sentiment Badges
- Upgraded Signals Desk (`/app/signals`):
  - Added quantitative desk overview metrics strip: Active BUY Signals, T1+ De-risked (≥ +0.75R), T2+ Core Targets (≥ +2.0R), and Sentiment Exhaustion Warnings (Node 2/3 RSI ≥ 70).
  - Added interactive milestone filter tabs (`All`, `T1+ Targets`, `In Progress`, `Exhaustion`).
  - Added real-time tracking of asymmetric targets ($T_1, T_2, T_3$) in the signals table with visual target hit highlights.
  - Added dynamic milestone badges (`T3 (+3.0R)`, `T2 (+2.0R)`, `T1 (+0.75R)`, `+X.XR`, `Stop Breached`).
  - Added RSI sentiment exhaustion node indicators (`Node 3 Peak`, `Node 2 Overbought`, `Node 1 Momentum`, `Equilibrium`, `Oversold`) with live RSI index.
  - Implemented `evaluateSignalProgress` in `web/src/lib/trade-plan.ts` with 6 dedicated unit tests (26/26 test suite passing).

### Added — Quantitative Trade Plan & Capital-Constrained Position Sizing
- Quantitative trade plan model (`web/src/lib/trade-plan.ts`) with asymmetric multiples ($T_1 = 0.75R$ de-risking, $T_2 = 2.0R$ core target, $T_3 = 3.0R$ trend runner) and unit tests in `web/src/lib/trade-plan.test.mts`.
- Capital-constrained position sizing fixing prototype audit Issue #6: unconstrained fractional sizing previously led to 300%+ leverage on tight stops. Units are strictly bounded by available cash ($\min(\lfloor \text{riskBudget} / R \rfloor, \lfloor \text{capital} / \text{entry} \rfloor)$), with an active shield badge and max-loss protection.
- Quantitative sentiment exhaustion classifier (`evaluateSentiment`): categorises 14-period RSI into actionable exhaustion nodes (Node 3: Sentiment Peak $\ge 80$, Node 2: Overbought $\ge 70$, Node 1: Momentum Expansion $\ge 60$, and Node 0: Oversold Accumulation $\le 30$).
- New interactive `<TradePlan>` component (`web/src/components/market/trade-plan.tsx`) embedded directly on stock market pages (`/app/markets/[symbol]`), anchored dynamically to active rule-based buy signals or key moving average support (SMA 20/50).

### Added — the whole NSE market (ADR-027)
- Coverage went from 43 hand-picked stocks to **3,571 symbols**: every NSE equity Yahoo lists (main board + SME
  Emerge), 13 major ETFs and 21 NSE indices (NIFTY 50, Bank Nifty, sector indices, India VIX …).
- `pipelines/eod/universe.py` + `eod.py --sync-universe` (daily in `market-eod.yml`): screener → names, market-cap
  rank, Yahoo sector (one vocabulary for every symbol), segment, vendor ticker (SME `-SM`); existing names, history
  and retirement notes kept; delisted symbols retired only when the screener answer looks complete. New symbols get
  their full `history_days` on the next run; downloads in chunks of 100; analytics/research in batches under the 8 s
  PostgREST limit; reads paged past the 1,000-row cap. Tests `test_universe.py`.
- Migration 26 `whole_market`: `market_symbols.segment / vendor_ticker / mcap_rank / history_days / status_note /
  successors`; `market_quotes` (latest quote per symbol, written by the analytics refresh) behind `market_snapshot`;
  `refresh_market_analytics(days, symbols)` rewritten per symbol with arrays (same rules, same 1,039 dev signals);
  `refresh_research_notes(symbols)`; `search_symbols(q)`; news-search cursor for the 300 largest + anything watched or
  held (trigger); retention sized for the free tier (candles per `history_days`: 760 core / 400 others; daily RSI 40 d;
  research notes 10 d). Migration 27: `research_latest` gains `segment`, `mcap_rank`, `score_change`.
  Migration 28: `exact_sma` running sums computed in exact decimal arithmetic to prevent float rounding noise.
- App: header search is server-side (`/api/symbols`, ranked; stocks, ETFs, indices with last price); add-symbol and
  add-holding forms suggest as you type; ticker = indices + 30 largest; Markets and Research filter by segment, use the
  fixed sector list and paginate (100/page, `Pager`); Overview breadth counted in the database, leaders/laggards among
  the 500 largest; indices can't be held.
- Fixed mobile navigation and header overflow: Panel header text truncation on small screens, restored Zen Linen
  design tokens and icon sizes for mobile bottom bar, and fixed portfolio form accessibility/label associations
  with external datalists to prevent test timeouts and ensure full compliance.
- Retired symbols explain themselves: TATAMOTORS (demerged 14 Oct 2025) shows a note with links to TMPV and TMCV on
  its page and in watchlists, and adding it says what to use instead.
- News matching with 3,600 names: automatic name/ticker matching limited to the 500 largest + indices, a hit inside a
  longer matched name is dropped ("Bank of India" in "State Bank of India"), "Reserve Bank of India" isn't Bank of
  India; per-company search matches any size.
- Owner account (amandubey7977@gmail.com): Pro Plus until 3 Oct 2028 and platform admin, via `admin_activate_plan`.

### Fixed — repeated headlines; dropped ticker in the EOD job
- Google News search re-issues a new redirect URL for the same story, so URL-based dedupe let repeats in (16 of
  1,263). Migration 25 `news_story_dedupe`: `story_hash` (normalised headline + publish second, set by trigger,
  unique), existing repeats merged into the oldest row with their symbol links, and
  `svc_store_news_articles(jsonb)` (service_role) storing a batch with `on conflict do nothing` across both keys and
  returning an id for every input. `privileged/news.ts` stores through it. Test `supabase/tests/06_news_dedupe.sql`.
- `eod.py`: yfinance's threaded download sometimes drops a ticker ("database is locked" in its tz cache — TECHM on
  1 Oct marked that run failed); misses are now retried one at a time.
- Tests: `03_news_research.sql` no longer collides with real history on the live project.
- Verified: Bajaj Auto −7.62 %, Maruti −4.86 %, Infosys +4.11 % on 1 Oct match the day's headlines
  ("tumbles 8 %", "tanks 5 %", "jumps 4 %"); audit 0 failures; 2 Oct (Gandhi Jayanti) correctly has no candle.

### Added — market data accuracy audit + split/bonus handling
- `pipelines/eod/audit.py` (read-only): stored candles vs a fresh Yahoo download (exact), sanity checks (OHLC,
  duplicates, gaps, >18 % one-day moves, stale symbols, `HISTORY_FROM`), and independent pandas recomputation of
  everything the app shows — `market_snapshot` (last, prev close, change, change %, 52-week high/low, RSI), Wilder RSI
  history, every SMA 20/50 and RSI-reversal signal, SIP backtests. Runs after each `market-eod.yml` load; a mismatch
  fails the run. First run on live data: **1,678 checks, 0 failures**.
- `eod.py`: Yahoo rescales a stock's whole history after a split/bonus; the daily run now detects that
  (`split_symbols`, "Stock Splits" column) and re-fetches `FULL_HISTORY_DAYS` (800) for that stock, then rewrites its RSI.
- GitHub Actions secrets set by the owner; `market-eod.yml` and `news-ingest.yml` verified green on GitHub.

### Changed — real end-of-day prices from Yahoo Finance (ADR-026)
- New `pipelines/eod/eod.py` (yfinance 1.7): daily NSE candles for every active symbol → `market_candles`, then
  `svc_refresh_market_analytics` → `svc_refresh_research` → `svc_run_eod_notifier`. Skips today's bar until 15:45 IST,
  rejects inconsistent OHLC, refuses to write if more than half the universe returns nothing. Unit tests
  `pipelines/eod/test_eod.py` (in CI). Scheduled by `.github/workflows/market-eod.yml` (17:00 + 20:00 IST, Mon–Fri).
- Migration 24 `market_analytics`: `private.refresh_market_analytics(days)` — **Wilder** RSI(14) (was a simple
  14-day mean), SMA 20/50 crosses, RSI reversals, monthly-SIP ledgers — one implementation for real and dev data
  (the dev seed now calls it). Signals get a natural unique key and are append-only (notifier ledger keys stay
  valid). `svc_refresh_market_analytics`, `svc_run_eod_notifier` (service_role only). pg_cron passes moved after
  the pipeline as backstops (analytics 17:55, notifier 18:00, research 18:05 IST).
- Universe is reference data now: `supabase/seed/ref_market_symbols.sql` (prod-safe). Tata Motors demerger:
  `TATAMOTORS` inactive; `TMPV` and `TMCV` added (aliases too). Yahoo files pre-demerger prices under TMPV, so the
  pipeline ignores TMPV history before 14 Oct 2025 (`HISTORY_FROM`).
- Live project: synthetic candles/signals/RSI/ledgers/notes purged (signal id sequence kept), ~2 years backfilled
  (22,106 candles, 43 symbols), analytics + research rebuilt. `NEXT_PUBLIC_MARKET_DATA_MODE=live`.
- UI: price source shown on Markets and symbol pages (`PRICE_SOURCE` in `lib/market.ts`); landing FAQ and Terms
  describe the data. e2e "sample prices" test is mode-aware.
- Tests: `supabase/tests/05_market_analytics.sql` (Wilder reference values, idempotency, grants, broker objects gone).

### Removed — broker connections (ADR-025, supersedes ADR-007)
- Migration 23 `remove_broker`: drops `broker_connections`, `private.broker_credentials`, `svc_put/get_broker_credentials`,
  enum `broker_code`, `portfolios.broker_connection_id`, `'broker'` holding/portfolio source, consent purpose
  `broker_data_access`, plan feature `broker_connect`; `export_my_data()` rewritten without brokers.
- Web: Integrations is AI keys only; broker form/actions, `connectBroker`, broker consent (welcome + settings), portfolio
  broker badge, deletion step and copy (landing, legal, workspace privacy matrix) removed. Holdings are entered by hand.

### Fixed — email confirmation on production
- Diagnosed: Supabase rejected the production redirect and fell back to its Site URL (`localhost:3000`) — the
  Auth URL allow-list needs the production domain (owner action in the dashboard).
- Expired/used links (`otp_expired`) now land on a clear sign-in message with a **Resend confirmation email** form;
  signing in before confirming offers the same. `resendConfirmation` action (no account enumeration, rate-limit aware).
- E2E: expired-link and unconfirmed sign-in flows covered (auth suite 9/9).

### Deployed — Vercel (2026-10-01)
- Production: **https://quantplus-ten.vercel.app** (Vercel project `quantplus`, root directory `web`).
- Functions pinned to **icn1 (Seoul)**, next to the Supabase project (ap-northeast-2); the project default was iad1 and
  overrode `vercel.json` under Fluid compute, so it was changed via the API (`resourceConfig.functionDefaultRegions`).
- Env vars set for production + preview (secrets as *sensitive*); `NEXT_PUBLIC_SITE_URL` = production URL.
- `web/vercel.json`: region + daily cron `/api/cron/news` (04:30 UTC = 10:00 IST; Hobby allows daily — the 30-min
  schedule stays in GitHub Actions). `.vercelignore` keeps secrets and non-app folders out of uploads (patterns anchored
  with `/` — an unanchored `supabase/` also removed `web/src/lib/supabase/` and broke the first build).
- Verified on production: full Playwright suite **83 passed** (`E2E_BASE_URL=https://quantplus-ten.vercel.app`),
  cron endpoint ingest OK (115 new headlines, 42 notes, 8 s), HSTS on, bundle secret check passed in the Vercel build.

### Fixed — full code & logic review (2026-10-01)
Three parallel reviews (SQL, server, UI) + PGlite probes; every confirmed issue fixed and covered by a test.

**Security**
- Open redirect: `next=/\evil.com` and `/\t/evil.com` escaped the old prefix check. New `lib/safe-next.ts` (URL-API
  based) used by sign-in, sign-up, email confirm and onboarding. Unit + e2e tests.
- Single active device now enforced in `requireSession()` for every page **and server action** (was layout-only, so a
  displaced device kept working until reload); new `/device` page; export route returns 403. Device registration is one
  transaction (`svc_register_device`) — concurrent sign-ins no longer collide.
- Admins could remove co-admins (only the owner may): RLS policy tightened.
- `authenticated` no longer holds TRUNCATE/REFERENCES/TRIGGER (TRUNCATE bypasses RLS and the audit-log trigger).
- Symbol-limit bypass via UPDATE of `symbol`: column no longer updatable (holdings: only quantity/avg price).
- Suspended organisations: invites can't be accepted; the access-token hook skips suspended tenants.
- Secret scanners strip quotes around env values; bundle check also scans prerendered HTML/RSC.

**Logic**
- EOD notifier rewritten: sections isolated (one bad row can't cancel the day's alerts); alerts only count prices after
  the alert was set/edited; expired plans don't fire alerts (and can't re-arm them); exit-signal window covers weekends;
  plan-expiry reminders for anything ending within 7 days; dedupe in `private.notification_ledger` so deleting a
  notification doesn't resend it.
- Research refresh: active symbols only, no division by zero, safe numeric casts, ledger-deduped stance notifications.
- `my_entitlements`, member directory and admin search prefer the live subscription over a later-ending cancelled one.
- Account deletion refuses (owned organisations) **before** revoking brokers or deleting files.
- News: ingest is idempotent and race-safe (upsert on `url_hash`), links are stored for every candidate, failures still
  record feed health and refresh research; relink pages past the 1000-row cap and never leaves articles unlinked;
  per-stock feeds and AI facts return the *newest* headlines (aliased inner-embed filter, 14-day window).
- AI: Gemini invalid-key (400 `API_KEY_INVALID`) handled; `effort` only sent to models that accept it.
- Holding edits validated (blank no longer saves 0); admin rename/owner leave no longer report false success.

**UI**
- Phones can reach every page (bottom-bar "More" sheet) and have stock search.
- "Mark all read" no longer hides later notifications; research stance counts stay correct while filtered; News filters
  reset the pagination cursor; portfolio and invite-role selects keep their value after an error; role select reverts
  on failure; holding edit shows errors; new-list and rename forms keep text.
- Invite → sign-up → onboarding → back to the invite (`next` carried through).
- Overview note: the named holding moved in the portfolio's direction; exact signal count.
- Copy matches the code: no broker-sync or "instant" claims, sample-price disclosure in the FAQ, billing says "plan ends".
- Accessibility: factor chips have glyphs + labels, chart readout no longer floods screen readers, search combobox
  announces the active option, ticker can be paused (button + focus), compact ₹ units round correctly, true minus signs.

### Tests
- `supabase/tests/04_hardening.sql` (16 checks); `00_verify` now asserts (incl. dangerous grants, security_invoker views).
- E2E fixtures now pass the project's device settings (mobile tests really run at 390px); new e2e for redirects,
  device takeover blocking actions, phone navigation, stance counts. **83 passed**, 1 skipped (phone-only test on desktop).

### Verified
- Access-token hook enabled by the owner: full Playwright suite **81 passed, 0 skipped**, including all write flows
  (radar add/remove, Basic 10-symbol limit, portfolio weighted-average merge, alerts, export, organisation + invite).
- `DB_confi` removed by the owner; keys and DB password unchanged and working.

### Fixed
- Forms lost what the user typed when the server returned an error (React 19 resets forms after each action).
  New `components/ui/use-echo-action.ts` restores non-secret fields after an error; used by alert, radar, holding,
  portfolio, organisation, invite, broker, AI-key and profile forms. Covered by `writes.spec.ts`.
- E2E: wait for the radar server action before navigating; exact label matching; scope alerts to `main` (Next's route
  announcer also has `role="alert"`).
- CI `tsc` failed on a clean checkout: Next route types (`PageProps`, `LayoutProps`) are generated, not committed.
  Added `npm run typecheck` (`next typegen && tsc --noEmit`) and use it in CI and the docs.

## [0.2.0] — 2026-10-01

### Added — live database
- All migrations applied to Supabase project `lrjedvwzmeunxvkezffw` (Seoul, PG 17) via the session pooler;
  synthetic market seed + reference aliases loaded; all DB test suites pass **on the live project**.
- `supabase/scripts/apply.mjs` (`migrate | status | seed ref|dev | test`) — records versions in
  `supabase_migrations.schema_migrations` (Supabase-CLI compatible). Credentials from gitignored `supabase/.env`.

### Added — news & research
- 17 `news_research`: `news_sources` (10 feeds), `news_articles`, `news_article_symbols`, `news_symbol_aliases`,
  `news_search_cursor`, `research_notes`; view `symbol_news_stats`; `private.refresh_research_notes()` (5 weighted,
  explained factors -> constructive/neutral/cautious) + `svc_refresh_research()`; stance-change notifications;
  cron `research-notes`, `retention-news`, `retention-research`.
- 18 disable feeds that block automated readers (Moneycontrol x2, Business Standard, NSE filings) — ADR-014.
- 19 view `research_latest`. 20 members may read `news_sources.is_active`.
- `web/src/lib/news/{feed,match,tone}.ts` (RSS/Atom parser, company matcher with sibling-entity guard, published
  tone lexicon) + unit tests; `server/privileged/news.ts` (`ingestNews`, `relinkRecentArticles`, `newsSourceHealth`);
  `npm run ingest:news` (+ `--relink`); `/api/cron/news` (Bearer `CRON_SECRET`); admin "Fetch news now" + feed health.
- Pages `/app/research` (Research desk) and `/app/news`; research note + headlines on every stock page; stance column
  and headlines panel on Overview; sidebar items.
- BYOK AI research read (`server/privileged/ai.ts`): Anthropic SDK (`claude-opus-5-5` default, server-side refusal
  fallbacks), OpenAI and Gemini via REST; metering only in `ai_usage_logs`, prompts/answers never stored.
- "Sample prices" label while `NEXT_PUBLIC_MARKET_DATA_MODE=synthetic`.

### Added — security
- `scripts/secret-scan.mjs` + `.githooks/pre-commit` (formats + exact local secret values); history scan clean.
- `web/scripts/check-bundle-secrets.mjs` as `postbuild`. `docs/SECURITY.md`.
- DB URL removed from the web app env (web never needs the superuser password).
- 21 `user_delete_cleanup`: deleting a user deletes their personal workspace (found 32 orphans from test runs; cleaned).

### Added — testing & CI
- Playwright suite `web/e2e/*` (desktop 1440 + mobile 390, system Chrome): public site, auth, onboarding consents,
  single-device takeover, every page renders with no console errors or sideways scroll, research/news/markets
  behaviour, outside-in security checks, axe WCAG 2.1 AA. Result: **74 passed, 7 skipped** (write flows need the
  access-token hook).
- `.github/workflows/ci.yml` (secret scan, types, lint, unit, build, DB harness) and `news-ingest.yml` (schedule).

### Fixed
- Matching linked "NTPC Green" to NTPC (sibling-entity guard). Digit class lost in tone regexes. Factor scores rendered
  as raw floats. Mobile page widened to 925px by an `sr-only` label escaping its scroll container (TableWrap now
  `relative`).
- Contrast: split gain/loss into *mark* (charts) and *ink* (text) tokens; `coral-ink` for coral text; neutral badge and
  sidebar chip text. ARIA: `role="img"` on labelled bars, `aria-current` instead of `aria-pressed` on links, valid
  `<dl>` in the chart readout, focusable scroll regions. Plan-gate grammar and container-query layout.
- Isolation test made PG16+-compatible (`grant analytics_reader to current_user` inside the rolled-back tx).

### Decided
- Plan limits confirmed by the owner: Basic 10 radar / 0 portfolio, Pro 15 / 15, Pro Plus unlimited (ADR-019).

## [0.1.0] — 2026-10-01

### Added — database (`supabase/`)
- Migrations 01–13: the spec (§5.1–5.13) as ordered files — tenancy, identity/billing, user financial data,
  BYOK/contract notes, analytics/audit, market data, entitlements, RLS, signup trigger + JWT hook, admin/tenant
  RPCs, storage, `analytics_reader` role.
- 14 `app_support`: `market_snapshot` view, `my_entitlements()`, `track_event()`, realtime publication, §8 retention cron jobs.
- 15 `service_rpcs`: `svc_*` bridge to the private schema (ADR-003).
- 16 `eod_notifier`: `private.run_eod_notifier()` + cron (ADR-006).
- `seed/dev_market_data.sql`: synthetic 2-year EOD data for 42 NSE names, RSI, SMA cross + RSI reversal signals, SIP backtests.
- `tests/01_isolation.sql`: all 18 spec §9 cases plus RPC/BYOK/service-bridge checks; `tests/02_eod_notifier.sql`.
- `tests/harness`: PGlite runner with Supabase shim (ADR-009).

### Changed — vs. the spec (marked `[QP change]` in SQL)
- Enabled `pg_cron` in foundations (spec used `cron.schedule` without it).
- Symbol limits count distinct symbols; existing symbols don't consume slots (ADR-005).
- Unique keys on `holdings` / `watchlist_items` include `user_id, tenant_id` — closes an existence oracle (ADR-004).
- `analytics_reader` role creation made re-runnable.

### Added — web app (`web/`)
- Next.js 16 app, Zen Linen theme (ADR-002), Inter / Playfair Display / JetBrains Mono, Phosphor icons.
- Auth: sign in, sign up with consent, password reset, `/auth/confirm`; proxy session refresh and route gating.
- Onboarding (`/app/welcome`) recording versioned consents.
- App shell: sidebar + mobile nav, workspace switcher, symbol search ("/"), NSE session clock, realtime
  notifications, theme toggle, ticker tape, single-active-device takeover (ADR-011), missing-hook banner.
- Pages: Overview, Markets screener, Symbol (candles + signal markers, levels, signal history, backtest),
  Market Radar, Portfolio, Alerts, Signals, Workspace (members, invites, roles, usage, audit), Integrations
  (brokers ADR-007, BYOK keys), Plan & billing, Settings (profile, password, consents, devices, export, delete),
  Platform admin console, invite acceptance, legal drafts, landing page.
- Privileged layer: service-role client confined by ESLint; AES-256-GCM `seal/open`; guards; audit writer;
  tenants, secrets, admin, account modules.

### Added — project
- `.claude/skills/` (ui-ux-pro-max set), `.mcp.json` for 21st.dev MCP (gitignored), design system `MASTER.md`.
- Docs: `AGENTS.md`, `CLAUDE.md`, `PLAYBOOK.md`, `docs/{BRD,ARCHITECTURE,CODEMAP,DECISIONS,ROADMAP}.md`, `README.md`.
