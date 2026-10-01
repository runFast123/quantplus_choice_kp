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
| 04 | `user_financial_data` | `broker_connections`, `private.broker_credentials`, `portfolios`, `holdings`, `watchlists`, `watchlist_items`, `price_alerts`, `notifications` |
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
| 15 | `service_rpcs` | `svc_is_platform_admin`, `svc_put/get_broker_credentials`, `svc_put/get_ai_key_secret`, `svc_admin_user_search` (service_role only) |
| 16 | `eod_notifier` | `private.run_eod_notifier()` + cron `eod-notifier` (16:15 IST Mon–Fri) |
| 17 | `news_research` | `news_sources`, `news_articles`, `news_article_symbols`, `news_symbol_aliases`, `news_search_cursor`, `research_notes`; view `symbol_news_stats`; `private.refresh_research_notes()`, `svc_refresh_research()`; crons `research-notes`, `retention-news`, `retention-research` |
| 18 | `news_sources_access` | disables feeds that block automated readers |
| 19 | `research_latest` | view: latest note per symbol + previous score |
| 20 | `news_sources_active_column` | members may read `news_sources.is_active` (not URLs/errors) |
| 21 | `user_delete_cleanup` | trigger `on_auth_user_deleted` → deletes the user's personal tenant |

Seeds: `seed/dev_market_data.sql` (SYNTHETIC, dev/staging) · `seed/ref_news_aliases.sql` (reference, safe for prod).
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
| `svc_*` | service_role | bridge to the `private` schema (see 15); `svc_refresh_research()` rebuilds notes (17) |

### Cron jobs
`expire-subscriptions` (*/15), `retention-notifications`, `retention-activity-events`, `retention-ai-usage`,
`retention-expired-invitations`, `retention-news`, `retention-research` (daily 02:xx UTC), `eod-notifier` (10:45 UTC
Mon–Fri), `research-notes` (11:00 UTC Mon–Fri).

### Views
`market_snapshot` (latest quote), `symbol_news_stats`, `research_latest` — all `security_invoker`, authenticated only.

### Notification types
`price_alert`, `exit_signal`, `plan_expiry`, `research_stance` (`broker_reauth` reserved).

### Error codes raised by the DB (mapped by `friendlyDbError`)
`PLAN_LIMIT_REACHED`, `NO_ACTIVE_PLAN`, `NOT_AUTHORIZED`, `USER_NOT_IN_TENANT`, `INVALID_INPUT`, `INVALID_EVENT_TYPE`, RLS `row-level security`.

---

## 2. Server (web/src/server)

| Module | Exports | Notes |
|---|---|---|
| `session.ts` | `getSession` (cached), `requireSession`, `can(s, feature)`, `isTenantAdmin(s)`, `displayName(s)`, type `Session` | One read per request: claims, profile, memberships, entitlements, `hookMissing` |
| `market-data.ts` | `getQuotes`, `normalizeQuote`, `getSparks`, `getCandles`, `positions`, `summarize`, type `Position` | All numeric normalisation from PostgREST strings happens here |
| `device.ts` | `DEVICE_COOKIE`, `claimThisDevice(userId)` | Single-active-device; call from actions/route handlers only |
| `privileged/service-role.ts` | `serviceRole()` | **Only importable inside `privileged/`** |
| `privileged/guards.ts` | `membershipRole`, `assertMember`, `planHasFeature`, `hasActiveConsent`, `PrivilegedError` | Re-establish what RLS would enforce |
| `privileged/crypto.ts` | `seal(plaintext, aad)`, `open(sealed, aad)`, type `Sealed` | AES-256-GCM, `QP_SECRETS_KEY_V<n>` |
| `privileged/audit.ts` | `audit({...})` | Append to `audit_log` with hashed IP |
| `privileged/tenants.ts` | `switchTenant`, `createOrganization`, `createInvitation`, `previewInvitation`, `acceptInvitation`, `changeMemberRole` | Role-escalation rules live here |
| `privileged/secrets.ts` | `saveAiKey`, `connectBroker` | Plan + consent checks, encryption, `svc_put_*` |
| `privileged/admin.ts` | `isPlatformAdmin`, `searchUsers`, `activatePlan`, `platformStats`, type `AdminUserRow` | Platform console |
| `privileged/account.ts` | `registerDevice`, `deviceHash`, `applyConsentWithdrawal`, `deleteAccount` | §7 deletion order |
| `privileged/news.ts` | `ingestNews({searchSymbols})`, `relinkRecentArticles(days)`, `newsSourceHealth()`, type `IngestReport` | RSS pipeline; only DB-listed URLs fetched |
| `privileged/ai.ts` | `researchReadWithMyKey(userId, tenantId, symbol)`, type `AiRead` | BYOK; Anthropic SDK / OpenAI / Gemini; metering only |
| `news-data.ts` | `getNews(db, {symbols?, tone?, kind?, limit?, before?})`, `getResearch(db, symbols?)`, `normalizeNote`, types `NewsItem`, `ResearchNote`, `ResearchFactor` | RLS client reads |

