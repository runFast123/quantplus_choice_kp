import Link from "next/link";
import type { RetiredSymbol } from "@/lib/types";

/** "No longer trades" with links to whatever replaced the symbol. */
export function RetiredNote({ r, className }: { r: RetiredSymbol; className?: string }) {
  return (
    <span className={className ?? "mt-1 block max-w-[320px] text-[11.5px] leading-4 text-muted-foreground"}>
      No longer trades
      {r.successors.length ? (
        <>
          {" — see "}
          {r.successors.map((s, i) => (
            <span key={s}>
              {i ? ", " : ""}
              <Link href={`/app/markets/${encodeURIComponent(s)}`} className="num text-foreground underline underline-offset-2">
                {s}
              </Link>
            </span>
          ))}
        </>
      ) : null}
      .
    </span>
  );
}
