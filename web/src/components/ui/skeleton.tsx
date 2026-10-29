import clsx from "clsx";

/**
 * Loading placeholders shaped like the page that is coming, so nothing jumps when it arrives.
 * Static on purpose: no looping shimmer or pulse (MASTER.md motion rules).
 */
export function Bone({ className }: { className?: string }) {
  return <div className={clsx("rounded bg-foreground/[0.07]", className)} />;
}

export function SkeletonPage({ children, label = "Loading" }: { children: React.ReactNode; label?: string }) {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label={label} role="status">
      {children}
    </div>
  );
}

export function SkeletonHeader() {
  return (
    <div className="border-b border-border pb-5">
      <Bone className="h-3 w-32" />
      <Bone className="mt-3 h-9 w-72 max-w-full bg-foreground/[0.08]" />
    </div>
  );
}

export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="panel p-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-6 border-t border-border/60 py-3 first:border-0">
          <Bone className="h-3 w-24" />
          <Bone className="h-3 flex-1 bg-foreground/[0.05]" />
          <Bone className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTiles({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel p-4">
          <Bone className="h-3 w-20" />
          <Bone className="mt-3 h-6 w-28 bg-foreground/[0.08]" />
        </div>
      ))}
    </div>
  );
}

export function SkeletonCards({ count = 4 }: { count?: number }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="panel flex flex-col gap-3 p-4">
          <Bone className="h-3 w-24" />
          <Bone className="h-5 w-3/4 bg-foreground/[0.08]" />
          <Bone className="h-3 w-full bg-foreground/[0.05]" />
          <Bone className="h-3 w-5/6 bg-foreground/[0.05]" />
        </div>
      ))}
    </div>
  );
}
