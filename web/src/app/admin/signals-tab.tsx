import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReactNode } from "react";
import { CheckTag } from "@/components/market/check-tag";
import { HealthChip } from "@/components/market/rule-health";
import { parseFilters } from "@/lib/admin-signals";
import { RULE_KEYS, type RuleKey } from "@/lib/rules";
import { loadSignalSessions } from "@/server/admin-signals";
import { getLatestRuleHealth } from "@/server/market-data";
import { SignalsExplorer } from "./signals-explorer";

/**
 * Admin → Signals after the close (ADR-063): loads the last ten sessions in one go (two round trips) and hands them to
 * the browser, which switches sessions and filters instantly (`SignalsExplorer`). Rule health chips and check tags are
 * drawn here (server icons) and passed in.
 */
export async function SignalsTab({ db, sp }: { db: SupabaseClient; sp: Record<string, string | string[] | undefined> }) {
  const [data, health] = await Promise.all([loadSignalSessions(db), getLatestRuleHealth(db)]);
  const day = typeof sp.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : null;
  const chips: Partial<Record<RuleKey, ReactNode>> = Object.fromEntries(
    RULE_KEYS.map((rule) => [rule, <HealthChip key={rule} row={health.get(rule)} prefix="Rule:" />]),
  );
  return (
    <SignalsExplorer
      data={data}
      initialDay={day}
      initialFilters={parseFilters(sp)}
      health={chips}
      checkTags={{ rsi_dip: <CheckTag rule="rsi_dip" />, strong_trend: <CheckTag rule="strong_trend" /> }}
    />
  );
}
