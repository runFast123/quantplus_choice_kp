"use client";

import { useActionState, useEffect, useRef } from "react";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { connectBrokerAction, saveAiKeyAction } from "./actions";

export const BROKERS = [
  { value: "choice", label: "Choice" },
  { value: "zerodha", label: "Zerodha" },
  { value: "angelone", label: "Angel One" },
  { value: "upstox", label: "Upstox" },
  { value: "dhan", label: "Dhan" },
  { value: "fyers", label: "Fyers" },
  { value: "other", label: "Other" },
];

export function BrokerForm() {
  const [state, action] = useActionState(connectBrokerAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-4" autoComplete="off">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Broker" htmlFor="broker">
          <Select id="broker" name="broker" defaultValue="choice">
            {BROKERS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Client ID" htmlFor="client_id" hint="We store only the last 4 characters.">
          <Input id="client_id" name="client_id" required className="num" />
        </Field>
      </div>
      <Field label="Access token" htmlFor="access_token" hint="From your broker's API console. Read-only scope. Most brokers expire it daily at 06:00 IST.">
        <Input id="access_token" name="access_token" type="password" required className="num" spellCheck={false} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-fit" pendingLabel="Encrypting…">
        Connect broker
      </SubmitButton>
    </form>
  );
}

export function AiKeyForm() {
  const [state, action] = useActionState(saveAiKeyAction, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-4" autoComplete="off">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Provider" htmlFor="provider">
          <Select id="provider" name="provider" defaultValue="anthropic">
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Label" htmlFor="label">
          <Input id="label" name="label" placeholder="default" maxLength={40} />
        </Field>
        <Field label="Default model" htmlFor="default_model">
          <Input id="default_model" name="default_model" placeholder="optional" maxLength={80} />
        </Field>
      </div>
      <Field label="API key" htmlFor="api_key" hint="Encrypted with AES-256-GCM before it reaches the database. Decrypted only at the moment of a call.">
        <Input id="api_key" name="api_key" type="password" required className="num" spellCheck={false} />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-fit" pendingLabel="Encrypting…">
        Save key
      </SubmitButton>
    </form>
  );
}
