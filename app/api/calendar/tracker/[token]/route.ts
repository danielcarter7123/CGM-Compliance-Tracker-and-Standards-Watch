import { NextResponse } from "next/server";
import { isLive } from "@/lib/entitlements";
import { buildTaskCalendar, type TaskEvent } from "@/lib/ical";
import { createAdminClient } from "@/lib/supabase/admin";
import { siteUrl } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/** Personal task calendar (OPEN-QUESTIONS 7). The address's token is the check (as for the Watch feed), so the
 *  scope is decided here, with the same rules as the app:
 *  - a client user: their own company's open tasks, while it holds the Tracker;
 *  - CGM staff: open tasks of the clients they're project manager for (every live client if none), plus team tasks
 *    they own or collaborate on.
 *  Client tasks aren't included. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.token)) return new NextResponse("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data: p } = await admin.from("profiles").select("id, staff_role, company_id").eq("calendar_token", params.token).maybeSingle();
  if (!p) return new NextResponse("Not found", { status: 404 });

  const [{ data: cos }, { data: ents }] = await Promise.all([
    admin.from("companies").select("id, name, pm_id, sample"),
    admin.from("entitlements").select("company_id, status").eq("product", "tracker"),
  ]);
  const live = new Set((ents || []).filter((e) => isLive(e.status as string)).map((e) => e.company_id as string));
  const companies = (cos || []).filter((c) => live.has(c.id as string) && !c.sample);
  let scope: string[];
  if (p.staff_role) {
    const mine = companies.filter((c) => c.pm_id === p.id).map((c) => c.id as string);
    scope = mine.length ? mine : companies.map((c) => c.id as string);
  } else {
    if (!p.company_id || !live.has(p.company_id as string)) return new NextResponse("Not found", { status: 404 });
    scope = [p.company_id as string];
  }
  const name = (id: string | null) => (id ? (companies.find((c) => c.id === id)?.name as string) || "" : "");
  const events: TaskEvent[] = [];
  for (let i = 0; i < scope.length; i += 100) {
    const { data } = await admin.from("tasks").select("id, company_id, title, standard_code, requirement, due_date")
      .in("company_id", scope.slice(i, i + 100)).neq("status", "done").not("due_date", "is", null);
    for (const t of data || []) {
      events.push({ id: t.id, kind: "task", date: t.due_date, title: t.title, client: scope.length > 1 ? name(t.company_id) : "",
        code: [t.standard_code, t.requirement].filter(Boolean).join(" ") });
    }
  }
  if (p.staff_role) {
    const { data } = await admin.from("team_tasks").select("id, title, planned_date, company_id, owner_id, collaborators")
      .neq("status", "done").not("planned_date", "is", null);
    for (const t of data || []) {
      if (t.owner_id !== p.id && !((t.collaborators as string[]) || []).includes(p.id as string)) continue;
      events.push({ id: t.id, kind: "team", date: t.planned_date, title: t.title, client: name(t.company_id), code: "" });
    }
  }
  return new NextResponse(buildTaskCalendar(events, siteUrl()), {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=3600", "Content-Disposition": "inline; filename=cgm-compliance-tracker.ics" },
  });
}
