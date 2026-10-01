"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/field";

type Option = { value: string; label: string };

/** URL-driven filters: every view is linkable and survives refresh. */
export function FilterBar({ filters }: { filters: { name: string; label: string; options: Option[] }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();

  const set = (name: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(name, value);
    else next.delete(name);
    next.delete("page");
    start(() => router.replace(`${pathname}?${next.toString()}`, { scroll: false }));
  };

  return (
    <div className="flex flex-wrap items-end gap-3" aria-busy={pending}>
      {filters.map((f) => (
        <label key={f.name} className="flex flex-col gap-1">
          <span className="eyebrow">{f.label}</span>
          <Select className="h-9 w-auto min-w-[150px] text-[13px]" value={params.get(f.name) ?? ""} onChange={(e) => set(f.name, e.target.value)}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      ))}
      {[...params.keys()].some((k) => filters.some((f) => f.name === k)) ? (
        <button
          type="button"
          onClick={() => start(() => router.replace(pathname, { scroll: false }))}
          className="h-9 px-1 text-[12.5px] text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}
