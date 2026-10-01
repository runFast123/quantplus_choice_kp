# Roadmap, stubs and known gaps

Check here before claiming a feature works, and before building something — it may be planned differently.
Requirement IDs refer to `docs/BRD.md`.

## Blocking for first real users
- [ ] Apply migrations 01–16 to Supabase project `lrjedvwzmeunxvkezffw` (needs DB password) and enable the
      Custom Access Token Hook — PLAYBOOK §H.
- [ ] Production market-data pipelines (FR-3.4, FR-5.3). Until then only the synthetic dev seed exists.
- [ ] Legal review of Terms/Privacy drafts and SEBI positioning (BRD §7).
- [ ] Transactional email (invites, auth emails from a custom domain).

## Next
- [ ] Payment gateway (Razorpay/Cashfree) checkout + webhook → `admin_activate_plan`-style RPC (FR-9.4).
- [ ] Broker OAuth per broker + holdings sync worker writing `source = 'broker'` holdings (FR-6.3, FR-8.1).
- [ ] Live tick worker for intraday alerts and prices (FR-3.5, FR-7.6); keep `run_eod_notifier` as the EOD pass.
- [ ] BYOK AI features: research chat per symbol, contract-note parsing (`contract_note_imports` + `contract-notes` bucket), metering in `ai_usage_logs` (FR-8.4, FR-6.4).
- [ ] Email/push notification channels (FR-7.7).
- [ ] NSE holiday calendar for `nseSession()` and cron schedules.
- [ ] Generated Supabase types (`supabase gen types`) to replace hand-written `lib/types.ts`.
- [ ] CI: run `tsc`, ESLint, `next build`, DB harness on every PR.

## Known limitations (by design for now)
- Broker connect stores a pasted token; "last synced" stays empty until the sync worker exists.
- Invite links are shown to the inviter to copy; nothing is emailed.
- Account deletion marks broker connections revoked but cannot revoke tokens at the broker.
- Market screener loads up to 300 rows; needs pagination when coverage grows past that.
- Symbol search loads the full symbol list into the client (fine for hundreds, not for 5,000+ — move to a search RPC).
