import { Bone, SkeletonFields, SkeletonHeader, SkeletonPage, SkeletonPanel } from "@/components/ui/skeleton";

/** Settings: the row of sections, then the form for the one that is open. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading settings">
      <SkeletonHeader />
      <div className="-mt-2 flex h-[41px] items-center gap-7 overflow-hidden border-b border-border px-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <Bone key={i} className="h-3 w-16 shrink-0" />
        ))}
      </div>
      <SkeletonPanel>
        <SkeletonFields fields={3} />
      </SkeletonPanel>
    </SkeletonPage>
  );
}
