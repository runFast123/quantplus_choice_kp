// Version of the text each consent refers to. Bump when the wording changes;
// existing grants keep the version they were given under.
export const CONSENT_VERSION: Record<string, string> = {
  terms: "2026-10-01",
  privacy_policy: "2026-10-01",
  broker_data_access: "2026-10-01",
  ai_processing: "2026-10-01",
  marketing: "2026-10-01",
};

export const CONSENT_COPY: Record<string, { title: string; body: string; required?: boolean }> = {
  terms: { title: "Terms of Service", body: "Required to use QuantsPulse.", required: true },
  privacy_policy: { title: "Privacy Policy", body: "How we handle your data. Required.", required: true },
  broker_data_access: {
    title: "Broker data access",
    body: "Read-only access to holdings at brokers you connect. Withdrawing disconnects every broker.",
  },
  ai_processing: {
    title: "AI processing",
    body: "Send prompts to the AI provider whose key you add. Withdrawing disables AI features. Prompts are never stored.",
  },
  marketing: { title: "Product notes by email", body: "Occasional product updates." },
};
