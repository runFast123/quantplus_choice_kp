# QuantsPulse — Business Requirements Document

**Version:** 0.1 (draft) · **Date:** 1 October 2026 · **Owner:** Product · **Status:** For review
**Related:** `quantspulse_supabase_schema.md` (data & security spec), `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`

---

## 1. Purpose

QuantsPulse helps self-directed Indian equity investors — and the firms that serve them — research NSE/BSE
stocks with transparent, rule-based signals, track what they own, and get told when something they care about
changes. This document states what the business needs the product to do; the schema spec states how data is
modelled and protected.

## 2. Problem

- Retail investors juggle broker apps, spreadsheets and chat tips. Watchlists are passive; nobody tells them when a
  stock they're waiting on actually does something.
- "Signals" in the market are usually opaque, hype-driven, or sold as advice.
- Advisory firms and broker partners want to give clients a research tool, but clients (rightly) don't want their
  employer or advisor seeing their holdings by default.

## 3. Goals and success measures

| Goal | Measure (first 6 months after launch) |
|---|---|
| Users build a habit around their radar | ≥ 40% of activated users open the app on ≥ 3 trading days a week |
| Free → paid conversion | ≥ 6% of Basic trials convert to Pro/Pro Plus by trial end |
| Signals are trusted | ≥ 70% of surveyed users say they understand why a signal fired |
| Privacy is a selling point for orgs | ≥ 5 organisation tenants with ≥ 5 members each |
| Zero cross-tenant data incidents | 0 — enforced by RLS and the §9 isolation suite in CI |

## 4. Users and personas

| Persona | Needs |
|---|---|
| **Self-directed investor** (primary) | A short watchlist, clear signals, portfolio P&L, alerts, mobile-friendly |
| **Active trader** | More symbols, broker sync, fast access to levels and history |
| **Advisory firm / desk owner** | Seats for staff or clients, plan management, usage visibility — without seeing holdings |
| **Org admin** | Invite/remove members, see plan status and feature usage |
| **Platform admin (QuantsPulse ops)** | Activate plans after manual payment, search accounts, audit — no access to financial data |

## 5. Scope

### In scope (v1)
Accounts & onboarding with consent capture · personal and organisation workspaces · Market Radar watchlists ·
market screener and symbol research (EOD) · rule-based signals · portfolio tracking · price alerts and in-app
notifications · broker connection (credential storage) · BYOK AI key storage · plans, limits and manual billing ·
data export and account deletion · platform admin console.

### Out of scope (v1)
Order placement/trading · intraday tick streaming · personalised recommendations or advice · payment gateway
checkout (manual activation instead) · email/SMS/push notifications · mobile native apps · advisor access to
client portfolios (would need explicit consent feature — see Open Decisions).

## 6. Functional requirements

IDs are referenced from CHANGELOG/ROADMAP. **Status:** ✅ built · 🟡 partial/stub · ⬜ not started.

### 6.1 Accounts, identity and consent
| ID | Requirement | Status |
|---|---|---|
| FR-1.1 | Sign up with email + password; email confirmation supported | ✅ |
| FR-1.2 | Every signup gets a personal workspace and Basic free for 3 months | ✅ (DB trigger) |
| FR-1.3 | Capture Terms + Privacy consent (required) and optional broker-data, AI-processing, marketing consents, each with version + timestamp | ✅ |
| FR-1.4 | Withdraw optional consents; withdrawing broker access disconnects brokers, withdrawing AI processing removes AI keys | ✅ |
| FR-1.5 | Password reset by email | ✅ |
| FR-1.6 | One active device per account; a new browser can take over | ✅ |
| FR-1.7 | Profile: name, mobile (for payment follow-up) | ✅ |

