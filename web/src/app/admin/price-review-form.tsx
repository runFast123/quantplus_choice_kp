"use client";

import { FormMessage } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { useEchoAction } from "@/components/ui/use-echo-action";
import { reviewPriceAction } from "./actions";

/** Two verdicts on a day whose price looked wrong (ADR-053): the price was real (the rules use it), or it was bad
 *  (the rules keep using the close). A reviewed day can be put back to waiting. */
export function PriceReviewForm({
  symbol,
  exchange,
  day,
  status,
}: {
  symbol: string;
  exchange: string;
  day: string;
  status: "suspect" | "real" | "bad" | "market";
}) {
  const [state, action] = useEchoAction(reviewPriceAction);
  return (
    <form action={action} className="flex flex-col items-start gap-1.5" aria-label={`Review the price of ${symbol} on ${day}`}>
      <input type="hidden" name="symbol" value={symbol} />
      <input type="hidden" name="exchange" value={exchange} />
      <input type="hidden" name="day" value={day} />
      <div className="flex flex-wrap gap-1.5">
        {status === "suspect" ? (
          <>
            <SubmitButton name="status" value="bad" variant="secondary" size="sm" pendingLabel="Saving…">
              Bad price
            </SubmitButton>
            <SubmitButton name="status" value="real" variant="ghost" size="sm" pendingLabel="Saving…">
              Real price
            </SubmitButton>
          </>
        ) : (
          <SubmitButton name="status" value="suspect" variant="ghost" size="sm" pendingLabel="Saving…">
            Undo review
          </SubmitButton>
        )}
      </div>
      <FormMessage state={state} />
    </form>
  );
}
