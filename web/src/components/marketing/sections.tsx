import clsx from "clsx";
import Link from "next/link";
import {
  ArrowRightIcon,
  BrowserIcon,
  CheckIcon,
  DownloadSimpleIcon,
  LockIcon,
  MinusIcon,
  ShieldCheckIcon,
  TerminalWindowIcon,
} from "@phosphor-icons/react/ssr";
import { Tilt } from "@/components/marketing/tilt";
import { ButtonLink } from "@/components/ui/button";
import { paiseToRupees } from "@/lib/format";
import { SITE_URL } from "@/lib/env";
import { FEATURE_ROWS } from "@/lib/plans";
import type { Plan } from "@/lib/types";

export { DEFINITION, ORGANIZATION } from "@/lib/site";

/**
 * The public site's sections (ADR-055): each one is its own page (/method, /chrome-extension, /pricing, /faq)
 * and the home page shows the privacy band and a card for each page. Motion classes (hero-in, reveal, Tilt) follow
 * ADR-054: movement only, never transparent, nothing with "reduce motion".
 */

// shown when the plans table can't be read (a cold start, a network blip), so the page never renders without prices
export const FALLBACK_PLANS: Plan[] = [
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

/** The page's title block: an eyebrow, the one H1 and a lead line, arriving line by line. */
export function PageHead({ eyebrow, title, lead }: { eyebrow: string; title: string; lead?: string }) {
  return (
    <div className="grid gap-4 md:grid-cols-[220px_1fr]">
      <p className="eyebrow hero-in pt-3">{eyebrow}</p>
      <div>
        <h1 className="hero-in display max-w-[24ch] text-[38px] leading-[1.08] md:text-[52px]" style={{ "--d": "80ms" } as React.CSSProperties}>
          {title}
        </h1>
        {lead ? (
          <p className="hero-in mt-4 max-w-2xl text-[16px] leading-7 text-muted-foreground" style={{ "--d": "200ms" } as React.CSSProperties}>
            {lead}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function HowSteps() {
  return (
    <section aria-labelledby="three-steps" className="mt-16">
    <h2 id="three-steps" className="reveal display text-[30px] leading-[1.1] md:text-[36px]">
      From watchlist to signal, in three steps
    </h2>
    <ol className="mt-10 grid gap-8 lg:grid-cols-3">
      <Step
        n="01"
        title="Build or import your Market Radar"
        body="Pick the stocks you'd actually buy, or upload your holdings file from Zerodha, Groww, Angel One, ICICI Direct or Upstox. Each row shows its last close, where it sits in its 52-week range, its RSI and what our rules say now."
      >
        <RadarSketch />
      </Step>
      <Step
        n="02"
        title="Six simple rules, in plain words"
        body="Four trend rules (a new 52-week high on heavy volume, the 20-day average turning above the 50-day in a market leader, a close above a flat or rising 200-day average, and a deep, long slump starting to turn up) and two dip rules (a sharp drop in a rising stock), each written out on the Signals page with its tested record. Every buy comes with a safety stop and a plan for when to sell, and a one-word read of how stretched the price is, from Beaten down to Very stretched."
      >
        <RuleSketch />
      </Step>
      <Step
        n="03"
        title="See it on your broker's chart"
        body="Our Chrome extension shows the signal, its safety stop and its plan right on your broker's chart (Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan and more). Or open any stock here for an interactive TradingView chart. You place any order yourself, with your broker."
      >
        <AllocationSketch />
      </Step>
    </ol>
    </section>
  );
}

export function ExtensionBody() {
  return (
    <div className="mt-12 grid gap-8 lg:grid-cols-12 lg:items-center">
      <div className="flex flex-col gap-4 lg:col-span-5">
        <h2 className="reveal display text-[28px] leading-[1.1] md:text-[32px]">What the extension shows on your chart</h2>
        {(
          [
            [TerminalWindowIcon, "A signal bar on the chart", "A small bar on your broker's chart shows the stock's latest signal (buy or exit), the price it fired at, its safety stop and its plan, from the last end-of-day close."],
            [BrowserIcon, "A side panel with the details", "Open the side panel for the signal explained in plain words, the 52-week range, recent signals and a one-click TradingView script, without leaving your broker."],
            [ShieldCheckIcon, "20+ brokers, no account access", "Works on Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan, Fyers, TradingView and more. It only reads the page: it never sees your broker password and never places orders."],
          ] as const
        ).map(([Icon, title, body]) => (
          <div key={title} className="reveal">
            <Tilt max={4}>
              <div className="panel p-5">
                <div className="flex items-center gap-2.5">
                  <Icon size={18} className="text-coral-ink shrink-0" aria-hidden />
                  <h3 className="text-[15px] font-semibold">{title}</h3>
                </div>
                <p className="mt-2 text-[13.5px] leading-6 text-muted-foreground">{body}</p>
              </div>
            </Tilt>
          </div>
        ))}

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
            How to install →
          </ButtonLink>
        </div>

        <div className="rounded-lg border border-border bg-card/60 p-4 text-[12.5px] leading-relaxed text-muted-foreground">
          <div className="flex items-center gap-1.5 font-medium text-foreground">
            <LockIcon size={14} className="text-coral-ink shrink-0" aria-hidden />
            <span>For QuantsPulse members</span>
          </div>
          <p className="mt-1.5 text-[12px] leading-5">
            Download the ZIP and load it in Chrome. The signals show once you&apos;re signed in to QuantsPulse in the same browser.
          </p>
        </div>
      </div>

      <div className="screen-in lg:col-span-7">
        <TerminalSpecimen />
      </div>
    </div>
  );
}

export function PrivacyBand() {
  return (
    <section id="privacy" className="scroll-mt-8 bg-primary text-primary-foreground">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-5 py-24 md:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="reveal">
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
        <div role="group" aria-label="Who can see what — scrolls sideways" tabIndex={0} className="reveal relative self-center overflow-x-auto rounded-xl border border-primary-foreground/15">
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
  );
}

export function PricingCards({ plans, signedIn }: { plans: Plan[]; signedIn: boolean }) {
  return (
    <div className="mt-12 grid items-start gap-5 md:grid-cols-3">
      <h2 className="sr-only">Compare the Basic, Pro and Pro Plus plans</h2>
      {plans.map((p) => (
        <div key={p.code} className={clsx("reveal h-full", p.code === "pro" && "md:-translate-y-3")}>
        <Tilt max={5} className="h-full">
        <div className={clsx("panel flex h-full flex-col p-6", p.code === "pro" && "bg-accent shadow-pop")}>
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
        </Tilt>
        </div>
      ))}
    </div>
  );
}

/** The questions; each one is a real heading inside its summary (h2 on /faq, h3 under a section heading elsewhere). */
export function FaqList({ limit, level = 3 }: { limit?: number; level?: 2 | 3 } = {}) {
  const Q = level === 2 ? "h2" : "h3";
  return (
      <div className="divide-y divide-border border-y border-border">
        {FAQ.slice(0, limit).map(([q, a]) => (
          <details key={q} className="group py-5">
            <summary className="flex list-none items-center justify-between gap-6 text-[17px] [&::-webkit-details-marker]:hidden">
              <Q className="display text-[17px] font-normal">{q}</Q>
              <span aria-hidden className="num text-muted-foreground transition-transform duration-150 group-open:rotate-45">
                +
              </span>
            </summary>
            <p className="mt-3 max-w-[62ch] text-[14.5px] leading-7 text-muted-foreground">{a}</p>
          </details>
        ))}
      </div>
  );
}

/** Structured data for search engines: the page's breadcrumb, plus anything page-specific (the FAQ, for one). */
export function JsonLd({ name, path, extra = [] }: { name: string; path: string; extra?: object[] }) {
  const data = [
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
        { "@type": "ListItem", position: 2, name, item: `${SITE_URL}${path}` },
      ],
    },
    ...extra,
  ];
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

/** Links to the other public pages at the foot of each one: readers find the next thing, crawlers find every page. */
const PAGES = [
  ["/method", "Method", "Six published rules check your radar after every close, with a safety stop and a plan for every buy."],
  ["/chrome-extension", "Chrome extension", "The signal, its safety stop and its plan, right on your broker's chart."],
  ["/pricing", "Pricing", "Basic, Pro and Pro Plus, priced by the year in rupees. Three months free to start."],
  ["/faq", "Questions", "Advice, data, the extension, your privacy and how to leave."],
  ["/blog", "Research notes", "Five common indicator setups, tested on NSE stocks from 2019 to 2026."],
] as const;

export function MorePages({ current, title }: { current?: string; title?: string }) {
  const list = PAGES.filter(([href]) => href !== current);
  return (
    <>
    {title ? <h2 className="reveal display mb-8 text-[28px] leading-[1.1] md:text-[32px]">{title}</h2> : null}
    <ul className={clsx("grid gap-4 sm:grid-cols-2", list.length > 4 ? "lg:grid-cols-5" : "lg:grid-cols-4")} data-testid="site-pages">
      {list.map(([href, title, body]) => (
        <li key={href} className="reveal">
          <Tilt max={6} className="h-full">
            <Link href={href} className="panel group flex h-full flex-col p-5 transition-colors hover:border-foreground/25">
              <h3 className="display text-[22px]">{title}</h3>
              <p className="mt-2 flex-1 text-[13.5px] leading-6 text-muted-foreground">{body}</p>
              <span className="mt-4 inline-flex items-center gap-1 text-[13px] font-medium">
                Open <ArrowRightIcon size={13} className="transition-transform group-hover:translate-x-0.5" aria-hidden />
              </span>
            </Link>
          </Tilt>
        </li>
      ))}
    </ul>
    </>
  );
}

export const FAQ: [string, string][] = [
  [
    "Is this investment advice?",
    "No. A signal is the mechanical output of a rule that's written out on the Signals page — the same rule, applied to every stock, with no view on your finances. What to buy, how much, and when, stays your decision.",
  ],
  [
    "Where does the market data come from, and how fresh is it?",
    "End-of-day NSE prices from Yahoo Finance, loaded each weekday at about 5 pm IST once the session has settled: about 3,600 listings, including SME stocks, ETFs and indices. Signals, charts and research notes update right after. Price alerts check each day's high and low, so a level touched during the day still counts. There are no live intraday prices.",
  ],
  [
    "How does the Chrome extension work with my broker?",
    "It runs in your own browser and works on TradingView and 20+ Indian broker sites, including Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan and Fyers. It spots the stock on your chart and shows its latest signal, safety stop and plan in a small bar, plus a side panel with more detail. It only reads the page: it never sees your broker password and never places orders.",
  ],
  [
    "Can I view TradingView charts directly in QuantsPulse?",
    "Yes. Every stock page has an interactive TradingView chart with its drawing tools and indicators, next to our own end-of-day chart with each past signal marked on it.",
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

function TerminalSpecimen() {
  return (
    <figure className="relative">
      <div className="panel p-5 shadow-pop md:p-6 bg-card border-border">
        {/* Broker bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3.5">
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-gain" aria-hidden />
            <span className="text-[12px] font-medium text-foreground">Signal bar on your broker</span>
            <span className="text-[11px] text-muted-foreground">· Choice FinX / Zerodha / Groww / TradingView</span>
          </div>
          <span className="num text-[11px] text-muted-foreground uppercase tracking-wide">Example</span>
        </div>

        {/* HUD Bar simulation */}
        <div className="mt-4 rounded-lg border border-border bg-background/60 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="num font-semibold text-[15px]">TCS</span>
              <span className="num text-[13px] text-muted-foreground">₹4,118.20</span>
              <span className="num text-[12px] text-gain font-medium"><span aria-hidden className="text-[0.7em]">▲</span> +0.84%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-gain-soft px-2 py-0.5 text-[11px] font-semibold text-gain tracking-wide">
                BUY
              </span>
              <span className="rounded bg-background px-2 py-0.5 text-[11px] text-muted-foreground border border-border">
                Rule: SMA 20/50
              </span>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 border-t border-dashed border-border pt-3 text-[11.5px]">
            <div>
              <p className="text-muted-foreground">Signal price</p>
              <p className="num font-medium text-foreground mt-0.5">₹4,080.00</p>
            </div>
            <div>
              <p className="text-muted-foreground">Stop-loss</p>
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
            <span>Click the bar to open the side panel</span>
          </div>
          <span className="num text-[11px] text-muted-foreground">End-of-day data</span>
        </div>
      </div>
      <figcaption className="mt-3 flex items-start gap-3 pl-2 text-[12.5px] leading-5 text-muted-foreground">
        <span className="mt-2 h-px w-8 shrink-0 bg-coral" aria-hidden />
        An example of the bar on a broker chart. Prices are illustrative.
      </figcaption>
    </figure>
  );
}

function Step({ n, title, body, children, className }: { n: string; title: string; body: string; children: React.ReactNode; className?: string }) {
  return (
    <li className={clsx("reveal list-none", className)}>
      <Tilt max={5} className="h-full">
        <div className="panel h-full overflow-hidden">
          <div className="border-b border-border bg-background/40 p-5">{children}</div>
          <div className="p-6">
            <p className="num text-[12px] text-coral-ink">{n}</p>
            <h3 className="display mt-2 text-[24px]">{title}</h3>
            <p className="mt-2 text-[14.5px] leading-7 text-muted-foreground">{body}</p>
          </div>
        </div>
      </Tilt>
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
