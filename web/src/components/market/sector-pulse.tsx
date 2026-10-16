"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import clsx from "clsx";
import { SECTORS } from "@/lib/market";

export function SectorPulse() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const activeSector = params.get("sector") ?? "";

  const selectSector = (s: string) => {
    const next = new URLSearchParams(params);
    if (s && s !== activeSector) {
      next.set("sector", s);
    } else {
      next.delete("sector");
    }
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3" aria-busy={pending}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">Sector Rotation & Focus</span>
        {activeSector && (
          <button
            type="button"
            onClick={() => selectSector("")}
            className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Reset sector
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-[12px] no-scrollbar">
        <button
          type="button"
          onClick={() => selectSector("")}
          className={clsx(
            "shrink-0 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            !activeSector
              ? "bg-foreground text-background"
              : "border border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
          )}
        >
          All Sectors
        </button>

        {SECTORS.map((s) => {
          const isSelected = activeSector === s;
          return (
            <button
              key={s}
              type="button"
              onClick={() => selectSector(s)}
              className={clsx(
                "shrink-0 rounded px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                isSelected
                  ? "bg-foreground text-background"
                  : "border border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground",
              )}
            >
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}
