import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runTrackerEmails } from "@/lib/tracker-job";

export const dynamic = "force-dynamic";

/** Weekday CGM Compliance Tracker emails (digests, reminders, unread-message notices). Vercel Cron calls this with
 *  "Authorization: Bearer <CRON_SECRET>" (vercel.json). Does nothing while automated emails are switched off. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24 || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const run = await runTrackerEmails(createAdminClient());
    // Counts only: no addresses in the job's response or logs.
    return NextResponse.json({ skipped: run.skipped, today: run.today, planned: run.planned.length, sent: run.sent, failed: run.failed });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
