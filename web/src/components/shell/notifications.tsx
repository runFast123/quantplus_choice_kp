"use client";

import clsx from "clsx";
import { BellIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState, useTransition } from "react";
import { markNotificationsRead } from "@/app/app/shell-actions";
import { relative } from "@/lib/format";
import { supabaseBrowser } from "@/lib/supabase/client";
import type { NotificationRow } from "@/lib/types";

/** Bell with live updates over Supabase Realtime; RLS scopes what arrives. */
export function Notifications({ userId, initial }: { userId: string; initial: NotificationRow[] }) {
  // Server rows arrive as props on every navigation; realtime rows are kept
  // apart and merged, so neither overwrites the other.
  const [live, setLive] = useState<NotificationRow[]>([]);
  const [readAllAt, setReadAllAt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);

  const seen = new Set<string>();
  const items = [...live, ...initial]
    .filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)))
    .slice(0, 20)
    .map((n) => (readAllAt && !n.read_at && n.created_at <= readAllAt ? { ...n, read_at: readAllAt } : n));
  const unread = items.filter((n) => !n.read_at).length;

  useEffect(() => {
    const supabase = supabaseBrowser();
    const channel = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload: { new: NotificationRow }) => setLive((prev) => [payload.new, ...prev].slice(0, 20)),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      >
        <BellIcon size={18} aria-hidden />
        {unread ? <span className="absolute right-2 top-2 size-2 rounded-full bg-coral ring-2 ring-background" aria-hidden /> : null}
      </button>
      {open ? (
        <div role="dialog" aria-label="Notifications" className="absolute right-0 top-11 z-40 w-[340px] max-w-[calc(100vw-24px)] rounded-lg border border-border bg-popover shadow-pop">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="text-[13px] font-semibold">Notifications</p>
            {unread ? (
              <button
                type="button"
                onClick={() => {
                  setReadAllAt(new Date().toISOString());
                  start(() => markNotificationsRead());
                }}
                className="text-[12px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Mark all read
              </button>
            ) : null}
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              Nothing yet. Triggered alerts and exit signals land here.
            </p>
          ) : (
            <ul className="max-h-[360px] overflow-y-auto">
              {items.map((n) => (
                <li key={n.id} className={clsx("border-b border-border/70 px-4 py-3 last:border-0", !n.read_at && "bg-coral/[0.06]")}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-[13px] font-medium">{n.title}</p>
                    <span className="num shrink-0 text-[11px] text-muted-foreground">{relative(n.created_at)}</span>
                  </div>
                  {n.body ? <p className="mt-0.5 text-[12.5px] leading-5 text-muted-foreground">{n.body}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
