# AGENTS.md — read this before changing anything

QuantsPulse is a multi-tenant research app for Indian equities (NSE/BSE): watchlists ("Market Radar"),
portfolio tracking, price alerts, rule-based signals, RSS news research and bring-your-own AI keys. No broker
connections (ADR-025). End-of-day prices come from Yahoo Finance via `pipelines/eod` (ADR-026).
Supabase (Postgres + Auth + RLS) is the backend of record; a Next.js 16 app in `web/` is both the UI and
the Node backend.

This file is the contract for every coding agent (Claude Code, Cursor, Codex, …) and every human.
If something here conflicts with your instinct, this file wins. If it's wrong, fix it in the same PR.

---

## 1. Read in this order

1. **This file.**
2. [`docs/CODEMAP.md`](docs/CODEMAP.md) — every existing function, action, RPC, table and component.
   **Search it before writing anything new.** Most "new" helpers already exist.
3. [`CHANGELOG.md`](CHANGELOG.md) — what changed recently and why.
4. [`docs/DECISIONS.md`](docs/DECISIONS.md) — why things are the way they are. Don't undo a decision
   without adding a new one that supersedes it.
5. The task-specific recipe in [`PLAYBOOK.md`](PLAYBOOK.md).
6. For product intent: [`docs/BRD.md`](docs/BRD.md). For the data model: `quantspulse_supabase_schema.md` (the spec).
7. For any UI work: [`design-system/quantspulse/MASTER.md`](design-system/quantspulse/MASTER.md).
8. For Next.js APIs: `web/AGENTS.md` → bundled docs in `web/node_modules/next/dist/docs/` (Next 16 differs from
   older training data: `proxy.ts` not `middleware.ts`; `cookies()`, `params`, `searchParams` are async).

## 2. Repo map

```
quantspulse_supabase_schema.md   the original spec (source of truth for data + security model)
AGENTS.md  PLAYBOOK.md  CHANGELOG.md  README.md
docs/          BRD, ARCHITECTURE, CODEMAP, DECISIONS, ROADMAP, SECURITY
design-system/quantspulse/MASTER.md   tokens, type, layout, chart rules ("Zen Linen")
supabase/
  migrations/  ordered SQL — 01–13 = spec §5.1–5.13, 14+ = additions (see DECISIONS); all applied to the live project
  seed/        dev_market_data.sql (SYNTHETIC prices, dev only — never prod) · ref_market_symbols.sql, ref_news_aliases.sql (prod-safe)
  scripts/     apply.mjs — migrate / seed / test against Supabase (reads gitignored supabase/.env)
  tests/       00_verify…, 01_isolation (spec §9), 02_eod_notifier, 03_news_research, 04_hardening, 05_market_analytics; harness/ runs them on PGlite
pipelines/eod/  eod.py — daily NSE candles from Yahoo (yfinance) → Supabase; test_eod.py
web/           Next.js app (UI + server actions + route handlers = the "Node backend")
  src/app/            routes  (app/app/* = signed-in product, admin/ = platform console)
  src/server/         server-only code; privileged/ = the ONLY place the service role is used
  src/lib/            pure helpers, types, Supabase clients
  src/components/     ui/ (primitives), shell/, market/, charts/, news/, research/, marketing/, brand/
  e2e/                Playwright end-to-end suite (system Chrome; disposable users)
scripts/secret-scan.mjs + .githooks/   secret guard (enable: git config core.hooksPath .githooks)
.claude/skills/  ui-ux-pro-max and friends (project-local)    .mcp.json  21st.dev MCP (gitignored: has a key)
```

## 3. Golden rules (non-negotiable)

**Security & tenancy**
1. Every user-data row carries `tenant_id` **and** `user_id`; RLS checks both plus live membership. Never add a
   user-data table without RLS policies and an isolation test in `supabase/tests/`.
