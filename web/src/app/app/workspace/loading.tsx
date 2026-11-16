import { SkeletonHeader, SkeletonLines, SkeletonPage, SkeletonPanel, SkeletonTable } from "@/components/ui/skeleton";

/** Workspace: the members table, then two cards side by side. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading workspace">
      <SkeletonHeader lines={1} />
      <SkeletonPanel>
        <SkeletonTable rows={4} />
      </SkeletonPanel>
      <div className="grid gap-6 lg:grid-cols-2">
        <SkeletonPanel>
          <SkeletonLines lines={4} />
        </SkeletonPanel>
        <SkeletonPanel>
          <SkeletonLines lines={4} />
        </SkeletonPanel>
      </div>
    </SkeletonPage>
  );
}
