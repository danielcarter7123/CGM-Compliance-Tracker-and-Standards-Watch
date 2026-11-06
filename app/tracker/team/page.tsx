import { requireStaff } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { todayIso } from "@/lib/tasks";
import {
  TEAM_SCOPES, TEAM_STATUS, TEAM_STATUS_FILTERS, filterTeam, hours, linksText, sumHours, teamLate, teamStats, teamStatusLabel, type TeamTask,
} from "@/lib/team";
import { fmt } from "@/lib/watch";
import { completeTeamTask, deleteTeamTask, saveTeamTask } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Team Tasks" };

type SP = Record<string, string | undefined>;
type Person = { id: string; full_name: string | null; email: string | null; staff_role: string | null };

const COLS = "id, title, description, company_id, owner_id, owner_email, collaborators, planned_date, actual_date, est_hours, status, links, created_at, created_by";
const ini = (s: string) => {
  const p = s.replace(/@.*/, "").split(/[\s._-]+/).filter(Boolean);
  return ((p[0]?.[0] || "?") + (p[1]?.[0] || "")).toUpperCase();
};

/** Team Tasks (TRACKER-SPEC §3.5): CGM's internal work. CGM staff only, in the app and in the database. */
export default async function TeamTasks({ searchParams: sp }: { searchParams: SP }) {
  const v = await requireStaff("/tracker/team");
  const db = createClient();
  const [{ data: rows, error }, { data: cos }, { data: ps }] = await Promise.all([
    db.from("team_tasks").select(COLS),
    db.from("companies").select("id, name").eq("sample", false).order("name"),
    db.from("profiles").select("id, full_name, email, staff_role"),
  ]);
  const all = (rows || []) as TeamTask[];
  const companies = (cos || []) as { id: string; name: string }[];
  const people = (ps || []) as Person[];
  const staffPeople = people.filter((p) => p.staff_role).sort((a, b) => (a.full_name || a.email || "").localeCompare(b.full_name || b.email || ""));
  const personName = (id: string | null) => {
    if (!id) return "";
    const p = people.find((x) => x.id === id);
    return p ? p.full_name || p.email || "A team member" : "A former user";
  };
  const clientName = (id: string | null) => (id ? companies.find((c) => c.id === id)?.name || "(removed client)" : "Internal");
  const today = todayIso();

  const f = { scope: sp.scope || "mine", status: sp.status || "active", client: sp.client || "", q: sp.q || "" };
  const shown = filterTeam(all, f, { me: v.userId, today, clientName, personName });
  const st = teamStats(all, v.userId, today);
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x) as [string, string][]).toString();
  const link = (extra: string) => `/tracker/team?${[qs, extra].filter(Boolean).join("&")}`;
  const jump = (scope: string, status: string) => `/tracker/team?scope=${scope}&status=${status}`;
  const keepFields = Object.entries(f).map(([k, x]) => (x ? <input key={k} type="hidden" name={`f_${k}`} value={x} /> : null));

  const isNew = sp.t === "new";
  const sel: TeamTask | null = isNew
    ? { id: "", title: "", description: null, company_id: null, owner_id: v.userId, collaborators: [], planned_date: null, actual_date: null,
        est_hours: null, status: "notstarted", links: [], created_at: "", created_by: null }
    : (sp.t && all.find((t) => t.id === sp.t)) || null;

  const owner = (t: TeamTask) =>
    t.owner_id ? (
      <span className="who"><span className="avatar sm" aria-hidden="true">{ini(personName(t.owner_id))}</span>{personName(t.owner_id)}</span>
    ) : t.owner_email ? <span className="muted">{t.owner_email}</span> : <span className="muted">Unassigned</span>;

  return (
    <main className="wrap trk-page dash">
      <nav className="strip team-strip" aria-label="Summary">
        <a className="stat" href={jump("mine", "active")}><span className="eyebrow">My open tasks</span><span className="v">{st.mine}</span><span className="muted small">{hours(st.mineHours)} estimated hours</span></a>
        <a className={`stat ${st.late ? "crit" : ""}`} href={jump("everyone", "late")}><span className="eyebrow">Past anticipated date</span><span className="v">{st.late}</span><span className="muted small">not yet complete</span></a>
        <a className="stat" href={jump("everyone", "active")}><span className="eyebrow">Team open tasks</span><span className="v">{st.open}</span><span className="muted small">{hours(st.openHours)} estimated hours</span></a>
        <a className="stat ok" href={jump("everyone", "done")}><span className="eyebrow">Completed this month</span><span className="v">{st.doneThisMonth}</span><span className="muted small">since {fmt(st.monthStart)}</span></a>
      </nav>

      <div className="trk-head">
        <h1>Team Tasks</h1>
        <span className="muted mono">{shown.length} shown</span>
        <span className="trk-actions">
          <a className="btn-line sm" href={`/tracker/team/export?${qs}`}>Export CSV</a>
          <a className="btn-main sm" href={link("t=new")}>New team task</a>
        </span>
      </div>
      <p className="muted small">CGM&apos;s internal work. Only CGM staff see this page; clients never do.</p>
      {sp.ok && !sel && <p className="notice ok" role="status">{sp.ok}</p>}
      {sp.error && !sel && <p className="notice" role="alert">{sp.error}</p>}
      {error && <p className="notice">Couldn&apos;t load team tasks: {error.message}</p>}

      {sel && (
        <section className="trk-panel" aria-label={isNew ? "New team task" : sel.title}>
          <div className="trk-panel-h">
            <h2>{isNew ? "New team task" : sel.title}</h2>
            {!isNew && <span className={`pill ${sel.status === "done" ? "done" : teamLate(sel, today) ? "overdue" : sel.status === "inprogress" ? "inprogress" : "scheduled"}`}>{teamStatusLabel(sel.status)}{teamLate(sel, today) ? " · late" : ""}</span>}
            <a className="btn-line sm" href={link("")}>Close</a>
          </div>
          {sp.ok && <p className="notice ok" role="status">{sp.ok}</p>}
          {sp.error && <p className="notice" role="alert">{sp.error}</p>}
          <form action={saveTeamTask} className="trk-form">
            {keepFields}
            <input type="hidden" name="id" value={sel.id} />
            <div className="field">
              <label htmlFor="tt_title">Task</label>
              <input id="tt_title" name="title" type="text" defaultValue={sel.title} required maxLength={200} />
            </div>
            <div className="field">
              <label htmlFor="tt_desc">Description</label>
              <textarea id="tt_desc" name="description" rows={3} defaultValue={sel.description || ""} />
            </div>
            <div className="field">
              <label htmlFor="tt_links">Links</label>
              <textarea id="tt_links" name="links" rows={3} defaultValue={linksText(sel.links)} placeholder={"SharePoint folder | https://…\nhttps://…"} aria-describedby="tt_links_h" />
              <span id="tt_links_h" className="muted small">Up to 3, one per line: a label, a bar, then the https link. For example a SharePoint folder, Teams channel, OneDrive document or meeting notes.</span>
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="tt_client">Client</label>
                <select id="tt_client" name="company_id" defaultValue={sel.company_id || ""}>
                  <option value="">Internal (no client)</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  {sel.company_id && !companies.some((c) => c.id === sel.company_id) && <option value={sel.company_id}>(removed client)</option>}
                </select>
              </div>
              <div className="field">
                <label htmlFor="tt_owner">Assigned to</label>
                <select id="tt_owner" name="owner_id" defaultValue={sel.owner_id || ""}>
                  <option value="">Unassigned</option>
                  <option value="me">Assign to me</option>
                  {staffPeople.map((p) => <option key={p.id} value={p.id}>{p.full_name || p.email}{p.id === v.userId ? " (you)" : ""}</option>)}
                  {sel.owner_id && !staffPeople.some((p) => p.id === sel.owner_id) && <option value={sel.owner_id}>{personName(sel.owner_id)}</option>}
                </select>
                {!sel.owner_id && sel.owner_email && <span className="muted small">Imported owner: {sel.owner_email} (not signed up yet).</span>}
              </div>
            </div>
            <fieldset className="field">
              <legend>Collaborators</legend>
              <div className="collabs">
                {staffPeople.map((p) => (
                  <label key={p.id} className="checkline small">
                    <input type="checkbox" name="collaborators" value={p.id} defaultChecked={sel.collaborators.includes(p.id)} /> {p.full_name || p.email}
                  </label>
                ))}
              </div>
              <span className="muted small">Adding someone doesn&apos;t notify them.</span>
            </fieldset>
            <div className="row2">
              <div className="field">
                <label htmlFor="tt_planned">Anticipated completion</label>
                <input id="tt_planned" name="planned_date" type="date" defaultValue={sel.planned_date || ""} />
              </div>
              <div className="field">
                <label htmlFor="tt_actual">Actual completion</label>
                <input id="tt_actual" name="actual_date" type="date" max={today} defaultValue={sel.actual_date || ""} aria-describedby="tt_actual_h" />
                <span id="tt_actual_h" className="muted small">Not in the future. Set to today when marked complete.</span>
              </div>
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="tt_hours">Estimated hours</label>
                <input id="tt_hours" name="est_hours" type="number" min={0} step={0.25} defaultValue={sel.est_hours ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="tt_status">Status</label>
                <select id="tt_status" name="status" defaultValue={sel.status}>
                  {TEAM_STATUS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
            </div>
            {!isNew && (
              <p className="muted small">Created {sel.created_at ? fmt(sel.created_at.slice(0, 10)) : ""}{sel.created_by ? ` by ${personName(sel.created_by)}` : ""}.</p>
            )}
            <div className="trk-form-f"><button className="btn-main sm" type="submit">{isNew ? "Add team task" : "Save"}</button></div>
          </form>
          {!isNew && (
            <div className="toolbar">
              {sel.status !== "done" && (
                <form action={completeTeamTask}>
                  {keepFields}
                  <input type="hidden" name="id" value={sel.id} />
                  <button className="btn-line sm" type="submit">Mark complete</button>
                </form>
              )}
              <form action={deleteTeamTask} className="toolbar">
                {keepFields}
                <input type="hidden" name="id" value={sel.id} />
                <label className="checkline small"><input type="checkbox" name="confirm" /> Delete this team task</label>
                <button className="btn-line sm danger" type="submit">Delete</button>
              </form>
            </div>
          )}
        </section>
      )}

      <form className="trk-filters" method="get" role="search">
        <input type="search" name="q" defaultValue={f.q} placeholder="Search tasks, descriptions, links, people…" aria-label="Search team tasks" />
        <select name="scope" defaultValue={f.scope} aria-label="Whose tasks">
          {TEAM_SCOPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="status" defaultValue={f.status} aria-label="Status">
          {TEAM_STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select name="client" defaultValue={f.client} aria-label="Client">
          <option value="">All clients</option>
          <option value="none">Internal (no client)</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn-line sm" type="submit">Filter</button>
      </form>

      <div className="tablewrap">
        <table className="grid tasktable teamtable">
          <thead>
            <tr><th>Task</th><th>Client</th><th>Assigned to</th><th>Collaborators</th><th className="num">Est. hrs</th><th>Anticipated</th><th>Actual</th><th>Status</th></tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const late = teamLate(t, today);
              return (
                <tr key={t.id} aria-current={sel?.id === t.id ? "true" : undefined}>
                  <td>
                    <a className="rowlink" href={link(`t=${t.id}`)}>{t.title}</a>
                    {t.description && <div className="muted small clamp2">{t.description}</div>}
                    {!!t.links?.length && (
                      <div className="tlinks">
                        {t.links.slice(0, 3).map((l, i) => <a key={i} href={l.url} target="_blank" rel="noopener noreferrer">{l.label || "Link"} ↗</a>)}
                      </div>
                    )}
                  </td>
                  <td className={t.company_id ? "" : "muted"}>{clientName(t.company_id)}</td>
                  <td className="nowrap">{owner(t)}</td>
                  <td className="small">{t.collaborators.map(personName).join(", ") || "—"}</td>
                  <td className="num mono">{t.est_hours != null && t.est_hours !== "" ? hours(Number(t.est_hours)) : "—"}</td>
                  <td className={`nowrap mono${late ? " late" : ""}`}>{t.planned_date ? fmt(t.planned_date) : "—"}</td>
                  <td className="nowrap mono">{t.actual_date ? fmt(t.actual_date) : "—"}</td>
                  <td><span className={`pill ${t.status === "done" ? "done" : late ? "overdue" : t.status === "inprogress" ? "inprogress" : "scheduled"}`}>{teamStatusLabel(t.status)}{late ? " · late" : ""}</span></td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={8} className="muted">No team tasks match these filters.</td></tr>}
          </tbody>
          {shown.length > 0 && (
            <tfoot>
              <tr><td colSpan={4}>Total estimated hours</td><td className="num mono">{hours(sumHours(shown))}</td><td colSpan={3} /></tr>
            </tfoot>
          )}
        </table>
      </div>
    </main>
  );
}
