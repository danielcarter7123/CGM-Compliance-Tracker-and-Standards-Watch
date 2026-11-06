"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";

// Messages run as the signed-in person; row level security (0003 + 0013) decides who can see, start and post
// in each conversation. Conversations are created on first message (client channels, direct messages).

const str = (f: FormData, k: string) => String(f.get(k) || "").trim();
function back(params: string): never {
  revalidatePath("/tracker/messages");
  redirect(`/tracker/messages?${params}`);
}

/** Finds or creates the conversation a form refers to: c=<chat id>, client=<company id> or dm=<user id>. */
async function resolveChat(f: FormData, me: string): Promise<string> {
  const db = createClient();
  const c = str(f, "c"), client = str(f, "client"), dm = str(f, "dm");
  if (c) return c;
  if (client) {
    const find = () => db.from("chats").select("id").eq("type", "client").eq("company_id", client).maybeSingle();
    let { data } = await find();
    if (!data) {
      // No RETURNING: the read rule can't see a conversation mid-insert. Create, then read.
      const { error } = await db.from("chats").insert({ type: "client", company_id: client, created_by: me });
      if (error && error.code !== "23505") throw new Error(error.message);
      ({ data } = await find());
    }
    if (!data) throw new Error("You can't message this client.");
    return data.id as string;
  }
  if (dm) {
    const members = [me, dm].sort();
    const find = () => db.from("chats").select("id").eq("type", "dm").contains("members", members).containedBy("members", members).maybeSingle();
    let { data } = await find();
    if (!data) {
      const { error } = await db.from("chats").insert({ type: "dm", members, created_by: me });
      if (error && error.code !== "23505") throw new Error(error.message === "new row violates row-level security policy for table \"chats\"" ? "You can only message your CGM project manager." : error.message);
      ({ data } = await find());
    }
    if (!data) throw new Error("You can't start this conversation.");
    return data.id as string;
  }
  throw new Error("Choose a conversation first.");
}

export async function sendMessage(formData: FormData) {
  const v = await requireTracker("/tracker/messages");
  const body = String(formData.get("body") || "").replace(/\s+$/, "");
  const where = ["c", "client", "dm"].map((k) => (str(formData, k) ? `${k}=${encodeURIComponent(str(formData, k))}` : "")).filter(Boolean).join("&");
  if (!body.trim()) back(`${where}&error=${encodeURIComponent("Write a message first.")}`);
  if (body.length > 4000) back(`${where}&error=${encodeURIComponent("Messages can be up to 4,000 characters.")}`);
  let chatId = "";
  try {
    chatId = await resolveChat(formData, v.userId);
  } catch (e) {
    back(`${where}&error=${encodeURIComponent((e as Error).message)}`);
  }
  const db = createClient();
  let taskRef: Record<string, string> | null = null;
  const taskId = str(formData, "task_id");
  if (taskId) {
    const { data: t } = await db.from("tasks").select("id, title").eq("id", taskId).maybeSingle(); // only tasks this person can see
    if (t) taskRef = { kind: "task", id: t.id as string, label: t.title as string };
  }
  const { error } = await db.from("chat_messages").insert({ chat_id: chatId, body, task_ref: taskRef });
  if (error) back(`c=${chatId}&error=${encodeURIComponent(error.message)}`);
  await db.from("chat_reads").upsert({ chat_id: chatId, read_at: new Date().toISOString() }, { onConflict: "user_id,chat_id" });
  back(`c=${chatId}&sent=1`);
}

/** Soft delete: the author's own message shows as "Message deleted". */
export async function deleteMessage(formData: FormData) {
  await requireTracker("/tracker/messages");
  const { error } = await createClient().from("chat_messages").update({ deleted_at: new Date().toISOString() }).eq("id", str(formData, "id"));
  back(`c=${str(formData, "c")}${error ? `&error=${encodeURIComponent(error.message)}` : ""}`);
}

/** CGM staff: a named team channel. */
export async function createChannel(formData: FormData) {
  const v = await requireTracker("/tracker/messages");
  const name = str(formData, "name").slice(0, 60);
  if (!v.isStaff) back(`error=${encodeURIComponent("Only CGM staff create team channels.")}`);
  if (!name) back(`error=${encodeURIComponent("Name the channel.")}`);
  const db = createClient();
  const { error } = await db.from("chats").insert({ type: "channel", name, created_by: v.userId });
  if (error) back(`error=${encodeURIComponent(error.message)}`);
  const { data } = await db.from("chats").select("id").eq("type", "channel").eq("name", name).order("created_at", { ascending: false }).limit(1).maybeSingle();
  back(data ? `c=${data.id}` : "");
}
