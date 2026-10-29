import { SkeletonCards, SkeletonHeader, SkeletonPage } from "@/components/ui/skeleton";

/** Research desk: note cards. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading research">
      <SkeletonHeader />
      <SkeletonCards count={6} />
    </SkeletonPage>
  );
}