## 3. Lib (web/src/lib) — pure, safe anywhere

| Module | Exports |
|---|---|
| `format.ts` | `factorScore`, `price`, `rupees`, `rupeesCompact` (L/Cr), `paiseToRupees`, `qty`, `volume`, `pct`, `signed`, `date`, `dateTime`, `longDate`, `relative`, `isoDaysAgo`, `isoNow`, `daysUntil`, `strategyLabel` |
| `market.ts` | `nseSession(now)` → pre-open / open / closed (IST; holidays not modelled) |
| `errors.ts` | `friendlyDbError(message)`, type `ActionState` |
| `consents.ts` | `CONSENT_VERSION`, `CONSENT_COPY` |
| `plans.ts` | `FEATURE_ROWS` (feature key → label, display order) |
| `news/feed.ts` | `parseFeed(xml)`, `parseFeedDate`, `cleanText`, `decodeEntities`, `normaliseUrl`, `nseFilingSymbol` |
| `news/match.ts` | `SymbolMatcher` (`match`, `matchesSymbol`), `stripLegalSuffix` — sibling-entity guard (`SIBLING_WORDS`) |
| `news/tone.ts` | `scoreTone(text)` → `{score, label, terms}`; `POSITIVE`, `NEGATIVE` word lists |
| `news/news.test.mts` | unit tests (`npm run test:unit`) |
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
| `app/app/integrations/actions.ts` | `connectBrokerAction`, `disconnectBroker`, `saveAiKeyAction`, `deleteAiKey` |
| `app/app/settings/actions.ts` | `updateProfile`, `changePassword`, `setConsent`, `deleteMyAccount` |
| `app/admin/actions.ts` | `activatePlanAction`, `fetchNewsNow` |
| `app/app/research/actions.ts` | `askMyAi` (BYOK research read; nothing stored) |
| `app/invite/[token]/page.tsx` | inline `accept` action |

## 5. Routes

| Route | What |
|---|---|
| `/` | landing (plans from DB, fallback constants) |
| `/login` `/signup` `/forgot` | auth (group `(auth)`) |
| `/auth/confirm` | email link handler (token_hash or PKCE code) |
| `/invite/[token]` | accept organisation invite |
| `/legal/[doc]` | `terms`, `privacy` (drafts) |
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
| `ui/use-echo-action.ts` | `useEchoAction(action)` → `[state, dispatch, pending, values]`; refills non-secret fields after a server error. **Use this instead of bare `useActionState` for forms.** |
| `ui/confirm-button.tsx` | `ConfirmButton` — two-step destructive action |
| `ui/data.tsx` | `Delta` (gain/loss w/ glyph), `Badge`, `Stat`, `Sparkline`, `RangeBar`, `ScoreBar` (diverging ±100), `StanceBadge`, `ToneBadge` |
| `news/news-list.tsx` | `NewsList` (outbound links `rel=noopener noreferrer nofollow`, tone + symbol chips) |
| `research/factor-breakdown.tsx` | `FactorBreakdown` |
| `research/ai-read.tsx` | `AiRead` (client; calls `askMyAi`) |
| `ui/layout.tsx` | `PageHeader`, `Panel`, `Empty`, `PlanGate` (`data-testid="plan-gate"`), `TableWrap` (relative, focusable), table class strings `th thNum td tdNum tr` |
| `shell/*` | `Sidebar`, `MobileNav`, `TenantSwitcher`, `SymbolSearch` ("/" shortcut), `MarketClock`, `Notifications` (realtime), `ThemeToggle`, `UserMenu`, `TickerTape` |
| `market/*` | `RadarToggle`, `AddSymbolForm`, `AlertForm`, `FilterBar` (URL-driven) |
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
| `.github/workflows/ci.yml`, `news-ingest.yml` | CI and scheduled news |
