import { Bone, SkeletonHeader, SkeletonPage, SkeletonPanel } from "@/components/ui/skeleton";

/** Dry Run: the practice amount, then the stocks you can pick from. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading Dry Run">
      <SkeletonHeader lines={2} />
      <SkeletonPanel title={false}>
        <div className="flex flex-wrap items-end gap-3">
          <Bone className="h-10 w-full bg-foreground/[0.05] sm:w-56" />
          <Bone className="h-10 w-full bg-foreground/[0.05] sm:w-40" />
          <Bone className="h-10 w-28 bg-foreground/[0.08]" />
        </div>
      </SkeletonPanel>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="panel flex flex-col gap-3 p-4">
            <Bone className="h-4 w-24 bg-foreground/[0.08]" />
            <Bone className="h-3 w-40 max-w-full bg-foreground/[0.05]" />
            <Bone className="h-3 w-28" />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
