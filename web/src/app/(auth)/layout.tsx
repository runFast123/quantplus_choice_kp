import { Logo } from "@/components/brand/logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="linen grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-5 py-6 sm:px-10">
        <Logo />
        <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-12">{children}</main>
        <p className="text-[12px] text-muted-foreground">
          Research tools, not investment advice. Markets carry risk; read all documents carefully.
        </p>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-border bg-card lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="eyebrow">The desk note</div>
        <figure className="max-w-[30rem]">
          <blockquote className="display text-[40px] leading-[1.12] text-foreground">
            A watchlist is a list of <em>questions</em>.
            <br />A signal is the moment one of them gets answered.
          </blockquote>
          <figcaption className="mt-6 text-[13px] text-muted-foreground">
            QuantsPulse watches NSE and BSE on rules you can read — moving-average crosses, RSI reversals, price levels — and tells
            you when they trigger.
          </figcaption>
        </figure>

        {/* Hand-set tape: an ink price line with one coral entry mark. Decorative. */}
        <svg viewBox="0 0 520 150" className="w-full max-w-[34rem] text-foreground" aria-hidden>
          <g className="stroke-border" strokeWidth="1">
            {[30, 60, 90, 120].map((y) => (
              <line key={y} x1="0" x2="520" y1={y} y2={y} strokeDasharray="2 5" />
            ))}
          </g>
          <path
            d="M0 108 L26 102 L44 110 L70 96 L92 100 L118 84 L140 92 L160 80 L182 88 L204 70 L226 76 L250 58 L270 66 L294 60 L318 72 L340 64 L362 48 L386 54 L410 40 L432 46 L456 30 L480 38 L504 24 L520 28"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinejoin="round"
          />
          <line x1="250" x2="250" y1="20" y2="140" className="stroke-coral" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx="250" cy="58" r="5" className="fill-coral" />
          <text x="258" y="18" className="fill-muted-foreground font-mono" fontSize="10">
            SMA 20 ↑ 50 · BUY
          </text>
        </svg>
      </aside>
    </div>
  );
}
