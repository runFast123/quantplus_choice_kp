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
        description="Overlay QuantsPulse quantitative signals directly onto your broker charts, export protected TradingView indicators, import broker portfolios, or bring your own AI keys."
      />

      {/* 1. Chrome Extension Terminal */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <BrowserIcon size={20} className="text-coral-ink" aria-hidden />
          <h2 className="display text-[22px]">Chrome Extension Terminal</h2>
        </div>
        <Panel title="On-Chart Signal HUD & Broker Side Panel">
          <div className="flex flex-col gap-5 text-[13.5px]">
            <p className="leading-6 text-muted-foreground">
              Run QuantsPulse directly inside your trading tabs. The extension automatically detects the active stock or index on your chart and renders an on-chart HUD bar and slide-over research panel with signals, targets, and sentiment audits.
            </p>

            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-card/60 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground text-[14px]">Terminal Package v1.0.0</span>
                  <Badge tone="gain" pulse>Production Ready</Badge>
                </div>
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Manifest V3 · 48 KB · Supports 23+ Indian brokers and TradingView
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
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircleIcon size={18} className="text-gain shrink-0" aria-hidden />
                  <span className="text-[13px] font-medium text-foreground">Active Account Authorized</span>
                </div>
                <div className="flex items-center gap-1.5 text-muted-foreground text-[11.5px]">
                  <LockIcon size={13} aria-hidden />
                  <span className="num">{s.email}</span>
                </div>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-muted-foreground">
                Your QuantsPulse session is securely authenticated. When you open broker charts in this browser, the extension automatically pairs with your account to deliver proprietary trend signals, 1.0R trailing stops, and sentiment audits. Non-members or logged-out users are locked out by server-side verification.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-background p-3.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:shadow-sm">
                <p className="eyebrow text-[11px]">On-Chart Signal HUD</p>
                <p className="mt-1 text-[13px] font-medium text-foreground">Live Signals &amp; Targets</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  Displays Entry, Stop Loss (1.0R), and Profit Targets (0.75R, 2.0R, 3.0R) directly on top of your broker chart.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:shadow-sm">
                <p className="eyebrow text-[11px]">23+ Indian Brokers</p>
                <p className="mt-1 text-[13px] font-medium text-foreground">Zero-Click Detection</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  Works on Choice FinX, Zerodha Kite, Groww, Angel One, Upstox, Dhan, Fyers, Kotak Neo, and TradingView.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-background p-3.5 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-muted-foreground/40 hover:shadow-sm">
                <p className="eyebrow text-[11px]">Side Panel Terminal</p>
                <p className="mt-1 text-[13px] font-medium text-foreground">Instant Research Depth</p>
                <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                  Full multi-factor breakdown, sentiment audit, 52-week position, and 1-click indicator setup without leaving your broker tab.
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
                  Open any broker chart (e.g. Choice FinX, Zerodha Kite, Groww, or TradingView) — your QuantsPulse session automatically connects and the signal HUD bar displays on your chart!
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
          <h2 className="display text-[22px]">TradingView Indicator Integration</h2>
        </div>
        <Panel title="Protected Alternating Signal Indicator (TradingView v5)">
          <PineScriptGeneratorPanel initialSymbol="NIFTY" />
        </Panel>
      </section>

      {/* 3. Multi-Broker Portfolio Import */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <FileCsvIcon size={20} className="text-coral-ink" aria-hidden />
          <h2 className="display text-[22px]">Broker Portfolio Import</h2>
        </div>
        <Panel title="1-Click Holdings Reconciliation">
          <div className="flex flex-col gap-4 text-[13.5px]">
            <p className="leading-6 text-muted-foreground">
              Import your existing equity holdings directly from your broker export files. We automatically strip exchange suffixes, clean tickers, and calculate your real-time portfolio P&amp;L against daily settled market closes.
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
          <h2 className="display text-[22px]">AI Provider Keys (BYOK)</h2>
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
