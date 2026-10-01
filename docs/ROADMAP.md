# Roadmap, stubs and known gaps

Check here before claiming a feature works, and before building something — it may be planned differently.
Requirement IDs refer to `docs/BRD.md`.

## Blocking for first real users
- [x] Apply migrations to Supabase project `lrjedvwzmeunxvkezffw` (done 2026-10-01; 21 migrations, tests pass live).
- [x] Custom Access Token Hook enabled (2026-10-01) — all 81 e2e tests pass incl. write flows.
- [x] GitHub repo secrets for `news-ingest.yml`, Secret scanning + Push protection (owner, 2026-10-01).
- [ ] Rotate the service-role key and 21st key (shared in chat during setup) — docs/SECURITY.md §3.
      As of 2026-10-01 the original service-role key still authenticates, so it has not been rotated yet.
- [ ] Production market-data pipelines (FR-3.4, FR-5.3). Until then only the synthetic dev seed exists.
- [ ] Legal review of Terms/Privacy drafts (SEBI positioning deprioritised by owner; copy stays non-advice).
- [ ] Transactional email (invites, auth emails from a custom domain).

## Next
- [ ] Payment gateway (Razorpay/Cashfree) checkout + webhook → `admin_activate_plan`-style RPC (FR-9.4).
- [ ] Broker OAuth per broker + holdings sync worker writing `source = 'broker'` holdings (FR-6.3, FR-8.1).
- [ ] Live tick worker for intraday alerts and prices (FR-3.5, FR-7.6); keep `run_eod_notifier` as the EOD pass.
- [x] News (RSS) ingestion, symbol matching, tone, research notes, BYOK AI research read (0.2.0).
- [ ] NSE / BSE corporate filings via a licensed feed (public archive blocks automated readers — ADR-014).
- [ ] More news sources that allow automated reading; alias curation for new listings.
- [ ] BYOK AI: chat per symbol, contract-note parsing (`contract_note_imports` + `contract-notes` bucket), metering in `ai_usage_logs` (FR-8.4, FR-6.4).
- [ ] Email/push notification channels (FR-7.7).
- [ ] NSE holiday calendar for `nseSession()` and cron schedules.
- [ ] Generated Supabase types (`supabase gen types`) to replace hand-written `lib/types.ts`.
- [x] CI: secret scan, `tsc`, ESLint, unit tests, `next build` (+ bundle secret check), DB harness (`.github/workflows/ci.yml`).
- [ ] Run the Playwright e2e suite in CI against a staging Supabase project (needs staging secrets).

## Known limitations (by design for now)
- Broker connect stores a pasted token; "last synced" stays empty until the sync worker exists.
- Invite links are shown to the inviter to copy; nothing is emailed.
- Account deletion marks broker connections revoked but cannot revoke tokens at the broker.
- Market screener loads up to 300 rows; needs pagination when coverage grows past that.
- Symbol search loads the full symbol list into the client (fine for hundreds, not for 5,000+ — move to a search RPC).
