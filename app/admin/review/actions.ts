"use server";

import { revalidatePath } from "next/cache";
import { getViewer } from "@/lib/auth";
import { applyDraft } from "@/lib/apply-draft";
import { draftProblems, tidyDraftValue } from "@/lib/draft-fields";
import { createClient } from "@/lib/supabase/server";
import type { Draft } from "@/lib/types";

type Result = { ok: true; message?: string } | { ok: false; error: string };

async function editorClient() {
  const v = await getViewer();
  if (!v?.isEditor) throw new Error("Only CGM editors can review drafts.");
  return { db: createClient(), userId: v.userId };
}

/** Approve a draft, optionally with an edited value, and publish it. An edited value is checked
 *  against the section's fields first (lib/draft-fields.ts), so a typo can't reach subscribers. */
export async function approveDraft(id: string, editedValue?: Record<string, unknown> | null): Promise<Result> {
  try {
    const { db, userId } = await editorClient();
    return await approveOne(db, userId, id, editedValue);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  } finally {
    revalidatePath("/admin/review");
    revalidatePath("/watch");
  }
}

/** Approve every listed draft that is still pending, oldest first. Stops at the first problem. */
export async function approveAll(ids: string[]): Promise<Result> {
  let done = 0;
  try {
    const { db, userId } = await editorClient();
    const { data, error } = await db.from("drafts").select("id").in("id", ids).eq("status", "pending").order("created_at");
    if (error) throw new Error(error.message);
    for (const { id } of data || []) {
      await approveOne(db, userId, id as string); // throws on any problem
      done++;
    }
    return { ok: true, message: `Published all ${done}.` };
  } catch (e) {
    return { ok: false, error: done ? `Published ${done}, then: ${(e as Error).message}` : (e as Error).message };
  } finally {
    revalidatePath("/admin/review");
    revalidatePath("/watch");
  }
}

async function approveOne(db: ReturnType<typeof createClient>, userId: string, id: string, editedValue?: Record<string, unknown> | null): Promise<Result> {
  const { data: d, error } = await db.from("drafts").select("*").eq("id", id).eq("status", "pending").maybeSingle();
  if (error) throw new Error(error.message);
  if (!d) throw new Error("That draft was already decided or no longer exists.");
  if (editedValue) {
    editedValue = tidyDraftValue(d.section, editedValue);
    const { data: src } = await db.from("sources").select("key");
    const problems = draftProblems(d.section, editedValue, (src || []).map((r) => String(r.key)));
    if (problems.length) throw new Error(problems.join(" "));
  }
  await applyDraft(db, d as Draft, editedValue ?? undefined);
  const { error: e2 } = await db
    .from("drafts")
    .update({ status: "approved", edited: !!editedValue, value: editedValue ?? d.value, decided_at: new Date().toISOString(), decided_by: userId })
    .eq("id", id);
  if (e2) throw new Error(e2.message);
  return { ok: true };
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
