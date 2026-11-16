import { Bone, SkeletonHeader, SkeletonPage, SkeletonPanel, SkeletonTable } from "@/components/ui/skeleton";

/** Market Radar: the list chips, then the add box and the table of stocks. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading Market Radar">
      <SkeletonHeader lines={2} />
      <div className="-mb-2 flex flex-wrap items-center gap-1.5">
        <Bone className="h-8 w-28 rounded-md" />
        <Bone className="h-8 w-24 rounded-md bg-foreground/[0.05]" />
      </div>
      <SkeletonPanel>
        <Bone className="mb-4 h-10 w-full max-w-xl bg-foreground/[0.05]" />
        <SkeletonTable rows={8} />
      </SkeletonPanel>
    </SkeletonPage>
  );
}