### 6.2 Workspaces (tenancy)
| ID | Requirement | Status |
|---|---|---|
| FR-2.1 | Users can create organisation workspaces and switch between workspaces | ✅ |
| FR-2.2 | Owners/admins invite by email with single-use, 7-day links; owners alone may grant admin | ✅ (link copied manually; no email sender yet) |
| FR-2.3 | Owners/admins see a member directory (name, email, phone, role, plan, expiry, total paid, last sign-in) | ✅ |
| FR-2.4 | Owners/admins see per-member feature-usage counts — never which stocks | ✅ |
| FR-2.5 | Owners/admins see their workspace's audit log | ✅ |
| FR-2.6 | Members can leave; removal takes effect immediately even with an unexpired token | ✅ |
| FR-2.7 | No one but the user can see their holdings, watchlists, alerts, broker connections or keys | ✅ (RLS + tests) |

### 6.3 Market research
| ID | Requirement | Status |
|---|---|---|
| FR-3.1 | Screener of covered stocks: last close, change, volume, 52-week range, RSI(14), last signal; filters by sector, signal, RSI zone; sorts | ✅ |
| FR-3.2 | Symbol page: daily candlestick chart (3M–2Y) with signal markers, key levels (SMA 20/50/200, RSI, 52w), signal history, monthly-SIP backtest | ✅ |
| FR-3.3 | Global symbol search with keyboard shortcut | ✅ |
| FR-3.4 | Market data pipelines populate symbols, candles, signals, RSI events, backtests | ⬜ (synthetic dev seed only) |
| FR-3.5 | Intraday ticks for live prices | ⬜ |

### 6.4 Market Radar (watchlists)
| ID | Requirement | Status |
|---|---|---|
| FR-4.1 | Multiple named watchlists; add/remove symbols | ✅ |
| FR-4.2 | Plan limit on distinct symbols (Basic 10, Pro 15, Pro Plus unlimited), enforced in the DB | ✅ |
| FR-4.3 | Radar table with price, change, sparkline, RSI, last signal | ✅ |

### 6.5 Signals
| ID | Requirement | Status |
|---|---|---|
| FR-5.1 | Signals list (my stocks / all), filter by strategy, with entry price, stop/target and move since | ✅ |
| FR-5.2 | Each strategy described in plain language in the product | ✅ |
| FR-5.3 | Signals generated by production pipelines | ⬜ |

### 6.6 Portfolio
| ID | Requirement | Status |
|---|---|---|
| FR-6.1 | Manual holdings across one or more portfolios; buying more merges at weighted average | ✅ |
| FR-6.2 | Value, invested, day P&L, overall P&L (₹ and %), weights, sector allocation, concentration note | ✅ |
| FR-6.3 | Broker sync of holdings | ⬜ (connection storage exists; sync worker not built) |
| FR-6.4 | Contract-note import (PDF/XLSX) parsed with the user's AI key | ⬜ (schema + bucket exist) |

### 6.7 Alerts and notifications
| ID | Requirement | Status |
|---|---|---|
| FR-7.1 | Price alerts above/below a level; pause/resume/delete; validation against last close | ✅ |
| FR-7.2 | Alerts evaluated server-side after each close against the day's high/low | ✅ (`run_eod_notifier`) |
| FR-7.3 | In-app notifications, live via Realtime; mark read | ✅ |
| FR-7.4 | Exit-signal notification for stocks the user holds | ✅ |
| FR-7.5 | Plan-expiry reminder 7 days out | ✅ |
| FR-7.6 | Intraday alert matching on live ticks | ⬜ |
| FR-7.7 | Email / push channels | ⬜ |

### 6.8 Integrations
| ID | Requirement | Status |
|---|---|---|
| FR-8.1 | Connect a broker (Choice, Zerodha, Angel One, Upstox, Dhan, Fyers) with read-only scope; token encrypted | 🟡 (manual token paste; per-broker OAuth not built) |
| FR-8.2 | Show connection status, masked account, token expiry; disconnect | ✅ |
| FR-8.3 | Store BYOK AI keys (Anthropic, OpenAI, Gemini) encrypted; show last 4 only | ✅ |
| FR-8.4 | AI features using the user's key (chat, news summary, contract-note parsing), metered in `ai_usage_logs` | ⬜ |

