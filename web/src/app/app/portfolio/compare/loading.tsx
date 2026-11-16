import { Bone, SkeletonBack, SkeletonHeader, SkeletonLines, SkeletonPage, SkeletonPanel, SkeletonTable } from "@/components/ui/skeleton";

/** Your trades next to the rules: the summary, the table by rule, the filters, then the matches. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading the comparison">
      <SkeletonBack />
      <SkeletonHeader lines={2} />
      <div className="panel p-4">
        <SkeletonLines lines={2} />
      </div>
      <SkeletonPanel>
        <SkeletonTable rows={4} />
      </SkeletonPanel>
      <div className="flex flex-wrap items-end gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Bone key={i} className="h-10 w-36 bg-foreground/[0.05]" />
        ))}
        <Bone className="h-10 w-20 bg-foreground/[0.08]" />
      </div>
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="panel p-4">
            <SkeletonLines lines={3} />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
