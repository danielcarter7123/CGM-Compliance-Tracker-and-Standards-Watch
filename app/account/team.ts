"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getViewer } from "@/lib/auth";
import { sendMail } from "@/lib/mail";
import { siteUrl } from "@/lib/stripe";
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

const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENT[c]);

export async function inviteColleague(formData: FormData) {
  const v = await companyAdmin();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = formData.get("company_role") === "admin" ? "admin" : "member";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) back("error=" + encodeURIComponent("Enter a valid email address."));
  const { error } = await createClient().from("invites").insert({ company_id: v.company.id, email, company_role: role });
  if (error) fail(error);

  const link = `${siteUrl()}/login?next=/workspace`; // the sign-in callback shows new joiners the welcome screen first
  const who = v.fullName || v.email || "A colleague";
  const company = v.company.name;
  let sent = false;
  try {
    sent = await sendMail({
      to: email,
      subject: `${who} invited you to ${company} on CGM Workspace`,
      text:
        `${who} invited you to join ${company} on CGM Workspace from CGM Consulting Group.\n\n` +
        `Sign in with this email address (${email}) at:\n${link}\n\n` +
        `There's no password: we email you a one-time sign-in link. The invite expires in 14 days.`,
      html: `<div style="font:15px/1.5 Arial,sans-serif;color:#0D1B2E;max-width:520px">
  <p><b>${esc(who)}</b> invited you to join <b>${esc(company)}</b> on CGM Workspace from CGM Consulting Group.</p>
  <p>Sign in with this email address (${esc(email)}). There's no password: we email you a one-time sign-in link.</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#1747D1;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600">Sign in to accept</a></p>
  <p style="color:#55657A;font-size:13px">The invite expires in 14 days.</p></div>`,
    });
  } catch {
    sent = false;
  }
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
