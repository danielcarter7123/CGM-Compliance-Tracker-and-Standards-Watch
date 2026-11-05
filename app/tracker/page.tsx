import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Row = { company_id: string; status: string; due_date: string | null; company: { name: string } | null };

/** First cut of the dashboard (full version is milestone T3). Reads tasks as the signed-in person,
    so row level security decides which companies appear: every client for CGM staff, one company for a client user. */
export default async function TrackerHome() {
  const v = await requireTracker();
  const db = createClient();
  const { data, error } = await db.from("tasks").select("company_id, status, due_date, company:companies(name)").neq("status", "done");
  const today = new Date().toISOString().slice(0, 10);
  const soon = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);

  const byCompany = new Map<string, { name: string; open: number; overdue: number; dueSoon: number; review: number }>();
  for (const t of (data || []) as unknown as Row[]) {
    const c = byCompany.get(t.company_id) || { name: t.company?.name || "Unknown", open: 0, overdue: 0, dueSoon: 0, review: 0 };
    if (t.status === "review") c.review++;
    else {
      c.open++;
      if (t.due_date && t.due_date < today) c.overdue++;
      else if (t.due_date && t.due_date <= soon) c.dueSoon++;
    }
    byCompany.set(t.company_id, c);
  }
  const rows = [...byCompany.values()].sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name));
  const total = rows.reduce((s, r) => ({ open: s.open + r.open, overdue: s.overdue + r.overdue, dueSoon: s.dueSoon + r.dueSoon, review: s.review + r.review }), { open: 0, overdue: 0, dueSoon: 0, review: 0 });

  return (
    <main className="wrap trk-page">
      <h1>{v.isStaff ? "All clients" : v.company?.name}</h1>
      {error && <p className="notice">Couldn&apos;t load tasks: {error.message}</p>}
      <div className="trk-tiles">
        <div className="tile"><span>Open</span><b>{total.open}</b></div>
        <div className={`tile ${total.overdue ? "bad" : ""}`}><span>Overdue</span><b>{total.overdue}</b></div>
        <div className="tile"><span>Due in 30 days</span><b>{total.dueSoon}</b></div>
        <div className="tile"><span>Awaiting approval</span><b>{total.review}</b></div>
      </div>
      {rows.length === 0 ? (
        <p className="muted">No open tasks.</p>
      ) : (
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Client</th><th>Open</th><th>Overdue</th><th>Due in 30 days</th><th>Awaiting approval</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td><td>{r.open}</td><td className={r.overdue ? "bad" : ""}>{r.overdue}</td><td>{r.dueSoon}</td><td>{r.review}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted" style={{ fontSize: 13 }}>The full dashboard, task list and the other sections arrive in the next milestones.</p>
    </main>
  );
}
