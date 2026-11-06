import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { companiesWith } from "@/lib/entitlements";
import { loadContent } from "@/lib/content";
import { buildCalendar } from "@/lib/ical";
import { siteUrl } from "@/lib/stripe";
import { classify } from "@/lib/watch";

/** Per-subscriber iCalendar feed: compliance dates and comment deadlines for their functions. */
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  if (!/^[0-9a-f-]{36}$/i.test(params.token)) return new NextResponse("Not found", { status: 404 });
  const admin = createAdminClient();
  const { data: p } = await admin
    .from("profiles")
    .select("functions, role, staff_role, company_id")
    .eq("calendar_token", params.token)
    .maybeSingle();
  const allowed = !!p && (!!p.staff_role || p.role === "editor" || (!!p.company_id && (await companiesWith(admin, "watch")).has(p.company_id as string)));
  if (!allowed) return new NextResponse("Not found", { status: 404 });

  const content = await loadContent(admin);
  const body = buildCalendar({ items: classify(content.items), deadlines: content.deadlines, functions: (p.functions as string[]) || [], site: siteUrl() });
  return new NextResponse(body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=3600", "Content-Disposition": "inline; filename=standards-watch.ics" } });
}
