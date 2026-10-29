import { Badge } from "@/components/ui/data";
import { setupsOf } from "@/lib/setups";

/** The setups a stock's latest close matched, as quiet badges; each badge's title states the rule. */
export function SetupBadges({ tags, className }: { tags: readonly string[] | null | undefined; className?: string }) {
  const list = setupsOf(tags);
  if (!list.length) return null;
  return (
    <span className={className ?? "flex flex-wrap gap-1"}>
      {list.map((s) => (
        <span key={s.key} title={`Matched a rule: ${s.rule}`}>
          <Badge tone="neutral">{s.label}</Badge>
        </span>
      ))}
    </span>
  );
}
