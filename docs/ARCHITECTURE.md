# Architecture

```
 Browser ──HTTPS──▶ Next.js 16 (web/)                              Supabase project
                    ├─ src/proxy.ts  refresh session, gate /app /admin
                    ├─ Server Components ── supabaseServer() ──JWT──▶ PostgREST ─▶ Postgres (RLS)
                    ├─ Server Actions   ─┘                                         ├─ public.*   user + market data
                    ├─ server/privileged/* ── service role ──────────▶ PostgREST   ├─ private.*  secrets, admins (not exposed)
                    │     (seal/open AES-GCM, key from env)            └─ svc_* RPCs bridge to private
                    └─ Client components ── supabaseBrowser() ── Realtime (notifications, RLS-filtered)
                                                                      Auth ── custom_access_token_hook → app_tenant_id claim
 Market pipelines (service role / worker) ──▶ market_symbols, market_candles, trading_signals, rsi_events, backtest_ledgers
 pg_cron ──▶ expire-subscriptions · retention-* · eod-notifier (alerts, exit signals, plan expiry → notifications)
 FastAPI analytics (future) ──▶ role analytics_reader: SELECT on market tables only
```

## Request lifecycle (signed-in page)

1. `proxy.ts` → `updateSession()` refreshes the Supabase cookie and verifies the JWT (`getClaims`). Unauthenticated
   requests to `/app*` or `/admin*` redirect to `/login?next=…`.
2. `app/app/layout.tsx` → `requireSession()` (cached per request): claims (`sub`, `app_tenant_id`), profile,
   memberships, `my_entitlements()`. Checks single-active-device. Shows a banner if the hook claim is missing.
3. The page queries with the same RLS client. Every policy re-checks `user_id = auth.uid()`, `tenant_id = active tenant`
   and live membership — so a removed member loses access immediately, regardless of token age.

## Tenancy

- A **tenant** owns data and billing. Personal tenant per user (created by `handle_new_user`); organisation tenants by invite.
- The active tenant travels in the JWT (`app_tenant_id`), chosen by the access-token hook from `profiles.default_tenant_id`.
- Switching: server action → `switchTenant()` (privileged: verify membership, update default) → `auth.refreshSession()`.

## Privilege boundaries

| Actor | Access path | Can |
|---|---|---|
| User | JWT → RLS | own rows in active tenant; read market data |
| Tenant owner/admin | JWT → RLS + `tenant_member_directory` / `tenant_feature_usage` RPCs | roster, plans, usage counts, audit — not financial data |
| Server actions (user context) | JWT → RLS | same as user |
| Privileged modules | service role | cross-tenant work, private schema via `svc_*`, auth admin API — always re-check with `guards.ts` |
| Platform admin | privileged modules after `svc_is_platform_admin` | search accounts (whitelisted columns), activate plans |
| Pipelines | service role (separate deploy) | write market tables |
| FastAPI | `analytics_reader` | read market tables only |

## Secrets

`seal(plaintext, aad)` → `{ciphertext, iv, auth_tag, key_version}` (base64) → `svc_put_*` → `private.*` (bytea).
AAD = `ai_key:<row id>` / `broker:<connection id>` so ciphertext can't be moved between rows.
Key: `QP_SECRETS_KEY_V<n>` env (32 bytes base64), current version in `QP_SECRETS_KEY_CURRENT`.

## Market data & signals (current state)

Dev/staging uses `supabase/seed/dev_market_data.sql` (synthetic random walk, 42 NIFTY names, ~2 years). It computes
RSI(14), SMA 20/50 crosses, RSI reversals and a monthly-SIP backtest ledger with the same shapes production pipelines
must produce. `market_snapshot` (security-invoker view) gives the latest quote per symbol to the app.

## Notifications

`private.run_eod_notifier()` (pg_cron, 16:15 IST weekdays): triggers armed alerts whose level the last daily candle's
high/low crossed; notifies holders of new exit signals; sends 7-day plan-expiry reminders. Idempotent via `data`
keys. Client bell subscribes to `notifications` inserts over Realtime.

## Frontend

Next.js App Router, React 19, Tailwind v4 with Zen Linen tokens in `globals.css`. Server components by default;
client components only for interaction (forms, menus, chart, realtime). Fonts via `next/font` (Inter, Playfair
Display, JetBrains Mono). Charts: lightweight-charts v5. Icons: Phosphor.

## Testing

- `supabase/tests/harness` loads a Supabase shim (auth/storage/cron stand-ins, roles) into PGlite, applies all
  migrations + seed, then runs `tests/NN_*.sql`. Tests are plain SQL in a rolled-back transaction, so the same files
  run unchanged on staging via the SQL editor.
- Web: `tsc`, ESLint (incl. service-role import ban), `next build`.
