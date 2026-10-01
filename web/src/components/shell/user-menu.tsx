"use client";

import { SignOutIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { signOut } from "@/app/(auth)/actions";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

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
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="grid size-9 place-items-center rounded-full bg-primary text-[12px] font-semibold text-primary-foreground transition-opacity hover:opacity-90"
      >
        {initials || "QP"}
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 top-11 z-40 w-[240px] rounded-lg border border-border bg-popover p-1.5 shadow-pop">
          <div className="px-2.5 py-2">
            <p className="truncate text-[13px] font-medium">{name}</p>
            <p className="truncate text-[12px] text-muted-foreground">{email}</p>
          </div>
          <div className="my-1 h-px bg-border" />
          <Link role="menuitem" href="/app/settings" onClick={() => setOpen(false)} className="block rounded-md px-2.5 py-2 text-[13px] hover:bg-foreground/[0.06]">
            Settings
          </Link>
          <Link role="menuitem" href="/app/billing" onClick={() => setOpen(false)} className="block rounded-md px-2.5 py-2 text-[13px] hover:bg-foreground/[0.06]">
            Plan &amp; billing
          </Link>
          <form action={signOut}>
            <button role="menuitem" type="submit" className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-foreground/[0.06]">
              <SignOutIcon size={15} aria-hidden /> Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
