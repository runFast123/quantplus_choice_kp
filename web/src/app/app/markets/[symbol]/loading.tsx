import { Bone, SkeletonPage } from "@/components/ui/skeleton";

/** Stock page: name and price, the chart, then the panels under it. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading stock">
      <div className="border-b border-border pb-5">
        <Bone className="h-3 w-40" />
        <Bone className="mt-3 h-9 w-80 max-w-full bg-foreground/[0.08]" />
        <Bone className="mt-3 h-7 w-56" />
      </div>
      <div className="panel flex flex-col gap-3 p-4">
        <Bone className="h-6 w-full bg-foreground/[0.05]" />
        <Bone className="h-[420px] w-full bg-foreground/[0.04] md:h-[480px] lg:h-[520px]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel h-48 p-4">
          <Bone className="h-3 w-24" />
        </div>
        <div className="panel h-48 p-4">
          <Bone className="h-3 w-24" />
        </div>
      </div>
    </SkeletonPage>
  );
}
