import { Bone, SkeletonHeader, SkeletonPage, SkeletonPanel, SkeletonStats, SkeletonTable } from "@/components/ui/skeleton";

/** Signals: the four numbers for today, the tabs, then fresh buys and what to watch next. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading signals" className="gap-5">
      <SkeletonHeader lines={2} />
      <SkeletonStats count={4} className="grid-cols-2 lg:grid-cols-4" />
      <div className="flex flex-col gap-4">
        <div className="flex h-[38px] items-center gap-7 overflow-hidden border-b border-border px-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Bone key={i} className="h-3 w-16 shrink-0" />
          ))}
        </div>
        <div className="flex flex-col gap-5">
          <SkeletonPanel>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-3 rounded-lg border border-border p-3">
                  <Bone className="h-4 w-24 bg-foreground/[0.08]" />
                  <Bone className="h-3 w-40 max-w-full bg-foreground/[0.05]" />
                  <Bone className="h-3 w-28" />
                </div>
              ))}
            </div>
          </SkeletonPanel>
          <SkeletonPanel>
            <SkeletonTable rows={4} />
          </SkeletonPanel>
        </div>
      </div>
    </SkeletonPage>
  );
}
