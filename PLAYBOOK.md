# PLAYBOOK — how to do common tasks the QuantsPulse way

Each recipe lists the files to touch and the checks to run. Finish every recipe with the
**Definition of done** in `AGENTS.md` §5 (CHANGELOG + CODEMAP updates included).

---

## A. Add a product page (signed-in)

1. Create `web/src/app/app/<name>/page.tsx` (server component). Start with:
   ```tsx
   const s = await requireSession();
   if (!can(s, "<feature>")) return <PlanGate feature="…" />;   // if gated
   const { data } = await s.supabase.from("…").select("…");     // RLS-scoped
   ```
2. Layout: `<PageHeader eyebrow title description actions/>` then `<Panel>`s. Tables: wrap in `<TableWrap>`, use
   `th/thNum/td/tdNum/tr` class strings; numbers in `.num`, P&L via `<Delta>`.
3. Add it to `components/shell/sidebar.tsx` (and `MobileNav` only if it's top-5).
4. Empty state with `<Empty title>` that tells the user what to do next. Loading is covered by `app/app/loading.tsx`.
5. Check 375 / 1440 widths, light + dark.

## B. Add a mutation (server action)

1. Put it in the route's `actions.ts` with `"use server"`. Signature for forms: `(prev: ActionState, form: FormData) => Promise<ActionState>`.
2. `const s = await requireSession();` → validate with zod → call `s.supabase` (RLS) → on error return
   `{ error: friendlyDbError(error.message) }` → `revalidatePath(...)` → `{ ok: true, message }`.
3. Client form: `const [state, action, , values] = useEchoAction(serverAction)` + `<FormMessage state>` +
   `<SubmitButton>`; give inputs `defaultValue={values.<name>}` so they survive an error.
   To close/reset UI on success, do it inside the action wrapper or reset a form ref — not `setState` in an effect.
4. Record feature usage if it's a meaningful action: `await s.supabase.rpc("track_event", { p_event_type: "snake_case" })`.

## C. Add a table with user data

1. New migration `supabase/migrations/20261001NNNNNN_<name>.sql` (next number; never edit old ones).
2. Columns: `tenant_id uuid not null default private.active_tenant_id() references tenants`, `user_id uuid not null default auth.uid() references auth.users`,
   child tables use a **composite FK** `(parent_id, user_id, tenant_id)` and include `user_id, tenant_id` in unique keys
   (see DECISIONS ADR-004 for why).
3. RLS: enable, then select/insert/update/delete policies with the standard `own` predicate from spec §5.9
   (`user_id = (select auth.uid()) and tenant_id = (select private.active_tenant_id()) and (select private.is_tenant_member(private.active_tenant_id()))`).
   Gate inserts with `(select private.plan_has_feature('<feature>'))` if plan-limited. Revoke what clients mustn't do.
4. Index `(user_id, tenant_id)`.
5. Add the table to `export_my_data()` (new migration with `create or replace`).
6. Tests in `supabase/tests/01_isolation.sql` (or a new numbered file): other user reads 0 rows; forged tenant reads 0;
   insert with someone else's ids fails.
7. `cd supabase/tests/harness && npm test`. Add row type to `lib/types.ts`.

## D. Add a plan-gated feature

1. Add the key to `plans.features` (new migration `update public.plans set features = features || '{"x":true}' where code in (...)`).
2. Add `Feature` union member in `lib/types.ts` and a row in `lib/plans.ts` `FEATURE_ROWS`.
3. UI: `can(s, "x")` / `<PlanGate>`. DB: RLS insert policy `plan_has_feature('x')`. Privileged: `planHasFeature()`.

## E. Add a privileged (service-role) operation

Only when RLS genuinely can't express it (cross-tenant work, private schema, auth admin API).
1. Add a function in `web/src/server/privileged/<area>.ts`, `import "server-only"`.
2. First lines: `assertMember(userId, tenantId, roles?)`, `planHasFeature`, `hasActiveConsent` as relevant.
3. Every query filters by `user_id` **and** `tenant_id`. Write `audit({...})` for security-relevant changes.
4. Call it from a server action that got `userId` from `requireSession()` — never from client input.
5. Private-schema access goes through an `svc_*` RPC (migration, `grant execute … to service_role` only, test that
   `authenticated` gets "permission denied").

## F. Add a notification type

1. Producer: SQL (preferred, inside `private.run_eod_notifier()` or a new cron function) or a privileged module.
   Insert into `public.notifications (tenant_id, user_id, type, title, body, data)`; dedupe on `data` keys.
2. `type` values in use: `price_alert`, `exit_signal`, `plan_expiry`, `research_stance`.
3. The bell (`components/shell/notifications.tsx`) receives inserts via Realtime automatically.
4. Test in `supabase/tests/02_eod_notifier.sql` style, including idempotency.

## G. Charts

Load the `dataviz` skill first. Use `PriceChart` for OHLC; `Sparkline` for inline trends; horizontal bar lists
(single hue `bg-primary`) for allocations — no pies, no dual axes. Read colors from CSS vars at runtime so dark mode works.
Every chart needs a hover readout/tooltip and a table or text equivalent.

## H. Apply migrations to Supabase (project `lrjedvwzmeunxvkezffw`)

**Preferred — repo runner:** `cd supabase/scripts && npm install && npm run migrate` (then `npm run seed:ref`, and
`npm run seed:dev` only on dev/staging). Needs `supabase/.env` (copy `.env.example`; session-pooler URL, password
URL-encoded). Records versions in `supabase_migrations.schema_migrations`, so the Supabase CLI agrees.
Alternatives: `npx supabase db push`, or paste files in order into the SQL editor.
Then:
1. Dashboard → Authentication → Hooks → **Custom Access Token** → `public.custom_access_token_hook`. Enable.
2. Dashboard → Database → Extensions: confirm `pg_cron` is enabled.
3. Dashboard → API → Exposed schemas: must **not** include `private`.
4. Prices: production → `npm run seed:ref` then `python pipelines/eod/eod.py --days 760` (PLAYBOOK §R).
   Dev/staging only: `supabase/seed/dev_market_data.sql` for synthetic prices.
5. `npm run test:remote` (or paste `supabase/tests/0*.sql` into the SQL editor — they roll back) — all PASS.
6. Auth → URL configuration: Site URL + redirect `…/auth/confirm`.

## I. Grant / revoke a platform admin
```sql
insert into private.platform_admins (user_id, note) values ('<auth.users.id>', 'who/why');
delete from private.platform_admins where user_id = '<id>';
```

## J. Rotate the secrets key
1. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
2. Add `QP_SECRETS_KEY_V2=…`, set `QP_SECRETS_KEY_CURRENT=2`, deploy. Old rows still decrypt with V1.
3. Re-encrypt: for each secret, `open()` with its `key_version`, `seal()` with V2, `svc_put_*`. Then remove V1.

## K. Activate a plan manually (until a payment gateway exists)
`/admin` → search the user → **Activate…** → plan, months, amount, method, UTR. Calls `admin_activate_plan`
(one transaction: subscription + payment + audit).

## L. UI work with the skills
- `python .claude/skills/ui-ux-pro-max/scripts/search.py "<query>" --domain ux` for a focused rule.
- 21st MCP `search` / `get_theme` are free; `get_component` uses the owner's credits — ask first.
- Never introduce a new color or font outside `MASTER.md`.

## N. News pipeline

- **Run now:** `cd web && npm run ingest:news` (or `/admin` → *Fetch news now*). Report shows per-source status.
- **Schedule:** `.github/workflows/news-ingest.yml` (needs repo secrets) or any scheduler calling
  `GET /api/cron/news` with `Authorization: Bearer $CRON_SECRET`.
- **Add a source:** new migration inserting into `news_sources` (`kind` news | filing | search). Check first that the
  site serves RSS to `QuantsPulseBot` (curl with that UA); if it blocks bots, don't add it (ADR-014).
- **Improve matching:** add rows to `seed/ref_news_aliases.sql` (avoid bare words that name other companies; extend
  `SIBLING_WORDS` in `lib/news/match.ts` for new sibling entities), add a unit test, then
  `npm run seed:ref` and `npm run ingest:news -- --relink`.
- **Tone words:** edit `lib/news/tone.ts` (`POSITIVE` / `NEGATIVE`), add a unit test; users see matched terms.
- **Research weights:** change `private.refresh_research_notes()` in a new migration, update the copy on
  `/app/research` and `docs/DECISIONS.md` ADR-015, run `03_news_research.sql`.

## R. Market data (EOD prices)

- **Source:** Yahoo Finance via yfinance (`pipelines/eod/eod.py`, ADR-026). Ticker = `SYMBOL.NS` unless listed in
  `YAHOO_OVERRIDES`. Candles stamped 10:00 UTC (15:30 IST); split-adjusted close.
- **Run now:** `python pipelines/eod/eod.py` (last 10 days; reads `web/.env.local`). Backfill: `--days 1250` (the 500 largest
  keep ~3.4 years, ADR-041; others 400 days).
- **After a longer history** (a back-fill, or `history_days` raised): rebuild the five rules on everything stored, so their
  warm-up comes before the chart and their one-trade-per-stock plans line up: `cd supabase/scripts && node rebuild-rules.mjs
  --dry-run` (one batch, rolled back), then `npm run rebuild:rules` (leaders, weather, analytics + rules per 20 stocks,
  signal checks, a year of rule health). Signals written again keep their ids, so no notification is sent twice.
  Check without writing: `--dry-run`. One symbol: `--symbols TCS`.
- **Schedule:** `.github/workflows/market-eod.yml` (17:00 + 20:00 IST weekdays; manual run takes `days`). Repo secrets:
  `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. pg_cron re-runs analytics/notifier/research at 17:55–18:05 IST.
- **Universe:** `python pipelines/eod/eod.py --sync-universe` refreshes ~3,600 symbols from Yahoo's screener (daily in
  the workflow); new symbols are backfilled on that run. Add an index/ETF in `universe.py` (`INDICES`, `ETFS`).
- **Retire a symbol on purpose** (demerger, merger): set `is_active = false`, `status_note` and `successors` on its
  `market_symbols` row (see TATAMOTORS in `ref_market_symbols.sql`); the sync leaves rows with a note alone.
- **Corporate actions Yahoo doesn't adjust** (demergers): add `HISTORY_FROM[symbol] = first clean date`; the next run
  prunes older candles/RSI/signals. Delete that symbol's signals + RSI and run `select private.refresh_market_analytics(100000)`
  once to rebuild from clean history. Spot-check with a >18% one-day move query.
- **Change an indicator or signal rule:** new migration replacing `private.refresh_market_analytics`, extend
  `supabase/tests/05_market_analytics.sql`, update the Signals page copy. Signals are append-only: never delete rows
  the notifier may have referenced, except in a deliberate rebuild.
- **Replace the vendor:** only `fetch()` in `eod.py` returns vendor frames; keep `to_candles()` validation.
- **Check accuracy:** `python pipelines/eod/audit.py` — must report 0 failures (also runs after every scheduled load).
  REVIEW lines are Yahoo's own lags and gaps (see the module docstring); read them, but they don't fail the run. A REVIEW
  that repeats for days (a stock still one session behind, an index with no Yahoo history) needs a look at the vendor ticker.
  Run it after a load: between 15:45 IST and the evening load every symbol lacks today's session and the run fails.
  Splits/bonuses are handled automatically (full re-fetch of that stock); a demerger needs `HISTORY_FROM`.

## S. Signal checks and rule health (quarterly review, ADR-038, ADR-039)

- **Daily:** nothing to do. `svc_refresh_signal_checks` runs after the analytics (EOD pipeline, Vercel route, admin
  button, cron backstop) and writes a frozen check for every new Strong trend buy and RSI dip setup.
- **Each quarter start:** the workflow *Signal checks refit* stores the quarter's RSI dip model (07:00 IST on 1 Jan / Apr /
  Jul / Oct). Admin → *Signal checks review* shows a red badge when this quarter's model is missing: run the workflow
  (manual run, optional `quarter`) or `cd pipelines/eod && python checks_refit.py [--dry-run]`. A model that cannot rank
  its own past is stored with `shown = false` and tags nothing that quarter — that is the check working, not a bug.
- **Review (research, quarterly):** the live record by label (`signal_check_record`, the Signals page panel); the
  27-setting shadow grid and the KK dip / SMA trend self-tests (`research/strategies/team/params/`, `metalabel/`). A rule
  change, or turning a tag into a filter, needs a new pre-registered test, an ADR and a migration.
- **Rule health (ADR-039, daily, automatic):** `private.refresh_rule_health()` runs inside `svc_refresh_signal_checks`
  and writes one `rule_health` row per rule. Admin → *Signal checks review* → *Rule health*. A rule *below its range* on
  two checks in a row goes on the quarterly agenda: read its `rule_mistakes` (what the losses had in common), then test
  any fix pre-registered on data it hasn't seen. Never switch a rule off or change it just because it is below range.
  Back-fill or repair a day: `select private.refresh_rule_health('2026-10-30');` (SQL editor / service role).
  Expectations live in `rule_expectations`; change them only when the rule's record script is re-run.
- **Rebuild the reference seed** after re-running the team's scripts: `cd research/strategies/team && python
  export_seed.py`, then `cd supabase/scripts && npm run seed:ref` (idempotent). Cross-check on a live copy first:
  `python ../dump_live.py ../../..`, `node check_live.mjs ../../..`, `python check_live.py`.

## O. End-to-end tests (Playwright)

```bash
cd web && npm run build && npm run test:e2e        # desktop + mobile projects
npx playwright test e2e/research.spec.ts --project=desktop   # one file
npx playwright show-report                           # HTML report
```
- Uses the installed Google Chrome (`channel: "chrome"`); no browser download.
- `global-setup.ts` creates disposable Basic/Pro users via the admin API; `global-teardown.ts` deletes them (and their
  personal workspaces, and any `e2e-*` organisations). Use `oneOffUser()` for tests that need a fresh account.
- Selectors: roles and labels first (`getByRole`, `getByLabel`); `data-testid` only where no accessible name exists.
- Write flows live in `writes.spec.ts` and skip with a reason until the access-token hook is enabled.
- New page? Add it to `PAGES` in `navigation.spec.ts` (renders, no console errors, no sideways scroll) and to
  `a11y.spec.ts`.

## P. Secrets hygiene

- One-time per clone: `git config core.hooksPath .githooks`.
- Scan everything ever committed: `node scripts/secret-scan.mjs --history`.
- New secret? Add it to `web/.env.local` (server-only names never start with `NEXT_PUBLIC_`), add a placeholder to
  `.env.example`, document it in `docs/SECURITY.md` §1. If it has a recognisable format, add a pattern to the scanner.

## Q. Deploy (Vercel)

Project `quantplus` (team `amandubey7977-1409s-projects`), Root Directory `web`, functions in `icn1`.
```bash
vercel login                      # once per machine (device-code flow in the browser)
vercel link --yes --project quantplus   # from the REPO ROOT (root directory is web/)
vercel deploy --prod --yes        # from the repo root
E2E_BASE_URL=https://quantplus-ten.vercel.app npx playwright test   # verify the live site (run in web/)
```
- Env vars live in Vercel (production + preview). Add with `printf '%s' "$VALUE" | vercel env add NAME production
  [--sensitive]` — never paste values into commands that get logged. `NEXT_PUBLIC_*` changes need a redeploy.
- `.vercelignore` patterns for root folders must start with `/` (unanchored names match nested folders too).
- Region: keep functions next to the database (`icn1`). The project setting wins over `vercel.json` under Fluid compute:
  `MSYS_NO_PATHCONV=1 vercel api /v9/projects/quantplus -X PATCH --input -` with
  `{"resourceConfig":{"functionDefaultRegions":["icn1"]}}`. Check with the `X-Vercel-Id` header (`…::icn1::…`).
- Git Bash: prefix `vercel api` calls with `MSYS_NO_PATHCONV=1`, or `/v9/...` is rewritten into a Windows path.
- Supabase Auth → URL Configuration must list the production URL (Site URL + `https://quantplus-ten.vercel.app/**`),
  or confirmation/reset emails link to localhost. Check without sending mail: create a throwaway user and call
  `/auth/v1/admin/generate_link` with `redirect_to` = the production URL — the returned link's `redirect_to` shows
  what Supabase will really use.
- **Email links that work on any device** (Supabase → Authentication → Email Templates → *Confirm signup* and
  *Reset password*): replace the link with
  `<a href="{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=email">Confirm your email</a>` (reset: `type=recovery`).
  The default `{{ .ConfirmationURL }}` uses PKCE, which only works in the browser that signed up.
  `/auth/confirm` already handles `token_hash`.

## M. Before you push
```bash
cd web && npm run typecheck && npx eslint src e2e && npm run test:unit && npm run build   # build runs the bundle secret check
npm run test:e2e
cd ../supabase/tests/harness && npm test
git status   # DB_confi, .mcp.json, .env.local, supabase/.env must NOT appear (the pre-commit hook blocks them anyway)
```
Then update `CHANGELOG.md` and `docs/CODEMAP.md`.
