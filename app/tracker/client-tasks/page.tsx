import { redirect } from "next/navigation";
import {
  CT_CATS, CT_PARTY, CT_PRI, CT_STATUS, CT_STATUS_FILTERS, ctRecur, ctState, ctStats, ctStatusLabel, ctWhen, filterCTasks, partyLabel,
  priorityLabel, type CTask,
} from "@/lib/clienttasks";
import { isLive } from "@/lib/entitlements";
import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { nextDuePreview, todayIso } from "@/lib/tasks";
import { linksText } from "@/lib/team";
import { fmt } from "@/lib/watch";
import { completeCTask, deleteCTask, enableClientTasks, saveCTask } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Client Tasks" };

type SP = Record<string, string | undefined>;
const COLS = "id, company_id, title, description, notes, category, assigned_to, party, due_date, completed_at, priority, status, recur_n, recur_unit, links, created_at, created_by, prev_id, next_id";
const PILL: Record<string, string> = { overdue: "overdue", window: "window", done: "done", inprogress: "inprogress", onhold: "scheduled", notstarted: "scheduled" };

/** Client Tasks add-on: a client's own work outside NERC compliance (permits, safety, maintenance, internal projects).
 *  Separate from NERC tasks and CGM Team Tasks; not on the dashboard, in reminders or in digests. */