### 6.9 Plans and billing
| ID | Requirement | Status |
|---|---|---|
| FR-9.1 | Public pricing from the `plans` table | ✅ |
| FR-9.2 | Current plan, expiry, payments history in-app | ✅ |
| FR-9.3 | Platform admin records manual payment and activates/renews a plan atomically | ✅ |
| FR-9.4 | Payment gateway (Razorpay/Cashfree) checkout + webhooks | ⬜ |
| FR-9.5 | Subscriptions expire automatically | ✅ (cron) |

### 6.10 Data rights
| ID | Requirement | Status |
|---|---|---|
| FR-10.1 | Export all own data as JSON | ✅ |
| FR-10.2 | Self-serve account deletion in the §7 order | ✅ (broker-side token revocation not integrated) |
| FR-10.3 | Retention jobs per spec §8 | ✅ |

## 7. Non-functional requirements

| Area | Requirement |
|---|---|
| Security | RLS on every public table; service role confined to `server/privileged`; secrets AES-256-GCM with external key; platform admin only via SQL; append-only audit log; isolation suite (spec §9) must pass on every DB change |
| Privacy | DPDP-style consent records; analytics never include symbols; prompts/responses never stored; payments retained without identity after deletion |
| Performance | App pages server-render in < 800 ms p75 on Indian mobile networks for a 50-symbol radar; RLS helpers wrapped in `(select …)` |
| Availability | Supabase managed; EOD notifier idempotent (safe to re-run) |
| Accessibility | WCAG 2.1 AA: 4.5:1 text contrast, keyboard navigation, visible focus, reduced-motion respected, gain/loss not color-only |
| Responsiveness | 375 / 768 / 1024 / 1440 px, no horizontal page scroll |
| Localisation | ₹ with Indian digit grouping (lakh/crore), IST timestamps, English UI |
| Compliance | Positioned as research tooling; signals are mechanical outputs of published rules, never personalised advice. **Legal to confirm SEBI (Research Analyst / Investment Adviser) requirements before launch.** |

## 8. Plans (seed values — confirm, see Open Decisions)

| Plan | Price | Radar symbols | Portfolio symbols | Features |
|---|---|---|---|---|
| Basic | ₹0 (3-month trial on signup) | 10 | 0 | watchlist, research |
| Pro | ₹10,000 / year | 15 | 15 | + portfolio, alerts, scanning, broker connect, AI BYOK |
| Pro Plus | ₹15,000 / year | unlimited | unlimited | same as Pro |

## 9. Assumptions and constraints

- Supabase is the single backend; the Next.js server is the "Node backend" from the spec.
- Market data arrives from separate pipelines (service role / worker); this app only reads it.
- Broker data may not be redistributed: broker-sourced data never enters shared market tables.
- The npm public registry is blocked on the current dev network; the repo uses `registry.yarnpkg.com`.

## 10. Open decisions

From spec §10, plus product items raised during build:
1. Plan limits — Basic 10/0, Pro 15/15, Pro Plus unlimited: confirm.
2. Broker-synced holdings vs. plan limits (today the limit applies to all sources).
3. "Pro Plus free for now" → implement as a `promo` subscription with an end date.
4. Organisation billing: per-user today; seat-based tenant billing would need a new table. Currently each member gets a Basic trial in the org workspace on joining.
5. Advisor access to client portfolios: not supported; would require a consent-based `portfolio_shares` feature.
6. Phone visibility to tenant admins: currently shown; consider masking.
7. Transactional email provider for invites and notifications (today invite links are copied manually).
8. SEBI positioning and final legal copy (Terms/Privacy are drafts).
9. Exchange holiday calendar for the session clock and notifier schedule.
