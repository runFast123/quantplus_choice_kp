"use client";

import { useEffect, useRef } from "react";
import { useEchoAction } from "@/components/ui/use-echo-action";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { saveAiKeyAction } from "./actions";

export function AiKeyForm() {
  const [state, action, , values] = useEchoAction(saveAiKeyAction);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) ref.current?.reset();
  }, [state]);
  return (
    <form ref={ref} action={action} className="flex flex-col gap-4" autoComplete="off">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Provider" htmlFor="provider">
          <Select id="provider" name="provider" defaultValue={values.provider ?? "anthropic"} key={values.provider ?? "anthropic"}>
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Label" htmlFor="label">
          <Input id="label" name="label" placeholder="default" maxLength={40} defaultValue={values.label} />
        </Field>
        <Field label="Default model" htmlFor="default_model">
          <Input id="default_model" name="default_model" placeholder="optional" maxLength={80} defaultValue={values.default_model} />
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
