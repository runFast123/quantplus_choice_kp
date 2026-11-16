import { Bone, SkeletonBack, SkeletonHeader, SkeletonLines, SkeletonPage, SkeletonPanel } from "@/components/ui/skeleton";

/** Import your trades: the upload box, then the list of past imports. */
export default function Loading() {
  return (
    <SkeletonPage label="Loading the import page">
      <SkeletonBack />
      <SkeletonHeader lines={2} />
      <SkeletonPanel title={false}>
        <Bone className="h-40 w-full bg-foreground/[0.04]" />
      </SkeletonPanel>
      <SkeletonPanel>
        <SkeletonLines lines={2} />
      </SkeletonPanel>
    </SkeletonPage>
  );
}
