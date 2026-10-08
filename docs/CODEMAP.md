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
| 25 | `news_story_dedupe` | `news_articles.story_hash` (trigger + unique), `private.news_story_hash()`, `svc_store_news_articles(jsonb)` |

Seeds: `seed/dev_market_data.sql` (SYNTHETIC, dev/staging — **never production**) · `seed/ref_market_symbols.sql` (core 44,
`history_days` 760, TATAMOTORS retirement note; the full universe comes from `pipelines/eod/universe.py`; prod-safe) · `seed/ref_news_aliases.sql` (reference, prod-safe).
Runner: `supabase/scripts/apply.mjs` — `npm run migrate | status | seed:ref | seed:dev | test:remote` (reads `supabase/.env`).

### RPCs callable from the app

| RPC | Caller | Purpose |
|---|---|---|
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
`price_alert`, `exit_signal`, `plan_expiry`, `research_stance`.

### Error codes raised by the DB (mapped by `friendlyDbError`)
`PLAN_LIMIT_REACHED`, `NO_ACTIVE_PLAN`, `NOT_AUTHORIZED`, `USER_NOT_IN_TENANT`, `INVALID_INPUT`, `INVALID_EVENT_TYPE`, RLS `row-level security`.

---

## 2. Server (web/src/server)

| Module | Exports | Notes |
|---|---|---|
| `session.ts` | `getSession` (cached), `requireSession`, `can(s, feature)`, `isTenantAdmin(s)`, `displayName(s)`, type `Session` | One read per request: claims, profile, memberships, entitlements, `hookMissing`, `deviceActive`. **`requireSession()` redirects inactive devices to `/device` — use it in every page and action** |
| `market-data.ts` | `getQuotes(db, symbols)`, `getTape`, `getBreadth`, `getRetired`, `normalizeQuote`, `getSparks`, `getCandles`, `positions`, `summarize`, type `Position` | All numeric normalisation from PostgREST strings happens here |
| `device.ts` | `DEVICE_COOKIE`, `claimThisDevice(userId)` | Single-active-device; call from actions/route handlers only |
| `device-hash.ts` | `deviceHash(id)` | SHA-256 of the device cookie |
| `privileged/service-role.ts` | `serviceRole()` | **Only importable inside `privileged/`** |
| `privileged/guards.ts` | `membershipRole`, `assertMember`, `planHasFeature`, `hasActiveConsent`, `PrivilegedError` | Re-establish what RLS would enforce |
| `privileged/crypto.ts` | `seal(plaintext, aad)`, `open(sealed, aad)`, type `Sealed` | AES-256-GCM, `QP_SECRETS_KEY_V<n>` |
| `privileged/audit.ts` | `audit({...})` | Append to `audit_log` with hashed IP |
| `privileged/tenants.ts` | `switchTenant`, `createOrganization`, `createInvitation`, `previewInvitation`, `acceptInvitation`, `changeMemberRole` | Role-escalation rules live here |
| `privileged/secrets.ts` | `saveAiKey` | Plan + consent checks, encryption, `svc_put_ai_key_secret` |
| `privileged/admin.ts` | `isPlatformAdmin`, `searchUsers`, `activatePlan`, `platformStats`, type `AdminUserRow` | Platform console |
| `privileged/account.ts` | `registerDevice`, `deviceHash`, `applyConsentWithdrawal`, `deleteAccount` | §7 deletion order |
| `privileged/news.ts` | `ingestNews({searchSymbols})`, `relinkRecentArticles(days)`, `newsSourceHealth()`, type `IngestReport` | RSS pipeline; only DB-listed URLs fetched |
| `privileged/ai.ts` | `researchReadWithMyKey(userId, tenantId, symbol)`, type `AiRead` | BYOK; Anthropic SDK / OpenAI / Gemini; metering only |
| `news-data.ts` | `getNews(db, {symbols?, tone?, kind?, limit?, before?})`, `getResearch(db, symbols?)`, `normalizeNote`, types `NewsItem`, `ResearchNote`, `ResearchFactor` | RLS client reads |

## 3. Lib (web/src/lib) — pure, safe anywhere

