import Link from "next/link";
import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react/ssr";

/** Prev / next for server-paginated tables. Keeps every other search param. */
export function Pager({
  path,
  params,
  page,
  pageSize,
  total,
}: {
  path: string;
  params: Record<string, string>;
  page: number;
  pageSize: number;
  total: number;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const href = (p: number) => {
    const next = new URLSearchParams(params);
    if (p > 1) next.set("page", String(p));
    else next.delete("page");
    const qs = next.toString();
    return qs ? `${path}?${qs}` : path;
  };
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const btn = "inline-flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-[12.5px] hover:border-foreground";
  return (
    <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3 text-[12.5px] text-muted-foreground">
      <span className="num">
        {from.toLocaleString("en-IN")}–{to.toLocaleString("en-IN")} of {total.toLocaleString("en-IN")}
      </span>
      <span className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={href(page - 1)} className={btn} rel="prev">
            <CaretLeftIcon size={13} aria-hidden /> Previous
          </Link>
        ) : null}
        <span className="num">
          Page {page} of {pages}
        </span>
        {page < pages ? (
          <Link href={href(page + 1)} className={btn} rel="next">
            Next <CaretRightIcon size={13} aria-hidden />
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

/** Parses ?page= into a 1-based page number within range. */
export function pageParam(raw: unknown): number {
  const n = Number(typeof raw === "string" ? raw : 1);
  return Number.isInteger(n) && n >= 1 && n <= 10000 ? n : 1;
}
