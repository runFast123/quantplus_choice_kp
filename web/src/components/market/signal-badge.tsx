import { Badge } from "@/components/ui/data";
import { strategyLabel } from "@/lib/format";
import { ruleOf } from "@/lib/rules";
import { ruleSentence } from "@/lib/signal-trade";

/** A stock's latest signal in a list: BUY / EXIT and which rule said so (its sentence on hover). */
export function SignalBadge({ signal, strategy }: { signal: "buy" | "exit"; strategy: string | null | undefined }) {
  const name = ruleOf(strategy)?.name ?? (strategy ? strategyLabel[strategy] : undefined);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={strategy ? ruleSentence(strategy, signal) || name : undefined}>
      <Badge tone={signal === "buy" ? "gain" : "loss"}>{signal === "buy" ? "BUY" : "EXIT"}</Badge>
      {name ? <span className="text-[11.5px] text-muted-foreground">{name}</span> : null}
    </span>
  );
}
