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
