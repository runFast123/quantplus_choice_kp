# Security & secrets

How QuantsPulse keeps database credentials, keys and user data from leaking — and what to do if something does.

## 1. Where every secret lives

| Secret | Lives in | Who/what may use it | Never |
|---|---|---|---|
| Supabase URL + publishable key | `web/.env.local` (`NEXT_PUBLIC_*`) | Browser + server. Public by design; RLS protects data. | Hard-coded in source |
| Service-role key | `web/.env.local` → `SUPABASE_SERVICE_ROLE_KEY` | `web/src/server/privileged/*` only (ESLint-enforced) and the news CLI | Client code, logs, `NEXT_PUBLIC_*` |
| Database password / URL | `supabase/.env` → `SUPABASE_DB_URL` | `supabase/scripts/apply.mjs` (migrations, tests) | The web app (it doesn't need it), CI logs |
| Secrets encryption key(s) | `web/.env.local` → `QP_SECRETS_KEY_V<n>`, `QP_SECRETS_KEY_CURRENT` | `server/privileged/crypto.ts` | The database (that's the point) |
| Cron secret | `web/.env.local` → `CRON_SECRET` | `/api/cron/*` callers (Vercel Cron, GitHub Actions) | Query strings |
| 21st.dev key | `.mcp.json` | Claude Code MCP | — |
| `DB_confi` | project root, owner's notes | nobody at runtime | — consider deleting it now that values are in the env files |

All of the above are **gitignored** (`.gitignore`: `DB_confi`, `.mcp.json`, `.env`, `.env.*` except `.env.example`, `.claude/settings.local.json`).
Templates without values: `web/.env.example`, `supabase/.env.example`.

## 2. Guards that stop leaks

1. **Pre-commit hook** — `.githooks/pre-commit` → `scripts/secret-scan.mjs --staged`. Blocks:
   - forbidden files (`DB_confi`, `.env*`, `.mcp.json`, `settings.local.json`);
   - known formats (Supabase JWT / `sb_secret_` / `sb_publishable_`, Postgres URLs with a password, 21st, Anthropic, OpenAI, Google keys, encryption/cron secret assignments);
   - **the exact values** currently in your local env files and `DB_confi` (catches renamed copies and pasted values).
   Enable once per clone: `git config core.hooksPath .githooks`. Bypassing with `--no-verify` is not allowed.
2. **History scan in CI** — `node scripts/secret-scan.mjs --history` on every push (format checks; local values aren't available in CI).
3. **Bundle check after every build** — `web/scripts/check-bundle-secrets.mjs` (npm `postbuild`) fails the build if any non-`NEXT_PUBLIC_` value appears in `.next/static`.
4. **Service-role confinement** — ESLint `no-restricted-imports` bans `server/privileged/service-role` outside `src/server/privileged/`.
5. **Database** — RLS on every public table, `private` schema not exposed, service-only RPCs (`svc_*`), append-only audit log. Verified by `supabase/tests/*` (local PGlite and the live project) and `web/e2e/security.spec.ts` (from the outside).
6. **Secrets at rest** — broker tokens and AI keys are AES-256-GCM encrypted in Node with an external key and row-bound AAD; the DB holds ciphertext only.
7. **App-level** — redirects only via `safeNext()`; single active device enforced in `requireSession()` for pages and
   actions; clients hold no TRUNCATE/REFERENCES/TRIGGER; symbol columns not updatable (plan limits can't be bypassed).
8. **Recommended (GitHub UI)** — Settings → Code security → enable *Secret scanning* and *Push protection*.

Last full-history scan: clean (no secrets ever committed).

## 3. Rotation

| What | How |
|---|---|
| DB password | Supabase → Project Settings → Database → Reset password → update `supabase/.env` (URL-encode special characters). The web app is unaffected. |
| Service-role / publishable keys | Prefer Supabase's new API keys: create an `sb_secret_…` key, swap `SUPABASE_SERVICE_ROLE_KEY`, deploy, then revoke the legacy JWT keys. |
| Encryption key | PLAYBOOK §J (add `V2`, switch `CURRENT`, re-encrypt, remove `V1`). |
| Cron secret | Generate a new one, update the app env and the scheduler, redeploy. |
| 21st key | Regenerate at 21st.dev, update `.mcp.json`. |

**Note:** the service-role key and the 21st key were shared in chat during setup; rotating them before production is cheap insurance.

## 4. Durability ("is my data saved?")

- **Schema** is code: `supabase/migrations/*` (also recorded in `supabase_migrations.schema_migrations`), so the database structure can always be rebuilt.
- **Data**: Supabase takes daily backups on paid plans; enable **Point-in-Time Recovery** (Pro plan add-on) before real users arrive. The free plan does not give you downloadable backups.
- **Deletions are deliberate**: deleting a user removes their personal workspace (migration 21) and nothing else; payments are retained without identity (spec §7).

## 5. If something leaks

1. Rotate the affected secret immediately (table above).
2. If it reached git: rotation is the fix — rewriting history doesn't un-leak a pushed secret.
3. Check `public.audit_log` and Supabase logs for use of the leaked credential.
4. Record what happened in `CHANGELOG.md` (no secret values).
