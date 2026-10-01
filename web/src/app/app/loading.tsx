/** Skeleton in the shape of a page header + table, so the layout doesn't jump. */
export default function Loading() {
  return (
    <div className="flex animate-pulse flex-col gap-6 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="border-b border-border pb-5">
        <div className="h-3 w-32 rounded bg-foreground/[0.07]" />
        <div className="mt-3 h-9 w-72 rounded bg-foreground/[0.08]" />
      </div>
      <div className="panel p-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 border-t border-border/60 py-3 first:border-0">
            <div className="h-3 w-24 rounded bg-foreground/[0.07]" />
            <div className="h-3 flex-1 rounded bg-foreground/[0.05]" />
            <div className="h-3 w-16 rounded bg-foreground/[0.07]" />
          </div>
        ))}
      </div>
    </div>
  );
}
