import { Bone, SkeletonHeader, SkeletonPage, SkeletonPanel, SkeletonTable } from "@/components/ui/skeleton";

/** Alerts: the new-alert form, then the table of levels being watched. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading alerts">
      <SkeletonHeader lines={2} />
      <SkeletonPanel>
        <div className="flex flex-wrap items-end gap-3">
          <Bone className="h-10 w-full bg-foreground/[0.05] sm:w-56" />
          <Bone className="h-10 w-full bg-foreground/[0.05] sm:w-40" />
          <Bone className="h-10 w-full bg-foreground/[0.05] sm:w-40" />
          <Bone className="h-10 w-28 bg-foreground/[0.08]" />
        </div>
      </SkeletonPanel>
      <SkeletonPanel>
        <SkeletonTable rows={5} />
      </SkeletonPanel>
    </SkeletonPage>
  );
}
