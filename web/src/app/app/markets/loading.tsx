import { Bone, SkeletonHeader, SkeletonPage, SkeletonPanel, SkeletonTable } from "@/components/ui/skeleton";

/** Markets: the sector chips, the filters, then the table of stocks. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading markets">
      <SkeletonHeader lines={2} />
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card/60 p-3">
        <Bone className="h-3 w-16" />
        <div className="flex flex-wrap gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <Bone key={i} className="h-7 w-24 rounded-md bg-foreground/[0.05]" />
          ))}
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex flex-col gap-1">
            <div className="flex h-4 items-center">
              <Bone className="h-2.5 w-16" />
            </div>
            <Bone className="h-9 w-[150px] bg-foreground/[0.05]" />
          </div>
        ))}
      </div>
      <SkeletonPanel>
        <SkeletonTable rows={12} />
      </SkeletonPanel>
    </SkeletonPage>
  );
}
