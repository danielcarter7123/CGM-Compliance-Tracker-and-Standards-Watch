import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { filterTasks, tasksCsv, todayIso, type Task } from "@/lib/tasks";

export const dynamic = "force-dynamic";

/** Tasks as CSV with the current filters, in the pilot's columns. Read as the signed-in person, so a client
 *  user only ever exports their own company's tasks (row level security). */
export async function GET(req: NextRequest) {
  const v = await getViewer();
  if (!v) return NextResponse.redirect(new URL("/login?next=/tracker/tasks", req.url));
  if (!v.products.tracker) return new NextResponse("The Compliance Tracker isn't part of your plan.", { status: 403 });
  const db = createClient();
  const [{ data: tasks, error }, { data: cos }, { data: stds }] = await Promise.all([
    db.from("tasks").select("*"),
    db.from("companies").select("id, name, ncr_id"),
    db.from("library_standards").select("code, version, applies"),
  ]);
  if (error) return new NextResponse(error.message, { status: 500 });
  const p = req.nextUrl.searchParams;
  const f = { q: p.get("q") || "", status: p.get("status") || "", client: p.get("client") || "", std: p.get("std") || "", fn: p.get("fn") || "" };
  const companies = cos || [];
  const standards = stds || [];
  const rows = filterTasks((tasks || []) as Task[], f, {
    clientName: (id) => (companies.find((c) => c.id === id)?.name as string) || "",
    applies: (code) => (standards.find((s) => s.code === code)?.applies as string[]) || [],
  });
  const csv = tasksCsv(rows, {
    client: (id) => companies.find((c) => c.id === id) as { name: string; ncr_id: string | null } | undefined,
    version: (code) => (standards.find((s) => s.code === code)?.version as string) || "",
  });
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="nerc-compliance-tasks-${todayIso()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
