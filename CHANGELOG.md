# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Newest first.
**Every change adds a line under _Unreleased_** — what changed, why, and where. Agents: read this before
building something; it may already exist (then check `docs/CODEMAP.md`).

## [Unreleased]

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
