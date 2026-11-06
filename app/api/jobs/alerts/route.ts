import { NextResponse, type NextRequest } from "next/server";
import { runAlerts } from "@/lib/alerts";
import { createAdminClient } from "@/lib/supabase/admin";

/** Daily Standards Watch alerts. Vercel Cron calls this with "Authorization: Bearer <CRON_SECRET>"
 *  (vercel.json). Does nothing while automated emails are switched off on the Admin page. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24 || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json(await runAlerts(createAdminClient()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
