// Illustrations of how each rule reads a chart. The prices are made up (a fixed, drawn series, labelled as an
// illustration); the averages and levels on it are computed from that series the way each rule computes them.
// Numbered markers on the drawing, with the words in a list underneath, so the text stays readable on a phone.
import type { RuleKey } from "@/lib/blog/types";

const W = 640, H = 300, PAD = { l: 14, r: 14, t: 18, b: 22 };

type Pt = [number, number];
type Note = { at: Pt; n: number };

function sma(xs: number[], n: number) {
  return xs.map((_, i) => (i + 1 < n ? NaN : xs.slice(i + 1 - n, i + 1).reduce((a, b) => a + b, 0) / n));
}

/** A smooth made up price walk through the given anchor points (index, price), with a small fixed wiggle. */
function walk(len: number, anchors: Pt[], wiggle = 1.2) {
  const out: number[] = [];
  for (let i = 0; i < len; i++) {
    const k = anchors.findIndex(([x]) => x >= i);
    const [x1, y1] = anchors[Math.max(k, 1)];
    const [x0, y0] = anchors[Math.max(k, 1) - 1];
    const f = (i - x0) / Math.max(x1 - x0, 1);
    const ease = 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(f, 0), 1));
    out.push(y0 + (y1 - y0) * ease + wiggle * (Math.sin(i * 1.7) + 0.6 * Math.sin(i * 0.9 + 1)));
  }
  return out;
}

function frame(series: number[][], len: number) {
  const all = series.flat().filter((v) => Number.isFinite(v));
  const lo = Math.min(...all), hi = Math.max(...all);
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / (len - 1);
  const y = (v: number) => PAD.t + (H - PAD.t - PAD.b) * (1 - (v - lo) / (hi - lo || 1));
  const line = (vs: number[]) =>
    vs.map((v, i) => (Number.isFinite(v) ? `${vs.slice(0, i).some(Number.isFinite) ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}` : "")).join("");
  return { x, y, line };
}

function Badge({ at: [cx, cy], n }: Note) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={11} fill="var(--series-ours)" stroke="var(--card)" strokeWidth={2.5} />
      <text x={cx} y={cy + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--card)">
        {n}
      </text>
    </g>
  );
}

function Svg({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="block h-auto w-full">
      <rect x={0} y={0} width={W} height={H} rx={10} fill="var(--card)" />
      {[0.25, 0.5, 0.75].map((f) => (
        <line key={f} x1={PAD.l} x2={W - PAD.r} y1={PAD.t + (H - PAD.t - PAD.b) * f} y2={PAD.t + (H - PAD.t - PAD.b) * f} stroke="var(--border)" strokeDasharray="2 4" />
      ))}
      {children}
    </svg>
  );
}

const ink = "var(--foreground)", muted = "var(--muted-foreground)", stop = "var(--loss)", ours = "var(--series-ours)";

function smaScene() {
  const len = 90;
  const p = walk(len, [[0, 62], [22, 50], [40, 52], [60, 66], [89, 80]]);
  const fast = sma(p, 8), slow = sma(p, 20);
  const hitC = fast.findIndex((v, i) => i > 25 && v > slow[i] && fast[i - 1] <= slow[i - 1]);
  const c = hitC > 0 ? hitC : 45;
  const { x, y, line } = frame([p, fast, slow, [p[c] - 9]], len);
  const end = Math.min(c + 46, len - 1);
  return {
    svg: (
      <Svg label="Illustration of the SMA 20/50 Trend rule">
        <path d={line(slow)} fill="none" stroke={muted} strokeWidth={2} />
        <path d={line(fast)} fill="none" stroke={ours} strokeWidth={2} />
        <path d={line(p)} fill="none" stroke={ink} strokeWidth={1.4} opacity={0.55} />
        <line x1={x(c)} x2={x(end)} y1={y(p[c] - 9)} y2={y(p[c] - 9)} stroke={stop} strokeWidth={2} strokeDasharray="6 4" />
        <path d={`M${x(c + 1)},${PAD.t + 6} v8 M${x(c + 1)},${PAD.t + 10} H${x(end)} M${x(end)},${PAD.t + 6} v8`} stroke={muted} strokeWidth={1.5} fill="none" />
        <circle cx={x(c)} cy={y(fast[c])} r={5} fill={ours} stroke="var(--card)" strokeWidth={2} />
        <Badge at={[x(c) - 22, y(fast[c]) + 22]} n={1} />
        <Badge at={[x(c) + 34, y(fast[c]) - 26]} n={2} />
        <Badge at={[x(c) + 22, y(p[c] - 9) + 18]} n={3} />
        <Badge at={[(x(c + 1) + x(end)) / 2, PAD.t + 10]} n={4} />
      </Svg>
    ),
    notes: [
      "The 20 day average (blue) closes above the 50 day average (grey).",
      "On that day the stock is a leader: its six month return is in the top 30% of the 500 largest companies.",
      "Bought at the next open, with a safety stop four average daily ranges under the signal close (dashed red).",
      "If the stop is not hit, the trade is closed after 60 sessions.",
    ],
    legend: ["Price", "20 day average", "50 day average", "Safety stop"],
  };
}

