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

### RPCs callable from the app

| RPC | Caller | Purpose |
|---|---|---|
| `my_entitlements()` | user | plan, status, features, limits, slots used — active tenant |
| `track_event(p_event_type)` | user | feature-usage event (regex `^[a-z_]{3,48}$`, no symbols) |
| `export_my_data()` | user | JSON of the caller's rows (security invoker) |
| `tenant_member_directory(p_tenant)` | tenant owner/admin, platform admin | whitelisted member columns |
| `tenant_feature_usage(p_tenant, p_from, p_to)` | tenant owner/admin, platform admin | counts per user × event |
| `admin_activate_plan(...)` | service_role | subscription + payment + audit, one transaction |
| `svc_*` | service_role | bridge to the `private` schema (see 15) |

### Cron jobs
`expire-subscriptions` (*/15), `retention-notifications`, `retention-activity-events`, `retention-ai-usage`,
`retention-expired-invitations` (daily 02:xx UTC), `eod-notifier` (10:45 UTC Mon–Fri).

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

## 3. Lib (web/src/lib) — pure, safe anywhere

| Module | Exports |
|---|---|
| `format.ts` | `price`, `rupees`, `rupeesCompact` (L/Cr), `paiseToRupees`, `qty`, `volume`, `pct`, `signed`, `date`, `dateTime`, `longDate`, `relative`, `isoDaysAgo`, `isoNow`, `daysUntil`, `strategyLabel` |
| `market.ts` | `nseSession(now)` → pre-open / open / closed (IST; holidays not modelled) |
| `errors.ts` | `friendlyDbError(message)`, type `ActionState` |
| `consents.ts` | `CONSENT_VERSION`, `CONSENT_COPY` |
| `plans.ts` | `FEATURE_ROWS` (feature key → label, display order) |
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
| `app/admin/actions.ts` | `activatePlanAction` |
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
| `/admin` | platform console (404 unless platform admin) |

## 6. Components (web/src/components)

| Folder | Components |
|---|---|
| `ui/button.tsx` | `Button`, `ButtonLink`, `buttonClass(variant, size)` — variants primary/secondary/ghost/danger/coral |
| `ui/field.tsx` | `Input`, `Select`, `Field`, `FormMessage`, `inputClass` |
| `ui/submit-button.tsx` | `SubmitButton` (useFormStatus) |
| `ui/confirm-button.tsx` | `ConfirmButton` — two-step destructive action |
| `ui/data.tsx` | `Delta` (gain/loss w/ glyph), `Badge`, `Stat`, `Sparkline`, `RangeBar` |
| `ui/layout.tsx` | `PageHeader`, `Panel`, `Empty`, `PlanGate`, `TableWrap`, table class strings `th thNum td tdNum tr` |
| `shell/*` | `Sidebar`, `MobileNav`, `TenantSwitcher`, `SymbolSearch` ("/" shortcut), `MarketClock`, `Notifications` (realtime), `ThemeToggle`, `UserMenu`, `TickerTape` |
| `market/*` | `RadarToggle`, `AddSymbolForm`, `AlertForm`, `FilterBar` (URL-driven) |
| `charts/price-chart.tsx` | `PriceChart` (lightweight-charts v5: candles + volume + signal markers), type `ChartMarker` |
| `marketing/site-nav.tsx` | `SiteNav`, `SiteFooter` |
| `brand/logo.tsx` | `Logo`, `LogoMark` |

## 7. CSS utilities (globals.css)
`.panel`, `.num` (mono tabular), `.display` (serif), `.eyebrow` (small caps label), `.linen` (page grain),
`.hairline`, `.rule-dotted`, `.animate-marquee`, shadow `shadow-pop`; color tokens incl. `gain`, `loss`, `coral`, `*-soft`.
