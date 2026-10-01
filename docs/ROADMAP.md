# Roadmap, stubs and known gaps

Check here before claiming a feature works, and before building something — it may be planned differently.
Requirement IDs refer to `docs/BRD.md`.

## Blocking for first real users
- [x] Apply migrations to Supabase project `lrjedvwzmeunxvkezffw` (done 2026-10-01; 21 migrations, tests pass live).
- [x] Custom Access Token Hook enabled (2026-10-01) — all 81 e2e tests pass incl. write flows.
- [x] Secret scanning + Push protection (owner, 2026-10-01).
- [x] GitHub Actions secrets set (owner, 2026-10-01); `market-eod.yml` + `news-ingest.yml` verified on GitHub.
- [ ] Rotate the service-role key and 21st key (shared in chat during setup) — docs/SECURITY.md §3.
      As of 2026-10-01 the original service-role key still authenticates, so it has not been rotated yet.
- [x] Real EOD market data: `pipelines/eod` (Yahoo/yfinance) + `market-eod.yml`, ~2 years backfilled (2026-10-01).
- [ ] Licensed market-data feed before charging for data (Yahoo is personal/non-commercial — ADR-026). Options: NSE
      data licence, TrueData / Global Datafeeds, or GreekSoft via a broker/licence (no free tier).
- [ ] Legal review of Terms/Privacy drafts (SEBI positioning deprioritised by owner; copy stays non-advice).
- [ ] Transactional email (invites, auth emails from a custom domain).

## Deployment
- [x] Vercel production at https://quantplus-ten.vercel.app (icn1), env vars set, daily cron, e2e green on production.
- [ ] Supabase Auth → URL Configuration: Site URL `https://quantplus-ten.vercel.app`, redirect `https://quantplus-ten.vercel.app/**`
      (owner action; until then auth emails link to localhost).
- [ ] Custom domain (then update `NEXT_PUBLIC_SITE_URL`, Supabase URL config, and redeploy).

## Next
- [ ] Payment gateway (Razorpay/Cashfree) checkout + webhook → `admin_activate_plan`-style RPC (FR-9.4).
- [ ] Live tick worker for intraday alerts and prices (FR-3.5, FR-7.6); keep `run_eod_notifier` as the EOD pass.
- [x] News (RSS) ingestion, symbol matching, tone, research notes, BYOK AI research read (0.2.0).
- [ ] NSE / BSE corporate filings via a licensed feed (public archive blocks automated readers — ADR-014).
- [ ] More news sources that allow automated reading; alias curation for new listings.
- [ ] BYOK AI: chat per symbol, contract-note parsing (`contract_note_imports` + `contract-notes` bucket), metering in `ai_usage_logs` (FR-8.4, FR-6.4).
- [ ] Email/push notification channels (FR-7.7).
- [ ] NSE holiday calendar for `nseSession()` and cron schedules (the EOD job runs on holidays harmlessly — no new bar).
- [ ] Corporate-action handling beyond `HISTORY_FROM` cut-offs (dividend-adjusted series for backtests).
- [ ] Generated Supabase types (`supabase gen types`) to replace hand-written `lib/types.ts`.
- [x] CI: secret scan, `tsc`, ESLint, unit tests, `next build` (+ bundle secret check), DB harness (`.github/workflows/ci.yml`).
- [ ] Run the Playwright e2e suite in CI against a staging Supabase project (needs staging secrets).

## Known limitations (by design for now)
- Invite links are shown to the inviter to copy; nothing is emailed.
- Prices are end-of-day only; Yahoo can be late or revise a bar (the 20:00 IST re-run picks that up). Signals already
  issued are not rewritten.
- Market screener loads up to 300 rows; needs pagination when coverage grows past that.
- Symbol search loads the full symbol list into the client (fine for hundreds, not for 5,000+ — move to a search RPC).
