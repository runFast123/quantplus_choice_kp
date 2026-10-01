# Changelog

All notable changes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Newest first.
**Every change adds a line under _Unreleased_** — what changed, why, and where. Agents: read this before
building something; it may already exist (then check `docs/CODEMAP.md`).

## [Unreleased]

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
