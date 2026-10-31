import type { Metadata } from "next";
import Link from "next/link";
import {
  BrowserIcon,
  CheckCircleIcon,
  CodeIcon,
  DownloadSimpleIcon,
  FileCsvIcon,
  LockIcon,
  SparkleIcon,
} from "@phosphor-icons/react/ssr";
import { ConfirmButton } from "@/components/ui/confirm-button";
import { Badge } from "@/components/ui/data";
import { ButtonLink } from "@/components/ui/button";
import { Empty, PageHeader, Panel, PlanGate } from "@/components/ui/layout";
import { relative } from "@/lib/format";
import { can, requireSession } from "@/server/session";
import { deleteAiKey } from "./actions";
import { AiKeyForm } from "./forms";
import { PineScriptGeneratorPanel } from "@/components/market/pine-script-generator-panel";

export const metadata: Metadata = { title: "Integrations & Extensions" };

// Keep in step with extension/manifest.json when the zip in public/downloads is rebuilt.
const EXTENSION_VERSION = "1.2.2";

export default async function IntegrationsPage() {
  const s = await requireSession();
  const db = s.supabase;
  const [keysRes, consentsRes] = await Promise.all([
    db.from("ai_provider_keys").select("id, provider, label, key_last4, default_model, status, last_used_at, created_at").order("created_at"),
    db.from("user_consents").select("purpose").is("withdrawn_at", null),
  ]);
  const consents = new Set((consentsRes.data ?? []).map((c) => c.purpose));

  return (
    <div className="flex flex-col gap-8 max-w-4xl">
      <PageHeader
        eyebrow="Connections"
        title="Integrations & Extensions"
        description="See QuantsPulse signals on your broker's chart, add our rules to TradingView, bring in holdings from your broker, or add your own AI key."
      />

      {/* 1. Chrome extension */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <BrowserIcon size={20} className="text-coral-ink" aria-hidden />
          <h2 className="display text-[22px]">Chrome extension</h2>
        </div>
        <Panel title="Signals on your broker's chart">
          <div className="flex flex-col gap-5 text-[13.5px]">
            <p className="leading-6 text-muted-foreground">
              The extension spots which stock or index you have open on your broker or TradingView and shows its latest signal, stop and targets in a small bar on the chart, with more detail in a side panel.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card/60 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground text-[14px]">QuantsPulse for Chrome</span>
                  <Badge>Version {EXTENSION_VERSION}</Badge>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Works on TradingView and 20+ Indian broker sites
                </p>
              </div>
              <a
                href="/downloads/quantspulse-terminal.zip"
                download="quantspulse-terminal.zip"
                className="inline-flex items-center gap-2 rounded-md bg-foreground px-4 py-2 text-[13px] font-medium text-background transition-opacity hover:opacity-90"
              >
                <DownloadSimpleIcon size={16} weight="bold" aria-hidden />
                Download Extension (.zip)
              </a>
            </div>

            <div className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircleIcon size={18} className="text-gain shrink-0" aria-hidden />
                  <span className="text-[13px] font-medium text-foreground">Signed in</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground text-[11.5px] min-w-0 max-w-full">
                  <LockIcon size={13} className="shrink-0" aria-hidden />
                  <span className="num truncate">{s.email}</span>
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
                The extension uses this sign-in, so there is nothing else to set up. If you sign out here, it stops showing signals until you sign in again.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-background p-3.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:shadow-sm">
                <p className="eyebrow text-[11px]">On the chart</p>
                <p className="mt-1 text-[13px] font-medium text-foreground">Signal, stop and targets</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  The last signal&apos;s price, its stop-loss and its price targets, from the latest end-of-day close.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:shadow-sm">
                <p className="eyebrow text-[11px]">Your broker</p>
                <p className="mt-1 text-[13px] font-medium text-foreground">Finds the stock for you</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan, Fyers, Kotak Neo, TradingView and more.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:shadow-sm">
                <p className="eyebrow text-[11px]">Side panel</p>
                <p className="mt-1 text-[13px] font-medium text-foreground">More detail, same tab</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  The signal explained, the 52-week range and a one-click TradingView script, without leaving your broker.
                </p>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-card/60 p-4">
              <p className="eyebrow text-[11px]">How to install the extension (2 minutes)</p>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-[12.5px] leading-relaxed text-muted-foreground">
                <li>
                  Click <strong>&ldquo;Download Extension (.zip)&rdquo;</strong> above and extract the downloaded ZIP file to a folder on your computer (e.g. into your Documents or Tools folder).
                </li>
                <li>
                  Open Google Chrome and navigate to <code className="rounded bg-background px-1 py-0.5 font-mono text-foreground">chrome://extensions</code>.
                </li>
                <li>
                  Toggle on <strong>&ldquo;Developer mode&rdquo;</strong> in the top-right corner.
                </li>
                <li>
                  Click <strong>&ldquo;Load unpacked&rdquo;</strong> in the top-left corner and select the folder you just extracted.
                </li>
                <li>
                  Open a chart on your broker or TradingView. While you&apos;re signed in here, the signal bar appears on the chart.
                </li>
              </ol>
            </div>
          </div>
        </Panel>
      </section>

      {/* 2. TradingView Indicator Integration */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <CodeIcon size={20} className="text-coral-ink" aria-hidden />
          <h2 className="display text-[22px]">TradingView indicator</h2>
        </div>
        <Panel title="Our signal rules as a TradingView script (Pine v5)">
          <PineScriptGeneratorPanel initialSymbol="NIFTY" />
        </Panel>
      </section>

      {/* 3. Multi-Broker Portfolio Import */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <FileCsvIcon size={20} className="text-coral-ink" aria-hidden />
          <h2 className="display text-[22px]">Broker Portfolio Import</h2>
        </div>
        <Panel title="Import your holdings">
          <div className="flex flex-col gap-4 text-[13.5px]">
            <p className="leading-6 text-muted-foreground">
              Download your holdings file from your broker and upload it on the Portfolio page. We tidy up the stock codes for you and value everything at the last market close.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded border border-border bg-background px-2.5 py-1 text-[12px] font-medium">Zerodha Console (.csv)</span>
              <span className="rounded border border-border bg-background px-2.5 py-1 text-[12px] font-medium">Groww (.csv)</span>
              <span className="rounded border border-border bg-background px-2.5 py-1 text-[12px] font-medium">Angel One (.csv)</span>
              <span className="rounded border border-border bg-background px-2.5 py-1 text-[12px] font-medium">ICICI Direct (.csv)</span>
              <span className="rounded border border-border bg-background px-2.5 py-1 text-[12px] font-medium">Upstox (.csv)</span>
            </div>
            <div className="pt-2">
              <ButtonLink href="/app/portfolio" size="sm" variant="secondary">
                Go to Portfolio &amp; Import Holdings
              </ButtonLink>
            </div>
          </div>
        </Panel>
      </section>

      {/* 4. AI Keys (BYOK) */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <SparkleIcon size={20} className="text-coral-ink" aria-hidden />
          <h2 className="display text-[22px]">Your own AI key</h2>
        </div>
        {!can(s, "ai_byok") ? (
          <PlanGate feature="Bring-your-own AI keys" />
        ) : (
          <>
            <Panel title="Your keys">
              {(keysRes.data ?? []).length === 0 ? (
                <Empty title="No keys yet.">
                  Add an Anthropic, OpenAI, or Gemini key. Keys are encrypted at rest with AES-256-GCM and never logged.
                </Empty>
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
            <Panel title="Add an AI key">
              {consents.has("ai_processing") ? <AiKeyForm /> : <ConsentNeeded purpose="AI processing" />}
            </Panel>
          </>
        )}
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
      first — you can withdraw it any time, and doing so deletes your keys.
    </p>
  );
}
