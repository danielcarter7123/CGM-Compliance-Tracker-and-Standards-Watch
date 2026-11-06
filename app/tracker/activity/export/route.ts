import { NextResponse, type NextRequest } from "next/server";
import { activityCsv } from "@/lib/activity";
import { activityFilters, loadActivity } from "@/lib/activity-data";
import { getViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/tasks";

export const dynamic = "force-dynamic";

/** The activity log as CSV, one row per field change, with the current filters. Read as the signed-in person, so a
 *  client user only exports their own company's history (row level security). */
export async function GET(req: NextRequest) {
  const v = await getViewer();
  if (!v) return NextResponse.redirect(new URL("/login?next=/tracker/activity", req.url));
  if (!v.products.tracker) return new NextResponse("The Compliance Tracker isn't part of your plan.", { status: 403 });
  const p = Object.fromEntries(req.nextUrl.searchParams.entries());
  const d = await loadActivity(createClient(), v, { ...activityFilters(p), n: 5000 });
  if (d.error) return new NextResponse(d.error.message, { status: 500 });
  const csv = activityCsv(d.rows, { personName: d.personName, clientName: d.clientName, who: d.who, client: d.client });
  return new NextResponse(`﻿${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cgm-activity-log-${todayIso()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
