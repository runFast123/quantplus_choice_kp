import "./signal-layers.css";

/**
 * "What every signal is made of" (home, ADR-057): four planes in CSS 3D — the price, the rule, the plan, the record —
 * that lift apart as the section scrolls through the screen (a scroll-driven animation; browsers without it, and
 * "reduce motion", get the lifted stack as a still). The planes are decoration (aria-hidden); the list beside them
 * carries the content. No library: transforms only, and no text ever fades.
 */
const LAYERS = [
  ["Price", "The day's official close", "End-of-day NSE prices for about 3,600 listings, loaded each weekday at about 5 pm IST."],
  ["Rule", "One published rule", "The same written conditions for every stock. You can read each one, so you know exactly why a signal fired."],
  ["Plan", "A stop and an exit", "Every buy comes with a safety stop under the entry and a set way out, fixed before the trade starts."],
  ["Record", "The tested record", "How the rule did on NSE prices from 2019 to 2026, after costs, with the losing trades left in."],
] as const;

function Plane({ n, label, children }: { n: number; label: string; children: React.ReactNode }) {
  return (
    <div className={`sl-plane sl-p${n}`}>
      <p className="num flex items-center gap-2 text-[11px] uppercase tracking-[0.08em] text-foreground">
        <span className="inline-flex size-5 items-center justify-center rounded-full bg-foreground text-[10px] text-background">{n}</span>
        {label}
      </p>
      <div className="mt-2 flex-1">{children}</div>
    </div>
  );
}

export function SignalLayers() {
  return (
    <section aria-labelledby="layers" className="sl mx-auto grid max-w-[1240px] items-center gap-10 overflow-x-clip px-5 py-24 md:px-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] lg:gap-16">
      <div>
        <p className="eyebrow reveal">Inside a signal</p>
        <h2 id="layers" className="reveal display mt-4 max-w-[18ch] text-[36px] leading-[1.1] md:text-[44px]">
          What every signal is made of.
        </h2>
        <p className="reveal mt-5 max-w-[32rem] text-[15.5px] leading-7 text-muted-foreground">
          A signal here is never a bare &ldquo;buy&rdquo;. It is four things stacked together, and you can open each one before you decide anything.
        </p>
        <ol className="mt-8 flex max-w-[32rem] flex-col gap-5">
          {LAYERS.map(([tag, title, body], i) => (
            <li key={tag} className="reveal flex gap-4">
              <span className="num mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-foreground text-[11px] text-background">{i + 1}</span>
              <div>
                <h3 className="text-[15.5px] font-semibold">{title}</h3>
                <p className="mt-1 text-[14px] leading-6 text-muted-foreground">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <div className="sl-stage" aria-hidden>
        <div className="sl-rig">
          <Plane n={1} label="Price">
            <svg viewBox="0 0 240 90" className="h-full w-full">
              <path
                d="M4 22 L24 30 L44 26 L64 44 L84 52 L104 66 L124 70 L144 62 L164 48 L184 40 L204 26 L236 14"
                fill="none"
                className="stroke-foreground"
                strokeWidth="2.2"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
              <circle cx="144" cy="62" r="5" className="fill-coral stroke-card" strokeWidth="2" />
            </svg>
          </Plane>
          <Plane n={2} label="Rule">
            <ul className="flex h-full flex-col justify-center gap-2.5">
              {[78, 62, 70].map((w) => (
                <li key={w} className="flex items-center gap-2.5">
                  <svg viewBox="0 0 16 16" className="size-4 shrink-0">
                    <circle cx="8" cy="8" r="8" className="fill-foreground" />
                    <path d="M4.5 8.2 L7 10.6 L11.5 5.6" fill="none" className="stroke-background" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="h-2 rounded-full bg-foreground/25" style={{ width: `${w}%` }} />
                </li>
              ))}
            </ul>
          </Plane>
          <Plane n={3} label="Plan">
            <svg viewBox="0 0 240 90" className="h-full w-full">
              <line x1="8" x2="232" y1="70" y2="70" className="stroke-loss" strokeWidth="2" strokeDasharray="6 5" />
              <line x1="8" x2="232" y1="44" y2="44" className="stroke-foreground/30" strokeWidth="1.5" />
              <circle cx="60" cy="44" r="5.5" className="fill-coral stroke-card" strokeWidth="2" />
              <path d="M60 44 L110 34 L150 38 L196 18" fill="none" className="stroke-foreground" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="190" y="12" width="12" height="12" rx="2" className="fill-foreground" />
            </svg>
          </Plane>
          <Plane n={4} label="Record">
            <svg viewBox="0 0 240 90" className="h-full w-full">
              <line x1="4" x2="236" y1="52" y2="52" className="stroke-foreground/30" strokeWidth="1.5" />
              {[30, 18, -14, 26, 36, -20, 22, 12, -10, 32, 24, -16].map((h, i) => (
                <rect
                  key={i}
                  x={8 + i * 19}
                  width="12"
                  rx="2"
                  y={h > 0 ? 52 - h : 52}
                  height={Math.abs(h)}
                  className={h > 0 ? "fill-foreground" : "fill-foreground/35"}
                />
              ))}
            </svg>
          </Plane>
        </div>
      </div>
    </section>
  );
}
