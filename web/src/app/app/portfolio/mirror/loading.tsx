import { SkeletonBack, SkeletonHeader, SkeletonLines, SkeletonPage } from "@/components/ui/skeleton";

/** Your trading habits: the header, then four habit cards. */
export default function Loading() {
  return (
    <SkeletonPage label="Reading your trades">
      <SkeletonBack />
      <SkeletonHeader lines={2} />
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel p-4">
            <SkeletonLines lines={4} />
          </div>
        ))}
      </div>
    </SkeletonPage>
  );
}