| Module | Exports |
|---|---|
| `format.ts` | `factorScore`, `signedInt`, `price`, `rupees`, `rupeesCompact` (L/Cr), `paiseToRupees`, `qty`, `volume`, `pct`, `signed`, `date`, `dateTime`, `longDate`, `relative`, `isoDaysAgo`, `isoNow`, `daysUntil`, `strategyLabel` |
| `market.ts` | `nseSession(now)` → pre-open / open / closed (IST; holidays not modelled); `PRICE_SOURCE` (attribution label); `SECTORS` (Yahoo's 11); `SEGMENT_LABEL`, type `Segment` |
| `errors.ts` | `friendlyDbError(message)`, type `ActionState` |
| `safe-next.ts` | `safeNext(raw, fallback)` — **only** way to use a user-supplied redirect target |
| `consents.ts` | `CONSENT_VERSION`, `CONSENT_COPY` |
| `plans.ts` | `FEATURE_ROWS` (feature key → label, display order) |
| `news/feed.ts` | `parseFeed(xml)`, `parseFeedDate`, `cleanText`, `decodeEntities`, `normaliseUrl`, `nseFilingSymbol` |
| `news/match.ts` | `SymbolMatcher` (`match`, `matchesSymbol`), `stripLegalSuffix` — sibling-entity guard (`SIBLING_WORDS`) |
| `news/tone.ts` | `scoreTone(text)` → `{score, label, terms}`; `POSITIVE`, `NEGATIVE` word lists |
| `news/news.test.mts` | unit tests (`npm run test:unit`) |
| `trade-plan.ts` | `calculateTradePlan`, `calculatePositionSize`, `evaluateSentiment`, types `TradePlanResult`, `PositionSizeResult`, `SentimentResult` |
| `trade-plan.test.mts` | unit tests (`npm run test:unit`) |
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
| `app/app/portfolio/actions.ts` | `addHolding` (merges at weighted avg), `updateHolding`, `deleteHolding`, `createPortfolio` |
| `app/app/alerts/actions.ts` | `createAlert`, `setAlertStatus`, `deleteAlert` |
| `app/app/workspace/actions.ts` | `createOrgAction`, `inviteAction`, `revokeInvitation`, `changeRoleAction`, `removeMember`, `leaveWorkspace`, `renameWorkspace` |
| `app/app/integrations/actions.ts` | `saveAiKeyAction`, `deleteAiKey` |
| `app/app/settings/actions.ts` | `updateProfile`, `changePassword`, `setConsent`, `deleteMyAccount` |
| `app/admin/actions.ts` | `activatePlanAction`, `fetchNewsNow` |
| `app/app/research/actions.ts` | `askMyAi` (BYOK research read; nothing stored) |
| `app/invite/[token]/page.tsx` | inline `accept` action |

## 5. Routes

| Route | What |
|---|---|
| `/` | landing (plans from DB, fallback constants) |
| `/api/symbols?q=` | ranked symbol search (`search_symbols`) for the header and add forms; signed-in only |
| `/login` `/signup` `/forgot` | auth (group `(auth)`) |
| `/auth/confirm` | email link handler (token_hash or PKCE code) |
| `/invite/[token]` | accept organisation invite |
| `/legal/[doc]` | `terms`, `privacy` (drafts) |
| `/device` | single-device takeover screen (target of `requireSession` for displaced devices) |
| `/app` | overview (redirects to `/app/welcome` until terms consent) |
| `/app/markets`, `/app/markets/[symbol]` | screener; symbol page with chart, levels, signals, backtest |
| `/app/watchlist` `/app/portfolio` `/app/alerts` `/app/signals` | product pages |
| `/app/workspace` `/app/integrations` `/app/billing` `/app/settings` | account pages (`settings?tab=profile|security|privacy|data`) |
| `/app/settings/export` | GET → JSON download of `export_my_data()` |
| `/app/research` | Research desk (`?scope=mine&stance=&sort=score|low|change|news`) |
| `/app/news` | News feed (`?scope=all&tone=&kind=news|filing&before=`) |
| `/api/cron/news` | GET/POST with `Authorization: Bearer $CRON_SECRET` → `ingestNews` |
| `/admin` | platform console (404 unless platform admin) |

## 6. Components (web/src/components)

| Folder | Components |
|---|---|
| `ui/button.tsx` | `Button`, `ButtonLink`, `buttonClass(variant, size)` — variants primary/secondary/ghost/danger/coral |
| `ui/field.tsx` | `Input`, `Select`, `Field`, `FormMessage`, `inputClass` |
| `ui/submit-button.tsx` | `SubmitButton` (useFormStatus) |
| `ui/use-echo-action.ts` | `useEchoAction(action, onResult?)` → `[state, dispatch, pending, values]`; refills non-secret fields after a server error. **Use this instead of bare `useActionState` for forms.** |
| `ui/confirm-button.tsx` | `ConfirmButton` — two-step destructive action |
| `ui/data.tsx` | `Delta` (gain/loss w/ glyph), `Badge`, `Stat`, `Sparkline`, `RangeBar`, `ScoreBar` (diverging ±100), `StanceBadge`, `ToneBadge` |
| `news/news-list.tsx` | `NewsList` (outbound links `rel=noopener noreferrer nofollow`, tone + symbol chips) |
| `research/factor-breakdown.tsx` | `FactorBreakdown` |
| `research/ai-read.tsx` | `AiRead` (client; calls `askMyAi`) |
| `ui/pager.tsx` | `Pager` (prev/next, keeps params), `pageParam(raw)` — every server-paginated table |
| `ui/layout.tsx` | `PageHeader`, `Panel`, `Empty`, `PlanGate` (`data-testid="plan-gate"`), `TableWrap` (relative, focusable), table class strings `th thNum td tdNum tr` |
| `shell/*` | `Sidebar`, `MobileNav` (bottom bar + "More" sheet), `TickerPause`, `TenantSwitcher`, `SymbolSearch` ("/" shortcut), `MarketClock`, `Notifications` (realtime), `ThemeToggle`, `UserMenu`, `TickerTape` |
| `market/*` | `RadarToggle`, `AddSymbolForm` (live suggestions), `AlertForm`, `FilterBar` (URL-driven), `TradePlan` (asymmetric targets & capital-constrained sizing), `useSymbolSearch(q)` (debounced `/api/symbols`), `RetiredNote` |
| `charts/price-chart.tsx` | `PriceChart` (lightweight-charts v5: candles + volume + signal markers), type `ChartMarker` |
| `marketing/site-nav.tsx` | `SiteNav`, `SiteFooter` |
| `brand/logo.tsx` | `Logo`, `LogoMark` |

## 7. CSS utilities (globals.css)
`.panel`, `.num` (mono tabular), `.display` (serif), `.eyebrow` (small caps label), `.linen` (page grain),
`.hairline`, `.rule-dotted`, `.animate-marquee`, shadow `shadow-pop`; color tokens incl. `gain`/`loss` (ink), `coral`
(decoration), `coral-ink` (text), `*-soft`. Chart code reads CSS vars `--gain`/`--loss` (mark colours).

## 8. Scripts & tests

| Path | What |
|---|---|
| `scripts/secret-scan.mjs` | `--staged` (pre-commit) / `--history` (CI) secret scanner |
| `.githooks/pre-commit` | runs the staged scan; enable with `git config core.hooksPath .githooks` |
| `web/scripts/ingest-news.mts` | `npm run ingest:news [-- --relink]` |
| `web/scripts/check-bundle-secrets.mjs` | `postbuild` — fails if a server-only secret is in `.next/static` |
| `web/e2e/*.spec.ts` | Playwright: `public`, `auth`, `navigation`, `research`, `markets`, `security`, `a11y`, `writes` (hook-gated) |
| `web/e2e/helpers/` | `admin.ts` (disposable users via admin API), `fixtures.ts` (`basicPage`, `proPage`, `expectNoHorizontalOverflow`), `axe.ts`, `extra-users.ts` |
| `supabase/tests/harness` | PGlite runner for migrations + seeds + `tests/NN_*.sql` |
| `supabase/scripts/apply.mjs` | migrations/seeds/tests against the live project |
| `pipelines/eod/eod.py` | EOD candles from Yahoo (yfinance) → Supabase, then analytics/research/notifier RPCs; `--days N`, `--dry-run`, `--symbols A,B`. Pure helpers: `last_settled_day`, `to_candles`, `yahoo_ticker`, `split_symbols`; config `YAHOO_OVERRIDES`, `HISTORY_FROM`, `FULL_HISTORY_DAYS` |
| `pipelines/eod/universe.py` | `fetch_universe()` (screener + sectors + curated `INDICES`/`ETFS`), `merge(fresh, existing)`, `retire_allowed`, `split_ticker`, `clean_name` |
| `pipelines/eod/test_universe.py` | unit tests |
| `pipelines/eod/audit.py` | read-only accuracy audit: DB vs fresh Yahoo, sanity, independent recomputation of snapshot/RSI/signals/backtests (`--symbols`, `--days`); exit 1 on any mismatch |
| `pipelines/eod/test_eod.py` | unit tests (`python -m unittest test_eod`, no network) |
| `.github/workflows/ci.yml`, `news-ingest.yml`, `market-eod.yml` | CI, scheduled news, scheduled EOD prices |
