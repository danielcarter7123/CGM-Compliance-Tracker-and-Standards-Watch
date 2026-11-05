"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { applyDraft } from "@/lib/apply-draft";
import { createClient } from "@/lib/supabase/server";
import type { Draft } from "@/lib/types";

type Result = { ok: true } | { ok: false; error: string };

async function editorClient() {
  const v = await getViewer();
  if (!v?.isEditor) throw new Error("Only CGM editors can review drafts.");
  return { db: createClient(), userId: v.userId };
}

/** Approve a draft, optionally with an edited value, and publish it. */
export async function approveDraft(id: string, editedValue?: Record<string, unknown> | null): Promise<Result> {
  try {
    const { db, userId } = await editorClient();
    const { data: d, error } = await db.from("drafts").select("*").eq("id", id).eq("status", "pending").maybeSingle();
    if (error) throw new Error(error.message);
    if (!d) throw new Error("That draft was already decided or no longer exists.");
    await applyDraft(db, d as Draft, editedValue ?? undefined);
    const { error: e2 } = await db
      .from("drafts")
      .update({ status: "approved", edited: !!editedValue, value: editedValue ?? d.value, decided_at: new Date().toISOString(), decided_by: userId })
      .eq("id", id);
    if (e2) throw new Error(e2.message);
    revalidatePath("/admin/review");
    revalidatePath("/watch");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function rejectDraft(id: string): Promise<Result> {
  try {
    const { db, userId } = await editorClient();
    const { error } = await db
      .from("drafts")
      .update({ status: "rejected", decided_at: new Date().toISOString(), decided_by: userId })
      .eq("id", id)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    revalidatePath("/admin/review");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
