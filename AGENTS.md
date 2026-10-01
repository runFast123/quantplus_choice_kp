# AGENTS.md — read this before changing anything

QuantsPulse is a multi-tenant research app for Indian equities (NSE/BSE): watchlists ("Market Radar"),
portfolio tracking, price alerts, rule-based signals, broker connections and bring-your-own AI keys.
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
docs/          BRD, ARCHITECTURE, CODEMAP, DECISIONS, ROADMAP
design-system/quantspulse/MASTER.md   tokens, type, layout, chart rules ("Zen Linen")
supabase/
  migrations/  ordered SQL — 01–13 = spec §5.1–5.13, 14+ = additions (see DECISIONS)
  seed/        dev_market_data.sql — SYNTHETIC prices, dev/staging only
  tests/       00_verify…, 01_isolation (spec §9), 02_eod_notifier; harness/ runs them on PGlite
web/           Next.js app (UI + server actions + route handlers = the "Node backend")
  src/app/            routes  (app/app/* = signed-in product, admin/ = platform console)
  src/server/         server-only code; privileged/ = the ONLY place the service role is used
  src/lib/            pure helpers, types, Supabase clients
  src/components/     ui/ (primitives), shell/, market/, charts/, marketing/, brand/
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
3. Financial data (holdings, watchlists, alerts, broker connections, AI keys) is private to the user **even from
   their tenant admins and platform admins**. Don't build any view that breaks this.
4. Secrets (broker tokens, AI keys) are encrypted in Node with `seal()` (AES-256-GCM, key from env, AAD bound to
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
11. Mutations are Server Actions returning `ActionState`; validate with zod; call `revalidatePath`.
12. Plan gating: UI uses `can(session, feature)` + `<PlanGate>`; the DB enforces it anyway (RLS insert policies,
    symbol-limit trigger). Both must agree with `public.plans.features`.
13. Copy must be true. Don't describe features that aren't built (see `docs/ROADMAP.md` for what is stubbed).
    Signals are "research", never "advice" or "recommendations".

**Design** (full rules in `design-system/quantspulse/MASTER.md`)
14. Theme is **Zen Linen** (21st.dev). Use tokens (`bg-card`, `text-muted-foreground`, `text-gain`…), never raw hex
    in components. Serif (`.display`) for titles, mono (`.num`) for every number, Inter for UI.
15. Gain/loss is never color-only: sign + ▲/▼ + color (`<Delta>`). Coral is brand-only, never on P&L.
16. No emoji icons (Phosphor only: `@phosphor-icons/react/ssr` in server components, `@phosphor-icons/react` in client).
    No gradients, glassmorphism, glows, or "✨ AI" copy. Respect reduced motion. Verify 375 / 768 / 1440 widths.

## 4. Commands

```bash
# web app
cd web && npm install            # uses .npmrc → registry.yarnpkg.com (npmjs.org is blocked on this network)
npm run dev                      # http://localhost:3000
npx tsc --noEmit && npx eslint src && npx next build    # must all pass before commit

# database tests (no Docker)
cd supabase/tests/harness && npm install && npm test
```

## 5. Definition of done (every change)

- [ ] Searched `docs/CODEMAP.md`; reused existing helpers.
- [ ] `tsc`, `eslint`, `next build` pass; DB harness passes if SQL changed.
- [ ] New table/RPC/policy → isolation test added.
- [ ] UI checked at mobile + desktop widths, light + dark.
- [ ] **`CHANGELOG.md` updated** (Unreleased section) — what, why, files.
- [ ] **`docs/CODEMAP.md` updated** for any new/renamed/removed export, action, route, RPC or table.
- [ ] New architectural choice → entry in `docs/DECISIONS.md`. Stub/limitation → `docs/ROADMAP.md`.
- [ ] No secrets committed (`DB_confi`, `.mcp.json`, `.env*` are gitignored — keep it that way).

## 6. Environment facts

- Supabase project ref `lrjedvwzmeunxvkezffw`. Keys live in `web/.env.local` (gitignored). Template: `web/.env.example`.
- The **Custom Access Token Hook** (`public.custom_access_token_hook`) must be enabled in Supabase → Auth → Hooks,
  or `app_tenant_id` is missing from JWTs and every tenant-scoped write fails RLS. The app shows a banner when it's off.
- Windows dev machine; bash (Git Bash) and PowerShell both available. Commit attribution per repo owner's rules.
- Remote: `https://github.com/runFast123/quantplus_choice_kp.git`, branch `main`.
