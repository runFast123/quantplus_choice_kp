import { SkeletonHeader, SkeletonPage, SkeletonRows, SkeletonTiles } from "@/components/ui/skeleton";

/** Portfolio: value tiles, then holdings. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading portfolio">
      <SkeletonHeader />
      <SkeletonTiles />
      <SkeletonRows rows={6} />
    </SkeletonPage>
  );
}
