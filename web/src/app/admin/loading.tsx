import { Bone, SkeletonHeader, SkeletonPage, SkeletonPanel, SkeletonStats, SkeletonTable } from "@/components/ui/skeleton";

/** Opening the console from the app: its header, the tab bar, then the open tab's numbers and table (page.tsx streams it). */
export default function Loading() {
  return (
    <div className="linen min-h-dvh">
      <div className="h-[56px] border-b border-border" />
      <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-6">
        <SkeletonPage label="Loading the admin console">
          <SkeletonHeader lines={1} />
          <div className="flex h-[38px] items-center gap-6 overflow-hidden border-b border-border">
            {Array.from({ length: 7 }).map((_, i) => (
              <Bone key={i} className="h-3 w-24 shrink-0" />
            ))}
          </div>
          <SkeletonStats count={4} className="grid-cols-2 md:grid-cols-4" />
          <SkeletonPanel>
            <SkeletonTable rows={6} />
          </SkeletonPanel>
        </SkeletonPage>
      </main>
    </div>
  );
}
