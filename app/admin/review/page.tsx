import { redirect } from "next/navigation";
import DraftingJobPanel, { type JobRun } from "@/components/DraftingJobPanel";
import ReviewQueue, { type ReviewDraft } from "@/components/ReviewQueue";
import { getViewer } from "@/lib/auth";
import { homeFor } from "@/lib/nav";
import { publishedValue } from "@/lib/published";
import { createClient } from "@/lib/supabase/server";
import type { Draft } from "@/lib/types";

export const dynamic = "force-dynamic";
// "Run it now" runs the weekly drafting job in a server action, which can take several minutes.
export const maxDuration = 800;

/** Editor-only review queue. Dark navy console, so it never reads as client-facing. */
export default async function ReviewPage() {
  const v = await getViewer();
  if (!v) redirect("/login?next=/admin/review");
  if (!v.isEditor) redirect(homeFor(v));

  const db = createClient();
  const { data: drafts } = await db.from("drafts").select("*").eq("status", "pending").order("created_at");
  const { data: decided } = await db.from("drafts").select("id,label,section,status,decided_at,edited").neq("status", "pending").order("decided_at", { ascending: false }).limit(5);
  const { data: srcRows } = await db.from("sources").select("key, title").order("key");
  const { data: runs } = await db.from("watch_job_runs").select("*").order("started_at", { ascending: false }).limit(5);
  const sources = Object.fromEntries((srcRows || []).map((r) => [String(r.key), String(r.title)]));

  // Current published version of each entry a draft touches, for the before/after view.
  const list: ReviewDraft[] = [];
  for (const d of (drafts || []) as Draft[]) {
    const current = await publishedValue(db, d.section, d.key);
    list.push({ ...d, current });
  }

  return (
    <main className="console">
      <div className="wrap">
        <h1>Review queue</h1>
        <p>Drafts from the Monday task wait here. Nothing reaches subscribers until you approve it. Every decision is recorded with who made it and when.</p>
        <ReviewQueue drafts={list} sources={sources} />
        <DraftingJobPanel runs={(runs || []) as JobRun[]} />
        {decided && decided.length > 0 && (
          <section className="review" style={{ marginTop: 24 }}>
            <div className="rhead"><span className="rtag">Log</span><h2>Recent decisions</h2><a className="only" href="/admin/review/log">Full decision log →</a></div>
            <div className="rlist">
              {decided.map((x) => (
                <div key={x.id} className="draft" style={{ borderLeftColor: x.status === "approved" ? "var(--adm-add)" : "var(--adm-del)" }}>
                  <div className="dtop">
                    <span className={`pill ${x.status === "approved" ? "approved" : "upcoming"}`}>{x.status}{x.edited ? " · edited" : ""}</span>
                    <b className="dlabel">{x.label}</b>
                    <span className="dwhen">{x.decided_at ? new Date(x.decided_at).toLocaleString() : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
