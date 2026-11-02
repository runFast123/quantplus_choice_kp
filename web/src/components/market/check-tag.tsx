import { ThermometerColdIcon, TrendUpIcon } from "@phosphor-icons/react/ssr";
import { Badge } from "@/components/ui/data";
import { CHECK_TAG, type CheckRule } from "@/lib/signal-checks";

/** A signal check's tag (ADR-038): an icon and words, never colour alone; the title says what it means. */
export function CheckTag({ rule }: { rule: CheckRule }) {
  const tag = CHECK_TAG[rule];
  const Icon = rule === "rsi_dip" ? TrendUpIcon : ThermometerColdIcon;
  return (
    <span title={tag.title} data-check={rule}>
      <Badge tone="neutral">
        <Icon size={12} weight="bold" aria-hidden />
        {tag.label}
      </Badge>
    </span>
  );
}
