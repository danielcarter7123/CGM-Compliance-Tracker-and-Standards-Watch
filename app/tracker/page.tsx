import { dashboard } from "@/lib/dashboard";
import { isLive } from "@/lib/entitlements";
import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { pill, whenText, type Task } from "@/lib/tasks";
import { fmt } from "@/lib/watch";

export const dynamic = "force-dynamic";
export const metadata = { title: "Dashboard" };

const TASK_COLS = "id, company_id, title, facility, standard_code, requirement, due_date, assignee_text, remind_days, recur_n, recur_unit, recur_basis, status, evidence, notes, completed_at, performed_by, reviewed_at, reviewed_by, prev_id, next_id, copied_from, sample";

/** The Tracker Dashboard (TRACKER-SPEC §3.2). Read as the signed-in person: CGM staff see every client,
 *  a client user sees their own company (row level security). */
export default async function Dashboard() {
  const v = await requireTracker();
  const db = createClient();
  const [{ data: tasks, error }, { data: cos }, { data: ents }, { data: stds }] = await Promise.all([
    db.from("tasks").select(TASK_COLS),
    db.from("companies").select("id, name").order("name"),
    db.from("entitlements").select("company_id, product, status").eq("product", "tracker"),
    db.from("library_standards").select("code, version"),
  ]);
  const all = (tasks || []) as Task[];
  // Tracker clients: companies with a live Tracker, plus any company that still has tasks.
  const withTasks = new Set(all.map((t) => t.company_id));
  const clients = (cos || []).filter((c) => withTasks.has(c.id as string) || (ents || []).some((e) => e.company_id === c.id && isLive(e.status as string))) as { id: string; name: string }[];
  const d = dashboard(all, clients);
  const coName = (id: string) => clients.find((c) => c.id === id)?.name || "";
  const version = (code: string | null) => (stds || []).find((s) => s.code === code)?.version as string | undefined;

  const tile = (status: string, label: string, value: number, sub: string, cls = "") => (
    <a className={`stat ${cls}`} href={`/tracker/tasks?status=${status}`}>
      <span className="eyebrow">{label}</span>
      <span className="v">{value}</span>
      <span className="muted small">{sub}</span>
    </a>
  );
  const item = (t: Task) => {
    const p = pill(t);
    return (
      <a key={t.id} className={`item ${p.cls}`} href={`/tracker/tasks?status=all&t=${t.id}`}>
        <span className="bar" aria-hidden="true" />
        <span className="itext">
          <span className="t">{t.title}{t.sample && <span className="chip">SAMPLE</span>}</span>
          <span className="m">
            {t.standard_code && <span className="mono">{t.standard_code}{version(t.standard_code) ? `-${version(t.standard_code)}` : ""}{t.requirement ? ` ${t.requirement}` : ""}</span>}
            {v.isStaff && <span>{coName(t.company_id)}</span>}
            {t.facility && <span>{t.facility}</span>}
            {t.assignee_text && <span>{t.assignee_text}</span>}
          </span>
        </span>
        <span className="when">
          <b>{t.due_date ? fmt(t.due_date) : "No due date"}</b>
          <span className={`pill ${p.cls}`}>{whenText(t)}</span>
        </span>
      </a>
    );
  };

  return (
    <main className="wrap trk-page dash">
      <h1>{v.isStaff ? "All clients" : v.company?.name}</h1>
      {error && <p className="notice">Couldn&apos;t load tasks: {error.message}</p>}

      <nav className="strip" aria-label="Summary">
        {tile("overdue", "Overdue", d.overdue, "past due date", d.overdue ? "crit" : "")}
        {tile("d30", "Due ≤ 30 days", d.due30, "coming due", "warn")}
        {tile("review", "Pending review", d.review.length, d.awaitingReport ? `${d.awaitingReport} awaiting report` : "performed, awaiting approval", "accent")}
        {tile("open", "Open tasks", d.open, `across ${d.clients} client${d.clients === 1 ? "" : "s"}`)}
        {tile("done", "Closed this quarter", d.closedThisQuarter, `since ${fmt(d.qStart)}`, "ok")}
      </nav>

      {d.noDueDate > 0 && (
        <a className="notice warn bannerlink" href="/tracker/tasks?status=nodate">
          <b>{d.noDueDate} task{d.noDueDate === 1 ? " needs" : "s need"} a due date.</b> Reminders and digest emails skip tasks without one. Open the list to set them.
        </a>
      )}
      {v.isStaff && clients.length === 0 && (
        <div className="callout">
          <b>Start by adding a client</b>
          <span>Add a Generator Owner / Operator entity, then create tasks from the standards library.</span>
          {v.canApprove && <div><a className="btn-main sm" href="/tracker/clients?c=new">Add client</a></div>}
        </div>
      )}

      <div className="cols">
        <section className="dpanel" aria-label="Reminders">
          <div className="dpanel-h"><h2>Reminders</h2><span className="muted small">Overdue, or inside a reminder window</span></div>
          <div className="list">
            {d.reminders.length ? d.reminders.map(item) : (
              <p className="empty">No active reminders. Tasks appear here once they enter the reminder window you set, for example 30 or 7 days before due.</p>
            )}
          </div>
        </section>
        <section className="dpanel" aria-label="By client">
          <div className="dpanel-h"><h2>By client</h2></div>
          {d.byClient.length ? (
            <table className="grid">
              <thead><tr><th>Client</th><th className="num">Open</th><th className="num">Reminders</th><th className="num">Overdue</th></tr></thead>
              <tbody>
                {d.byClient.map((r) => (
                  <tr key={r.client.id}>
                    <td><a className="rowlink" href={`/tracker/tasks?client=${r.client.id}`}>{r.client.name}</a></td>
                    <td className="num">{r.open}</td>
                    <td className="num">{r.reminders}</td>
                    <td className={`num ${r.overdue ? "bad" : ""}`}>{r.overdue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="empty">No clients yet.</p>}
        </section>
      </div>

      {d.review.length > 0 && (
        <section className="dpanel" aria-label="Pending review">
          <div className="dpanel-h"><h2>Pending review</h2><span className="muted small">Performed on site, waiting for the report and project manager approval</span></div>
          <div className="list">{d.review.map(item)}</div>
        </section>
      )}

      <section className="dpanel" aria-label="Upcoming schedule">
        <div className="dpanel-h"><h2>Upcoming schedule</h2><span className="muted small">Next 40 tasks outside their reminder window</span></div>
        <div className="list">
          {d.upcoming.length ? d.upcoming.map((m) => (
            <div key={m.label}>
              <div className="month">{m.label}</div>
              {m.tasks.map(item)}
            </div>
          )) : <p className="empty">Nothing scheduled beyond the current reminder windows.</p>}
        </div>
      </section>
    </main>
  );
}
