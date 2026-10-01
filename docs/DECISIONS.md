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
**Date** 2026-10-01 · **Status** accepted (interim)
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
**Date** 2026-10-01 · **Status** accepted
Withdrawing `broker_data_access` deletes the user's broker connections in every tenant (privileged), and
withdrawing `ai_processing` deletes their AI keys — RLS alone would only reach the active tenant.
