import CloseOutForm from "@/components/CloseOutForm";
import { requireTracker } from "@/lib/guards";
import { REGISTERED_FUNCTIONS, standardLink } from "@/lib/functions";
import { createClient } from "@/lib/supabase/server";
import {
  REMIND_OFFSETS, STATUS_FILTERS, defaultReminders, filterTasks, hasReport, isLink, nextDuePreview, nextReminder, pill, recurText,
  todayIso, whenText, type Task,
} from "@/lib/tasks";
import { fmt } from "@/lib/watch";
import { approveTask, deleteTask, markPerformed, saveEvidenceNotes, saveTask, sendBack } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Tasks" };

type Std = { code: string; version: string; title: string; applies: string[]; url: string | null };
type Co = { id: string; name: string; ncr_id: string | null };
type Tpl = { id: string; standard_code: string; req: string; title: string; recur_n: number; recur_unit: "d" | "m" | "y"; recur_basis: "due" | "done" };
type SP = Record<string, string | undefined>;

const TASK_COLS = "id, company_id, title, facility, standard_code, requirement, due_date, assignee_text, remind_days, recur_n, recur_unit, recur_basis, status, evidence, notes, completed_at, performed_by, reviewed_at, reviewed_by, prev_id, next_id, copied_from, sample";

/** NERC compliance tasks. CGM staff see every client's; a client user sees their own company's (row level security). */
export default async function Tasks({ searchParams: sp }: { searchParams: SP }) {
  const v = await requireTracker("/tracker/tasks");
  const staff = v.isStaff;
  const db = createClient();
  const [{ data: tasks, error }, { data: cos }, { data: stds }] = await Promise.all([
    db.from("tasks").select(TASK_COLS),
    db.from("companies").select("id, name, ncr_id").order("name"),
    db.from("library_standards").select("code, version, title, applies, url").order("code"),
  ]);
  const all = (tasks || []) as Task[];
  const companies = (cos || []) as Co[];
  const standards = (stds || []) as Std[];
  const coName = (id: string) => companies.find((c) => c.id === id)?.name || "";
  const std = (code: string | null) => standards.find((s) => s.code === code);
  const f = { q: sp.q, status: sp.status, client: sp.client, std: sp.std, fn: sp.fn };
  const rows = filterTasks(all, f, { clientName: coName, applies: (c) => std(c)?.applies || [] });
  const qs = new URLSearchParams(Object.entries(f).filter(([, x]) => x) as [string, string][]).toString();
  const link = (extra: string) => `/tracker/tasks?${[qs, extra].filter(Boolean).join("&")}`;
  const keepFields = Object.entries(f).map(([k, x]) => (x ? <input key={k} type="hidden" name={`f_${k}`} value={x} /> : null));

  // The open task, or a new one (prefilled from a library obligation when tpl= is given).
  const isNew = sp.t === "new" && staff;
  let sel: Task | null = sp.t && !isNew ? all.find((t) => t.id === sp.t) || null : null;
  if (isNew) {
    let tpl: Tpl | null = null;
    if (sp.tpl) {
      const { data } = await db.from("obligation_templates").select("id, standard_code, req, title, recur_n, recur_unit, recur_basis").eq("id", sp.tpl).maybeSingle();
      tpl = (data as Tpl) || null;
    }
    const unit = tpl?.recur_unit || "m";
    sel = {
      id: "", company_id: sp.client || "", title: tpl?.title || "", facility: null, standard_code: tpl?.standard_code || null, requirement: tpl?.req || null,
      due_date: tpl && tpl.recur_n > 0 ? nextDuePreview(todayIso(), tpl.recur_n, unit) : null, assignee_text: null, remind_days: defaultReminders(unit),
      recur_n: tpl?.recur_n || 0, recur_unit: unit, recur_basis: tpl?.recur_basis || "due", status: "open", evidence: null, notes: null,
      completed_at: null, performed_by: null, reviewed_at: null, reviewed_by: null, prev_id: null, next_id: null, copied_from: null, sample: false,
    };
  }
  const nextTask = sel?.next_id ? all.find((t) => t.id === sel!.next_id) : undefined;
  const prevTask = sel?.prev_id ? all.find((t) => t.id === sel!.prev_id) : undefined;
  const names = new Map<string, string>();
  const ids = [sel?.performed_by, sel?.reviewed_by].filter(Boolean) as string[];
  if (ids.length) {
    const { data } = await db.from("profiles").select("id, full_name, email").in("id", ids);
    for (const p of data || []) names.set(p.id as string, (p.full_name as string) || (p.email as string));
  }
  const who = (id: string | null) => (id ? names.get(id) || (id === v.userId ? "you" : "a team member") : "");
  const selStd = sel ? std(sel.standard_code) : undefined;
  const nr = sel && !isNew ? nextReminder(sel) : null;

  return (
    <main className="wrap trk-page">
      <div className="trk-head">
        <h1>Tasks</h1>
        <span className="muted mono">{rows.length} shown</span>
        <span className="trk-actions">
          <a className="btn-line sm" href={`/tracker/tasks/export?${qs}`}>Export CSV</a>
          {staff && <a className="btn-main sm" href={link("t=new")}>New task</a>}
        </span>
      </div>
      {sp.ok && !sel && <p className="notice ok" role="status">{sp.ok}</p>}
      {sp.error && !sel && <p className="notice" role="alert">{sp.error}</p>}
      {error && <p className="notice">Couldn&apos;t load tasks: {error.message}</p>}

      {sel && (
        <section className="trk-panel" aria-label={isNew ? "New task" : sel.title}>
          <div className="trk-panel-h">
            <h2>{isNew ? "New task" : sel.title}</h2>
            {!isNew && <span className={`pill ${pill(sel).cls}`}>{pill(sel).label}</span>}
            {!isNew && <a className="btn-line sm" href={`/tracker/messages?client=${sel.company_id}&task=${sel.id}`}>Discuss</a>}
            <a className="btn-line sm" href={link("")}>Close</a>
          </div>
          {sp.ok && <p className="notice ok" role="status">{sp.ok}</p>}
          {sp.error && <p className="notice" role="alert">{sp.error}</p>}
          {!isNew && <p className="muted small">{coName(sel.company_id)}{sel.facility ? ` · ${sel.facility}` : ""} · {whenText(sel)}</p>}

          {staff ? (
            <form action={saveTask} className="trk-form">
              {keepFields}
              <input type="hidden" name="id" value={sel.id} />
              <div className="field">
                <label htmlFor="t_title">Task</label>
                <input id="t_title" name="title" type="text" defaultValue={sel.title} required />
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="t_client">Client</label>
                  <select id="t_client" name="company_id" defaultValue={sel.company_id} required>
                    <option value="">Choose…</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="t_fac">Facility / unit</label>
                  <input id="t_fac" name="facility" type="text" defaultValue={sel.facility || ""} />
                </div>
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="t_std">Standard</label>
                  <select id="t_std" name="standard_code" defaultValue={sel.standard_code || ""}>
                    <option value="">None</option>
                    {standards.map((s) => <option key={s.code} value={s.code}>{s.code}-{s.version} {s.title}</option>)}
                  </select>
                  {selStd && <a className="small" href={standardLink(selStd)} target="_blank" rel="noopener noreferrer">Open {selStd.code}-{selStd.version} ↗</a>}
                </div>
                <div className="field">
                  <label htmlFor="t_req">Requirement</label>
                  <input id="t_req" name="requirement" type="text" defaultValue={sel.requirement || ""} placeholder="e.g. R3 or Table 1-4" />
                </div>
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="t_due">Due date</label>
                  <input id="t_due" name="due_date" type="date" defaultValue={sel.due_date || ""} />
                </div>
                <div className="field">
                  <label htmlFor="t_asg">Assignee</label>
                  <input id="t_asg" name="assignee_text" type="text" defaultValue={sel.assignee_text || ""} />
                </div>
              </div>
              <div className="field">
                <span className="lbl">Remind me before the due date</span>
                <div className="checks">
                  {REMIND_OFFSETS.map((d) => (
                    <label key={d}><input type="checkbox" name="remind_days" value={d} defaultChecked={sel!.remind_days.includes(d)} /> {d} day{d === 1 ? "" : "s"}</label>
                  ))}
                </div>
                {nr && <span className="muted small">Next reminder {fmt(nr.date)} ({nr.offset} days before).</span>}
              </div>
              <div className="row2">
                <div className="field">
                  <label htmlFor="t_rn">Repeats every</label>
                  <div className="toolbar">
                    <input id="t_rn" name="recur_n" type="number" min={0} max={600} defaultValue={sel.recur_n} className="narrow" />
                    <select name="recur_unit" defaultValue={sel.recur_unit} aria-label="Repeat unit">
                      <option value="m">calendar months</option>
                      <option value="y">calendar years</option>
                      <option value="d">days</option>
                    </select>
                  </div>
                  <span className="muted small">0 means one-time. Calendar years fall due Dec 31.</span>
                </div>
                <div className="field">
                  <label htmlFor="t_basis">Repeat from</label>
                  <select id="t_basis" name="recur_basis" defaultValue={sel.recur_basis}>
                    <option value="due">Previous due date (fixed schedule)</option>
                    <option value="done">Completion date (rolling interval)</option>
                  </select>
                </div>
              </div>
              {!isNew && (
                <div className="field">
                  <label htmlFor="t_status">Status</label>
                  <select id="t_status" name="status" defaultValue={sel.status}>
                    <option value="open">Open</option>
                    <option value="inprogress">In progress</option>
                    <option value="review">Pending review</option>
                    <option value="done">Complete</option>
                  </select>
                </div>
              )}
              {!isNew && (sel.status === "review" || sel.status === "done") && (
                <div className="field">
                  <label htmlFor="t_done">Date the work was performed</label>
                  <input id="t_done" name="completed_at" type="date" defaultValue={sel.completed_at || ""} max={todayIso()} />
                  <span className="muted small">
                    Check it against the report before approving.{sel.recur_basis === "done" && sel.next_id ? " Changing it moves the next occurrence's due date to match." : ""}
                  </span>
                </div>
              )}
              <div className="field">
                <label htmlFor="t_ev">Evidence location</label>
                <input id="t_ev" name="evidence" type="text" defaultValue={sel.evidence || ""} placeholder="https://… link to the dated evidence folder" />
                <span className="muted small">Paste the SharePoint link to the dated evidence. An https link counts as the report.</span>
              </div>
              <div className="field">
                <label htmlFor="t_notes">Notes</label>
                <textarea id="t_notes" name="notes" defaultValue={sel.notes || ""} />
              </div>
              <div className="trk-form-f"><button className="btn-main" type="submit">{isNew ? "Add task" : "Save"}</button></div>
            </form>
          ) : (
            <dl className="taskfacts">
              <dt>Standard</dt>
              <dd>{selStd ? <a href={standardLink(selStd)} target="_blank" rel="noopener noreferrer">{selStd.code}-{selStd.version} ↗</a> : sel.standard_code || "—"}{sel.requirement ? ` · ${sel.requirement}` : ""}</dd>
              <dt>Due</dt><dd>{sel.due_date ? fmt(sel.due_date) : "No due date"}</dd>
              <dt>Assignee</dt><dd>{sel.assignee_text || "—"}</dd>
              <dt>Repeats</dt><dd>{recurText(sel)}</dd>
            </dl>
          )}
          {!staff && !isNew && (
            <p className="muted small clientnote">CGM sets the due date, repeat schedule and assignee. To change one, ask your CGM project manager. You can close out the task (with the date the work was performed) and post evidence and notes.</p>
          )}

          {!isNew && (sel.status === "open" || sel.status === "inprogress") && (
            <details className="perform">
              <summary className="btn-main sm">Close out task</summary>
              <CloseOutForm
                action={markPerformed}
                id={sel.id}
                filters={Object.fromEntries(Object.entries(f).filter(([, x]) => x)) as Record<string, string>}
                evidence={sel.evidence || ""}
                today={todayIso()}
                due={sel.due_date}
                recur={{ n: sel.recur_n, unit: sel.recur_unit, basis: sel.recur_basis }}
              />
            </details>
          )}

          {!isNew && sel.status === "review" && (
            <div className="callout">
              <b>Pending review</b>
              <span>Performed {fmt(sel.completed_at)}{sel.performed_by ? ` by ${who(sel.performed_by)}` : ""}. {hasReport(sel) ? "The report is posted." : "The report link isn't posted yet."}</span>
              {staff && (
                <div className="toolbar">
                  <form action={approveTask} className="toolbar">
                    {keepFields}
                    <input type="hidden" name="id" value={sel.id} />
                    {!hasReport(sel) && <label className="checkline small"><input type="checkbox" name="no_report" /> Approve without a report link</label>}
                    <button className="btn-main sm" type="submit">Approve &amp; close</button>
                  </form>
                  <form action={sendBack}>
                    {keepFields}
                    <input type="hidden" name="id" value={sel.id} />
                    <button className="btn-line sm" type="submit">Send back</button>
                  </form>
                </div>
              )}
            </div>
          )}
          {!isNew && sel.status === "done" && (
            <div className="callout">
              <b>Complete</b>
              <span>
                {sel.completed_at && `Performed ${fmt(sel.completed_at)}${sel.performed_by ? ` by ${who(sel.performed_by)}` : ""}. `}
                {sel.reviewed_at && `Approved ${fmt(sel.reviewed_at)}${sel.reviewed_by ? ` by ${who(sel.reviewed_by)}` : ""}.`}
              </span>
            </div>
          )}
          {(nextTask || prevTask) && (
            <p className="small">
              {prevTask && <a href={link(`t=${prevTask.id}`)}>← Previous occurrence ({prevTask.due_date ? fmt(prevTask.due_date) : "no date"})</a>}
              {prevTask && nextTask && " · "}
              {nextTask && <a href={link(`t=${nextTask.id}`)} className="nextocc">Next occurrence, due {nextTask.due_date ? fmt(nextTask.due_date) : "no date"} →</a>}
            </p>
          )}

          {!isNew && !staff && (
            <form action={saveEvidenceNotes} className="trk-form">
              {keepFields}
              <input type="hidden" name="id" value={sel.id} />
              <div className="field">
                <label htmlFor="c_ev">Evidence location</label>
                <input id="c_ev" name="evidence" type="text" defaultValue={sel.evidence || ""} placeholder="https://… link to the dated evidence folder" />
              </div>
              <div className="field">
                <label htmlFor="c_notes">Notes</label>
                <textarea id="c_notes" name="notes" defaultValue={sel.notes || ""} />
              </div>
              <div><button className="btn-line sm" type="submit">Save evidence and notes</button></div>
            </form>
          )}

          {!isNew && staff && (
            <form action={deleteTask} className="trk-form danger-zone">
              {keepFields}
              <input type="hidden" name="id" value={sel.id} />
              <label className="checkline"><input type="checkbox" name="confirm" /> Delete this task</label>
              <div><button className="btn-line sm danger" type="submit">Delete task</button></div>
            </form>
          )}
        </section>
      )}

      <form className="trk-filters" method="get" role="search">
        <input type="search" name="q" defaultValue={sp.q || ""} placeholder="Search tasks, standards, facilities, assignees…" aria-label="Search tasks" />
        <select name="status" defaultValue={sp.status || "open"} aria-label="Status">
          {STATUS_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {staff && (
          <select name="client" defaultValue={sp.client || ""} aria-label="Client">
            <option value="">All clients</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <select name="std" defaultValue={sp.std || ""} aria-label="Standard">
          <option value="">All standards</option>
          {standards.map((s) => <option key={s.code} value={s.code}>{s.code}</option>)}
        </select>
        <select name="fn" defaultValue={sp.fn || ""} aria-label="Function">
          <option value="">All functions</option>
          {REGISTERED_FUNCTIONS.map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
        <button className="btn-line sm" type="submit">Filter</button>
      </form>

      <div className="tablewrap">
        <table className="grid tasktable">
          <thead>
            <tr><th>Due</th><th>Task</th><th>Standard</th><th>Client / facility</th><th>Assignee</th><th>Evidence</th><th>Repeats</th><th>Status</th></tr>
          </thead>
          <tbody>
            {rows.map((t) => {
              const s = std(t.standard_code), p = pill(t);
              return (
                <tr key={t.id} aria-current={sel?.id === t.id ? "true" : undefined}>
                  <td className="nowrap mono">{t.due_date ? fmt(t.due_date) : "—"}<div className="muted small">{whenText(t)}</div></td>
                  <td><a className="rowlink" href={link(`t=${t.id}`)}>{t.title}</a></td>
                  <td className="nowrap">
                    {s ? <a href={standardLink(s)} target="_blank" rel="noopener noreferrer" className="mono">{s.code}-{s.version}</a> : t.standard_code || "—"}
                    {t.requirement && <div className="muted small">{t.requirement}</div>}
                  </td>
                  <td>{coName(t.company_id)}{t.facility && <div className="muted small">{t.facility}</div>}</td>
                  <td>{t.assignee_text || "—"}</td>
                  <td className="small">{isLink(t.evidence) ? <a href={t.evidence!} target="_blank" rel="noopener noreferrer">Report ↗</a> : t.evidence || "—"}</td>
                  <td className="small">{recurText(t)}</td>
                  <td><span className={`pill ${p.cls}`} title={p.reportDue ? "Performed, but the report or evidence link isn't posted yet" : undefined}>{p.label}</span></td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={8} className="muted">No tasks match these filters.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
