import { Bone, SkeletonFields } from "@/components/ui/skeleton";

/** Welcome: the short first-run form, in its narrow centred column. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-[620px] py-6" aria-busy="true" aria-label="Loading" role="status">
      <Bone className="h-3 w-20" />
      <Bone className="mt-3 h-11 w-80 max-w-full bg-foreground/[0.08]" />
      <Bone className="mt-4 h-3 w-full bg-foreground/[0.05]" />
      <Bone className="mt-3 h-3 w-2/3 bg-foreground/[0.05]" />
      <div className="panel mt-8 p-6">
        <SkeletonFields fields={2} className="max-w-none" />
      </div>
    </div>
  );
}
