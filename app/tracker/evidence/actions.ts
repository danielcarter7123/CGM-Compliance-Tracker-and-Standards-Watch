"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EVIDENCE_MAX_BYTES, allowedType, isCip } from "@/lib/evidence";
import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";

// Evidence runs as the signed-in person. The database decides who may add, see and remove it (0005: it follows the
// task; the storage path must sit in the task's company folder; rows can't be edited, only soft-removed by whoever
// added them or by CGM staff). Every add and remove is in the activity log.

const str = (f: FormData, k: string) => String(f.get(k) || "").trim();
/** Where to go back to: a Tracker page only. */
const backTo = (f: FormData) => {
  const b = str(f, "back");
  return /^\/tracker\/(tasks|client-tasks)\?[^\s]*$/.test(b) ? b : "/tracker/tasks";
};
function back(f: FormData, kind: "ok" | "error", msg: string): never {
  revalidatePath("/tracker", "layout");
  const b = backTo(f).replace(/[?&](ok|error)=[^&]*/g, "");
  redirect(`${b}${b.includes("?") ? "&" : "?"}${kind}=${encodeURIComponent(msg)}`);
}

/** The task or client task the form refers to, read as the signed-in person (so only ones they can see). */
async function target(f: FormData) {
  const db = createClient();
  const task = str(f, "task_id"), ctask = str(f, "client_task_id");
  if (task) {
    const { data } = await db.from("tasks").select("id, company_id, standard_code").eq("id", task).maybeSingle();
    return data ? { col: "task_id" as const, id: data.id as string, company: data.company_id as string, folder: data.id as string, cip: isCip(data.standard_code as string) } : null;
  }
  if (ctask) {
    const { data } = await db.from("client_tasks").select("id, company_id").eq("id", ctask).maybeSingle();
    return data ? { col: "client_task_id" as const, id: data.id as string, company: data.company_id as string, folder: `ct-${data.id}`, cip: false } : null;
  }
  return null;
}

/** After the browser has put the file in the client's folder of the private "evidence" bucket: record it. */
export async function recordUpload(formData: FormData) {
  await requireTracker("/tracker/tasks");
  const t = await target(formData);
  if (!t) back(formData, "error", "That task wasn't found.");
  const path = str(formData, "path"), name = str(formData, "file_name"), size = Number(str(formData, "size_bytes"));
  if (!path.startsWith(`${t.company}/${t.folder}/`) || path.includes("..")) back(formData, "error", "The file wasn't stored in this task's folder.");
  if (!allowedType(name)) back(formData, "error", "That type of file isn't accepted.");
  if (!(size > 0) || size > EVIDENCE_MAX_BYTES) back(formData, "error", "Files can be up to 50 MB.");
  if (t.cip && formData.get("no_bcsi") !== "on") back(formData, "error", "Confirm the file contains no BES Cyber System Information, or paste a SharePoint link instead.");
  const db = createClient();
  // The object must really be there (the storage rules let this person see only their own client's folder).
  const dir = path.slice(0, path.lastIndexOf("/")), file = path.slice(path.lastIndexOf("/") + 1);
  const { data: found } = await db.storage.from("evidence").list(dir, { search: file, limit: 1 });
  if (!found?.some((o) => o.name === file)) back(formData, "error", "The upload didn't finish. Try again.");
  const sha = str(formData, "sha256");
  const { error } = await db.from("evidence").insert({
    company_id: t.company, [t.col]: t.id, kind: "file", storage_path: path, file_name: name.slice(0, 200), size_bytes: size,
    mime_type: str(formData, "mime_type").slice(0, 100) || null, sha256: /^[0-9a-f]{64}$/.test(sha) ? sha : null,
    title: str(formData, "title").slice(0, 200) || null,
  });
  if (error) back(formData, "error", error.message);
  back(formData, "ok", `Uploaded ${name}.`);
}

/** Paste a link (SharePoint, OneDrive or another system). */
export async function addEvidenceLink(formData: FormData) {
  await requireTracker("/tracker/tasks");
  const t = await target(formData);
  if (!t) back(formData, "error", "That task wasn't found.");
  const url = str(formData, "url");
  if (!/^https:\/\/\S+$/i.test(url) || url.length > 2000) back(formData, "error", "Links must start with https://");
  const { error } = await createClient().from("evidence").insert({
    company_id: t.company, [t.col]: t.id, kind: "link", url, title: str(formData, "title").slice(0, 200) || null,
  });
  if (error) back(formData, "error", error.message);
  back(formData, "ok", "Link added.");
}

/** Soft remove: the item stays on record (who removed it and when); the file isn't deleted. */
export async function removeEvidence(formData: FormData) {
  await requireTracker("/tracker/tasks");
  const { data, error } = await createClient().from("evidence").update({ removed_at: new Date().toISOString() }).eq("id", str(formData, "id")).is("removed_at", null).select("id");
  if (error) back(formData, "error", error.message);
  if (!data?.length) back(formData, "error", "You can remove evidence you added; CGM staff can remove any.");
  back(formData, "ok", "Removed. It stays on record as removed.");
}
