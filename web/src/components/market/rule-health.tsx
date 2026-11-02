import { CheckCircleIcon, HourglassIcon, TrendUpIcon, WarningIcon } from "@phosphor-icons/react/ssr";
import clsx from "clsx";
import { Badge, Sparkline } from "@/components/ui/data";
import { date } from "@/lib/format";
import { CAUSE, HEALTH_STATUS, healthSentence, mistakeSentence, pos, type Cause, type HealthRow, type HealthStatus } from "@/lib/rule-health";

const ICON: Record<HealthStatus, typeof CheckCircleIcon> = {
  within: CheckCircleIcon,
  above: TrendUpIcon,
  below: WarningIcon,
  too_few: HourglassIcon,
};

/** The rule's status in a few words; the hover text explains it. */
export function HealthChip({ row, prefix }: { row: HealthRow | undefined; prefix?: string }) {
  if (!row) return null;
  const s = HEALTH_STATUS[row.status];
  const Icon = ICON[row.status];
  return (
    <span title={`${s.title} ${healthSentence(row)}`} data-health={row.status} className="inline-flex">
      <Badge tone={s.tone} className="gap-1">
        <Icon size={12} weight="bold" aria-hidden />
        {prefix ? `${prefix} ` : ""}
        {s.label}
      </Badge>
    </span>
  );
}

/**
 * How often the rule's recent trades made money, on a 0–100 track: the shaded band is the normal range for this many
 * trades, the tick is the tested rate and the dot is now.
 */
export function HealthTrack({ row }: { row: HealthRow }) {
  return (
    <span
      role="img"
      aria-label={`${Math.round(row.made_pct ?? 0)} in 100 made money; normal range ${Math.round(row.low_pct)} to ${Math.round(row.high_pct)}; tested ${Math.round(row.expected_pct)}`}
      className="relative block h-2 w-full rounded-full bg-foreground/[0.07]"
    >
      <span className="absolute inset-y-0 rounded-full bg-foreground/15" style={{ left: `${pos(row.low_pct)}%`, width: `${pos(row.high_pct) - pos(row.low_pct)}%` }} />
      <span className="absolute -inset-y-0.5 w-px bg-foreground/60" style={{ left: `${pos(row.expected_pct)}%` }} />
      {row.made_pct != null ? (
        <span
          className={clsx(
            "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card",
            row.status === "below" ? "bg-loss" : row.status === "above" ? "bg-gain" : "bg-foreground",
          )}
          style={{ left: `${pos(row.made_pct)}%` }}
        />
      ) : null}
    </span>
  );
}

/** One rule's health: status, the record against its tested range, the trend and what its losses had in common. */
export function RuleHealthCard({ title, row, history, label }: { title: string; row: HealthRow | undefined; history: number[]; label?: string }) {
  return (
    <section aria-label={`${title} health`} className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-semibold">{label ?? title}</p>
        <HealthChip row={row} />
      </div>
      {!row ? (
        <p className="text-[12px] text-muted-foreground">Not checked yet. The first check runs after the next close.</p>
      ) : (
        <>
          <div className="flex items-end justify-between gap-3">
            <p className="num text-[24px] font-semibold leading-none">
              {row.made}
              <span className="text-[14px] text-muted-foreground">/{row.trades}</span>
            </p>
            <Sparkline values={history} width={88} height={26} />
          </div>
          <div className="flex flex-col gap-1">
            <HealthTrack row={row} />
            <span className="num flex justify-between text-[10.5px] text-muted-foreground">
              <span>0</span>
              <span>tested {Math.round(row.expected_pct)}</span>
              <span>100</span>
            </span>
          </div>
          <p className="text-[12px] leading-5 text-muted-foreground">{healthSentence(row)}</p>
          <CauseBar causes={row.causes} />
          <p className="text-[12px] leading-5">{mistakeSentence(row)}</p>
          {row.first_exit && row.last_exit ? (
            <p className="mt-auto text-[11px] text-muted-foreground">
              Trades finished {date(row.first_exit)} – {date(row.last_exit)}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** The losing trades split by cause, with counts written out (never colour alone). */
export function CauseBar({ causes }: { causes: HealthRow["causes"] }) {
  const keys: Cause[] = ["market", "stock", "small"];
  const total = keys.reduce((a, k) => a + Number(causes?.[k] ?? 0), 0);
  if (!total) return null;
  const shade: Record<Cause, string> = { market: "bg-foreground/70", stock: "bg-foreground/40", small: "bg-foreground/15" };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
        {keys.map((k) =>
          Number(causes?.[k] ?? 0) ? <span key={k} className={shade[k]} style={{ width: `${(100 * Number(causes[k])) / total}%` }} /> : null,
        )}
      </span>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {keys.map((k) => (
          <li key={k} title={CAUSE[k].title} className="flex items-center gap-1">
            <span className={clsx("size-1.5 rounded-full", shade[k])} aria-hidden />
            {CAUSE[k].label} <span className="num text-foreground">{Number(causes?.[k] ?? 0)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
