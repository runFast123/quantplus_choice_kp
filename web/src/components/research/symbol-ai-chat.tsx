"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ChatCircleTextIcon,
  CircleNotchIcon,
  PaperPlaneTiltIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { askSymbolAiChat } from "@/app/app/research/actions";

interface Message {
  role: "user" | "assistant";
  text: string;
  model?: string;
}

interface SymbolAiChatProps {
  symbol: string;
  ready: boolean;
  reason?: string;
}

const SUGGESTIONS = [
  "Summarize trend against 50 & 200 SMA",
  "Explain RSI & sentiment exhaustion node",
  "Key news catalysts from last 14 days",
  "Notable risk factors in research note",
];

export function SymbolAiChat({ symbol, ready, reason }: SymbolAiChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) {
    return (
      <p className="text-[12.5px] leading-5 text-muted-foreground">
        {reason}{" "}
        <Link
          href="/app/integrations"
          className="text-foreground underline underline-offset-4 hover:text-foreground/80"
        >
          Integrations
        </Link>
      </p>
    );
  }

  const handleSend = async (questionToSend?: string) => {
    const q = (questionToSend ?? input).trim();
    if (!q || loading) return;

    setError(null);
    setInput("");
    const userMsg: Message = { role: "user", text: q };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await askSymbolAiChat(symbol, q);
      if (res.error) {
        setError(res.error);
      } else if (res.reply) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", text: res.reply!, model: res.model },
        ]);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to query AI provider.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {/* Suggestions Pills */}
      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((sug) => (
            <button
              key={sug}
              type="button"
              disabled={loading}
              onClick={() => handleSend(sug)}
              className="rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-50 text-left"
            >
              {sug}
            </button>
          ))}
        </div>
      )}

      {/* Message History */}
      {messages.length > 0 && (
        <div className="flex flex-col gap-3 rounded-md border border-border bg-background/40 p-3 max-h-80 overflow-y-auto">
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={`flex flex-col ${
                m.role === "user" ? "items-end" : "items-start"
              }`}
            >
              <div
                className={`max-w-[88%] rounded-md px-3 py-2 text-[13px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-foreground text-background font-medium"
                    : "border border-border bg-card text-foreground whitespace-pre-line"
                }`}
              >
                {m.text}
              </div>
              {m.model && (
                <span className="num mt-1 text-[10.5px] text-muted-foreground">
                  {m.model} · BYOK
                </span>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <CircleNotchIcon size={14} className="animate-spin" aria-hidden />
              <span>Analyzing market facts…</span>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-loss/30 bg-loss-soft/30 p-2.5 text-[12px] text-loss">
          <WarningCircleIcon size={15} aria-hidden />
          <span>{error}</span>
        </div>
      )}

      {/* Input Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSend();
        }}
        className="flex items-center gap-2"
      >
        <div className="relative flex-1">
          <ChatCircleTextIcon
            size={16}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Ask your AI about ${symbol} (e.g. moving averages, RSI, filings)...`}
            className="h-9 w-full rounded-md border border-input bg-card pl-8 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground/60 focus:border-foreground focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-foreground px-3 text-[13px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {loading ? (
            <CircleNotchIcon size={14} className="animate-spin" />
          ) : (
            <PaperPlaneTiltIcon size={14} />
          )}
          <span className="hidden sm:inline">Ask</span>
        </button>
      </form>
    </div>
  );
}
