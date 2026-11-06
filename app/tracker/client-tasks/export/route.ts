import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { ctCsv, filterCTasks, type CTask } from "@/lib/clienttasks";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/tasks";

export const dynamic = "force-dynamic";

/** Client tasks as CSV with the current filters, in the pilot's columns. Read as the signed-in person, so a client
 *  user only exports their own company's client tasks (row level security). */
export async function GET(req: NextRequest) {
  const v = await getViewer();
  if (!v) return NextResponse.redirect(new URL("/login?next=/tracker/client-tasks", req.url));
  if (!v.isStaff && !v.products.client_tasks) return new NextResponse("Client Tasks isn't part of your plan.", { status: 403 });
  const db = createClient();
  const [{ data: rows, error }, { data: cos }] = await Promise.all([db.from("client_tasks").select("*"), db.from("companies").select("id, name")]);
  if (error) return new NextResponse(error.message, { status: 500 });
  const companies = cos || [];
  const clientName = (id: string) => (companies.find((c) => c.id === id)?.name as string) || "(removed client)";
  const p = req.nextUrl.searchParams;
  const f = { client: p.get("client") || "", status: p.get("status") || "active", cat: p.get("cat") || "", party: p.get("party") || "", q: p.get("q") || "" };
  const shown = filterCTasks((rows || []) as CTask[], f, todayIso(), clientName);
  return new NextResponse(`﻿${ctCsv(shown, clientName)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="client-tasks-${todayIso()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