function dipScene(kind: "rsi" | "kk") {
  const len = 80;
  const p = walk(len, [[0, 40], [30, 58], [44, 66], [48, 60], [50, 55], [53, 63], [79, 72]], 0.9);
  const long = sma(p, 30).map((v) => (Number.isFinite(v) ? v - 10 : v));
  const five = sma(p, 4);
  const sig = 50, buy = 51;
  const lim = p[sig] - 3.2;
  p[buy] = lim - 1.2;
  const hitOut = five.findIndex((v, i) => i > buy && p[i] > v);
  const out = hitOut > 0 ? hitOut : buy + 3;
  const low20 = Math.min(...p.slice(sig - 20, sig - 1));
  const { x, y, line } = frame([p, long, [lim - 8, low20]], len);
  return {
    svg: (
      <Svg label={`Illustration of the ${kind === "rsi" ? "RSI Dip" : "KK Dip"} rule`}>
        <path d={line(long)} fill="none" stroke={muted} strokeWidth={2} />
        <path d={line(five)} fill="none" stroke={ours} strokeWidth={1.6} strokeDasharray="1 0" opacity={0.7} />
        <path d={line(p)} fill="none" stroke={ink} strokeWidth={1.6} />
        {kind === "kk" ? (
          <line x1={x(sig - 20)} x2={x(sig + 1)} y1={y(low20)} y2={y(low20)} stroke={muted} strokeWidth={1.5} strokeDasharray="5 4" />
        ) : null}
        <line x1={x(sig)} x2={x(buy + 1)} y1={y(lim)} y2={y(lim)} stroke={ours} strokeWidth={2} />
        <circle cx={x(buy)} cy={y(lim)} r={5} fill={ours} stroke="var(--card)" strokeWidth={2} />
        <circle cx={x(out)} cy={y(p[out])} r={5} fill="var(--gain)" stroke="var(--card)" strokeWidth={2} />
        <line x1={x(buy)} x2={x(out + 8)} y1={y(lim - 7)} y2={y(lim - 7)} stroke={stop} strokeWidth={2} strokeDasharray="6 4" />
        <Badge at={[x(38), y(long[38]) + 22]} n={1} />
        <Badge at={[x(sig) - 20, y(p[sig]) - 18]} n={2} />
        <Badge at={[x(buy) + 4, y(lim) + 26]} n={3} />
        <Badge at={[x(out) + 20, y(p[out]) - 18]} n={4} />
      </Svg>
    ),
    notes: [
      "The stock closes above its 200 day average (grey): it is still rising over the year.",
      kind === "rsi"
        ? "A sharp two day drop: the 2 day RSI closes under 10."
        : "The day's low falls at least 1% under the lowest low of the 20 sessions before it (dashed grey).",
      "Next session only: bought if the price dips one average daily range under the signal close (blue level). No dip, no trade. Safety stop five ranges under the buy (dashed red).",
      "Sold on the first close above the 5 day average (green dot), or after 10 sessions.",
    ],
    legend: ["Price", "200 day average", "5 day average", "Safety stop"],
  };
}

function strongScene() {
  const len = 90;
  const p = walk(len, [[0, 50], [15, 58], [30, 52], [45, 59], [58, 53], [66, 58], [70, 66], [89, 78]], 1);
  const brk = 68;
  const ceiling = Math.max(...p.slice(0, brk));
  while (p[brk] <= ceiling) p[brk] += 1;
  const vol = p.map((_, i) => (i === brk ? 2.6 : 0.8 + 0.35 * Math.abs(Math.sin(i * 2.3))));
  const { x, y, line } = frame([p, [ceiling - 18]], len);
  const vy = (v: number) => H - PAD.b - v * 16;
  return {
    svg: (
      <Svg label="Illustration of the Strong Trend rule">
        {vol.map((v, i) => (
          <rect key={i} x={x(i) - 2.2} y={vy(v)} width={4.4} height={v * 16} rx={1} fill={i === brk ? ours : muted} opacity={i === brk ? 1 : 0.35} />
        ))}
        <line x1={x(0)} x2={x(brk)} y1={y(ceiling)} y2={y(ceiling)} stroke={muted} strokeWidth={1.5} strokeDasharray="5 4" />
        <path d={line(p)} fill="none" stroke={ink} strokeWidth={1.6} />
        <circle cx={x(brk)} cy={y(p[brk])} r={5} fill={ours} stroke="var(--card)" strokeWidth={2} />
        <line x1={x(brk)} x2={x(len - 1)} y1={y(p[brk] - 12)} y2={y(p[brk] - 12)} stroke={stop} strokeWidth={2} strokeDasharray="6 4" />
        <g transform={`translate(${W - 70},${PAD.t + 8})`}>
          <circle r={9} fill="none" stroke={muted} strokeWidth={2} />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <line key={a} x1={13 * Math.cos((a * Math.PI) / 180)} y1={13 * Math.sin((a * Math.PI) / 180)} x2={17 * Math.cos((a * Math.PI) / 180)} y2={17 * Math.sin((a * Math.PI) / 180)} stroke={muted} strokeWidth={2} />
          ))}
        </g>
        <Badge at={[x(brk) - 24, y(p[brk]) - 16]} n={1} />
        <Badge at={[x(brk) - 24, vy(2.6) + 8]} n={2} />
        <Badge at={[W - 106, PAD.t + 8]} n={3} />
        <Badge at={[x(brk) + 90, y(p[brk] - 12) - 16]} n={4} />
      </Svg>
    ),
    notes: [
      "The close is above every close of the past year (the dashed line): a new 52 week high, above the 50 day average.",
      "Volume that day is at least twice its average of the previous 50 sessions.",
      "The market weather is sunny: the Nifty 50 is in an uptrend and India VIX is at 22 or less.",
      "Bought at the next open, safety stop four average daily ranges under the signal close, out at the stop or after 60 sessions.",
    ],
    legend: ["Price", "52 week high", "Volume", "Safety stop"],
  };
}

