import type { Metadata } from "next";
import Link from "next/link";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Badge } from "@/components/ui/data";
import { Empty, PageHeader, Panel, PlanGate } from "@/components/ui/layout";
import { dateTime, relative } from "@/lib/format";
import { can, requireSession } from "@/server/session";
import { deleteAiKey, disconnectBroker } from "./actions";
import { AiKeyForm, BROKERS, BrokerForm } from "./forms";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const s = await requireSession();
  const db = s.supabase;
  const [brokersRes, keysRes, consentsRes] = await Promise.all([
    db.from("broker_connections").select("id, broker, broker_account_masked, status, token_expires_at, last_synced_at, last_error, created_at").order("created_at"),
    db.from("ai_provider_keys").select("id, provider, label, key_last4, default_model, status, last_used_at, created_at").order("created_at"),
    db.from("user_consents").select("purpose").is("withdrawn_at", null),
  ]);
  const consents = new Set((consentsRes.data ?? []).map((c) => c.purpose));
  const brokerLabel = (b: string) => BROKERS.find((x) => x.value === b)?.label ?? b;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="Connections"
        title="Integrations"
        description="Secrets are encrypted on our servers with a key that never lives in the database. You'll only ever see a status and the last four characters."
      />

      <section className="grid gap-6 xl:grid-cols-2">
        <div className="flex flex-col gap-4">
          <h2 className="display text-[22px]">Brokers</h2>
          {!can(s, "broker_connect") ? (
            <PlanGate feature="Broker connections" />
          ) : (
            <>
              <Panel title="Connected">
                {(brokersRes.data ?? []).length === 0 ? (
                  <Empty title="No brokers connected." />
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {(brokersRes.data ?? []).map((b) => {
                      const expired = b.token_expires_at && new Date(b.token_expires_at) < new Date();
                      const status = expired && b.status === "connected" ? "expired" : b.status;
                      return (
                        <li key={b.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                          <div>
                            <p className="flex items-center gap-2 text-[14px] font-medium">
                              {brokerLabel(b.broker)}
                              <Badge tone={status === "connected" ? "gain" : status === "expired" ? "coral" : "loss"}>{status}</Badge>
                            </p>
                            <p className="num text-[12px] text-muted-foreground">
                              {b.broker_account_masked} · {status === "expired" ? "token expired — reconnect" : `token valid until ${dateTime(b.token_expires_at)}`}
                            </p>
                            <p className="text-[12px] text-muted-foreground">Last synced {relative(b.last_synced_at)}</p>
                          </div>
                          <ConfirmButton label={`Disconnect ${brokerLabel(b.broker)}`} confirmLabel="Disconnect" onConfirm={disconnectBroker.bind(null, b.id)}>
                            Disconnect
                          </ConfirmButton>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Panel>
              <Panel title="Connect a broker">
                {consents.has("broker_data_access") ? (
                  <BrokerForm />
                ) : (
                  <ConsentNeeded purpose="broker data access" />
                )}
              </Panel>
            </>
          )}
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="display text-[22px]">AI keys</h2>
          {!can(s, "ai_byok") ? (
            <PlanGate feature="Bring-your-own AI keys" />
          ) : (
            <>
              <Panel title="Your keys">
                {(keysRes.data ?? []).length === 0 ? (
                  <Empty title="No keys yet.">Your key, your provider, your bill. We meter calls but never store prompts or answers.</Empty>
                ) : (
                  <ul className="flex flex-col divide-y divide-border">
                    {(keysRes.data ?? []).map((k) => (
                      <li key={k.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div>
                          <p className="flex items-center gap-2 text-[14px] font-medium capitalize">
                            {k.provider}
                            <span className="text-[12px] font-normal normal-case text-muted-foreground">{k.label}</span>
                            <Badge tone={k.status === "active" ? "gain" : "loss"}>{k.status}</Badge>
                          </p>
                          <p className="num text-[12px] text-muted-foreground">
                            ••••{k.key_last4}
                            {k.default_model ? ` · ${k.default_model}` : ""} · last used {relative(k.last_used_at)}
                          </p>
                        </div>
                        <ConfirmButton label={`Delete ${k.provider} key`} confirmLabel="Delete" onConfirm={deleteAiKey.bind(null, k.id)}>
                          Delete
                        </ConfirmButton>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
              <Panel title="Add a key">{consents.has("ai_processing") ? <AiKeyForm /> : <ConsentNeeded purpose="AI processing" />}</Panel>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function ConsentNeeded({ purpose }: { purpose: string }) {
  return (
    <p className="text-[13px] leading-6 text-muted-foreground">
      You haven&apos;t allowed {purpose}. Turn it on in{" "}
      <Link href="/app/settings?tab=privacy" className="text-foreground underline underline-offset-4">
        Settings → Privacy
      </Link>{" "}
      first — you can withdraw it any time, and doing so removes the connection.
    </p>
  );
}
