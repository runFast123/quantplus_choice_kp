import clsx from "clsx";

/**
 * Loading placeholders shaped like the page that is coming, so nothing jumps when it arrives.
 * Static on purpose: no looping shimmer or pulse (MASTER.md motion rules).
 */
export function Bone({ className }: { className?: string }) {
  return <div className={clsx("rounded bg-foreground/[0.07]", className)} />;
}

export function SkeletonPage({
  children,
  label = "Loading",
  className = "gap-6",
}: {
  children: React.ReactNode;
  label?: string;
  /** The space between blocks; match the real page (most use gap-6, a few gap-5 or gap-8). */
  className?: string;
}) {
  return (
    <div className={clsx("flex flex-col", className)} aria-busy="true" aria-label={label} role="status">
      {children}
    </div>
  );
}

/** The page title block. `lines` is how many lines of description sit under the title (24 px each, like the real one). */
export function SkeletonHeader({ lines = 0 }: { lines?: number }) {
  return (
    <div className="border-b border-border pb-5">
      <Bone className="h-3 w-32" />
      <Bone className="mt-3 h-9 w-72 max-w-full bg-foreground/[0.08]" />
      {lines > 0 ? (
        <div className="mt-2 max-w-2xl">
          {Array.from({ length: lines }).map((_, i) => (
            <div key={i} className="flex h-6 items-center">
              <Bone className={clsx("h-3 bg-foreground/[0.05]", i === lines - 1 && lines > 1 ? "w-2/3" : "w-full")} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The small "back" link above a page title (13 px text, so about 20 px tall). */
export function SkeletonBack() {
  return (
    <div className="flex h-5 items-center">
      <Bone className="h-3 w-20" />
    </div>
  );
}

/** A card with the same title bar and padding as the real Panel (ui/layout.tsx), so the frame is already in place. */
export function SkeletonPanel({
  title = true,
  children,
  className,
  bodyClassName,
}: {
  title?: boolean;
  children?: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <div className={clsx("panel min-w-0", className)}>
      {title ? (
        <div className="flex h-[45px] items-center border-b border-border px-4">
          <Bone className="h-3 w-28" />
        </div>
      ) : null}
      <div className={clsx("p-4", bodyClassName)}>{children}</div>
    </div>
  );
}

/** Table-shaped lines with the real tables' heights: a 36 px heading line, then 40 px rows (th / td in ui/layout.tsx). */
export function SkeletonTable({ rows = 6 }: { rows?: number }) {
  return (
    <div>
      <div className="flex h-9 items-center gap-6">
        <Bone className="h-2.5 w-14" />
        <Bone className="h-2.5 w-20 bg-foreground/[0.05]" />
        <span className="flex-1" />
        <Bone className="h-2.5 w-10" />
        <Bone className="hidden h-2.5 w-10 sm:block" />
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex h-10 items-center gap-6 border-t border-border/80">
          <Bone className="h-3 w-20" />
          <Bone className="h-3 flex-1 bg-foreground/[0.05]" />
          <Bone className="h-3 w-14" />
          <Bone className="hidden h-3 w-14 sm:block" />
        </div>
      ))}
    </div>
  );
}

/** The strip of headline numbers at the top of a page: one card, a label, a number and a small line in each cell. */
export function SkeletonStats({ count = 4, className = "grid-cols-2 md:grid-cols-4" }: { count?: number; className?: string }) {
  return (
    <div className={clsx("panel grid", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex h-[102px] flex-col justify-between p-4">
          <Bone className="h-3 w-20" />
          <Bone className="h-6 w-24 max-w-full bg-foreground/[0.08]" />
          <Bone className="h-2.5 w-28 max-w-full bg-foreground/[0.05]" />
        </div>
      ))}
    </div>
  );
}

/** Form fields: a small label over a 40 px input, then the button. */
export function SkeletonFields({ fields = 3, className = "max-w-md" }: { fields?: number; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-4", className)}>
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="flex flex-col gap-1.5">
          <Bone className="h-3 w-24" />
          <Bone className="h-10 w-full bg-foreground/[0.05]" />
        </div>
      ))}
      <Bone className="h-10 w-28 bg-foreground/[0.08]" />
    </div>
  );
}

/** A few lines of text. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={clsx("flex flex-col gap-2.5", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Bone key={i} className={clsx("h-3 bg-foreground/[0.05]", i === lines - 1 ? "w-3/5" : "w-full")} />
      ))}
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
