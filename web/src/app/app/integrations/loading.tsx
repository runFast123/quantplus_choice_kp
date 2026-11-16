import { Bone, SkeletonHeader, SkeletonLines, SkeletonPage, SkeletonPanel } from "@/components/ui/skeleton";

/** Integrations: one titled card per connection. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading integrations" className="max-w-4xl gap-8">
      <SkeletonHeader lines={2} />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-3">
          <div className="flex h-[33px] items-center gap-2">
            <Bone className="size-5" />
            <Bone className="h-5 w-56 max-w-full bg-foreground/[0.08]" />
          </div>
          <SkeletonPanel>
            <SkeletonLines lines={4} />
          </SkeletonPanel>
        </div>
      ))}
    </SkeletonPage>
  );
}
