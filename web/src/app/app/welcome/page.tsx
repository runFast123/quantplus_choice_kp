import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/safe-next";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { requireSession } from "@/server/session";
import { completeOnboarding } from "./actions";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage({ searchParams }: PageProps<"/app/welcome">) {
  const { next } = await searchParams;
  const s = await requireSession();
  const { data: consents } = await s.supabase.from("user_consents").select("purpose").is("withdrawn_at", null);
  if (consents?.some((c) => c.purpose === "terms")) redirect(safeNext(next));

  const { data: auth } = await s.supabase.auth.getUser();
  const meta = (auth.user?.user_metadata ?? {}) as { full_name?: string; marketing?: boolean };

  return (
    <div className="mx-auto max-w-[620px] py-6">
      <p className="eyebrow">Step 1 of 1</p>
      <h1 className="display mt-2 text-[40px] leading-[1.08]">
        Before we open <em>the desk</em>.
      </h1>
      <p className="mt-3 text-[15px] leading-7 text-muted-foreground">
        We record what you agree to — and when — so you can see and withdraw it later in Settings. Your holdings, watchlists and
        alerts are private to you, including from any organisation you join.
      </p>

      <form action={completeOnboarding} className="panel mt-8 flex flex-col gap-5 p-6">
        {typeof next === "string" ? <input type="hidden" name="next" value={next} /> : null}
        <Field label="What should we call you?" htmlFor="full_name">
          <Input id="full_name" name="full_name" defaultValue={s.profile?.full_name ?? meta.full_name ?? ""} required maxLength={120} />
        </Field>
        <Field label="Mobile (optional)" htmlFor="phone" hint="Only used for payment follow-ups. Include the country code, e.g. +919812345678.">
          <Input id="phone" name="phone" inputMode="tel" autoComplete="tel" pattern="\+?[0-9]{10,15}" placeholder="+91" />
        </Field>

        <fieldset className="flex flex-col gap-3 border-t border-border pt-5">
          <legend className="eyebrow mb-1">Consents</legend>
          <Consent name="terms" required title="Terms of Service and Privacy Policy" body="Required to use QuantsPulse." />
          <Consent
            name="ai_processing"
            title="AI processing with your own key"
            body="Lets us send your prompts to the AI provider whose key you add (Pro). We never store prompts or responses."
          />
          <Consent name="marketing" title="Product notes by email" body="Occasional. No tips, no hype." defaultChecked={meta.marketing} />
        </fieldset>

        <SubmitButton size="lg" pendingLabel="Saving…">
          Open my desk
        </SubmitButton>
      </form>
    </div>
  );
}

function Consent({
  name,
  title,
  body,
  required,
  defaultChecked,
}: {
  name: string;
  title: string;
  body: string;
  required?: boolean;
  defaultChecked?: boolean;
}) {
  return (
    <label className="flex items-start gap-3">
      <input type="checkbox" name={name} required={required} defaultChecked={defaultChecked || required} className="mt-1 size-4 accent-[var(--primary)]" />
      <span>
        <span className="block text-[14px] font-medium">
          {title}
          {required ? <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">required</span> : null}
        </span>
        <span className="block text-[13px] leading-5 text-muted-foreground">{body}</span>
      </span>
    </label>
  );
}
