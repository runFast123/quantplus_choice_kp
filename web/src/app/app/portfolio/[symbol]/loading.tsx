import { SkeletonBack, SkeletonHeader, SkeletonPage, SkeletonPanel, SkeletonStats, SkeletonTable } from "@/components/ui/skeleton";

/** Your trades in one stock: five headline numbers, then every buy and sell. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading your trades">
      <SkeletonBack />
      <SkeletonHeader lines={1} />
      <SkeletonStats count={5} className="grid-cols-2 md:grid-cols-5" />
      <SkeletonPanel>
        <SkeletonTable rows={6} />
      </SkeletonPanel>
    </SkeletonPage>
  );
}
