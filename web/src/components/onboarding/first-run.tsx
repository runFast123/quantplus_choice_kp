"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { CheckCircleIcon, CircleIcon, XIcon } from "@phosphor-icons/react";

export interface FirstRunStep {
  key: string;
  label: string;
  detail: string;
  href: string;
  done: boolean;
}

// Hidden once dismissed in this browser (a per-viewer convenience, not account state).
const dismissKey = (userId: string) => `qp:first-run-dismissed:${userId}`;
const noop = () => () => {};

/**
 * First-run checklist on the overview: the few steps that make QuantsPulse useful. Hides itself
 * when every step is done or when dismissed. "Add the extension" is detected in the browser:
 * the extension's auth-sync script announces itself on QuantsPulse pages.
 */
export function FirstRun({ userId, steps }: { userId: string; steps: FirstRunStep[] }) {
  const storedDismissed = useSyncExternalStore(
    noop,
    () => {
      try {
        return localStorage.getItem(dismissKey(userId)) === "1";
      } catch {
        return false;
      }
    },
    () => true, // server render: hidden until the browser says otherwise
  );
  const [dismissed, setDismissed] = useState(false);
  const [extension, setExtension] = useState(false);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source === window && e.origin === window.location.origin && e.data?.type === "QP_EXTENSION_DISCOVERED") setExtension(true);
      if (e.source === window && e.origin === window.location.origin && e.data?.type === "QP_EXTENSION_SYNC_ACK") setExtension(true);
    };
    window.addEventListener("message", onMessage);
    window.postMessage({ type: "QP_REQUEST_AUTH_SYNC" }, window.location.origin);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const all: FirstRunStep[] = [
    ...steps,
    {
      key: "extension",
      label: "Add the Chrome extension",
      detail: "See the signal and plan beside your broker or TradingView chart.",
      href: "/api/extension/download",
      done: extension,
    },
  ];
  const done = all.filter((s) => s.done).length;
  if (storedDismissed || dismissed || done === all.length) return null;

  const hide = () => {
    try {
      localStorage.setItem(dismissKey(userId), "1");
    } catch {
      // Storage blocked: hidden for this visit only.
    }
    setDismissed(true);
  };

  return (
    <section aria-labelledby="first-run-title" className="panel animate-fade-in p-4" data-testid="first-run">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 id="first-run-title" className="text-[15px] font-semibold">Get set up</h2>
          <p className="text-[12.5px] text-muted-foreground">
            <span className="num">{done}</span> of <span className="num">{all.length}</span> done
          </p>
        </div>
        <button type="button" onClick={hide} className="rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Hide the setup checklist">
          <XIcon size={16} aria-hidden />
        </button>
      </div>
      <div className="mt-3 h-1 rounded-full bg-foreground/[0.08]" aria-hidden>
        <div className="bar-fill h-1 rounded-full bg-foreground" style={{ width: `${(done / all.length) * 100}%` }} />
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2">
        {all.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className="flex gap-3 rounded-md border border-border/70 p-3 transition-colors hover:border-foreground/40"
              aria-describedby={`first-run-${s.key}`}
              {...(s.key === "extension" ? { prefetch: false } : {})}
            >
              {s.done ? (
                <CheckCircleIcon size={20} weight="fill" className="mt-0.5 shrink-0 text-gain" aria-label="Done" />
              ) : (
                <CircleIcon size={20} className="mt-0.5 shrink-0 text-muted-foreground" aria-label="To do" />
              )}
              <span className="min-w-0">
                <span className={s.done ? "text-[13.5px] text-muted-foreground line-through" : "text-[13.5px] font-medium"}>{s.label}</span>
                <span id={`first-run-${s.key}`} className="block text-[12px] text-muted-foreground">
                  {s.detail}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
