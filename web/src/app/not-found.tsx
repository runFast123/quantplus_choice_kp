import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="linen grid min-h-dvh place-items-center px-5">
      <div className="max-w-md">
        <Logo />
        <p className="num mt-10 text-[13px] text-muted-foreground">404</p>
        <h1 className="display mt-2 text-[40px] leading-tight">No such page — or no such ticker.</h1>
        <p className="mt-3 text-[15px] text-muted-foreground">Check the symbol, or head back to somewhere familiar.</p>
        <div className="mt-6 flex gap-2">
          <ButtonLink href="/app">Overview</ButtonLink>
          <ButtonLink href="/app/markets" variant="secondary">
            Markets
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