function ma200Scene() {
  const len = 100;
  const p = walk(len, [[0, 40], [55, 66], [66, 70], [76, 61], [84, 68], [99, 80]], 0.8);
  const long = sma(p, 40);
  const hit = p.findIndex((v, i) => i > 70 && v > long[i] && p[i - 1] <= long[i - 1]);
  const c = hit > 0 ? hit : 80;
  const s = Math.max(c - 30, 40);
  const fit = (() => {
    const xs = Array.from({ length: c - s + 1 }, (_, k) => s + k), ys = xs.map((i) => long[i]);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    const b = xs.reduce((a, xi, k) => a + (xi - mx) * (ys[k] - my), 0) / xs.reduce((a, xi) => a + (xi - mx) ** 2, 0);
    return (i: number) => my + b * (i - mx);
  })();
  const { x, y, line } = frame([p, long, [p[c] - 10]], len);
  const cEnd = Math.min(c + 34, len - 1);
  return {
    svg: (
      <Svg label="Illustration of the 200 Day Trend rule">
        <path d={line(long)} fill="none" stroke={muted} strokeWidth={2.2} />
        <line x1={x(s)} x2={x(c + 8)} y1={y(fit(s))} y2={y(fit(c + 8))} stroke={ours} strokeWidth={2} strokeDasharray="7 4" />
        <path d={line(p)} fill="none" stroke={ink} strokeWidth={1.5} />
        <circle cx={x(c)} cy={y(p[c])} r={5} fill={ours} stroke="var(--card)" strokeWidth={2} />
        <line x1={x(c)} x2={x(cEnd)} y1={y(p[c] - 10)} y2={y(p[c] - 10)} stroke={stop} strokeWidth={2} strokeDasharray="6 4" />
        <Badge at={[x(c) + 4, y(p[c]) - 28]} n={1} />
        <Badge at={[x(s) + 6, y(fit(s)) + 26]} n={2} />
        <Badge at={[x(30), y(p[30]) - 26]} n={3} />
        <Badge at={[x(c) + 34, y(p[c] - 10) + 18]} n={4} />
      </Svg>
    ),
    notes: [
      "The first close above the 200 day average (grey).",
      "The straight line fitted to that average over 100 days (dashed blue) is flat or rising.",
      "The last 100 closes have climbed steadily, not in wild jumps.",
      "Bought at the next open, safety stop four average daily ranges under the signal close, out at the stop or after 60 sessions.",
    ],
    legend: ["Price", "200 day average", "Fitted line", "Safety stop"],
  };
}

export function RuleDiagram({ rule, caption }: { rule: RuleKey; caption: string }) {
  const scene = rule === "sma" ? smaScene() : rule === "rsi" ? dipScene("rsi") : rule === "kk" ? dipScene("kk") : rule === "strong" ? strongScene() : ma200Scene();
  return (
    <figure className="my-8 overflow-hidden rounded-xl border border-border bg-card">
      <div className="p-2 md:p-3">{scene.svg}</div>
      <div className="border-t border-border px-4 py-3 md:px-5">
        <ol className="grid gap-2 text-[13.5px] leading-6 text-foreground md:grid-cols-2">
          {scene.notes.map((n, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="num mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-series-ours text-[11px] font-bold text-card">
                {i + 1}
              </span>
              <span>{n}</span>
            </li>
          ))}
        </ol>
        <figcaption className="mt-3 text-[12.5px] leading-5 text-muted-foreground">{caption} An illustration with made up prices, not a real stock.</figcaption>
      </div>
    </figure>
  );
}
