import { NextResponse, type NextRequest } from "next/server";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/tasks";
import { filterTeam, teamCsv, type TeamTask } from "@/lib/team";

export const dynamic = "force-dynamic";

/** Team tasks as CSV with the current filters, in the pilot's columns. CGM staff only (and only staff can read
 *  team tasks in the database). */
export async function GET(req: NextRequest) {
  const v = await getViewer();
  if (!v) return NextResponse.redirect(new URL("/login?next=/tracker/team", req.url));
  if (!v.isStaff) return new NextResponse("Team tasks are CGM's internal work.", { status: 403 });
  const db = createClient();
  const [{ data: rows, error }, { data: cos }, { data: ps }] = await Promise.all([
    db.from("team_tasks").select("*"),
    db.from("companies").select("id, name"),
    db.from("profiles").select("id, full_name, email"),
  ]);
  if (error) return new NextResponse(error.message, { status: 500 });
  const companies = cos || [], people = ps || [];
  const clientName = (id: string | null) => (id ? (companies.find((c) => c.id === id)?.name as string) || "(removed client)" : "Internal");
  const personName = (id: string | null) => {
    const p = id ? people.find((x) => x.id === id) : null;
    return p ? ((p.full_name as string) || (p.email as string)) : id ? "A former user" : "";
  };
  const p = req.nextUrl.searchParams;
  const f = { scope: p.get("scope") || "mine", status: p.get("status") || "active", client: p.get("client") || "", q: p.get("q") || "" };
  const shown = filterTeam((rows || []) as TeamTask[], f, { me: v.userId, today: todayIso(), clientName, personName });
  return new NextResponse(`﻿${teamCsv(shown, { clientName, personName })}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cgm-team-tasks-${todayIso()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
