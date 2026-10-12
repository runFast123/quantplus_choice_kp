"use client";

import { useActionState, useState } from "react";
import { FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { activatePlanAction } from "./actions";

const PRICE: Record<string, number> = { basic: 0, pro: 10000, pro_plus: 15000 };

export function ActivateForm({ userId, tenantId, email }: { userId: string; tenantId: string; email: string }) {
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState("pro");
  const [months, setMonths] = useState(12);
  const [state, action] = useActionState(activatePlanAction, undefined);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] underline underline-offset-4 hover:text-foreground">
        Activate…
      </button>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-2 rounded-md border border-border bg-background/60 p-3" aria-label={`Activate plan for ${email}`}>
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="tenantId" value={tenantId} />

      {/* Quick Duration Presets */}
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="font-medium">Presets:</span>
        {[
          { label: "1 Mo", m: 1 },
          { label: "3 Mo", m: 3 },
          { label: "6 Mo", m: 6 },
          { label: "12 Mo", m: 12 },
        ].map((p) => (
          <button
            key={p.m}
            type="button"
            onClick={() => setMonths(p.m)}
            className={`rounded px-1.5 py-0.5 border text-[11px] transition-colors ${
              months === p.m
                ? "bg-foreground/10 border-foreground/30 text-foreground font-semibold"
                : "border-border hover:bg-foreground/5 text-muted-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[110px_80px_110px_120px_1fr]">
        <Select name="plan" aria-label="Plan" value={plan} onChange={(e) => setPlan(e.target.value)} className="h-8 text-[12.5px]">
          <option value="basic">Basic</option>
          <option value="pro">Pro</option>
          <option value="pro_plus">Pro Plus</option>
        </Select>
        <Input name="months" aria-label="Months" type="number" min={1} max={24} value={months} onChange={(e) => setMonths(Number(e.target.value))} className="num h-8 text-[12.5px]" />
        <Input
          name="amountRupees"
          aria-label="Amount in rupees"
          type="number"
          min={0}
          step="0.01"
          key={plan + months}
          defaultValue={Math.round((PRICE[plan] * months) / 12)}
          className="num h-8 text-[12.5px]"
        />
        <Select name="method" aria-label="Payment method" defaultValue="upi" className="h-8 text-[12.5px]">
          <option value="upi">UPI</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </Select>
        <Input name="reference" aria-label="UTR / reference" placeholder="UTR / ref" className="num h-8 text-[12.5px]" />
      </div>
      <FormMessage state={state} />
      <div className="flex gap-2">
        <SubmitButton size="sm" pendingLabel="Activating…">
          Record payment &amp; activate
        </SubmitButton>
        <button type="button" onClick={() => setOpen(false)} className="text-[12.5px] text-muted-foreground">
          Cancel
        </button>
      </div>
    </form>
  );
}
