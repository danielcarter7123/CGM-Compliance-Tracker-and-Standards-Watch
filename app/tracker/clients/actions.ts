"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/guards";
import { MAPPED_ENTITIES, REGIONS, REGISTERED_FUNCTIONS } from "@/lib/functions";
import { createClient } from "@/lib/supabase/server";

// Client changes run as the signed-in CGM person, so row level security decides (0002):
// project managers and admins edit clients; any staff member edits contacts; only admins change products
// (Tracker, Client Tasks) or delete a client. These checks only give a clearer message first.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function back(params: string): never {
  revalidatePath("/tracker/clients");
  redirect(`/tracker/clients?${params}`);
}
const str = (f: FormData, k: string) => String(f.get(k) || "").trim();

type ContactKind = "compliance" | "pm" | "plant_manager";
const CONTACT_LABEL: Record<ContactKind, string> = { compliance: "contact", pm: "Project Manager", plant_manager: "Plant Manager" };

export async function saveClient(formData: FormData) {
  const v = await requireStaff("/tracker/clients");
  const id = str(formData, "id");
  const again = id ? `c=${id}` : "c=new";
  if (!v.canApprove) back(`${again}&error=${encodeURIComponent("Only CGM project managers and admins can edit clients.")}`);
  const db = createClient();

  const name = str(formData, "name");
  if (!name) back(`${again}&error=${encodeURIComponent("Enter the registered entity name.")}`);
  const region = str(formData, "region");
  const regDate = str(formData, "reg_date");
  const sharepoint = str(formData, "sharepoint_url");
  if (sharepoint && !/^https:\/\/\S+$/i.test(sharepoint)) back(`${again}&error=${encodeURIComponent("Paste the full SharePoint folder link, starting with https://")}`);
  if (regDate && !/^\d{4}-\d{2}-\d{2}$/.test(regDate)) back(`${again}&error=${encodeURIComponent("Enter the registration date as a date.")}`);

  const contacts = (["compliance", "pm", "plant_manager"] as ContactKind[]).map((kind) => ({
    kind,
    name: str(formData, `${kind}_name`),
    email: str(formData, `${kind}_email`).toLowerCase(),
    digest: formData.get(`${kind}_digest`) === "on",
  }));
  for (const c of contacts) {
    if (c.email && !EMAIL.test(c.email)) back(`${again}&error=${encodeURIComponent(`Enter a valid ${CONTACT_LABEL[c.kind]} email, or leave it blank.`)}`);
  }

  const row = {
    name: name.slice(0, 200),
    ncr_id: str(formData, "ncr_id") || null,
    region: (REGIONS as readonly string[]).includes(region) ? region : null,
    reg_date: regDate || null,
    functions: formData.getAll("functions").map(String).filter((f) => (REGISTERED_FUNCTIONS as readonly string[]).includes(f)),
    entities: Object.fromEntries(MAPPED_ENTITIES.map((e) => [e.k, str(formData, `ent_${e.k}`)])),
    facilities: str(formData, "facilities") || null,
    sharepoint_url: sharepoint || null,
    notes: str(formData, "notes") || null,
    pm_id: str(formData, "pm_id") || null,
  };

  let companyId = id;
  if (id) {
    const { error } = await db.from("companies").update(row).eq("id", id);
    if (error) back(`${again}&error=${encodeURIComponent(error.message)}`);
  } else {
    const { data, error } = await db.from("companies").insert(row).select("id").single();
    if (error || !data) back(`c=new&error=${encodeURIComponent(error?.message || "Couldn't add the client.")}`);
    companyId = data.id as string;
  }

  // One contact of each kind, as in the pilot. Blank name and email removes it.
  const { data: existing } = await db.from("contacts").select("id, kind").eq("company_id", companyId).in("kind", ["compliance", "pm", "plant_manager"]);
  for (const c of contacts) {
    const cur = (existing || []).find((e) => e.kind === c.kind);
    if (!c.name && !c.email) {
      if (cur) await db.from("contacts").delete().eq("id", cur.id);
      continue;
    }
    const fields = { name: c.name || c.email, email: c.email || null, digest: c.digest };
    const { error } = cur
      ? await db.from("contacts").update(fields).eq("id", cur.id)
      : await db.from("contacts").insert({ company_id: companyId, kind: c.kind, ...fields });
    if (error) back(`c=${companyId}&error=${encodeURIComponent(error.message)}`);
  }
  back(`c=${companyId}&ok=${encodeURIComponent(id ? `${name} saved.` : `${name} added. A CGM admin turns the Tracker on for it under Add-ons.`)}`);
}

/** Admin only: switch a client's CGM Workspace applications (writes entitlements). Each app is separate;
 *  Client Tasks needs the Tracker. Stripe-billed Standards Watch is changed in Stripe. */
