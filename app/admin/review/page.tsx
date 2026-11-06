import { redirect } from "next/navigation";
import ReviewQueue, { type ReviewDraft } from "@/components/ReviewQueue";
import { getViewer } from "@/lib/auth";
import { itemToValue, rowToItem } from "@/lib/mapping";
import { createClient } from "@/lib/supabase/server";
import type { Draft } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Editor-only review queue. Dark navy console, so it never reads as client-facing. */
export default async function ReviewPage() {
  const v = await getViewer();
  if (!v) redirect("/login?next=/admin/review");
  if (!v.isEditor) redirect("/watch");

  const db = createClient();
  const { data: drafts } = await db.from("drafts").select("*").eq("status", "pending").order("created_at");
  const { data: decided } = await db.from("drafts").select("id,label,section,status,decided_at,edited").neq("status", "pending").order("decided_at", { ascending: false }).limit(5);
  const { data: srcRows } = await db.from("sources").select("key, title").order("key");
  const sources = Object.fromEntries((srcRows || []).map((r) => [String(r.key), String(r.title)]));

  // Current published version of each entry a draft touches, for the before/after view.
  const list: ReviewDraft[] = [];
  for (const d of (drafts || []) as Draft[]) {
    let current: Record<string, unknown> | null = null;
    if (d.section === "items") {
      const { data } = await db.from("standards").select("*").eq("id", d.key).maybeSingle();
      current = data ? itemToValue(rowToItem(data)) : null;
    } else if (d.section === "deadlines") {
      const { data } = await db.from("deadlines").select("*").eq("id", d.key).maybeSingle();
      current = data ? { d: data.d, t: data.title, who: data.who, fn: data.functions } : null;
    } else if (d.section === "activity") {
      const { data } = await db.from("actions").select("*").eq("id", d.key).maybeSingle();
      current = data ? { d: data.d, src: data.src, t: data.text } : null;
    } else if (d.section === "sources") {
      const { data } = await db.from("sources").select("*").eq("key", d.key).maybeSingle();
      current = data ? { t: data.title, u: data.url } : null;
    } else if (d.section === "week") {
      const { data } = await db.from("weekly_summaries").select("*").order("published_at", { ascending: false }).limit(1);
      current = data && data[0] ? { label: data[0].label, covers: data[0].covers, items: data[0].items } : null;
    }
    list.push({ ...d, current });
  }

  return (
    <main className="console">
      <div className="wrap">
        <h1>Review queue</h1>
        <p>Drafts from the Monday task wait here. Nothing reaches subscribers until you approve it. Every decision is recorded with who made it and when.</p>
        <ReviewQueue drafts={list} sources={sources} />
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
