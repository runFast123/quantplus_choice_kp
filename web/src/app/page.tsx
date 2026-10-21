import clsx from "clsx";
import {
  BrowserIcon,
  CheckIcon,
  DownloadSimpleIcon,
  LockIcon,
  MinusIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react/ssr";
import { SiteFooter, SiteNav } from "@/components/marketing/site-nav";
import { ButtonLink } from "@/components/ui/button";
import { paiseToRupees } from "@/lib/format";
import { FEATURE_ROWS } from "@/lib/plans";
import { supabaseServer } from "@/lib/supabase/server";
import type { Plan } from "@/lib/types";

const FALLBACK_PLANS: Plan[] = [
  { code: "basic", name: "Basic", price_paise_yearly: 0, max_watchlist_symbols: 10, max_portfolio_symbols: 0, features: { watchlist: true, research: true } },
  {
    code: "pro",
    name: "Pro",
    price_paise_yearly: 1000000,
    max_watchlist_symbols: 15,
    max_portfolio_symbols: 15,
    features: { watchlist: true, research: true, portfolio: true, alerts: true, scanning: true, ai_byok: true },
  },
  {
    code: "pro_plus",
    name: "Pro Plus",
    price_paise_yearly: 1500000,
    max_watchlist_symbols: null,
    max_portfolio_symbols: null,
    features: { watchlist: true, research: true, portfolio: true, alerts: true, scanning: true, ai_byok: true },
  },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  const supabase = await supabaseServer();
  const [{ data: claims }, { data: plansData }, sp] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.from("plans").select("*").order("price_paise_yearly"),
    searchParams,
  ]);
  const plans = (plansData?.length ? plansData : FALLBACK_PLANS) as Plan[];
  const signedIn = Boolean(claims?.claims?.sub);

  return (
    <div className="linen min-h-dvh">
      {sp.deleted ? (
        <p role="status" className="bg-primary px-5 py-2 text-center text-[13px] text-primary-foreground">
          Your account and personal workspace have been deleted.
        </p>
      ) : null}
      <SiteNav signedIn={signedIn} />

      <main>
        {/* ---------------- Hero ---------------- */}
        <section className="mx-auto grid max-w-[1240px] gap-12 px-5 pb-16 pt-10 md:px-8 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16 lg:pt-16">
          <div>
            <p className="eyebrow">For people who research NSE &amp; BSE stocks themselves</p>
            <h1 className="display mt-5 text-[46px] leading-[1.02] text-foreground sm:text-[60px] lg:text-[72px]">
              Research on rules <br className="hidden sm:block" />
              you can <em className="relative whitespace-nowrap">read<Underline /></em>.
            </h1>
            <p className="mt-6 max-w-[34rem] text-[17px] leading-8 text-muted-foreground">
              Keep a radar of the stocks you&apos;re waiting on. QuantsPulse checks each one against published rules after every close — moving-average crosses,
              RSI reversals, 4-tier sentiment audits, the price levels you set — and brings signals right to your broker charts via our Chrome Terminal HUD.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href={signedIn ? "/app" : "/signup"} size="lg">
                {signedIn ? "Open the desk" : "Start free for 3 months"}
              </ButtonLink>
              <ButtonLink href="#terminal" size="lg" variant="secondary">
                Terminal HUD
              </ButtonLink>
              <ButtonLink href="#how" size="lg" variant="secondary">
                See how it works
              </ButtonLink>
            </div>
            <p className="mt-4 text-[12.5px] text-muted-foreground">No card needed. Basic covers a 10-stock radar, rule-based signals, and research on every listing.</p>
          </div>

          <Specimen />
        </section>

        {/* ---------------- Dateline ---------------- */}
        <div className="border-y border-border bg-card/70">
          <p className="num mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-1.5 px-5 py-3 text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground md:px-8">
            <span>3,600+ NSE &amp; BSE Listings</span>
            <span aria-hidden>/</span>
            <span>Settled Daily at 17:00 IST</span>
            <span aria-hidden>/</span>
            <span>Extension HUD across 23+ Brokers</span>
            <span aria-hidden>/</span>
            <span>TradingView Chart Integration</span>
            <span aria-hidden>/</span>
            <span>1-Click CSV Portfolio Sync</span>
            <span aria-hidden>/</span>
            <span>4-Tier Sentiment Audit</span>
            <span aria-hidden>/</span>
            <span>Prices in ₹, times in IST</span>
          </p>
        </div>

        {/* ---------------- How ---------------- */}
        <section id="how" className="mx-auto max-w-[1240px] scroll-mt-8 px-5 py-20 md:px-8">
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <p className="eyebrow pt-3">How it works</p>
            <h2 className="display max-w-[22ch] text-[36px] leading-[1.1] md:text-[44px]">A short list, a few rules, and a nudge when they agree.</h2>
          </div>

          <ol className="mt-14 grid gap-y-14 md:grid-cols-12 md:gap-x-10">
            <Step
              n="01"
              title="Build or import your Market Radar"
              className="md:col-span-5"
              body="Pick the names you'd actually buy, or import your holdings with 1 click from Zerodha, Groww, Angel One, ICICI Direct, or Upstox CSVs. Each row carries its last close, 52-week position, 14-day RSI and current rule state."
            >
              <RadarSketch />
            </Step>
            <Step
              n="02"
              title="Mechanical rules & 4-tier sentiment"
              className="md:col-span-7 md:pt-24"
              body="Two published rule families: trend (SMA 20/50 crosses) and mean-reversion (RSI 30/70 reversals). Every signal is mapped through our 4-tier sentiment audit (Oversold Accumulation, Momentum Expansion, Overbought, Sentiment Exhaustion Peak) with asymmetric T1/T2/T3 alpha targets and 1.0R trailing risk."
            >
              <RuleSketch />
            </Step>
            <Step
              n="03"
              title="Execute on your broker or TradingView"
              className="md:col-span-6 md:col-start-4"
              body="View signals directly on your broker's charts without opening another tab via the QuantsPulse Extension HUD (Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan) or analyze interactive TradingView charts within your private desk."
            >
              <AllocationSketch />
            </Step>
          </ol>
        </section>

        {/* ---------------- Terminal Extension Section ---------------- */}
        <section id="terminal" className="mx-auto max-w-[1240px] scroll-mt-8 px-5 py-20 md:px-8 border-t border-border">
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <p className="eyebrow pt-3">Extension HUD</p>
            <div>
              <h2 className="display text-[36px] leading-[1.1] md:text-[44px]">
                Your research desk, overlaid on your broker&apos;s charts.
              </h2>
              <p className="mt-3 max-w-2xl text-[15px] leading-7 text-muted-foreground">
                Stop switching tabs and context. The QuantsPulse Chrome Extension Terminal projects a non-intrusive on-chart HUD and a full research slide-over panel right onto your broker&apos;s TradingView charts.
              </p>
            </div>
          </div>

          <div className="mt-12 grid gap-8 lg:grid-cols-12 lg:items-center">
            <div className="flex flex-col gap-4 lg:col-span-5">
              <div className="panel-interactive p-5">
                <div className="flex items-center gap-2.5">
                  <TerminalWindowIcon size={18} className="text-coral-ink shrink-0" aria-hidden />
                  <h3 className="text-[15px] font-semibold">On-Chart Heads-Up Display (HUD)</h3>
                </div>
                <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
                  Floating directly on the chart header: live signal badge (<span className="text-gain font-medium">ACTIVE LONG</span> or <span className="text-loss font-medium">EXIT</span>), Entry Base, 1.0R Trailing Stop, and scale-out Targets (T1 +3%, T2 +6%, T3 +12%).
                </p>
              </div>

              <div className="panel-interactive p-5">
                <div className="flex items-center gap-2.5">
                  <BrowserIcon size={18} className="text-coral-ink shrink-0" aria-hidden />
                  <h3 className="text-[15px] font-semibold">Slide-over Research Drawer</h3>
                </div>
                <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
                  Click the floating trigger or tap the shortcut to slide open technical scorecards, company profile, 4-tier sentiment audit, and recent signals without leaving your broker window.
                </p>
              </div>

              <div className="panel-interactive p-5">
                <div className="flex items-center gap-2.5">
                  <ShieldCheckIcon size={18} className="text-coral-ink shrink-0" aria-hidden />
                  <h3 className="text-[15px] font-semibold">23+ Brokers &amp; Zero Account Access</h3>
                </div>
                <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">
                  Works out of the box on Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan, Fyers, and TradingView. 100% read-only in your browser—never touches orders or trading keys.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                <a
                  href="/downloads/quantspulse-terminal.zip"
                  download="quantspulse-terminal.zip"
                  className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-90"
                >
                  <DownloadSimpleIcon size={16} weight="bold" aria-hidden />
                  Download Extension (.zip)
                </a>
                <ButtonLink href="/app/integrations" variant="secondary" size="md">
                  Setup Instructions →
                </ButtonLink>
              </div>

              <div className="rounded-lg border border-border bg-card/60 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
                <div className="flex items-center gap-1.5 font-medium text-foreground">
                  <LockIcon size={14} className="text-coral-ink shrink-0" aria-hidden />
                  <span>Account-Gated Quantitative Intelligence</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-5">
                  1-click download the ZIP and load it in Chrome. Signals, 1.0R trailing stops, and sentiment audits are exclusive to QuantsPulse members — your browser session automatically unlocks the on-chart HUD once you sign in.
                </p>
              </div>
            </div>

            <div className="lg:col-span-7">
              <TerminalSpecimen />
            </div>
          </div>
        </section>

        {/* ---------------- Privacy ---------------- */}
        <section id="privacy" className="scroll-mt-8 bg-primary text-primary-foreground">
          <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-20 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            <div>
              <p className="eyebrow !text-primary-foreground/60">Privacy, enforced by the database</p>
              <h2 className="display mt-4 text-[38px] leading-[1.08] md:text-[48px]">
                Your holdings are yours.
                <br />
                <em>Even from your firm.</em>
              </h2>
              <p className="mt-5 max-w-[30rem] text-[15px] leading-7 text-primary-foreground/75">
                Advisory firms and desks can run QuantsPulse as an organisation. Their admins manage seats and plans — and still can&apos;t open a member&apos;s
                portfolio. That isn&apos;t a setting someone can flip; it&apos;s row-level security in Postgres, checked on every query.
              </p>
              <ul className="mt-8 flex flex-col gap-3 text-[14px] text-primary-foreground/85">
                <li>AI keys are encrypted with a key that never sits in the database.</li>
                <li>Usage analytics record that a feature was used — never which stock.</li>
                <li>Export everything, or delete your account, from Settings. No email to support.</li>
              </ul>
            </div>
            <div role="group" aria-label="Who can see what — scrolls sideways" tabIndex={0} className="relative self-center overflow-x-auto rounded-xl border border-primary-foreground/15">
              <table className="w-full min-w-[440px] text-left text-[13.5px]">
                <caption className="sr-only">Who can see what</caption>
                <thead>
                  <tr className="border-b border-primary-foreground/15">
                    <th className="px-5 py-3 font-normal text-primary-foreground/60">Data</th>
                    <th className="px-3 py-3 text-center font-normal text-primary-foreground/60">You</th>
                    <th className="px-3 py-3 text-center font-normal text-primary-foreground/60">Org admin</th>
                    <th className="px-3 py-3 text-center font-normal text-primary-foreground/60">Our staff</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Holdings & portfolios", "Full", "—", "—"],
                      ["Watchlists & alerts", "Full", "—", "—"],
                      ["AI key", "Last 4", "—", "—"],
                      ["Name, email, plan", "Full", "Yes", "Yes"],
                      ["Feature usage", "Own", "Counts", "Counts"],
                    ] as const
                  ).map(([label, you, admin, staff]) => (
                    <tr key={label} className="border-b border-primary-foreground/10 last:border-0">
                      <td className="px-5 py-3">{label}</td>
                      {[you, admin, staff].map((v, i) => (
                        <td key={i} className={clsx("px-3 py-3 text-center", v === "—" ? "text-primary-foreground/40" : "")}>
                          {v === "—" ? <span aria-label="No access">—</span> : v}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* ---------------- Pricing ---------------- */}
        <section id="pricing" className="mx-auto max-w-[1240px] scroll-mt-8 px-5 py-20 md:px-8">
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <p className="eyebrow pt-3">Pricing</p>
            <div>
              <h2 className="display text-[36px] leading-[1.1] md:text-[44px]">Priced by the year, in rupees.</h2>
              <p className="mt-3 max-w-xl text-[15px] leading-7 text-muted-foreground">Every account starts on Basic for three months. Upgrade when the radar gets crowded.</p>
            </div>
          </div>
          <div className="mt-12 grid gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3">
            {plans.map((p) => (
              <div key={p.code} className={clsx("flex flex-col bg-card p-6", p.code === "pro" && "bg-accent")}>
                <div className="flex items-baseline justify-between">
                  <h3 className="display text-[26px]">{p.name}</h3>
                  {p.code === "pro" ? <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-coral-ink">Most chosen</span> : null}
                </div>
                <p className="mt-4">
                  <span className="num text-[34px] leading-none">{p.price_paise_yearly ? paiseToRupees(p.price_paise_yearly) : "₹0"}</span>
                  <span className="ml-1 text-[13px] text-muted-foreground">{p.price_paise_yearly ? "per year" : "for 3 months"}</span>
                </p>
                <p className="mt-2 text-[13px] text-muted-foreground">
                  {p.max_watchlist_symbols == null ? "Unlimited radar" : `${p.max_watchlist_symbols}-stock radar`} ·{" "}
                  {p.max_portfolio_symbols == null ? "unlimited portfolio" : p.max_portfolio_symbols ? `${p.max_portfolio_symbols}-stock portfolio` : "no portfolio"}
                </p>
                <ul className="mt-6 flex flex-1 flex-col gap-2.5 border-t border-border pt-5 text-[13.5px]">
                  {FEATURE_ROWS.map(([key, label]) => {
                    const on = Boolean(p.features?.[key]);
                    return (
                      <li key={key} className={clsx("flex items-start gap-2.5", !on && "text-muted-foreground")}>
                        {on ? <CheckIcon size={15} weight="bold" className="mt-0.5 shrink-0" aria-label="Included" /> : <MinusIcon size={15} className="mt-0.5 shrink-0" aria-label="Not included" />}
                        {label}
                      </li>
                    );
                  })}
                </ul>
                <ButtonLink href={signedIn ? "/app/billing" : "/signup"} variant={p.code === "pro" ? "primary" : "secondary"} className="mt-7 w-full">
                  {p.price_paise_yearly ? `Choose ${p.name}` : "Start free"}
                </ButtonLink>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------- FAQ ---------------- */}
        <section id="faq" className="mx-auto max-w-[1240px] scroll-mt-8 px-5 pb-24 md:px-8">
          <div className="grid gap-4 md:grid-cols-[220px_1fr]">
            <p className="eyebrow pt-3">Questions</p>
            <div className="divide-y divide-border border-y border-border">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group py-5">
                  <summary className="flex list-none items-center justify-between gap-6 text-[17px] [&::-webkit-details-marker]:hidden">
                    <span className="display">{q}</span>
                    <span aria-hidden className="num text-muted-foreground transition-transform duration-150 group-open:rotate-45">
                      +
                    </span>
                  </summary>
                  <p className="mt-3 max-w-[62ch] text-[14.5px] leading-7 text-muted-foreground">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}

const FAQ: [string, string][] = [
  [
    "Is this investment advice?",
    "No. A signal is the mechanical output of a rule that's written out on the Signals page — the same rule, applied to every stock, with no view on your finances. What to buy, how much, and when, stays your decision.",
  ],
  [
    "Where does the market data come from, and how fresh is it?",
    "End-of-day NSE and BSE candles from Yahoo Finance, loaded each weekday at approximately 5 pm IST once the session has settled. An automated pipeline updates ~3,600 listings (main board, SMEs, ETFs, and indices) with automatic exchange fallback. Signals, sentiment audits, charts, and research notes rebuild immediately right after. Price alerts test session highs and lows so intraday touches register.",
  ],
  [
    "How does the Chrome Extension Terminal work with my broker?",
    "The extension runs locally in your browser and activates on 23+ Indian broker platforms including Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan, Fyers, and TradingView. It injects a sleek On-Chart HUD showing active signals, Entry levels, 1.0R risk stops, and T1/T2/T3 targets, plus a slide-over research drawer. It is completely read-only and never accesses your broker credentials or executes orders.",
  ],
  [
    "Can I view TradingView charts directly in QuantsPulse?",
    "Yes. The Market desk includes interactive TradingView Advanced Charts with real-time indicators, drawing tools, and multi-timeframe analysis seamlessly integrated with QuantsPulse historical signals and 4-tier sentiment audits.",
  ],
  [
    "Can I import my existing stock portfolio from Zerodha, Groww, or Angel One?",
    "Yes. In the Portfolio desk, upload your CSV export from Zerodha Console, Groww, Angel One, ICICI Direct, or Upstox. QuantsPulse automatically maps symbols, quantities, and buy prices without needing any broker API credentials or passwords.",
  ],
  [
    "What does “bring your own AI key” mean?",
    "On Pro you can add your own Anthropic, OpenAI or Gemini key. Calls are billed to your account with that provider, the key is encrypted at rest using AES-256-GCM, and we keep a count of calls — never the prompts or answers.",
  ],
  [
    "Can my firm see my portfolio if we use QuantsPulse together?",
    "No. Organisation admins see who's in the workspace, their plan, and how often features are used. Holdings, watchlists, alerts and keys are blocked from them at the database level by PostgreSQL row-level security.",
  ],
  [
    "How do I leave?",
    "Settings → Your data. Download a JSON export of everything you stored, then delete the account. Payment records are kept without your name, because tax law requires it.",
  ],
];

/* ------------------------------------------------------------------ */
/* Hand-drawn pieces & Specimen visualisations                         */
/* ------------------------------------------------------------------ */

function Underline() {
  return (
    <svg viewBox="0 0 200 14" preserveAspectRatio="none" className="absolute -bottom-1 left-0 h-3 w-full text-coral" aria-hidden>
      <path d="M2 9 C 40 3, 80 12, 120 6 S 180 4, 198 8" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function Specimen() {
  return (
    <figure className="relative self-center">
      <div className="panel rotate-[-0.6deg] p-5 shadow-pop md:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="eyebrow">Signal · specimen</p>
            <p className="num mt-2 text-[22px] font-medium">HDFCBANK</p>
            <p className="text-[12.5px] text-muted-foreground">HDFC Bank · Banking</p>
          </div>
          <span className="rounded-[4px] bg-gain-soft px-2 py-1 text-[11px] font-semibold tracking-wide text-gain">BUY</span>
        </div>
        <svg viewBox="0 0 320 120" className="mt-4 w-full text-foreground" aria-hidden>
          <g className="stroke-border" strokeWidth="1">
            {[24, 60, 96].map((y) => (
              <line key={y} x1="0" x2="320" y1={y} y2={y} strokeDasharray="2 4" />
            ))}
          </g>
          <path d="M0 80 L20 84 L40 78 L60 88 L80 82 L100 90 L120 86 L140 92 L160 84 L180 76 L200 70 L220 62 L240 58 L260 48 L280 44 L300 36 L320 30" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
          <path d="M0 74 L40 78 L80 82 L120 84 L160 82 L200 76 L240 68 L280 58 L320 48" fill="none" className="stroke-muted-foreground" strokeWidth="1.2" strokeDasharray="4 3" />
          <path d="M0 70 L60 74 L120 78 L180 80 L240 76 L320 68" fill="none" className="stroke-muted-foreground/60" strokeWidth="1.2" strokeDasharray="1 3" />
          <circle cx="186" cy="74" r="4.5" className="fill-coral" />
        </svg>
        <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-border pt-4 text-[12px]">
          <div>
            <dt className="eyebrow">Rule</dt>
            <dd className="mt-1">SMA 20 ↑ 50</dd>
          </div>
          <div>
            <dt className="eyebrow">Fired at</dt>
            <dd className="num mt-1">₹1,642.30</dd>
          </div>
          <div>
            <dt className="eyebrow">Stop / target</dt>
            <dd className="num mt-1">1,527 / 1,839</dd>
          </div>
        </dl>
      </div>
      <figcaption className="mt-5 flex items-start gap-3 pl-2 text-[12.5px] leading-5 text-muted-foreground">
        <span className="mt-2 h-px w-8 shrink-0 bg-coral" aria-hidden />
        Illustrative. The coral mark is where the 20-day average (dashed) crossed the 50-day (dotted) — the whole rule, visible on the chart.
      </figcaption>
    </figure>
  );
}

function TerminalSpecimen() {
  return (
    <figure className="relative">
      <div className="panel p-5 shadow-pop md:p-6 bg-card border-border">
        {/* Broker bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-gain" aria-hidden />
            <span className="text-[12px] font-medium text-foreground">Broker On-Chart HUD</span>
            <span className="text-[11px] text-muted-foreground">· Choice FinX / Zerodha / Groww / TradingView</span>
          </div>
          <span className="num text-[11px] text-muted-foreground uppercase tracking-wide">Sync: TCS.NS</span>
        </div>

        {/* HUD Bar simulation */}
        <div className="mt-4 rounded-lg border border-border bg-background/60 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="num font-semibold text-[15px]">TCS</span>
              <span className="num text-[13px] text-muted-foreground">₹4,118.20</span>
              <span className="num text-[12px] text-gain font-medium">+0.84%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-gain-soft px-2 py-0.5 text-[11px] font-semibold text-gain tracking-wide">
                ACTIVE LONG
              </span>
              <span className="rounded bg-background px-2 py-0.5 text-[11px] text-muted-foreground border border-border">
                Rule: SMA 20/50
              </span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 border-t border-dashed border-border pt-3 text-[11.5px]">
            <div>
              <p className="text-muted-foreground">Entry Base</p>
              <p className="num font-medium text-foreground mt-0.5">₹4,080.00</p>
            </div>
            <div>
              <p className="text-muted-foreground">Trailing Stop</p>
              <p className="num font-medium text-loss mt-0.5">₹3,940.00</p>
            </div>
            <div>
              <p className="text-muted-foreground">Target 1 (0.75R)</p>
              <p className="num font-medium text-gain mt-0.5">₹4,185.00</p>
            </div>
            <div>
              <p className="text-muted-foreground">Target 2 (2.0R)</p>
              <p className="num font-medium text-gain mt-0.5">₹4,360.00</p>
            </div>
          </div>
        </div>

        {/* Chart specimen with levels */}
        <div className="relative mt-4 h-36 w-full rounded-md border border-border/80 bg-background/40 p-2 overflow-hidden">
          <svg viewBox="0 0 500 130" className="w-full h-full text-foreground" aria-hidden preserveAspectRatio="none">
            {/* Target lines */}
            <line x1="0" x2="500" y1="20" y2="20" stroke="var(--gain)" strokeDasharray="3 3" strokeWidth="1" />
            <text x="6" y="16" fill="var(--gain)" fontSize="9" fontFamily="monospace">Target 2 (2.0R) ₹4,360.00</text>
            <line x1="0" x2="500" y1="46" y2="46" stroke="var(--gain)" strokeDasharray="3 3" strokeWidth="1" />
            <text x="6" y="42" fill="var(--gain)" fontSize="9" fontFamily="monospace">Target 1 (0.75R) ₹4,185.00</text>

            {/* Entry line */}
            <line x1="0" x2="500" y1="75" y2="75" stroke="var(--muted-foreground)" strokeDasharray="2 2" strokeWidth="1" />
            <text x="6" y="71" fill="var(--muted-foreground)" fontSize="9" fontFamily="monospace">Entry ₹4,080.00</text>

            {/* Stop loss line */}
            <line x1="0" x2="500" y1="110" y2="110" stroke="var(--loss)" strokeDasharray="3 3" strokeWidth="1" />
            <text x="6" y="106" fill="var(--loss)" fontSize="9" fontFamily="monospace">Stop Loss (1.0R) ₹3,940.00</text>

            {/* Price path */}
            <path
              d="M 20 85 L 60 88 L 100 82 L 140 76 L 180 73 L 220 68 L 260 58 L 300 52 L 340 44 L 380 48 L 420 38 L 460 35 L 490 32"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
            />
            {/* Buy marker */}
            <circle cx="160" cy="74" r="4.5" fill="var(--gain)" />
          </svg>
        </div>

        {/* Drawer preview footer */}
        <div className="mt-3.5 flex items-center justify-between rounded border border-border bg-card px-3 py-2 text-[12px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <BrowserIcon size={14} className="text-coral-ink shrink-0" aria-hidden />
            <span>Slide-over Drawer: Press [Ctrl + Q] or click HUD pill</span>
          </div>
          <span className="num text-[11px] text-gain">● Live Observer Synced</span>
        </div>
      </div>
      <figcaption className="mt-3 flex items-start gap-3 pl-2 text-[12.5px] leading-5 text-muted-foreground">
        <span className="mt-2 h-px w-8 shrink-0 bg-coral" aria-hidden />
        Native overlay rendered seamlessly on broker charts without leaving your trading window.
      </figcaption>
    </figure>
  );
}

function Step({ n, title, body, children, className }: { n: string; title: string; body: string; children: React.ReactNode; className?: string }) {
  return (
    <li className={clsx("list-none", className)}>
      <div className="panel overflow-hidden">
        <div className="border-b border-border bg-background/40 p-5">{children}</div>
        <div className="p-6">
          <p className="num text-[12px] text-coral-ink">{n}</p>
          <h3 className="display mt-2 text-[24px]">{title}</h3>
          <p className="mt-2 text-[14.5px] leading-7 text-muted-foreground">{body}</p>
        </div>
      </div>
    </li>
  );
}

function RadarSketch() {
  const rows = [
    ["TCS", "4,118.20", "+0.84%", true],
    ["ITC", "468.05", "−0.31%", false],
    ["LT", "3,702.60", "+1.92%", true],
    ["SBIN", "812.45", "+0.12%", true],
  ] as const;
  return (
    <div className="num text-[12px]" aria-hidden>
      {rows.map(([s, p, c, up]) => (
        <div key={s} className="flex items-center justify-between border-b border-dashed border-border py-1.5 last:border-0">
          <span className="w-16 font-medium">{s}</span>
          <span className="text-muted-foreground">{p}</span>
          <span className={up ? "text-gain" : "text-loss"}>
            {up ? "▲" : "▼"} {c}
          </span>
        </div>
      ))}
    </div>
  );
}

function RuleSketch() {
  return (
    <svg viewBox="0 0 520 110" className="w-full text-foreground" aria-hidden>
      <line x1="0" x2="520" y1="30" y2="30" className="stroke-border" strokeDasharray="2 4" />
      <line x1="0" x2="520" y1="86" y2="86" className="stroke-border" strokeDasharray="2 4" />
      <text x="4" y="24" className="fill-muted-foreground font-mono" fontSize="10">
        70
      </text>
      <text x="4" y="100" className="fill-muted-foreground font-mono" fontSize="10">
        30
      </text>
      <path d="M20 60 L60 70 L100 84 L130 96 L160 92 L190 80 L230 64 L270 50 L310 34 L340 24 L370 30 L410 44 L450 52 L500 48" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="176" cy="86" r="4.5" className="fill-gain" />
      <circle cx="362" cy="30" r="4.5" className="fill-loss" />
      <text x="186" y="104" className="fill-gain font-mono" fontSize="10">
        ▲ back above 30
      </text>
      <text x="372" y="20" className="fill-loss font-mono" fontSize="10">
        ▼ back below 70
      </text>
    </svg>
  );
}

function AllocationSketch() {
  const rows = [
    ["IT", 34],
    ["Banking", 27],
    ["Auto", 18],
    ["FMCG", 12],
    ["Pharma", 9],
  ] as const;
  return (
    <div className="flex flex-col gap-2" aria-hidden>
      {rows.map(([label, w]) => (
        <div key={label} className="grid grid-cols-[64px_1fr_40px] items-center gap-3 text-[12px]">
          <span>{label}</span>
          <span className="h-1.5 rounded-full bg-foreground/[0.07]">
            <span className="block h-full rounded-full bg-primary" style={{ width: `${w * 2.5}%` }} />
          </span>
          <span className="num text-right text-muted-foreground">{w}%</span>
        </div>
      ))}
    </div>
  );
}

export const dynamic = "force-dynamic";
