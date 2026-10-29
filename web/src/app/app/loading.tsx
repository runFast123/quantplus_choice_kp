import { SkeletonHeader, SkeletonPage, SkeletonRows } from "@/components/ui/skeleton";

/** Default for every /app page without its own: a page header and a table. */
export default function Loading() {
  return (
    <SkeletonPage>
      <SkeletonHeader />
      <SkeletonRows />
    </SkeletonPage>
  );
}
