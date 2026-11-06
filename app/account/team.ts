"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { sendInviteEmail } from "@/lib/invites";
import { createClient } from "@/lib/supabase/server";

// Team changes for company admins. Each one runs as the signed-in user; the database (0007_accounts.sql)
// decides whether they may, enforces seats, and refuses anything outside their own company.

function back(params: string): never {
  revalidatePath("/account");
  redirect(`/account?${params}#team`);
}
const fail = (e: { message: string }): never => back(`error=${encodeURIComponent(e.message)}`);

async function companyAdmin() {
  const v = await getViewer();
  if (!v) redirect("/login?next=/account");
  if (!v.company || v.companyRole !== "admin") back("error=" + encodeURIComponent("Only your company admin can manage the team."));
  return v as typeof v & { company: { id: string; name: string } };
}

export async function inviteColleague(formData: FormData) {
  const v = await companyAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = formData.get("company_role") === "admin" ? "admin" : "member";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back("error=" + encodeURIComponent("Enter a valid email address."));
  const { error } = await createClient().from("invites").insert({ company_id: v.company.id, email, company_role: role });
  if (error) fail(error);

  const sent = await sendInviteEmail(v.fullName || v.email || "A colleague", v.company.name, email);
  back(`team=${sent ? "invited" : "invited-nomail"}&who=${encodeURIComponent(email)}`);
}

export async function revokeInvite(formData: FormData) {
  await companyAdmin();
  const { error } = await createClient().rpc("revoke_invite", { invite_id: String(formData.get("id")) });
  if (error) fail(error);
  back("team=revoked");
}

export async function removeMember(formData: FormData) {
  await companyAdmin();
  const { error } = await createClient().rpc("remove_member", { member: String(formData.get("id")) });
  if (error) fail(error);
  back("team=removed");
}

export async function setMemberRole(formData: FormData) {
  const v = await companyAdmin();
  const id = String(formData.get("id"));
  if (id === v.userId) back("error=" + encodeURIComponent("You can't change your own role. Ask another admin at your company, or CGM."));
  const role = formData.get("company_role") === "admin" ? "admin" : "member";
  const { error } = await createClient().from("profiles").update({ company_role: role }).eq("id", id).eq("company_id", v.company.id);
  if (error) fail(error);
  back("team=role");
}
