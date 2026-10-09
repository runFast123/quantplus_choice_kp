# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Newest first.
**Every change adds a line under _Unreleased_** — what changed, why, and where. Agents: read this before
building something; it may already exist (then check `docs/CODEMAP.md`).

## [Unreleased]

### Fixed — Chrome Extension Context Invalidation, Lag Debounce & HUD Body Portal (`extension/`)
- **Eliminated `Extension context invalidated` Runtime Errors**:
  - Implemented `isExtensionValid()` lifecycle guard and `safeSendMessage` / `safeStorageGet` / `safeStorageSet` wrappers in `detector.js`, catching context teardown whenever the unpacked extension is reloaded at `chrome://extensions`.
  - Added auto-cleanup (`destroyContentScript()`) that cleanly disconnects all `MutationObserver`s, clears all `setInterval` / `setTimeout` timers, and detaches event listeners when an orphaned context is detected, preventing rogue background callbacks from throwing unhandled exceptions.
  - Added singleton guard `window.__qp_detector_loaded` at the entry of `detector.js` preventing duplicate instances from being evaluated in the same document.
  - Removed duplicate `chrome.scripting.executeScript` injections from `pushHudDirectToTabs` in `sidepanel.js` and `tabs.onActivated` / `tabs.onUpdated` in `background.js`, stopping runaway script re-injection loops.
- **Fixed TradingView Glitching & Main-Thread Lag**:
  - Debounced symbol detection with a 300ms scheduler (`scheduleDetect`), stopping high-frequency TradingView canvas mutations from flooding the main thread with repetitive DOM inspection.
- **Fixed HUD Visibility & DOM Attachment**:
  - Corrected `getOrCreateShadowRoot()` mounting target to strictly append to `document.body` (instead of `documentElement`), avoiding clipping and overflow issues caused by TradingView's full-screen root layout.
  - Added immediate visual loading skeleton (`renderHudLoading`) upon ticker detection, ensuring the HUD appears instantly without blank-screen delay while quote data is being fetched.

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
