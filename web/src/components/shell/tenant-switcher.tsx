"use client";

import clsx from "clsx";
import { BuildingsIcon, CaretDownIcon, CheckIcon, PlusIcon, UserIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { switchTenantAction } from "@/app/app/shell-actions";
import type { Membership } from "@/lib/types";

export function TenantSwitcher({ memberships, activeTenantId }: { memberships: Membership[]; activeTenantId: string | null }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const active = memberships.find((m) => m.tenant_id === activeTenantId);

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

  const label = (m?: Membership) => (m ? (m.tenants.type === "personal" ? "Personal" : m.tenants.name) : "No workspace");

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={pending}
        className="flex h-9 max-w-[220px] items-center gap-2 rounded-md border border-border bg-card px-2.5 text-[13px] transition-colors hover:border-muted-foreground/40"
      >
        {active?.tenants.type === "organization" ? <BuildingsIcon size={15} aria-hidden /> : <UserIcon size={15} aria-hidden />}
        <span className="truncate">{pending ? "Switching…" : label(active)}</span>
        <CaretDownIcon size={12} className="shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 top-11 z-40 w-[260px] rounded-lg border border-border bg-popover p-1.5 shadow-pop">
          <p className="eyebrow px-2 pb-1 pt-1.5">Workspaces</p>
          {memberships.map((m) => {
            const isActive = m.tenant_id === activeTenantId;
            return (
              <button
                key={m.tenant_id}
                role="menuitemradio"
                aria-checked={isActive}
                type="button"
                onClick={() => {
                  setOpen(false);
                  if (!isActive) start(() => switchTenantAction(m.tenant_id));
                }}
                className={clsx(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-[13px] hover:bg-foreground/[0.06]",
                  isActive && "font-medium",
                )}
              >
                {m.tenants.type === "organization" ? <BuildingsIcon size={16} aria-hidden /> : <UserIcon size={16} aria-hidden />}
                <span className="flex-1 truncate">{label(m)}</span>
                <span className="text-[11px] capitalize text-muted-foreground">{m.role}</span>
                {isActive ? <CheckIcon size={14} aria-hidden /> : <span className="w-[14px]" />}
              </button>
            );
          })}
          <div className="my-1 h-px bg-border" />
          <Link
            href="/app/workspace#new"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 rounded-md px-2 py-2 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground"
          >
            <PlusIcon size={16} aria-hidden /> New organisation
          </Link>
        </div>
      ) : null}
    </div>
  );
}