2. Normal requests use `supabaseServer()` (the caller's JWT → RLS applies). The **service role** client lives in
   `web/src/server/privileged/service-role.ts` and may only be imported from `src/server/privileged/*`
   (ESLint enforces this). Privileged functions must re-check membership/role/plan themselves (`guards.ts`) and
   filter by both `user_id` and `tenant_id`.
3. Financial data (holdings, watchlists, alerts, AI keys) is private to the user **even from
   their tenant admins and platform admins**. Don't build any view that breaks this.
4. Secrets (AI keys) are encrypted in Node with `seal()` (AES-256-GCM, key from env, AAD bound to
   the row) and stored via `svc_put_*` RPCs into the non-exposed `private` schema. Never return plaintext or
   ciphertext to the client; show `key_last4` / masked ids only. Never log them.
5. Platform admins are granted only by SQL (`insert into private.platform_admins`). No API path may grant it.
6. `audit_log` is append-only; metadata must never contain tokens, keys, holdings, symbols or prompts.
   `activity_events` record an event type only — never a symbol.

**Database**
7. **Never edit an applied migration.** Add a new numbered file. Migrations 01–13 mirror the spec; changes to
   them were made before first deploy and are marked `[QP change]`.
8. Every migration must pass `cd supabase/tests/harness && npm test` (PGlite, no Docker) before commit.
9. New public functions: `security definer set search_path = ''`, explicit `revoke … from public, anon` and a
   narrow `grant`. Service-only RPCs are prefixed `svc_` and granted to `service_role` only.

**App**
10. Reuse before you write: check `docs/CODEMAP.md`. Formatting → `lib/format.ts`; DB errors → `friendlyDbError`;
    quotes/candles/P&L → `server/market-data.ts`; session/plan checks → `server/session.ts` (`requireSession`, `can`).
11. Mutations are Server Actions returning `ActionState`; start with `requireSession()` (enforces sign-in AND the
    single active device); validate with zod; call `revalidatePath`. Forms use `useEchoAction`. Any redirect target
    that came from a user goes through `safeNext()`. When an RLS-guarded write might match 0 rows, `.select()` and check.
12. Plan gating: UI uses `can(session, feature)` + `<PlanGate>`; the DB enforces it anyway (RLS insert policies,
    symbol-limit trigger). Both must agree with `public.plans.features`.
13. Copy must be true. Don't describe features that aren't built (see `docs/ROADMAP.md` for what is stubbed).
    Signals are "research", never "advice" or "recommendations".

**Secrets** (full rules in `docs/SECURITY.md`)
17. Never put a key, password or token in source, docs, tests or commit messages. Env files only; the pre-commit hook
    and CI scan enforce it — never bypass with `--no-verify`. The web app must never receive the DB password.
18. News/feeds: only fetch URLs stored in `news_sources`; identify as `QuantsPulseBot`; never spoof a browser to get
    past a site's bot protection (ADR-014). Store headline/summary/link only.

**Design** (full rules in `design-system/quantspulse/MASTER.md`)
14. Theme is **Zen Linen** (21st.dev). Use tokens (`bg-card`, `text-muted-foreground`, `text-gain`…), never raw hex
    in components. Serif (`.display`) for titles, mono (`.num`) for every number, Inter for UI.
15. Gain/loss is never color-only: sign + ▲/▼ + color (`<Delta>`). Coral is brand-only, never on P&L. Text uses ink
    tokens (`text-gain`, `text-loss`, `text-coral-ink`); charts use mark vars (`--gain`/`--loss`). axe must stay clean.
16. No emoji icons (Phosphor only: `@phosphor-icons/react/ssr` in server components, `@phosphor-icons/react` in client).
    No gradients, glassmorphism, glows, or "✨ AI" copy. Respect reduced motion. Verify 375 / 768 / 1440 widths.

## 4. Commands

```bash
# web app
cd web && npm install            # uses .npmrc → registry.yarnpkg.com (npmjs.org is blocked on this network)
npm run dev                      # http://localhost:3000
npm run typecheck && npx eslint src e2e && npm run build    # must all pass before commit (typecheck runs next typegen)

# database tests (no Docker)
cd supabase/tests/harness && npm install && npm test

# live Supabase (needs supabase/.env)
cd supabase/scripts && npm run status | migrate | seed:ref | test:remote

# EOD prices (manual run; scheduled in .github/workflows/market-eod.yml). Reads web/.env.local.
pip install -r pipelines/eod/requirements.txt
python pipelines/eod/eod.py [--days 760] [--dry-run]
python pipelines/eod/audit.py            # read-only accuracy audit; must be 0 failures
cd pipelines/eod && python -m unittest test_eod

# news pipeline (manual run; scheduled in .github/workflows/news-ingest.yml)
cd web && npm run ingest:news            # add -- --relink after changing matching rules/aliases

# unit + end-to-end
cd web && npm run test:unit
cd web && npm run build && npm run test:e2e   # Playwright on installed Chrome; creates & deletes test users
```

## 5. Definition of done (every change)

- [ ] Searched `docs/CODEMAP.md`; reused existing helpers.
- [ ] `tsc`, `eslint src e2e`, `npm run test:unit`, `next build` pass; DB harness passes if SQL changed; new SQL also
      applied with `supabase/scripts` (`npm run migrate && npm run test:remote`).
- [ ] UI change → `npm run test:e2e` green (axe + overflow included); add/adjust a spec for new behaviour.
- [ ] New table/RPC/policy → isolation test added.
- [ ] UI checked at mobile + desktop widths, light + dark.
- [ ] **`CHANGELOG.md` updated** (Unreleased section) — what, why, files.
- [ ] **`docs/CODEMAP.md` updated** for any new/renamed/removed export, action, route, RPC or table.
- [ ] New architectural choice → entry in `docs/DECISIONS.md`. Stub/limitation → `docs/ROADMAP.md`.
- [ ] No secrets committed (`DB_confi`, `.mcp.json`, `.env*` are gitignored — keep it that way).

## 6. Environment facts

- Supabase project ref `lrjedvwzmeunxvkezffw`. Keys live in `web/.env.local` (gitignored). Template: `web/.env.example`.
- The **Custom Access Token Hook** (`public.custom_access_token_hook`) must be enabled in Supabase → Auth → Hooks,
  or `app_tenant_id` is missing from JWTs and every tenant-scoped write fails RLS. The app shows a banner when it's off,
  and `e2e/writes.spec.ts` skips. **Status: enabled 2026-10-01.**
- Live DB is reached through the **session pooler** `aws-0-ap-northeast-2.pooler.supabase.com:5432`
  (user `postgres.<ref>`); the direct `db.<ref>.supabase.co` host is IPv6-only from this network.
- **Production:** https://quantplus-ten.vercel.app — Vercel project `quantplus`, root dir `web`, functions in `icn1`.
  Deploy from the repo root (PLAYBOOK §Q). Env vars are managed in Vercel, not in git.
- Market prices are **real end-of-day NSE candles from Yahoo Finance** (`pipelines/eod`, ADR-026), loaded ~17:00 IST
  on weekdays; `NEXT_PUBLIC_MARKET_DATA_MODE=live`. No intraday data. Yahoo's terms are personal/non-commercial —
  swap the vendor in `fetch()` before charging for data. Never run `dev_market_data.sql` against production.
- Windows dev machine; bash (Git Bash) and PowerShell both available. Commit attribution per repo owner's rules.
- Remote: `https://github.com/runFast123/quantplus_choice_kp.git`, branch `main`.
