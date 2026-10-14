"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { ArrowClockwise, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { useEchoAction } from "@/components/ui/use-echo-action";
import { Field, FormMessage, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { fetchProviderModelsAction, saveAiKeyAction } from "./actions";

const PRESET_MODELS: Record<string, { id: string; label: string }[]> = {
  anthropic: [
    { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet (Latest recommended)" },
    { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet" },
    { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku (High speed)" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5 (Deep research)" },
    { id: "claude-3-opus-latest", label: "Claude 3 Opus" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o (Flagship recommended)" },
    { id: "gpt-4o-mini", label: "GPT-4o Mini (Fast & efficient)" },
    { id: "o3-mini", label: "o3-mini (High-speed reasoning)" },
    { id: "o1", label: "o1 (Deep reasoning)" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash (Fast recommended)" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro (Long context)" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
  ],
  other: [],
};

const PROVIDER_NAMES: Record<string, string> = {
  anthropic: "Anthropic",
  openai: "OpenAI",
  gemini: "Google Gemini",
  other: "Other Provider",
};

export function AiKeyForm() {
  const [state, action, , values] = useEchoAction(saveAiKeyAction);
  const ref = useRef<HTMLFormElement>(null);

  const [provider, setProvider] = useState<string>(values.provider ?? "anthropic");
  const [apiKey, setApiKey] = useState<string>("");
  const [models, setModels] = useState<{ id: string; label: string }[]>(PRESET_MODELS[provider] ?? []);
  const [selectedModel, setSelectedModel] = useState<string>(
    values.default_model || (PRESET_MODELS[provider]?.[0]?.id ?? "")
  );
  const [customModel, setCustomModel] = useState<string>("");
  const [hasFetchedLive, setHasFetchedLive] = useState<boolean>(false);
  const [detectStatus, setDetectStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [isDetecting, startDetecting] = useTransition();

  // Reset form upon successful save
  useEffect(() => {
    if (state?.ok) {
      ref.current?.reset();
    }
  }, [state]);

  function handleFormReset() {
    setApiKey("");
    setDetectStatus(null);
    setHasFetchedLive(false);
    setCustomModel("");
    setSelectedModel(PRESET_MODELS[provider]?.[0]?.id ?? "");
  }

  // Handle provider switch
  function handleProviderChange(newProvider: string) {
    setProvider(newProvider);
    setHasFetchedLive(false);
    setDetectStatus(null);

    const presets = PRESET_MODELS[newProvider] ?? [];
    setModels(presets);

    if (newProvider === "other") {
      setSelectedModel("__custom__");
    } else {
      setSelectedModel(presets[0]?.id ?? "");
    }
  }

  // Live model detector using user's entered API key
  function handleDetectModels() {
    const key = apiKey.trim();
    if (key.length < 12) {
      setDetectStatus({ type: "error", message: "Enter your full API key first to detect models." });
      return;
    }

    startDetecting(async () => {
      setDetectStatus(null);
      const res = await fetchProviderModelsAction(provider, key);
      if (res.ok && res.models && res.models.length > 0) {
        setModels(res.models);
        setHasFetchedLive(true);
        setSelectedModel(res.models[0].id);
        setDetectStatus({
          type: "success",
          message: `Key verified! Loaded ${res.models.length} active models from ${PROVIDER_NAMES[provider] ?? provider}.`,
        });
      } else {
        setDetectStatus({
          type: "error",
          message: res.error ?? "Failed to detect models. Check your key and try again.",
        });
      }
    });
  }

  const isCustom = selectedModel === "__custom__" || provider === "other";
  const finalModelValue = isCustom ? customModel.trim() : selectedModel;

  return (
    <form ref={ref} action={action} onReset={handleFormReset} className="flex flex-col gap-4" autoComplete="off">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Provider" htmlFor="provider">
          <Select
            id="provider"
            name="provider"
            value={provider}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            <option value="anthropic">Anthropic</option>
            <option value="openai">OpenAI</option>
            <option value="gemini">Google Gemini</option>
            <option value="other">Other</option>
          </Select>
        </Field>

        <Field label="Label" htmlFor="label">
          <Input id="label" name="label" placeholder="default" maxLength={40} defaultValue={values.label} />
        </Field>

        <Field
          label="Default model"
          htmlFor="model_select"
          hint={hasFetchedLive ? "Live models from your account" : "Recommended default models"}
        >
          {provider === "other" ? (
            <Input
              id="model_select"
              name="custom_model_input"
              placeholder="e.g. mistral-large-latest"
              maxLength={80}
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              autoComplete="off"
            />
          ) : (
            <Select
              id="model_select"
              name="model_select_picker"
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
            >
              <optgroup label={hasFetchedLive ? "Live account models" : "Recommended models"}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </optgroup>
              <option value="__custom__">Custom model ID…</option>
            </Select>
          )}
        </Field>
      </div>

      {/* Custom model input if user selected "Custom model ID..." on a standard provider */}
      {isCustom && provider !== "other" && (
        <Field
          label="Custom model identifier"
          htmlFor="custom_model_id"
          hint="Specify any fine-tuned or unlisted model identifier supported by your provider account."
        >
          <Input
            id="custom_model_id"
            placeholder="e.g. claude-3-5-sonnet-20241022 or ft:gpt-4o:my-org:custom"
            maxLength={80}
            value={customModel}
            onChange={(e) => setCustomModel(e.target.value)}
            autoComplete="off"
          />
        </Field>
      )}

      {/* Hidden input carrying the chosen model to the server action */}
      <input type="hidden" name="default_model" value={finalModelValue} />

      {/* API Key Input with Live Model Auto-Detection */}
      <div className="flex flex-col gap-2">
        <Field
          label="API key"
          htmlFor="api_key"
          hint="Encrypted with AES-256-GCM before it reaches the database. Decrypted only at the moment of a call."
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Input
                id="api_key"
                name="api_key"
                type="password"
                required
                className="num pr-8"
                spellCheck={false}
                autoComplete="new-password"
                data-lpignore="true"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (detectStatus) setDetectStatus(null);
                }}
              />
            </div>

            {provider !== "other" && (
              <button
                type="button"
                onClick={handleDetectModels}
                disabled={isDetecting || apiKey.trim().length < 12}
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-input bg-card px-3 text-[13px] font-medium text-foreground transition-all duration-200 hover:border-muted-foreground/60 hover:bg-muted-bg active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-50"
                title="Query the provider to verify this key and load your authorized models"
              >
                <ArrowClockwise size={14} className={isDetecting ? "animate-spin text-coral-ink" : ""} />
                <span>{isDetecting ? "Detecting models…" : "Auto-detect models"}</span>
              </button>
            )}
          </div>
        </Field>

        {/* Live Key Verification / Detection Status Badge */}
        {detectStatus && (
          <div
            className={`flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${
              detectStatus.type === "success"
                ? "border-gain/30 bg-gain-soft text-gain"
                : "border-loss/30 bg-loss-soft text-loss"
            }`}
          >
            {detectStatus.type === "success" ? (
              <CheckCircle size={16} className="mt-0.5 shrink-0" />
            ) : (
              <WarningCircle size={16} className="mt-0.5 shrink-0" />
            )}
            <span className="leading-5">{detectStatus.message}</span>
          </div>
        )}
      </div>

      <FormMessage state={state} />

      <SubmitButton className="w-fit" pendingLabel="Encrypting…">
        Save key
      </SubmitButton>
    </form>
  );
}
