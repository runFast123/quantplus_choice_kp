import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { SubmitButton } from "@/components/ui/submit-button";
import { acceptInvitation, previewInvitation, switchTenant } from "@/server/privileged/tenants";
import { PrivilegedError } from "@/server/privileged/guards";
import { getSession } from "@/server/session";

export const metadata: Metadata = { title: "Invitation" };

export default async function InvitePage({ params, searchParams }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const { error } = await searchParams;
  const invite = await previewInvitation(token);
  const session = await getSession();

  async function accept() {
    "use server";
    const s = await getSession();
    if (!s) redirect(`/login?next=/invite/${token}`);
    try {
      const tenantId = await acceptInvitation(s.userId, s.email, token);
      await switchTenant(s.userId, tenantId);
      await s.supabase.auth.refreshSession();
    } catch (e) {
      redirect(`/invite/${token}?error=${encodeURIComponent(e instanceof PrivilegedError ? e.message : "Couldn't accept the invitation.")}`);
    }
    redirect("/app/workspace");
  }

  const body = (() => {
    if (!invite || invite.expired || invite.accepted) {
      return (
        <>
          <h1 className="display text-[30px]">This invitation can&apos;t be used.</h1>
          <p className="mt-2 text-[14px] text-muted-foreground">It may have expired or already been accepted. Ask the person who invited you for a fresh link.</p>
        </>
      );
    }
    return (
      <>
        <p className="eyebrow">Invitation</p>
        <h1 className="display mt-2 text-[32px] leading-tight">
          Join <em>{invite.tenantName}</em> on QuantsPulse.
        </h1>
        <p className="mt-3 text-[14px] leading-6 text-muted-foreground">
          You&apos;ve been invited as {invite.role === "admin" ? "an admin" : "a member"}, at <span className="text-foreground">{invite.email}</span>. Admins
          there will see your name, email and plan — never your holdings, watchlists or keys.
        </p>
        {typeof error === "string" ? (
          <p role="alert" className="mt-4 rounded-md border border-loss/30 bg-loss-soft px-3 py-2 text-[13px] text-loss">
            {error}
          </p>
        ) : null}
        <div className="mt-6">
          {session ? (
            <form action={accept}>
              <SubmitButton size="lg" className="w-full" pendingLabel="Joining…">
                Accept and join
              </SubmitButton>
              {session.email.toLowerCase() !== invite.email ? (
                <p className="mt-2 text-[12px] text-muted-foreground">You&apos;re signed in as {session.email}. Sign in with {invite.email} to accept.</p>
              ) : null}
            </form>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <ButtonLink href={`/signup`} size="lg" className="flex-1">
                Create account
              </ButtonLink>
              <ButtonLink href={`/login?next=/invite/${token}`} size="lg" variant="secondary" className="flex-1">
                Sign in
              </ButtonLink>
            </div>
          )}
        </div>
      </>
    );
  })();

  return (
    <div className="linen grid min-h-dvh place-items-center px-5 py-10">
      <div className="w-full max-w-[460px]">
        <Logo />
        <div className="panel mt-8 p-7">{body}</div>
      </div>
    </div>
  );
}