export async function setClientProducts(formData: FormData) {
  const v = await requireStaff("/tracker/clients");
  const id = str(formData, "id");
  if (v.staffRole !== "admin") back(`c=${id}&error=${encodeURIComponent("Only CGM admins change a client's products.")}`);
  const db = createClient();
  const want = { watch: formData.get("watch") === "on", tracker: formData.get("tracker") === "on", client_tasks: formData.get("client_tasks") === "on", powerworks: formData.get("powerworks") === "on" };
  if (want.client_tasks && !want.tracker) back(`c=${id}&error=${encodeURIComponent("Client Tasks only works while the Tracker is on.")}`);
  const now = new Date().toISOString();
  for (const product of ["watch", "tracker", "client_tasks", "powerworks"] as const) {
    const { data: cur } = await db.from("entitlements").select("status, source").eq("company_id", id).eq("product", product).maybeSingle();
    const live = cur && (cur.status === "active" || cur.status === "trialing");
    if (want[product] && !live) {
      const { error } = await db.from("entitlements").upsert({ company_id: id, product, status: "active", source: "contract", updated_at: now }, { onConflict: "company_id,product" });
      if (error) back(`c=${id}&error=${encodeURIComponent(error.message)}`);
    } else if (!want[product] && live) {
      if (cur.source === "stripe") back(`c=${id}&error=${encodeURIComponent("CGM Standards Watch is billed through Stripe for this client. Cancel it in Stripe so billing stops too.")}`);
      const { error } = await db.from("entitlements").update({ status: "canceled", updated_at: now }).eq("company_id", id).eq("product", product);
      if (error) back(`c=${id}&error=${encodeURIComponent(error.message)}`);
    }
  }
  back(`c=${id}&ok=${encodeURIComponent("Products updated.")}`);
}

/** Admin only: delete a client and, with it, all of its tasks and client tasks (the activity log keeps the record). */
export async function deleteClient(formData: FormData) {
  const v = await requireStaff("/tracker/clients");
  const id = str(formData, "id");
  if (v.staffRole !== "admin") back(`c=${id}&error=${encodeURIComponent("Only CGM admins delete clients.")}`);
  if (formData.get("confirm") !== "on") back(`c=${id}&error=${encodeURIComponent("Tick the box to confirm. Deleting a client deletes all of its tasks.")}`);
  const { data, error } = await createClient().from("companies").delete().eq("id", id).select("name");
  if (error) back(`c=${id}&error=${encodeURIComponent(error.message)}`);
  if (!data?.length) back(`c=${id}&error=${encodeURIComponent("Nothing was deleted.")}`);
  back(`ok=${encodeURIComponent(`${data[0].name} and its tasks were deleted.`)}`);
}

/** Admin only: remove the sample clients the pilot ships with, and their tasks. */
export async function removeSamples() {
  const v = await requireStaff("/tracker/clients");
  if (v.staffRole !== "admin") back(`error=${encodeURIComponent("Only CGM admins remove sample clients.")}`);
  const { data, error } = await createClient().from("companies").delete().eq("sample", true).select("id");
  if (error) back(`error=${encodeURIComponent(error.message)}`);
  back(`ok=${encodeURIComponent(`Removed ${data?.length || 0} sample client${data?.length === 1 ? "" : "s"} and their tasks.`)}`);
}

// ---------- People: CGM invites and manages a client's users (T5) ----------
// Row level security (0007) allows CGM admins and project managers to invite into any company and to revoke or
// remove; seats are enforced by the database. Other staff can see the list but not change it.

export async function inviteToClient(formData: FormData) {
  const v = await requireStaff("/tracker/clients");
  const id = str(formData, "id");
  if (!v.canApprove) back(`c=${id}&error=${encodeURIComponent("Only CGM project managers and admins invite client users.")}#people`);
  const email = str(formData, "email").toLowerCase();
  const role = formData.get("company_role") === "admin" ? "admin" : "member";
  if (!EMAIL.test(email)) back(`c=${id}&error=${encodeURIComponent("Enter a valid email address.")}#people`);
  const db = createClient();
  const { error } = await db.from("invites").insert({ company_id: id, email, company_role: role });
  if (error) back(`c=${id}&error=${encodeURIComponent(error.message)}#people`);
  const { data: co } = await db.from("companies").select("name").eq("id", id).single();
  const { sendInviteEmail } = await import("@/lib/invites");
  const sent = await sendInviteEmail(v.fullName || "CGM Consulting Group", (co?.name as string) || "your company", email);
  back(`c=${id}&ok=${encodeURIComponent(sent ? `Invite sent to ${email}.` : `Invite created for ${email}, but the email couldn't be sent. Ask them to sign in with that address; they'll join automatically.`)}#people`);
}

export async function revokeClientInvite(formData: FormData) {
  await requireStaff("/tracker/clients");
  const id = str(formData, "id");
  const { error } = await createClient().rpc("revoke_invite", { invite_id: str(formData, "invite_id") });
  if (error) back(`c=${id}&error=${encodeURIComponent(error.message)}#people`);
  back(`c=${id}&ok=${encodeURIComponent("Invite revoked.")}#people`);
}

export async function removeClientMember(formData: FormData) {
  await requireStaff("/tracker/clients");
  const id = str(formData, "id");
  const { error } = await createClient().rpc("remove_member", { member: str(formData, "member") });
  if (error) back(`c=${id}&error=${encodeURIComponent(error.message)}#people`);
  back(`c=${id}&ok=${encodeURIComponent("Removed from this client. They can no longer see its information.")}#people`);
}