export default async function ClientTasks({ searchParams: sp }: { searchParams: SP }) {
  const v = await requireTracker("/tracker/client-tasks");
  if (!v.isStaff && !v.products.client_tasks) redirect("/tracker");
  const staff = v.isStaff;
  const db = createClient();
  const [{ data: rows, error }, { data: cos }, { data: ents }] = await Promise.all([
    db.from("client_tasks").select(COLS),
    db.from("companies").select("id, name, sample").order("name"),
    db.from("entitlements").select("company_id, product, status").in("product", ["tracker", "client_tasks"]),
  ]);
  const live = (p: string) => new Set((ents || []).filter((e) => e.product === p && isLive(e.status as string)).map((e) => e.company_id as string));
  const tr = live("tracker"), ct = live("client_tasks");
  const companies = (cos || []) as { id: string; name: string; sample: boolean }[];
  // Add-on clients: Client Tasks and the Tracker both live. A client user only ever sees their own company.
  const ws = companies.filter((c) => tr.has(c.id) && ct.has(c.id) && (staff || c.id === v.company?.id));
  const others = staff ? companies.filter((c) => tr.has(c.id) && !ct.has(c.id) && !c.sample) : [];
  const clientName = (id: string) => companies.find((c) => c.id === id)?.name || "(removed client)";
  const today = todayIso();
  const all = ((rows || []) as CTask[]).filter((t) => ws.some((c) => c.id === t.company_id));

  const f = { client: staff ? (ws.some((c) => c.id === sp.client) ? sp.client! : "") : "", status: sp.status || "active", cat: sp.cat || "", party: sp.party || "", q: sp.q || "" };
  const shown = filterCTasks(all, f, today, clientName);
  const st = ctStats(all, today, f.client || undefined);
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x) as [string, string][]).toString();
  const link = (extra: string) => `/tracker/client-tasks?${[qs, extra].filter(Boolean).join("&")}`;
  const jump = (status: string) => `/tracker/client-tasks?${[f.client ? `client=${f.client}` : "", `status=${status}`].filter(Boolean).join("&")}`;
  const keepFields = Object.entries(f).map(([k, x]) => (x ? <input key={k} type="hidden" name={`f_${k}`} value={x} /> : null));
  const cats = [...new Set([...CT_CATS, ...all.map((t) => t.category).filter(Boolean)])].sort() as string[];

  const isNew = sp.t === "new" && ws.length > 0;
  const sel: CTask | null = isNew
    ? { id: "", company_id: f.client || ws[0]?.id || "", title: "", description: null, notes: null, category: null, assigned_to: null, party: "client",
        due_date: null, completed_at: null, priority: "normal", status: "notstarted", recur_n: 0, recur_unit: "m", links: [], created_at: "", created_by: null,
        prev_id: null, next_id: null }
    : (sp.t && all.find((t) => t.id === sp.t)) || null;
  const nextDue = sel && !isNew && sel.status !== "done" && sel.recur_n > 0 && sel.due_date ? nextDuePreview(sel.due_date, sel.recur_n, sel.recur_unit) : null;
  const forClient = f.client ? clientName(f.client) : staff ? "all add-on clients" : ws[0]?.name || "";

  const enable = staff && others.length > 0 && (
    v.staffRole === "admin" ? (
      <form action={enableClientTasks} className="toolbar">
        <label className="sr" htmlFor="ws_pick">Client to turn on</label>
        <select id="ws_pick" name="company_id" defaultValue="">
          <option value="">Choose client…</option>
          {others.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn-line sm" type="submit">Turn on Client Tasks</button>
      </form>
    ) : <span className="muted small">A CGM admin turns on Client Tasks for a client (Clients › Applications).</span>
  );

  if (!ws.length) {
    return (
      <main className="wrap trk-page">
        <h1>Client Tasks</h1>
        {sp.error && <p className="notice" role="alert">{sp.error}</p>}
        <div className="callout">
          <b>No clients have Client Tasks yet</b>
          <span>Client Tasks is an add-on. It gives a client its own task list for work outside NERC compliance, such as environmental permits, safety, maintenance and internal projects. It stays separate from NERC tasks and CGM Team Tasks. Turn it on for a client to get started.</span>
          {enable}
        </div>
      </main>
    );
  }

  return (
    <main className="wrap trk-page dash">
      <nav className="strip team-strip" aria-label="Summary">
        <a className={`stat ${st.overdue ? "crit" : ""}`} href={jump("overdue")}><span className="eyebrow">Overdue</span><span className="v">{st.overdue}</span><span className="muted small">past due</span></a>
        <a className="stat warn" href={jump("d30")}><span className="eyebrow">Due ≤ 30 days</span><span className="v">{st.due30}</span><span className="muted small">coming due</span></a>
        <a className="stat" href={jump("active")}><span className="eyebrow">Open</span><span className="v">{st.open}</span><span className="muted small">{forClient}</span></a>
        <a className="stat ok" href={jump("done")}><span className="eyebrow">Completed this month</span><span className="v">{st.doneThisMonth}</span><span className="muted small">since {fmt(st.monthStart)}</span></a>
      </nav>

      <div className="trk-head">
        <h1>Client Tasks</h1>
        <span className="chip">ADD-ON</span>
        <span className="muted mono">{shown.length} shown</span>
        <span className="trk-actions">
          <a className="btn-line sm" href={`/tracker/client-tasks/export?${qs}`}>Export CSV</a>
          <a className="btn-main sm" href={link("t=new")}>New client task</a>
        </span>
      </div>
      <p className="muted small">
        {staff ? "Each add-on client's own work outside NERC compliance. " : `${ws[0].name}'s own work outside NERC compliance. `}
        Separate from NERC tasks: these don&apos;t appear on the dashboard, in reminders or in digest emails.
      </p>
      {enable && <div className="toolbar">{enable}</div>}
      {sp.ok && !sel && <p className="notice ok" role="status">{sp.ok}</p>}
      {sp.error && !sel && <p className="notice" role="alert">{sp.error}</p>}
      {error && <p className="notice">Couldn&apos;t load client tasks: {error.message}</p>}

      {sel && (
        <section className="trk-panel" aria-label={isNew ? "New client task" : sel.title}>
          <div className="trk-panel-h">
            <h2>{isNew ? "New client task" : sel.title}</h2>
            {!isNew && <span className={`pill ${PILL[ctState(sel, today)]}`}>{ctWhen(sel, today, fmt)}</span>}
            {!isNew && <a className="btn-line sm" href={`/tracker/messages?client=${sel.company_id}&ctask=${sel.id}`}>Discuss</a>}
            <a className="btn-line sm" href={link("")}>Close</a>
          </div>
          {sp.ok && <p className="notice ok" role="status">{sp.ok}</p>}
          {sp.error && <p className="notice" role="alert">{sp.error}</p>}
          <form action={saveCTask} className="trk-form">
            {keepFields}
            <input type="hidden" name="id" value={sel.id} />
            <div className="field">
              <label htmlFor="ct_title">Task</label>
              <input id="ct_title" name="title" type="text" defaultValue={sel.title} required maxLength={200} placeholder="e.g. Submit quarterly stormwater inspection report" />
            </div>
            <div className="row2">
              {staff ? (
                <div className="field">
                  <label htmlFor="ct_client">Client</label>
                  <select id="ct_client" name="company_id" defaultValue={sel.company_id} required>
                    {ws.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              ) : <input type="hidden" name="company_id" value={sel.company_id} />}
              <div className="field">
                <label htmlFor="ct_cat">Category</label>
                <input id="ct_cat" name="category" type="text" list="ct_cats" defaultValue={sel.category || ""} placeholder="Pick or type a category" autoComplete="off" maxLength={60} />
                <datalist id="ct_cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ct_desc">Description</label>
              <textarea id="ct_desc" name="description" rows={3} defaultValue={sel.description || ""} placeholder="Scope, permit or reference numbers, next steps" />
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="ct_who">Assigned to</label>
                <input id="ct_who" name="assigned_to" type="text" defaultValue={sel.assigned_to || ""} placeholder="Name or email" maxLength={120} />
              </div>
              <div className="field">
                <label htmlFor="ct_party">Responsible party</label>
                <select id="ct_party" name="party" defaultValue={sel.party}>
                  {CT_PARTY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="ct_due">Due date</label>
                <input id="ct_due" name="due_date" type="date" defaultValue={sel.due_date || ""} />
              </div>
              <div className="field">
                <label htmlFor="ct_pri">Priority</label>
                <select id="ct_pri" name="priority" defaultValue={sel.priority}>
                  {CT_PRI.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="ct_status">Status</label>
                <select id="ct_status" name="status" defaultValue={sel.status}>
                  {CT_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="ct_done">Date completed</label>
                <input id="ct_done" name="completed_at" type="date" max={today} defaultValue={sel.completed_at || ""} aria-describedby="ct_done_h" />
                <span id="ct_done_h" className="muted small">Used when the status is Complete; today if left empty. Never in the future.</span>
              </div>
            </div>
            <div className="field">
              <label htmlFor="ct_rn">Repeats every</label>
              <div className="toolbar">
                <input id="ct_rn" name="recur_n" type="number" min={0} max={120} step={1} defaultValue={sel.recur_n} className="mono narrow" />
                <label className="sr" htmlFor="ct_ru">Repeat unit</label>
                <select id="ct_ru" name="recur_unit" defaultValue={sel.recur_unit}>
                  <option value="m">months</option><option value="y">years</option><option value="d">days</option>
                </select>
              </div>
              <span className="muted small">
                0 = one-time. Completing a repeating task schedules the next one from its due date.
                {nextDue && ` Completing this one schedules the next for ${fmt(nextDue)}.`}
              </span>
            </div>
            <div className="field">
              <label htmlFor="ct_links">Links</label>
              <textarea id="ct_links" name="links" rows={2} defaultValue={linksText(sel.links)} placeholder={"Permit | https://…"} aria-describedby="ct_links_h" />
              <span id="ct_links_h" className="muted small">One per line: a label, a bar, then the https link. Permits, reports, SharePoint folders or work orders.</span>
            </div>
            <div className="field">
              <label htmlFor="ct_notes">Notes</label>
              <textarea id="ct_notes" name="notes" rows={3} defaultValue={sel.notes || ""} />
            </div>
            <div className="trk-form-f"><button className="btn-main sm" type="submit">{isNew ? "Create task" : "Save"}</button></div>
          </form>
          {!isNew && (
            <div className="toolbar">
              {sel.status !== "done" && (
                <form action={completeCTask}>
                  {keepFields}
                  <input type="hidden" name="id" value={sel.id} />
                  <button className="btn-line sm" type="submit">Mark complete</button>
                </form>
              )}
              <form action={deleteCTask} className="toolbar">
                {keepFields}
                <input type="hidden" name="id" value={sel.id} />
                <label className="checkline small"><input type="checkbox" name="confirm" /> Delete this client task</label>
                <button className="btn-line sm danger" type="submit">Delete</button>
              </form>
            </div>
          )}
        </section>
      )}

      <form className="trk-filters" method="get" role="search">
        <input type="search" name="q" defaultValue={f.q} placeholder="Search task, person, category…" aria-label="Search client tasks" />
        {staff && (
          <select name="client" defaultValue={f.client} aria-label="Client">
            <option value="">All add-on clients</option>
            {ws.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select name="status" defaultValue={f.status} aria-label="Status">
          {CT_STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="cat" defaultValue={f.cat} aria-label="Category">
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select name="party" defaultValue={f.party} aria-label="Responsible party">
          <option value="">Everyone responsible</option>
          {CT_PARTY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className="btn-line sm" type="submit">Filter</button>
      </form>

      <div className="tablewrap">
        <table className="grid tasktable cttable">
          <thead>
            <tr><th>Due</th><th>Task</th>{staff && <th>Client</th>}<th>Category</th><th>Assigned to</th><th>Priority</th><th>Repeats</th><th>Status</th></tr>
          </thead>
          <tbody>
            {shown.map((t) => (
              <tr key={t.id} aria-current={sel?.id === t.id ? "true" : undefined}>
                <td className="nowrap mono">{t.due_date ? fmt(t.due_date) : "—"}</td>
                <td>
                  <a className="rowlink" href={link(`t=${t.id}`)}>{t.title}</a>
                  {t.description && <div className="muted small clamp2">{t.description}</div>}
                </td>
                {staff && <td>{clientName(t.company_id)}</td>}
                <td className="small">{t.category || "—"}</td>
                <td>{t.assigned_to || "—"}<div className="muted small">{partyLabel(t.party)}</div></td>
                <td className={t.priority === "high" ? "hi" : "small"}>{priorityLabel(t.priority)}</td>
                <td className="small">{ctRecur(t)}</td>
                <td><span className={`pill ${PILL[ctState(t, today)]}`}>{t.status === "done" || ctState(t, today) === "overdue" || ctState(t, today) === "window" ? ctWhen(t, today, fmt) : ctStatusLabel(t.status)}</span></td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={staff ? 8 : 7} className="muted">No client tasks match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
