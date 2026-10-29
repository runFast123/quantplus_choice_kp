import { SkeletonCards, SkeletonHeader, SkeletonPage } from "@/components/ui/skeleton";

/** News: headline cards. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading news">
      <SkeletonHeader />
      <SkeletonCards count={6} />
    </SkeletonPage>
  );
}
