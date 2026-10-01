import clsx from "clsx";
import { CheckIcon, MinusIcon } from "@phosphor-icons/react/ssr";
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
    features: { watchlist: true, research: true, portfolio: true, alerts: true, scanning: true, broker_connect: true, ai_byok: true },
  },
  {
    code: "pro_plus",
    name: "Pro Plus",
    price_paise_yearly: 1500000,
    max_watchlist_symbols: null,
    max_portfolio_symbols: null,
    features: { watchlist: true, research: true, portfolio: true, alerts: true, scanning: true, broker_connect: true, ai_byok: true },
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
              RSI reversals, the price levels you set — and tells you the moment something changes.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href={signedIn ? "/app" : "/signup"} size="lg">
                {signedIn ? "Open the desk" : "Start free for 3 months"}
              </ButtonLink>
              <ButtonLink href="#how" size="lg" variant="secondary">
                See how it works
              </ButtonLink>
            </div>
            <p className="mt-4 text-[12.5px] text-muted-foreground">No card needed. Basic covers a 10-stock radar and research on every listing.</p>
          </div>

          <Specimen />
        </section>

        {/* ---------------- Dateline ---------------- */}
        <div className="border-y border-border bg-card/70">
          <p className="num mx-auto flex max-w-[1240px] flex-wrap gap-x-6 gap-y-1 px-5 py-3 text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground md:px-8">
            <span>NSE · BSE</span>
            <span aria-hidden>/</span>
            <span>End-of-day candles</span>
            <span aria-hidden>/</span>
            <span>SMA 20·50 · RSI 14</span>
            <span aria-hidden>/</span>
            <span>Alerts checked after every close</span>
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
              title="Build your Market Radar"
              className="md:col-span-5"
              body="Pick the names you'd actually buy. Each row carries its last close, where it sits in its 52-week range, 14-day RSI and the last signal — on one line, no tabs."
            >
              <RadarSketch />
            </Step>
            <Step
              n="02"
              title="Let the rules watch"
              className="md:col-span-7 md:pt-24"
              body="Two families, both written out in plain words: trend (the 20-day average crossing the 50-day) and mean-reversion (RSI turning back from 30 or 70). Every signal links to the rule and the price it fired at."
            >
              <RuleSketch />
            </Step>
            <Step
              n="03"
              title="Track what you own"
              className="md:col-span-6 md:col-start-4"
              body="Add holdings by hand or connect your broker. See day and overall P&L, sector concentration, and get notified when an exit rule fires on something you hold."
            >
              <AllocationSketch />
            </Step>
          </ol>
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
                <li>Broker tokens and AI keys are encrypted with a key that never sits in the database.</li>
                <li>Usage analytics record that a feature was used — never which stock.</li>
                <li>Export everything, or delete your account, from Settings. No email to support.</li>
              </ul>
            </div>
            <div className="self-center overflow-x-auto rounded-xl border border-primary-foreground/15">
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
                      ["Broker connection", "Status", "—", "—"],
                      ["Broker token, AI key", "Last 4", "—", "—"],
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
                  {p.code === "pro" ? <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-coral">Most chosen</span> : null}
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
                      <li key={key} className={clsx("flex items-start gap-2.5", !on && "text-muted-foreground/80")}>
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
    "Signals and charts run on end-of-day candles for NSE and BSE listings, updated after the close. Price alerts are checked against each session's high and low, so a level touched intraday still triggers.",
  ],
  [
    "Which brokers can I connect?",
    "Choice, Zerodha, Angel One, Upstox, Dhan and Fyers, with read-only scope. Most Indian brokers expire API sessions every morning, so you'll see a reconnect prompt when that happens. Connecting is optional — you can enter holdings by hand.",
  ],
  [
    "What does “bring your own AI key” mean?",
    "On Pro you can add your own Anthropic, OpenAI or Gemini key. Calls are billed to your account with that provider, the key is encrypted at rest, and we keep a count of calls — never the prompts or answers.",
  ],
  [
    "Can my firm see my portfolio if we use QuantsPulse together?",
    "No. Organisation admins see who's in the workspace, their plan, and how often features are used. Holdings, watchlists, alerts, broker connections and keys are blocked from them at the database level.",
  ],
  [
    "How do I leave?",
    "Settings → Your data. Download a JSON export of everything you stored, then delete the account. Payment records are kept without your name, because tax law requires it.",
  ],
];

/* ------------------------------------------------------------------ */
/* Hand-drawn pieces. Decorative and labelled as specimens.            */
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

function Step({ n, title, body, children, className }: { n: string; title: string; body: string; children: React.ReactNode; className?: string }) {
  return (
    <li className={clsx("list-none", className)}>
      <div className="panel overflow-hidden">
        <div className="border-b border-border bg-background/40 p-5">{children}</div>
        <div className="p-6">
          <p className="num text-[12px] text-coral">{n}</p>
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
