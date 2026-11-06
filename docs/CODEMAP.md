# CODEMAP — what already exists

**Search this file before writing a helper, action, RPC or component.** If you add, rename or delete
anything listed here, update this file in the same commit. Paths are relative to `web/src/` unless noted.

---

## 1. Database (supabase/migrations)

| # | File | Contents |
|---|---|---|
| 01 | `foundations` | extensions (pgcrypto, pg_cron), `private` schema, enums, `private.set_updated_at()`, `private.active_tenant_id()` |
| 02 | `tenancy` | `tenants`, `tenant_members`, `tenant_invitations`, `private.platform_admins`; `private.is_tenant_member()`, `private.has_tenant_role()`, `private.is_platform_admin()` |
| 03 | `identity_billing` | `profiles`, `user_devices`, `user_consents`, `plans` (+ seed rows), `subscriptions`, `payments` |
| 04 | `user_financial_data` | ~~`broker_connections`, `private.broker_credentials`~~ (dropped in 23), `portfolios`, `holdings`, `watchlists`, `watchlist_items`, `price_alerts`, `notifications` |
| 05 | `ai_byok_contract_notes` | `ai_provider_keys`, `private.ai_key_secrets`, `ai_usage_logs`, `contract_note_imports` |
| 06 | `analytics_audit` | `activity_events`, `audit_log` (+ immutability trigger) |
| 07 | `market_data` | `market_symbols`, `market_candles` (partitioned), `backtest_ledgers`, `trading_signals`, `rsi_events` |
| 08 | `entitlements` | `private.effective_plan()`, `private.plan_has_feature()`, `private.enforce_symbol_limit()` trigger, cron `expire-subscriptions`, updated_at triggers |
| 09 | `rls_policies` | all RLS policies + column grants (spec §5.9) |
| 10 | `signup_and_jwt_hook` | `private.handle_new_user()` trigger, `public.custom_access_token_hook()` |
| 11 | `admin_tenant_rpc` | `admin_activate_plan()`, `tenant_member_directory()`, `tenant_feature_usage()`, `export_my_data()` |
| 12 | `storage` | `contract-notes` bucket + policies |
| 13 | `analytics_reader_role` | `analytics_reader` role for FastAPI |
| 14 | `app_support` | view `market_snapshot`; RPCs `my_entitlements()`, `track_event()`; realtime publication; retention cron jobs |
| 15 | `service_rpcs` | `svc_is_platform_admin`, `svc_put/get_ai_key_secret`, `svc_admin_user_search` (service_role only) |
| 16 | `eod_notifier` | `private.run_eod_notifier()` + cron `eod-notifier` (16:15 IST Mon–Fri) |
| 17 | `news_research` | `news_sources`, `news_articles`, `news_article_symbols`, `news_symbol_aliases`, `news_search_cursor`, `research_notes`; view `symbol_news_stats`; `private.refresh_research_notes()`, `svc_refresh_research()`; crons `research-notes`, `retention-news`, `retention-research` |
| 18 | `news_sources_access` | disables feeds that block automated readers |
| 19 | `research_latest` | view: latest note per symbol + previous score |
| 20 | `news_sources_active_column` | members may read `news_sources.is_active` (not URLs/errors) |
| 21 | `user_delete_cleanup` | trigger `on_auth_user_deleted` → deletes the user's personal tenant |
| 22 | `review_hardening` | `private.try_numeric`, `private.notification_ledger`, `svc_register_device`; notifier + research rewritten; live-first subscription ordering; hook skips suspended tenants; symbol columns not updatable; admin-removal policy; TRUNCATE revoked |
| 23 | `remove_broker` | drops broker tables/secrets/RPCs/enum/consent/feature; `export_my_data()` without brokers (ADR-025) |
| 24 | `market_analytics` | `private.refresh_market_analytics(days)` (Wilder RSI, SMA 20/50, signals, SIP ledgers), `svc_refresh_market_analytics`, `svc_run_eod_notifier`; unique natural key on `trading_signals`; crons moved after the pipeline |
| 26 | `whole_market` | `market_symbols` + `segment`, `vendor_ticker`, `mcap_rank`, `history_days`, `status_note`, `successors`; `market_quotes` (latest quote, written by analytics) behind view `market_snapshot`; `refresh_market_analytics(days, symbols)` per-symbol; `refresh_research_notes(symbols)`; `svc_refresh_market_analytics(p_days, p_symbols)`, `svc_refresh_research(p_symbols)`; `search_symbols(q, limit)`; trigger `ensure_news_cursor` on watchlist_items/holdings; crons `retention-candles`, `retention-rsi-daily`, `retention-research` (10 d) |
| 27 | `research_latest_columns` | `research_latest` + `segment`, `mcap_rank`, `score_change` |
| 28 | `exact_sma` | moving averages in exact decimal arithmetic (numeric running sums instead of float8) |
| 29 | `news_feeds_live_syndication` | restores active feeds for Moneycontrol, Business Standard, and Corporate Announcements via Google News RSS syndication |
| 30 | `push_notifications` | `push_subscriptions` (own rows: select/insert/delete; https endpoint, keys), `notifications.pushed_at` + pending index, `svc_claim_push_batch(p_limit)` (SKIP LOCKED, last 2 days, service_role), `export_my_data()` + push browsers (no keys) |
| 31 | `daily_setups` | `market_quotes.setups text[]` (GIN index), `private.refresh_setups(p_symbols)` (breakout_20d, bull_flag, reclaim_ma20, oversold, oversold_bounce on the last 30 daily closes + stored RSI), `svc_refresh_market_analytics` now also returns `setups`, cron `market-analytics` runs both, `market_snapshot` + `setups` |
| 32 | `history_top500` | `private.history_for_rank()` trigger on `market_symbols` (insert / update of `mcap_rank`, `history_days`): rank ≤ 500 → `history_days` raised to 760, never lowered (ADR-034); top 500 set to 760 |
| 33 | `strong_trend` | `market_weather` (sunny/mixed/stormy per session from NIFTY + INDIAVIX) + `private.refresh_market_weather()`; `private.refresh_strong_trend(p_symbols)` (strategy `strong_trend`: buy + exit rows, top-500 equities); `signal_outcomes` (every entry signal graded at 5/20/60 sessions vs the Nifty 500) + `private.grade_signals(p_symbols, p_since)`; view `strategy_scorecard` (per strategy × side, `all` / `12m`); `svc_refresh_market_analytics` runs all of them (plpgsql now); cron `market-analytics` too |
| 34 | `analytics_batch_speed` | `private.refresh_market_weather(p_full boolean default false)` (normal run: last 10 sessions only); trigger `market_symbols_drop_ledger_when_retired` → `private.drop_ledger_when_retired()` (a retired symbol's SIP ledger is deleted) |
| 35 | `dip_rules` | `refresh_market_analytics` without RSI reversal signals; `signal_watch` (next session's dip-buy levels, read-only to members); `private.refresh_dip_rules(p_symbols)` (strategies `rsi_dip`, `kk_dip`: buy on the fill day with `fill`, exit on bounce / 10 sessions / stop; top-500 equities); `svc_refresh_market_analytics` + cron also run it |
| 36–37 | `trade_results`, `trade_results_fair` | view `strategy_trade_results` (per strategy × side: trades, made_money_pct, avg/win/loss %, first/last day; stored `pnl_pct` on exits, SMA exits paired with the previous buy, none for RSI reversal) |
| 39 | `signal_checks` | `signal_checks` (strategy × symbol × signal day: label weak/ok/high/normal/low/none, `tagged`, score, `detail.features`; frozen); `market_breadth` (day: breadth50/200, `rsi_setups`), `market_sectors` (day × sector: r63, rank), `market_pit_top` (year × top 300 by traded value); `signal_check_models` (quarterly RSI dip models), `signal_check_training` (service only); `private.refresh_trend_checks()`, `refresh_rsi_checks()`, `refresh_market_breadth(p_full)`, `refresh_pit_top(year)`, `refresh_check_training()`, `rsi_check_features()`; views `signal_trades` (each buy with its exit's result), `signal_check_record` (month × label); `svc_refresh_signal_checks(p_full)`, `svc_signal_check_training(strategy)`, `svc_put_signal_check_model(...)`; cron backstop runs the checks |
| 41 | `ma200_trend` | `private.refresh_ma200_trend(p_symbols)` (200-day trend: close > 200-day average, `regr_slope` of that average over 100 sessions × 20 ≥ −0.25 % of it, `corr(close, t)` over 100 ≥ 0.5; first session all hold after one that did not; 4 × ATR14 stop, 60-session review; payload `sma200`, `slope_pct`, `r_px`); `signal_trades` + `rule_expectations` include it; `svc_refresh_market_analytics` returns `ma200_trend` |
| 53 | `trade_import` | `portfolio_imports.replaced_openings`; `preview_trades(portfolio, rows, replace)` (dry run per stock, rolled back), `import_trades(portfolio, broker, rows, replace, skipped)` (one import, `on conflict do nothing`, replaced opening balances kept), `undo_import(id)`; `private.can_write_portfolio`, `private.valid_trade_rows` |
| 52 | `holdings_from_ledger` | clients may only read `holdings` (insert/update/delete revoked, policies dropped); `ensure_opening_balances()` once more |
| 51 | `portfolio_ledger` | `portfolio_transactions` (own rows: opening/buy/sell, date, qty, price, charges, note, `sip`, source, `broker_ref` unique per portfolio × stock × day × side, `import_id`; stock/side not updatable; no future dates), `portfolio_imports` (own: broker, counts, date range; deleting one removes its trades), derived read-only `portfolio_lots` (per buy: as bought, still open in today's shares) and `portfolio_realized` (per sell × lot: cost and proceeds after charges, gain, days held); `private.position_events` (trades + stored splits not undone, replay order split → opening → buy → sell), `private.rebuild_position` (FIFO replay → lots, gains, `holdings`; `SELL_EXCEEDS_HOLDING`; symbol limit only on a new stock), statement triggers on trades, `private.held_before`, `private.ensure_opening_balances` (holdings without trades → one opening dated the last edit; step 1 adjustments → opening before the split), `private.corporate_action_ledger` (split seen / undone per portfolio × stock), `apply_corporate_actions` + `undo_holding_adjustment` rewritten on the ledger, `private.ledger_maintenance` (notifier), `export_my_data` + trades, imports, gains |
| 50 | `holdings_trust` | `notification_prefs` (own rows; `exit_rules` ⊆ the five live rules, default the three trend rules), `corporate_actions` (symbol × ex_date × `factor` = new shares per old; read by members, written by the EOD pipeline), `holding_adjustments` (own rows, read only: before/after quantity and average, `undone_at`); `private.apply_corporate_actions()` (holdings last edited before the ex-date session, last 30 days; whole shares stay whole, cost kept; `holding_adjusted` notification), `private.fmt_qty`, `public.undo_holding_adjustment(p_id)`; `private.run_eod_notifier()` runs the adjustments first, and exit messages follow `notification_prefs` and name the rule (`rule_label`) with "Your holding is unchanged" |
| 49 | `evening_checks_cron` | `svc_refresh_signal_checks` without the kept records; cron `market-analytics` + `evening-checks` (`10 16,19,22 * * 1-5`) + `morning-checks` (`10 4 * * 2-6`) run the checks, `refresh_record_summaries()` and (the last two) `refresh_research_notes()` |
| 48 | `summaries_where` | `private.refresh_record_summaries()` with `delete … where true` (API sessions run `safeupdate`) |
| 47 | `rsi_events_rebuilt` | one-off: RSI crossings of the stocks with `history_days >= 1250` deleted and written again by `refresh_market_analytics(1300, …)` |
| 46 | `leaders_once` | `private.refresh_leaders(p_full)` redefined: returns early unless a stock ranked on the previous session has the latest session's candle but no rank |
| 45 | `rule_continuity` | `private.rule_resume(symbol, exchange, strategy, ts[], back)` (session index the stored record covers); `refresh_strong_trend`, `refresh_sma_trend`, `refresh_ma200_trend`, `refresh_dip_rules` start from it and insert only rows later than the stock's last stored signal of the rule |
| 44 | `fast_reads` | `strategy_trade_summary`, `strategy_scorecard_summary` (kept copies of the record views, `private.refresh_record_summaries()` in `svc_refresh_signal_checks`); `research_latest` returns `market_symbols.symbol`; `private.retention_derived()` (cron `retention-derived`) |
| 43 | `rule_history` | `history_days` 1,250 for the 500 largest + NIFTY / NIFTY500 / INDIAVIX (trigger `history_for_rank`, cap 2,000); `private.rebuild_rule_signals(p_symbols)` (delete the five rules' signals, run them again, old ids back for rows written again, last signal, grades) — run by `supabase/scripts/rebuild-rules.mjs` |
| 42 | `rule_names_last_signal` | `private.rule_label(key)` (the name people read; research notes' Signals line uses it); `private.refresh_last_signal(p_symbols)` re-reads each quote's latest signal (any rule, ties: buy first) after the rules run — in `svc_refresh_market_analytics` (`last_signal`) and the cron backstop; `refresh_research_notes` redefined with the name |
| 40 | `rule_health` | `rule_expectations` (tested made-money rate per rule), `rule_health` (rule × day: last 40 finished trades, made, normal range, status below/within/above/too_few, `causes`), view `rule_mistakes` (each losing trade: `net_pct`, `market_pct`, cause market/stock/small), `private.refresh_rule_health(day)`; `signal_trades.exit_reason`; `svc_refresh_signal_checks` adds `health`; a year of weekly history back-filled |
| 38 | `sma_trend` | `refresh_market_analytics` without SMA 20/50 cross signals; `market_leaders` (day × symbol: 126-session return, cume_dist among the 500 largest) + `private.refresh_leaders(p_full)` (normal run: last 14 days, once per session); `private.refresh_sma_trend(p_symbols)` (strategy `sma_trend`: buy + exit rows); wrapper and cron run it |
| 25 | `news_story_dedupe` | `news_articles.story_hash` (trigger + unique), `private.news_story_hash()`, `svc_store_news_articles(jsonb)` |

Seeds: `seed/dev_market_data.sql` (SYNTHETIC, dev/staging — **never production**) · `seed/ref_market_symbols.sql` (core 44,
`history_days` 760, TATAMOTORS retirement note; the full universe comes from `pipelines/eod/universe.py`; prod-safe) · `seed/ref_news_aliases.sql` (reference, prod-safe) · `seed/ref_signal_checks.sql` (research models, top-300 lists, training trades for the signal checks; generated by `research/strategies/team/export_seed.py`; prod-safe).
Runner: `supabase/scripts/apply.mjs` — `npm run migrate | status | seed:ref | seed:dev | test:remote` (reads `supabase/.env`).

### RPCs callable from the app

| RPC | Caller | Purpose |
|---|---|---|
| `preview_trades` / `import_trades` / `undo_import` | user | tradebook import (53): owner, workspace, member and plan checked; rows written as the caller |
| `undo_holding_adjustment(p_id)` | user | puts a split/bonus adjusted holding back (owner, active workspace, only while it still has the adjusted numbers) |
| `my_entitlements()` | user | plan, status, features, limits, slots used — active tenant |
| `track_event(p_event_type)` | user | feature-usage event (regex `^[a-z_]{3,48}$`, no symbols) |
| `export_my_data()` | user | JSON of the caller's rows (security invoker) |
| `tenant_member_directory(p_tenant)` | tenant owner/admin, platform admin | whitelisted member columns |
| `tenant_feature_usage(p_tenant, p_from, p_to)` | tenant owner/admin, platform admin | counts per user × event |
| `admin_activate_plan(...)` | service_role | subscription + payment + audit, one transaction |
| `svc_*` | service_role | bridge to the `private` schema (see 15); `svc_refresh_research()` rebuilds notes (17); `svc_refresh_market_analytics(p_days)`, `svc_run_eod_notifier()` (24); `svc_store_news_articles(p_rows)` (25) |

### Cron jobs
`expire-subscriptions` (*/15), `retention-notifications`, `retention-activity-events`, `retention-ai-usage`,
`retention-expired-invitations`, `retention-news`, `retention-research` (daily 02:xx UTC); backstops after the EOD
pipeline: `market-analytics` (12:25 UTC), `eod-notifier` (12:30 UTC), `research-notes` (12:35 UTC), Mon–Fri.

### Views
`market_snapshot` (latest quote), `symbol_news_stats`, `research_latest` — all `security_invoker`, authenticated only.

### Notification types
`price_alert`, `exit_signal` (a rule closed its trade in a stock you hold; only the rules in `notification_prefs`), `holding_adjusted` (split/bonus; opens `/app/portfolio#adjustments`), `plan_expiry`, `research_stance`. All are also pushed to the owner's browsers (`privileged/push.ts`) when they turned notifications on.

### Error codes raised by the DB (mapped by `friendlyDbError`)
`PLAN_LIMIT_REACHED`, `NO_ACTIVE_PLAN`, `SELL_EXCEEDS_HOLDING`, `TRADE_IN_FUTURE` (ledger, 51; mapped by `ledgerError`), `NOT_AUTHORIZED`, `USER_NOT_IN_TENANT`, `INVALID_INPUT`, `INVALID_EVENT_TYPE`, RLS `row-level security`.

---

## 2. Server (web/src/server)

| Module | Exports | Notes |
|---|---|---|
| `session.ts` | `getSession` (cached), `requireSession`, `can(s, feature)`, `isTenantAdmin(s)`, `displayName(s)`, type `Session` | One read per request: claims, profile, memberships, entitlements, `hookMissing`, `deviceActive`. **`requireSession()` redirects inactive devices to `/device` — use it in every page and action** |
| `market-data.ts` | `getQuotes(db, symbols)`, `getTape`, `getBreadth`, `getRetired`, `normalizeQuote`, `getSparks` (chunked under the 1,000-row cap), `getRuleHealth(db)` → latest row + history per rule, `getCandles` (default 1,300 days = everything stored, for the chart; Dry Run asks for 730), `positions`, `summarize`, type `Position` | All numeric normalisation from PostgREST strings happens here |
| `device.ts` | `DEVICE_COOKIE`, `claimThisDevice(userId)` | Single-active-device; call from actions/route handlers only |
| `device-hash.ts` | `deviceHash(id)` | SHA-256 of the device cookie |
| `privileged/service-role.ts` | `serviceRole()` | **Only importable inside `privileged/`** |
| `privileged/guards.ts` | `membershipRole`, `assertMember`, `planHasFeature`, `hasActiveConsent`, `PrivilegedError` | Re-establish what RLS would enforce |
| `privileged/crypto.ts` | `seal(plaintext, aad)`, `open(sealed, aad)`, type `Sealed` | AES-256-GCM, `QP_SECRETS_KEY_V<n>` |
| `privileged/audit.ts` | `audit({...})` | Append to `audit_log` with hashed IP |
| `privileged/tenants.ts` | `switchTenant`, `createOrganization`, `createInvitation`, `previewInvitation`, `acceptInvitation`, `changeMemberRole` | Role-escalation rules live here |
| `privileged/secrets.ts` | `saveAiKey` | Plan + consent checks, encryption, `svc_put_ai_key_secret` |
| `privileged/admin.ts` | `isPlatformAdmin`, `searchUsers`, `activatePlan`, `platformStats`, `getDatabaseInventory`, `getRecentPayments`, `getRecentAuditLogs`, `triggerMarketAnalytics`, `triggerResearchRefresh`, `triggerEodNotifier`, `triggerEodSync`, `getSignalCheckReview` (quarterly review of the checks), types `AdminUserRow`, `DatabaseInventory`, `PaymentRow`, `AuditLogRow`, `SignalCheckReview` | Platform console |
| `privileged/eod-sync.ts` | `syncEodPrices`, types `SyncEodOptions`, `SyncEodReport` | Native Yahoo Finance EOD candle fetcher, validation & multi-step pipeline sync engine |
| `github-dispatch.ts` | `dispatchMarketEod()` → `{ dispatched, detail }` | Starts the Market EOD workflow via GitHub's dispatch API when `GITHUB_DISPATCH_TOKEN` + `GITHUB_REPO` are set (ADR-043) |
| `privileged/account.ts` | `registerDevice`, `deviceHash`, `applyConsentWithdrawal`, `deleteAccount` | §7 deletion order |
| `privileged/push.ts` | `deliverPendingPush(limit)` → `PushReport`, `sendTestPush(userId, tenantId)` | Web Push (VAPID env); claims via `svc_claim_push_batch`, one send per browser, drops 404/410 and 5× failures |
| `privileged/news.ts` | `ingestNews({searchSymbols})`, `relinkRecentArticles(days)`, `newsSourceHealth()`, type `IngestReport` | RSS pipeline; only DB-listed URLs fetched |
| `privileged/ai.ts` | `researchReadWithMyKey(userId, tenantId, symbol)`, `portfolioHealthReadWithMyKey(userId, tenantId, portfolioId?, focus?)`, `symbolResearchChatWithMyKey(userId, tenantId, symbol, question)`, `parseContractNoteWithMyKey(userId, tenantId, noteText)`, type `AiRead`, type `ParsedTrade`, type `PortfolioDiagnosticFocus` | BYOK; Anthropic SDK / OpenAI / Gemini; metering only |
| `news-data.ts` | `getNews(db, {symbols?, tone?, kind?, limit?, before?})`, `getResearch(db, symbols?)`, `normalizeNote`, types `NewsItem`, `ResearchNote`, `ResearchFactor` | RLS client reads |

## 3. Lib (web/src/lib) — pure, safe anywhere

| Module | Exports |
|---|---|
| `format.ts` | `factorScore`, `signedInt`, `price`, `rupees`, `rupeesCompact` (L/Cr), `paiseToRupees`, `qty`, `volume`, `pct`, `signed`, `signedRupees` (+₹1,240.50), `date`, `dateTime`, `longDate`, `relative`, `isoDaysAgo`, `isoNow`, `daysUntil`, `strategyLabel`, `signalDisplayName` |
| `market.ts` | `nseSession(now)` → pre-open / open / closed / holiday (IST, official NSE holidays 2025–2027, Muhurat sessions); `NSE_HOLIDAYS`, type `NseSessionInfo`; `toTradingViewSymbol(symbol, exchange)`, `toTradingViewWidgetSymbol(symbol)`; `nextEodUpdate(now)` (17:00 IST on the next trading day); `PRICE_SOURCE`; `SECTORS`; `SEGMENT_LABEL`, type `Segment` |
| `market.test.mts` | unit tests (`npm run test:unit`) |
| `trade-odds.ts` | `simulateOdds(candles, entryIndex, plan, {paths, lookback, seed})` → `SimOdds`, `historicalOdds(candles, entries, direction, rTarget, horizon)` → `HistoryOdds`, `oddsVerdict(sim)`, `defaultHorizon(strategy)`, `oddsForTrade(candles, trade)` (the chart panel's opening odds), `plainOdds(sim)` → `PlainOdds` (beginner headline + counts out of 100 + break-even pass mark), `wholeCounts`, `barIndex`, `rng` (mulberry32), `rAt` |
| `trade-odds.test.mts` | unit tests (`npm run test:unit`) |
| `dry-run.ts` | Dry Run math (ADR-033): `sizePlan(stocks, total, cashPct)` → `Plan` (even split, whole shares, loss at each stop), `replayPlan(plan, candles, benchmark)` → `Replay` (same amounts on the first common day, `limitedBy`), `badDays(points)` (worst day / 5 sessions / deepest fall + recovery), `guardrails(plan)` (7 general checks), `tradedValue(candles)` |
| `dry-run.test.mts` | unit tests (`npm run test:unit`) |
| `setups.ts` | `SETUPS` (key, label, rule), type `SetupKey`, `isSetupKey`, `setupsOf(tags)` |
| `news/display.ts` | `cleanTitle(title, source)` (drops a trailing publisher name), `summaryEchoes(summary, title)`, `dayLabel`, `groupByDay(items)` (IST days), `stocksInNews(items, limit)` → symbol, n, pos, neg |
| `rules.ts` | `RULES` (the five rules in display order: key, name, tag, kind trend/dip, `why`), `OLD_RULES`, `RULE_KEYS`, `DEFAULT_EXIT_RULES` (the trend rules; same as the SQL default), `isRule`, `isOldRule`, `ruleOf`, `ruleTag` — the one list `HEALTH_RULES`, `isTrendRule` and the stock page read |
| `rule-health.ts` | `HEALTH_RULES`, `isHealthRule`, `HEALTH_STATUS` (label, tone, meaning per status), `CAUSE` (words per loss cause), `healthSentence(row)`, `mainCause`, `mistakeSentence(row)`, `pos`, types `HealthRow`, `HealthStatus`, `Cause` (ADR-039) |
| `signal-checks.ts` | `isCheckRule`, `CHECK_TAG` (tag words + meaning), `checkKey`, `signalDayOf(sg)` (a dip's setup close), `quarterStartIST`, `daysAgoIST`, `CHECK_TESTED` (tested record by year, from `research/strategies/team`), `liveYears(rows, rule)`, `total`, `standingLine(rule, years)` (names the wrong years), `periodsSentence`, types `CheckRule`, `CheckYear`, `RecordRow` |
| `dip-rules.ts` | `isDipRule`, `DIP_EXIT`, `dipStatus(stop, last)`, `DIP_TESTED` (tested record per rule, from `research/strategies/record_dip.py`), `dipTestedSentence(rule)`, type `DipRule` |
| `strong-trend.ts` | `isTrendRule(s)` (Strong trend, SMA 20/50 trend, 200-day trend), `SMA_TREND_TESTED`, `MA200_TREND_TESTED` (incl. a random day above the 200-day), `weatherView({state, nifty, sma50, sma200, vix})` → `WeatherView` (names the actual reason), `reviewDate(signalAt)` (≈60 sessions), `strongTrendStatus(stop, last)`, `REVIEW_SESSIONS`, `STRONG_TREND_TESTED` (tested record, from `research/strategies/record.py`), type `Weather` |
| `setups.test.mts` | unit tests (`npm run test:unit`) |
| `tradebook.ts` | `BROKERS` (guide per broker; `known` only for Zerodha), `csvRows`, `detectColumns` (header row by name), `mapHeader`, `missingFields`, `parseTradebook` → `TradebookRow[]` + `SkippedRow[]`, `mergeTrades` (each trade once across files), `parseTradeDate`, `parseSide`, `normName`, `hash53` (references for files without trade ids), `FIELD_LABEL`, `MAPPABLE` |
| `xlsx.ts` | `readXlsx(bytes)` → first sheet's rows (zip + DecompressionStream, no dependency), `sheetRows`, `columnIndex`, `decodeXml`, `XlsxError` |
| `chart-replay.ts` | `SPEEDS`, `STARTS`, `startIndex`, `daysBeforeEnd`, `barsDue` (frame pacing with carry, capped after a hidden tab), `revealedUpTo` / `revealedBetween` (signals by day), practice: `buy`, `sell`, `openResult`, `practiceSummary`, `rewindPractice`, `PRACTICE_BUDGET` |
| `ledger.ts` | `groupSales(realized rows)` → one row per sale, `heldFor`, `istToday`, `ledgerError` (SELL_EXCEEDS_HOLDING / TRADE_IN_FUTURE in plain words), `KIND_LABEL`, `SOURCE_LABEL`, types `Trade`, `RealizedPart`, `Sale` |
| `push-payload.ts` | `toPushPayload(notification)` → `{title, body, url, tag}`, `notificationUrl(type, data)` |
| `push-payload.test.mts` | unit tests (`npm run test:unit`) |
| `errors.ts` | `friendlyDbError(message)`, type `ActionState` |
| `safe-next.ts` | `safeNext(raw, fallback)` — **only** way to use a user-supplied redirect target |
| `consents.ts` | `CONSENT_VERSION`, `CONSENT_COPY` |
| `plans.ts` | `FEATURE_ROWS` (feature key → label, display order) |
| `csv-parser.ts` | `parseHoldingsCsv(csvText)`, `cleanBrokerSymbol`, `parseNumeric`, types `ParsedHoldingRow`, `ParseHoldingsResult` (Zerodha, Groww, Angel One, Upstox, generic) |
| `csv-parser.test.mts` | unit tests (`npm run test:unit`) |
| `backtest-engine.ts` | `simulateSip(candles, monthlyAmount)`, `simulateTechnicalStrategy(candles, strategy)`, `simulateCustomStrategy(candles, params)`, `simulateKkStrategy(candles, params)`, `generateKkChartMarkers(candles, params)`, `generateBacktestPineScript(params, symbol)`, `DEFAULT_KK_PARAMS`, `computeSma`, `computeRsi`, types `SipResult`, `StrategyResult`, `DetailedStrategyResult`, `DetailedStrategyTrade`, `EquityPoint`, `AdvancedStrategyParams`, `KkResultType` |
| `backtest-engine.test.mts` | unit tests (`npm run test:unit`) |
| `portfolio-health.ts` | `calculatePortfolioHealth(positions)`, types `PortfolioHealthReport`, `HealthPosition`, `PortfolioDiagnosticFocus`, `RiskFlag`, `HealthVerdict`, `SectorAllocation` |
| `portfolio-health.test.mts` | unit tests (`npm run test:unit`) |
| `news/feed.ts` | `parseFeed(xml)`, `parseFeedDate`, `cleanText`, `decodeEntities`, `normaliseUrl`, `nseFilingSymbol` |
| `news/match.ts` | `SymbolMatcher` (`match`, `matchesSymbol`), `stripLegalSuffix` — sibling-entity guard (`SIBLING_WORDS`) |
| `news/tone.ts` | `scoreTone(text)` → `{score, label, terms}`; `POSITIVE`, `NEGATIVE` word lists |
| `news/news.test.mts` | unit tests (`npm run test:unit`) |
| `trade-plan.ts` | `calculateTradePlan`, `calculatePositionSize`, `evaluateSentiment`, `evaluateSignalProgress`, `auditStockSentiment`, `deduplicateChartSignals`, `getAlphaLevel`, `computeExitNodeHistory`, types `TradePlanResult`, `PositionSizeResult`, `SentimentResult`, `SignalProgressResult`, `TargetStatus`, `QuantumAuditItem`, `RawChartMarker`, `ExitLogEntry` |
| `trade-plan.test.mts` | unit tests (`npm run test:unit`) |
| `signal-trade.ts` | `signalAction(marker)` (buy/sell/exit/cover — the chart's one classifier), `isWinningExit`, `ruleSentence(strategy, action, result)`, `explainMarker`, `tradeFor(selected, markers)` → `TradeView`, `markerFromSignal(sg)` (stored signal → chart marker; symbol page + Dry Run) (entry/exit pair, stop, 1R, R-labelled targets), `KK_RESULTS`, `STRONG_TREND_RESULTS`, `DIP_RESULTS` |
| `signal-trade.test.mts` | unit tests (`npm run test:unit`) |
| `pine-script.ts` | One TradingView Pine v6 script per live rule, following the SQL bar by bar: `pineScript(rule, symbol)`, `PINE_RULES`, `pineRuleLabel(rule)`, `pineRuleForChart(filter)` (chart filter → rule, null for all / none), type `PineRule` (`kk_dip` \| `rsi_dip` \| `sma_trend` \| `strong_trend` \| `ma200_trend`) |
| `blog/types.ts`, `blog/data.ts`, `blog/format.ts`, `blog/posts.ts` | The research notes (/blog): types; `BLOG_DATA` (GENERATED by `research/strategies/blog_ts.py` from `compare_blog.py`); number words without minus signs (`pct`, `in100`, `result`, `signed`, `count`, `longDate`, `shortDate`, `readMinutes`); `POSTS`, `postBySlug(slug)`, `postText(post)` (every reader-facing string; the no-hyphen test reads it). Tests `blog/posts.test.mts` |
| `pine-script.test.mts` | unit tests (`npm run test:unit`) |
| `extension-signals.ts` | `toExtensionSignal(row)`, `describeSignal(row)` (one-sentence rule per strategy × action, KK result), types `ExtensionSignal` (kind `buy`/`sell`/`exit`/`cover` from `payload.action`), `SignalRow` |
| `extension-cors.ts` | `isExtensionOrigin(origin)`, `extensionCors(origin, {anyOrigin})` — credentials only for `chrome-extension://` origins |
| `extension-signals.test.mts`, `extension-syntax.test.mts` | unit tests: signal mapping + CORS; extension syntax + download zip matches source with `/` paths |
| `types.ts` | row types: `Plan`, `Entitlements`, `Membership`, `Profile`, `Quote`, `Candle`, `Holding`, `Portfolio`, `Watchlist`, `WatchlistItem`, `PriceAlert`, `Signal`, `NotificationRow` + enums |
| `env.ts` | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SITE_URL` |
| `supabase/server.ts` | `supabaseServer()` — RLS client for server components/actions |
| `supabase/client.ts` | `supabaseBrowser()` — RLS client for client components (realtime) |
| `supabase/proxy.ts` | `updateSession(request)` — used by `src/proxy.ts`; gates `/app`, `/admin` |

## 4. Server actions (mutations)

| File | Actions |
|---|---|
| `app/(auth)/actions.ts` | `signIn`, `signUp`, `sendReset`, `signOut` |
| `app/app/shell-actions.ts` | `switchTenantAction`, `claimDeviceAction`, `markNotificationsRead`, `refreshClaimsAction` |
| `app/app/welcome/actions.ts` | `completeOnboarding` (profile + consents) |
| `app/app/watchlist/actions.ts` | `addToRadar`, `removeFromRadar`, `removeSymbolFromRadar`, `createWatchlist`, `deleteWatchlist` |
| `app/app/portfolio/actions.ts` | `recordTrade` (buy/sell; a sale returns its gain), `updateTrade`, `deleteTrade(id)`, `deleteHolding(id)` (all of a stock's trades), `undoHoldingAdjustment(id)`, `createPortfolio`, `importHoldingsCsv` (new stocks → opening balances dated today), `applyParsedTrades(portfolio, trades, tradeDate)` (one `portfolio_imports` row, all or nothing) — every write goes to `portfolio_transactions` |
| `app/app/alerts/actions.ts` | `createAlert`, `setAlertStatus`, `deleteAlert` |
| `app/app/workspace/actions.ts` | `createOrgAction`, `inviteAction`, `revokeInvitation`, `changeRoleAction`, `removeMember`, `leaveWorkspace`, `renameWorkspace` |
| `app/app/integrations/actions.ts` | `saveAiKeyAction`, `deleteAiKey`, `fetchProviderModelsAction` |
| `app/app/settings/actions.ts` | `updateProfile`, `changePassword`, `setConsent`, `deleteMyAccount`, `savePushSubscription`, `removePushSubscription`, `sendTestPushAction`, `saveExitRules` (which rules message you about stocks you hold) |
| `app/admin/actions.ts` | `activatePlanAction`, `fetchNewsNow`, `refreshMarketAnalyticsAction`, `refreshResearchNotesAction`, `runEodNotifierAction`, `syncEodMarketPricesAction` |
| `app/app/research/actions.ts` | `askMyAi` (BYOK research read; nothing stored) |
| `app/invite/[token]/page.tsx` | inline `accept` action |

## 5. Routes

| Route | What |
|---|---|
| `/` | landing (plans from DB, fallback constants) |
| `/api/symbols?q=` | ranked symbol search (`search_symbols`) for the header and add forms; signed-in only |
| `/api/dry-run/stock?symbol=` | one stock for Dry Run: name, sector, segment, last price, 2 years of candles, stored signals as markers; signed-in only |
| `/login` `/signup` `/forgot` | auth (group `(auth)`) |
| `/auth/confirm` | email link handler (token_hash or PKCE code) |
| `/invite/[token]` | accept organisation invite |
| `/legal/[doc]` | `terms`, `privacy` (drafts) |
| `/blog`, `/blog/[slug]` | Research notes (public): five posts, each rule against the usual way of using its indicator; metadata + canonical + OG, JSON-LD `Blog` / `BlogPosting` + `FAQPage` + `BreadcrumbList`; `/blog/[slug]/opengraph-image` (prerendered share card) |
| `/sitemap.xml`, `/robots.txt` | `app/sitemap.ts` (public pages + posts), `app/robots.ts` (disallows `/app`, `/admin`, `/api/`, `/auth/`, `/invite/`, `/device`) |
| `/device` | single-device takeover screen (target of `requireSession` for displaced devices) |
| `/app` | overview (redirects to `/app/welcome` until terms consent) |
| `/app/markets`, `/app/markets/[symbol]` | screener (`?setup=` filter + Setups column); symbol page: header, *At a glance* strip (`data-testid="at-a-glance"`), chart, then tabs Plan & alerts / Research & news / Signal history / Backtest (`#plan`, `#research`, `#history`, `#backtest`), "Matched on the last close" setups |
| `/app/watchlist` `/app/portfolio` `/app/alerts` | product pages (`/app/portfolio?sell=SYM#record` opens the form on a sale) |
| `/app/portfolio/import` | tradebook import wizard and the list of imports with Undo |
| `/app/portfolio/[symbol]` | one stock's trades (edit/delete), purchases still held, sales, splits in between (`?p=` one portfolio) |
| `/app/signals` | Today strip, then tabs `#today` (fresh buys, dip-buy levels), `#all` (`?status=open|closed&rules=old|all&strategy=&more=1`), `#rules` (alias `#health`), `#record` (alias `#checks`) |
| `/app/dry-run` | Dry Run (ADR-033): disclosure gate, then one screen — pick (fresh rule buys in the top 500 with stop, tag and rule health; *My radar*; any stock) beside a live plan panel → results tabs: replay vs NIFTY 50, bad days, guardrail checks |
| `/app/workspace` `/app/integrations` `/app/billing` `/app/settings` | account pages (`settings?tab=profile|security|notifications|privacy|data`) |
| `/app/settings/export` | GET → JSON download of `export_my_data()` |
| `/app/research` | Research desk (`?scope=mine&stance=&sort=score|low|change|news&q=`): search, stance cards with meaning, Turned constructive / cautious, plain-sentence table (cards on phones), 50 per page |
| `/app/news` | News feed (`?scope=all&tone=&kind=news|filing&before=`): tone/type chips, headlines by day, Stocks in the news (`data-testid="stocks-in-news"`) |
| `/api/cron/news` | GET/POST with `Authorization: Bearer $CRON_SECRET` → `ingestNews`, then `deliverPendingPush` |
| `/api/cron/push` | GET/POST with `Authorization: Bearer $CRON_SECRET` → `deliverPendingPush` (Vercel cron 18:15 IST weekdays, after the pg_cron notifier) |
| `/manifest.webmanifest` | install metadata (`app/manifest.ts`); `public/sw.js` shows pushes and opens their page; `public/icons/*` |
| `/api/cron/market-eod` | GET/POST with `Authorization: Bearer $CRON_SECRET` → `syncEodPrices` (daily 17:00 & 20:00 IST), then `deliverPendingPush`; with `?dispatch=full` (Vercel's crons) also `dispatchMarketEod()` |
| `/api/extension/session` | POST (what the extension uses) or GET: Bearer JWT or cookie session → `{ authenticated, user }`; to a `chrome-extension://` origin only, also `{ token, expiresAt }` from the cookie session (how the extension signs in) |
| `/api/extension/download` | GET direct download endpoint serving `quantspulse-terminal.zip` package |
| `/api/extension/quote?symbol=` | Quote, stored signals (`latestSignal` + `rule`, `sessionsSince`, `moveSincePct`), `history` (≤63 daily closes, oldest first) and trade plan for the Chrome Extension (Bearer; `*` CORS without credentials, credentials only for the extension); 401 when signed out |
| `/admin` | platform console (404 unless platform admin) |

## 6. Components (web/src/components)

`charts/chart-replay.tsx` — `ChartReplay` (setup → replay; incremental `update`/`pop`, rAF playback, keys, practice), shown by `PriceChart` in place of its chart when Replay is on (`data-testid="replay-toggle"`).

`portfolio/tradebook-import.tsx` — `TradebookImport` (broker → files → columns → check → done), `UndoImport`. Server actions: `app/app/portfolio/import/actions.ts` — `previewTradebook`, `importTradebook`, `undoImport` (stock matching by symbol, broker spelling, company name, successor).

Route-local: `app/app/portfolio/forms.tsx` — `RecordTradeForm`, `EditTrade`, `DeleteTrade`, `RemoveHolding`, `UndoAdjustment`, `NewPortfolioForm`.


| Folder | Components |
|---|---|
| `ui/button.tsx` | `Button`, `ButtonLink`, `buttonClass(variant, size)` — variants primary/secondary/ghost/danger/coral |
| `ui/field.tsx` | `Input`, `Select`, `Field`, `FormMessage`, `inputClass` |
| `ui/submit-button.tsx` | `SubmitButton` (useFormStatus) |
| `ui/use-echo-action.ts` | `useEchoAction(action, onResult?)` → `[state, dispatch, pending, values]`; refills non-secret fields after a server error. **Use this instead of bare `useActionState` for forms.** |
| `ui/confirm-button.tsx` | `ConfirmButton` — two-step destructive action |
| `ui/data.tsx` | `Delta` (gain/loss w/ glyph; `kind` pct / abs / inr), `Badge`, `Stat`, `Sparkline`, `RangeBar`, `ScoreBar` (diverging ±100), `StanceBadge`, `ToneBadge` |
| `news/news-list.tsx` | `NewsList({items, showSummary, hideSymbol, byDay})` (outbound links `rel=noopener noreferrer nofollow`, tone + symbol chips, clean titles, echo summaries hidden) |
| `research/factor-breakdown.tsx` | `FactorBreakdown` |
| `research/ai-read.tsx` | `AiRead` (client; calls `askMyAi`) |
| `ui/pager.tsx` | `Pager` (prev/next, keeps params), `pageParam(raw)` — every server-paginated table |
| `ui/section-tabs.tsx` | `SectionTabs({tabs, label})` — one section at a time; `#id` / aliases open a tab; panels mount on first open (stock page) |
| `ui/layout.tsx` | `PageHeader`, `Panel`, `Empty`, `PlanGate` (`data-testid="plan-gate"`), `TableWrap` (relative, focusable), table class strings `th thNum td tdNum tr` |
| `shell/*` | `Sidebar`, `MobileNav` (bottom bar + "More" sheet), `TickerPause`, `TenantSwitcher`, `SymbolSearch` (global command palette with `/` and `Ctrl+K` / `Cmd+K` shortcuts, recently viewed stocks else popular presets, desk quick links), `recent-symbols.ts` (`useRecentSymbols`, `rememberSymbol`, `<RememberSymbol>` — last 6 stocks opened, localStorage `qp:recent-symbols`), `MarketClock` (+ "EOD <date> · next <day> 17:00" freshness chip from `asOf`), `Notifications` (realtime), `ThemeToggle`, `UserMenu`, `TickerTape` |
| `market/signal-badge.tsx` | `SignalBadge({signal, strategy})` — BUY/EXIT plus the rule's name (its sentence on hover): Markets, Overview, Market Radar |
| `market/rule-health.tsx` | `HealthChip({row, prefix})` (status + meaning in the title, `data-health`), `HealthTrack` (record vs range on 0–100), `RuleHealthCard({title, row, history, label})` (Signals → The four rules), `CauseBar` — ADR-039 |
| `market/check-tag.tsx` | `CheckTag({rule})` — a signal check's tag (icon + words, meaning in the title): Signals list, dip-buy levels, stock page |
| `market/setup-badges.tsx` | `SetupBadges` (neutral badges, rule in the title) — screener and Market Radar |
| `market/*` | `MarketBreadthCard` (A/D ratio bar, sentiment bias badge, top NSE gainers/losers), `SectorPulse` (the Markets sector filter: one chip row, `aria-pressed`), `RadarToggle`, `AddSymbolForm` (live suggestions), `AlertForm`, `FilterBar` (URL-driven), `TradePlan` (asymmetric targets & capital presets & sizing), `QuantumAudit` ("How stretched are your stocks?": RSI zone in plain words, RSI gauge, filter chips, folded stop / targets), `BacktestLab` (quantitative strategy simulator with custom lookbacks, SL/TP risk controls, SVG interactive equity curve, filterable trade logs, CSV & Pine Script export), `CopyPineButton` (in the chart's rule bar: copies the chosen rule's script; with All / Clean a menu of the five), `PineScriptGeneratorPanel` (Integrations: ticker + rule), `useSymbolSearch(q)` (debounced `/api/symbols`), `RetiredNote` |
| `blog/*` | `PeriodsChart` (Made money / Average / Middle, by period), `YearsChart`, `SpreadChart`, `ExampleChart` (closes + trade lanes, hover/tap) — each with a legend and a "Show the numbers" table, series colours `--series-usual` / `--series-ours`; `RuleDiagram` (an illustration per rule, numbered notes); `PostBody`, `Inline` (**bold**, [link](/path)), `StatTiles` |
| `dry-run/dry-run-studio.tsx` | `DryRunStudio({candidates, benchmark, health})` (the whole flow, client: steps, `CandidateCard`, plan panel with `AllocationBar`, results tabs), `DryRunDisclosure` (fixed non-advice wording, `data-testid="dry-run-disclosure"`), type `Candidate` |
| `dry-run/replay-chart.tsx` | `ReplayChart` (lightweight-charts: plan line drawn in over 2.2 s, NIFTY 50 dashed, crosshair values, Replay button; instant under reduced motion) |
| `charts/trade-odds.tsx` | `TradeOdds` ("What usually happens next?" under the chart when a trade is selected: plain headline, 100-dot waffle, break-even pass mark, past-signal ▲▼ strip, method folded away; 5/10/20 days, target price) |
| `charts/price-chart.tsx` | `PriceChart` (lightweight-charts v5: candles + volume + full-history SMA 20/50/200 + strategy-isolated signal overlays [KK (dip + old breakout), SMA 20/50 (trend + old cross), RSI (dip + old reversal), Strong trend, 200-day trend (turns on SMA 200), All Plans, Clean (Off)] + HUD with plain-English signal explainer + Signals Timeline ribbon ("New" since last visit, `qp:chart-seen:<SYMBOL>` in localStorage) + trade view on selection [entry/stop/target price lines (no-target rules: an "Exit ±x%" line and the zone to the exit), risk/reward zones, 1R label, ~260 ms pan; reduced motion → instant] + one-time ring on new signals + collapsible daily OHLCV table view), types `ChartMarker`, `ChartStrategyFilter` |
| `charts/tradingview-widget.tsx` | `TradingViewWidget` (official free TradingView Advanced Chart embed with 100+ indicators & drawings) |
| `charts/market-chart-view.tsx` | `MarketChartView` (unified switcher between QuantsPulse Strategy Signals Chart and TradingView Pro) |
| `marketing/site-nav.tsx` | `SiteNav`, `SiteFooter` |
| `brand/logo.tsx` | `Logo`, `LogoMark` (Q whose tail ends in the coral signal dot; same geometry as `app/icon.svg`) |
| `onboarding/first-run.tsx` | `FirstRun` (overview checklist: radar, alert, notifications, extension; hides when done or dismissed), type `FirstRunStep` |
| `ui/skeleton.tsx` | `Bone`, `SkeletonPage`, `SkeletonHeader`, `SkeletonRows`, `SkeletonTiles`, `SkeletonCards` — static loading shapes for `loading.tsx` |

## 7. CSS utilities (globals.css)
`.panel`, `.panel-interactive`, `.num` (mono tabular), `.display` (serif), `.eyebrow` (small caps label), `.linen` (page grain),
`.hairline`, `.rule-dotted`, `.animate-marquee`, `.animate-fade-in` / `.animate-fadeIn`, `.animate-scale-in`, `.animate-slide-up`, `.animate-fade-quick` (150 ms opacity), `.signal-ring` (one-shot ring, invisible at rest), `.bar-fill`, shadow `shadow-pop`; color tokens incl. `gain`/`loss` (ink), `coral` / `coral-foreground`
(decoration), `coral-ink` (text), `*-soft`, `sma-20`/`sma-50`/`sma-200`, `series-usual`/`series-ours` (blog comparison charts; validated pair, never gain/loss hues). Chart code reads CSS vars `--gain`/`--loss` (mark colours) and `--sma-20`/`--sma-50`/`--sma-200`.

## 8. Scripts & tests

| Path | What |
|---|---|
| `scripts/secret-scan.mjs` | `--staged` (pre-commit) / `--history` (CI) secret scanner |
| `research/strategies/` | Strategy research (Python, read-only on Supabase): 7-year download, backtests, fair checks, diagnosis, walk-forward signal checker, Strong trend record, live SQL cross-check — see its README |
| `research/strategies/compare_blog.py`, `blog_ts.py` | The blog's test: each live rule against the usual way of using its indicator (same stocks, years, costs) → `data/blog_compare.json` (`python compare_blog.py sma rsi kk strong`, then `ma200`; memory) → `blog_ts.py` writes `web/src/lib/blog/data.ts` |
| `scripts/ingest_kk_signals.py` | Ingests verified empirical KK breakout trades from `kk_eod_results_fixed.json` into Supabase `public.trading_signals` |
| `.githooks/pre-commit` | runs the staged scan; enable with `git config core.hooksPath .githooks` |
| `web/scripts/brand-icons.mts` | renders the mark to `app/apple-icon.png`, `public/icons/*`, `extension/icons/*` (installed Chrome) |
| `web/scripts/ingest-news.mts` | `npm run ingest:news [-- --relink]` |
| `web/scripts/check-bundle-secrets.mjs` | `postbuild` — fails if a server-only secret is in `.next/static` |
| `web/e2e/*.spec.ts` | Playwright: `chart-replay` (start, step, keys, practice, play/pause with a frame-time check, exit), `tradebook-import` (check, import, re-import, undo; columns by hand), `holdings-trust` (undo a split adjustment; rule choice for holders), `public`, `auth`, `navigation`, `research`, `markets`, `security`, `a11y`, `strategy-plan`, `chart-trade-view`, `setups`, `onboarding`, `extension-api`, `dry-run` (@mobile too), `signals` (@mobile too: four rules, market weather, track record), `extension-live` (opt-in: the real extension in Chromium, `EXTENSION_E2E=1 E2E_PORT=3000`), `writes` (hook-gated) |
| `web/e2e/helpers/` | `admin.ts` (disposable users via admin API; `seedSplitAdjustment`), `fixtures.ts` (`basicPage`, `proPage`, `expectNoHorizontalOverflow`), `axe.ts`, `extra-users.ts` |
| `supabase/tests/harness` | PGlite runner for migrations + seeds + `tests/NN_*.sql` |
| `supabase/scripts/apply.mjs` | migrations/seeds/tests against the live project |
| `supabase/scripts/freshness.mjs` | `node freshness.mjs` — read-only report: latest candle per segment, stale quotes, latest signal and grade per rule, weather, research/news times, pg_cron jobs and their last runs |
| `supabase/scripts/time-analytics.mjs` | `node time-analytics.mjs [batch] [offsets]` — times each step of the pipeline's analytics batch on the live DB inside a rolled-back transaction (keep each batch well under PostgREST's 8 s) |
| `pipelines/eod/eod.py` | EOD candles from Yahoo (yfinance) → Supabase, then analytics/research/notifier RPCs; `--days N`, `--dry-run`, `--symbols A,B`. Pure helpers: `last_settled_day`, `to_candles`, `yahoo_ticker`, `split_history` (`--splits-history`: every split/bonus per stock → `corporate_actions`), `split_events` (Yahoo's splits/bonuses → `corporate_actions` rows, stored before the notifier), `split_symbols`, `run_split` / `run_analytics` (split a batch that hits the statement limit; research uses it too, non-fatal); config `YAHOO_OVERRIDES`, `HISTORY_FROM`, `FULL_HISTORY_DAYS` |
| `pipelines/eod/universe.py` | `fetch_universe()` (screener + sectors + curated `INDICES`/`ETFS`), `merge(fresh, existing)`, `retire_allowed`, `split_ticker`, `clean_name` |
| `pipelines/eod/test_universe.py` | unit tests |
| `pipelines/eod/checks_refit.py` | quarterly refit of the RSI dip check: reads `svc_signal_check_training`, fits `tier_model.fit` on complete cohorts, stores via `svc_put_signal_check_model`; `--quarter`, `--dry-run`. `tier_model.py` = byte copy of `research/strategies/team/metalabel/tier_model.py`; tests `test_checks_refit.py` |
| `pipelines/eod/audit.py` | read-only accuracy audit: DB vs fresh Yahoo, sanity, independent recomputation of snapshot/RSI/signals/backtests (`--symbols`, `--days`); exit 1 on any mismatch; Yahoo's own lags and gaps are REVIEW lines (`vendor_has_history`, `split_extra`, `sessions_behind`, `revised_since`, `REVIEWED_GAPS`; tests `test_audit.py`) |
| `pipelines/eod/test_eod.py` | unit tests (`python -m unittest test_eod`, no network) |
| `.github/workflows/ci.yml`, `news-ingest.yml`, `market-eod.yml`, `signal-checks-refit.yml` | CI, scheduled news, scheduled EOD prices, the quarterly refit of the RSI dip check |

## 9. Chrome Extension (`extension/`)

| Path | What |
|---|---|
| `extension/manifest.json` | Manifest V3: `sidePanel`, permissions, broker matches, `all_frames: true` |
| `extension/background.js` | Service worker: owns auth (`refreshAuth()` → POST `/api/extension/session` with cookies — POST because Chrome omits the Origin on an extension's GET, `currentToken()` renews before expiry, retry once on 401), `ALLOWED_BACKENDS` (prod + localhost only), `FETCH_QUOTE_DATA` (only quote path: side panel + HUD) with 30s cache, `QP_REFRESH_AUTH` message, toolbar badge |
| `extension/content-scripts/auth-sync.js` | On the QuantsPulse site: asks the background worker to re-check sign-in (load, tab visible, every 5 min, `QP_REQUEST_AUTH_SYNC`); reads no storage or cookies |
| `extension/content-scripts/detector.js` | Ticker detection ladder (`KNOWN_INDICES`), Shadow DOM On-Chart HUD (`signalMeta(kind)`), drag/layout customization; fetches only via the background worker |
| `extension/sidepanel/sidepanel.html` | Side Panel UI: Phosphor icon sprite, sticky quote with 3-month price line, tabs Signal / Plan / Levels, view states (loading placeholders, empty, locked, error), toast |
| `extension/sidepanel/sidepanel.css` | Zen Linen tokens from MASTER.md (ink + mark gain/loss, light/dark), type scale 11/12/13/16/22, motion 150–200 ms, reduced-motion off-switch |
| `extension/options/options.{html,css,js}` | Options page (`options_ui`): overlay on/off + style, server (prod or localhost only; switching clears the token) |
| `extension/sidepanel/sidepanel.js` | Side Panel controller: `showView`, `render` → `renderSpark` (hover/arrow-key reading), `renderSignal` (story + timeline), `renderPlan` (price ladder), `renderLevels` (distance bars); `selectTab` (remembered, arrow keys); click-to-copy via `data-copy` + `toast`; multi-broker detection (`detectActiveTab`), Pine Script generator, `/` & `Ctrl+K` |
| `web/src/server/privileged/extension.ts` | Privileged API (`/api/extension/quote`): index aliases, stored signals only (no stand-ins), trade plan only while the latest signal is a long entry (from its entry/stop), sentiment audit |

