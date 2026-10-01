"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SITE_URL } from "@/lib/env";
import { friendlyDbError, type ActionState } from "@/lib/errors";
import { changeMemberRole, createInvitation, createOrganization, switchTenant } from "@/server/privileged/tenants";
import { PrivilegedError } from "@/server/privileged/guards";
import { requireSession } from "@/server/session";

const fail = (e: unknown): ActionState => ({
  error: e instanceof PrivilegedError ? (e.message === "NOT_AUTHORIZED" ? "You don't have permission to do that." : e.message) : "Something went wrong.",
});

const orgSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters.").max(120),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{3,48}$/, "Use 3–48 lowercase letters, numbers or hyphens."),
});

export async function createOrgAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const parsed = orgSchema.safeParse({ name: form.get("name"), slug: form.get("slug") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  let tenantId: string;
  try {
    tenantId = await createOrganization(s.userId, parsed.data.name, parsed.data.slug);
    await switchTenant(s.userId, tenantId);
  } catch (e) {
    return fail(e);
  }
  await s.supabase.auth.refreshSession();
  revalidatePath("/app", "layout");
  redirect("/app/workspace");
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email.").transform((e) => e.toLowerCase().trim()),
  role: z.enum(["member", "admin"]),
});

export async function inviteAction(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  if (!s.activeTenantId) return { error: "No active workspace." };
  const parsed = inviteSchema.safeParse({ email: form.get("email"), role: form.get("role") });
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  try {
    const { token } = await createInvitation(s.userId, s.activeTenantId, parsed.data.email, parsed.data.role);
    revalidatePath("/app/workspace");
    // No transactional email provider is wired yet — hand the link to the inviter.
    return {
      ok: true,
      message: `Invitation created for ${parsed.data.email}. Send them this link — it works once and expires in 7 days.`,
      data: { link: `${SITE_URL}/invite/${token}` },
    };
  } catch (e) {
    return fail(e);
  }
}

export async function revokeInvitation(id: string) {
  const s = await requireSession();
  await s.supabase.from("tenant_invitations").delete().eq("id", id);
  revalidatePath("/app/workspace");
}

export async function changeRoleAction(userId: string, role: "member" | "admin"): Promise<ActionState> {
  const s = await requireSession();
  if (!s.activeTenantId) return { error: "No active workspace." };
  try {
    await changeMemberRole(s.userId, s.activeTenantId, userId, role);
  } catch (e) {
    return fail(e);
  }
  revalidatePath("/app/workspace");
  return { ok: true };
}

/** RLS policy members_remove_by_admin does the authorisation. */
export async function removeMember(userId: string) {
  const s = await requireSession();
  if (!s.activeTenantId) return;
  await s.supabase.from("tenant_members").delete().eq("tenant_id", s.activeTenantId).eq("user_id", userId);
  revalidatePath("/app/workspace");
}

/** RLS policy members_leave: any non-owner can leave. */
export async function leaveWorkspace() {
  const s = await requireSession();
  const tenantId = s.activeTenantId;
  const personal = s.memberships.find((m) => m.tenants.type === "personal");
  if (!tenantId || !personal || tenantId === personal.tenant_id) return;
  await s.supabase.from("tenant_members").delete().eq("tenant_id", tenantId).eq("user_id", s.userId);
  await switchTenant(s.userId, personal.tenant_id);
  await s.supabase.auth.refreshSession();
  revalidatePath("/app", "layout");
  redirect("/app");
}

export async function renameWorkspace(_: ActionState, form: FormData): Promise<ActionState> {
  const s = await requireSession();
  const name = String(form.get("name") ?? "").trim();
  if (name.length < 2 || name.length > 120) return { error: "Use 2–120 characters." };
  const { error } = await s.supabase.from("tenants").update({ name }).eq("id", s.activeTenantId!);
  if (error) return { error: friendlyDbError(error.message) };
  revalidatePath("/app", "layout");
  return { ok: true, message: "Saved." };
}
