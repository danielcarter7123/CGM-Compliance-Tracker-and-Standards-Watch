import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runWatchJob } from "@/lib/watch-job";

// The job can take several minutes (searching and reading NERC and FERC pages).
export const maxDuration = 800;
export const dynamic = "force-dynamic";

/** Weekly Standards Watch drafts. Vercel Cron calls this on Mondays with "Authorization: Bearer <CRON_SECRET>"
 *  (vercel.json). It only creates drafts; nothing reaches subscribers until an editor approves them. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 24 || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await runWatchJob(createAdminClient(), "cron"));
}
