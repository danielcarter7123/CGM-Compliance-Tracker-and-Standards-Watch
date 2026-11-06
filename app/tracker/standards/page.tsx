import { requireTracker } from "@/lib/guards";
import { REGISTERED_FUNCTIONS, standardLink } from "@/lib/functions";
import { createClient } from "@/lib/supabase/server";
import { createAllForClient } from "../tasks/actions";
import { deleteStandard, saveLink, saveStandard, saveVersion } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Standards library" };

type Std = { code: string; version: string; title: string; family: string; applies: string[]; url: string | null; notes: string | null; custom: boolean };
type Tpl = { id: string; standard_code: string; req: string; title: string; recur_n: number; recur_unit: "d" | "m" | "y"; recur_basis: "due" | "done"; basis_confirmed: boolean; pos: number | null };

const recurText = (t: Pick<Tpl, "recur_n" | "recur_unit" | "recur_basis">) =>
  !t.recur_n ? "Event-driven or one-time"
    : `Every ${t.recur_n} ${t.recur_unit === "d" ? (t.recur_n === 1 ? "day" : "days") : t.recur_unit === "y" ? (t.recur_n === 1 ? "calendar year" : "calendar years") : (t.recur_n === 1 ? "month" : "months")}` +
      ` · from ${t.recur_basis === "done" ? "completion" : "due date"}`;

/** The CGM standards library: every Tracker user can read it; CGM project managers and admins edit it. */
export default async function StandardsLibrary({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const v = await requireTracker("/tracker/standards");
  const canEdit = v.canApprove;
  const db = createClient();
  const staff = v.isStaff;
  const [{ data: stds, error }, { data: tpls }, { data: open }, { data: clients }] = await Promise.all([
    db.from("library_standards").select("code, version, title, family, applies, url, notes, custom").order("code"),
    db.from("obligation_templates").select("*").order("pos"),
    db.from("tasks").select("standard_code").neq("status", "done").not("standard_code", "is", null),
    v.isStaff ? db.from("companies").select("id, name").order("name") : Promise.resolve({ data: [] as { id: string; name: string }[] }),
  ]);
  const all = (stds || []) as Std[];
  const byStd = new Map<string, Tpl[]>();
  for (const t of (tpls || []) as Tpl[]) byStd.set(t.standard_code, [...(byStd.get(t.standard_code) || []), t]);
  const openCount = new Map<string, number>();
  for (const t of open || []) openCount.set(t.standard_code as string, (openCount.get(t.standard_code as string) || 0) + 1);

  const q = (searchParams.q || "").trim().toLowerCase();
  const fam = searchParams.fam || "";
  const fn = searchParams.fn || "";
  const families = [...new Set(all.map((s) => s.family))].sort();
  const rows = all.filter((s) => (!fam || s.family === fam) && (!fn || s.applies.includes(fn)) && (!q || `${s.code} ${s.title} ${s.notes || ""}`.toLowerCase().includes(q)));
  const unconfirmed = ((tpls || []) as Tpl[]).filter((t) => t.recur_n > 0 && !t.basis_confirmed).length;

  const editing = canEdit && (searchParams.new === "1" ? ({ code: "", version: "", title: "", family: "", applies: ["GO", "GOP"], url: null, notes: null, custom: true } as Std) : all.find((s) => s.code === searchParams.edit));
  const isNew = searchParams.new === "1";
  const editTasks = editing && !isNew ? openCount.get(editing.code) || 0 : 0;

  return (
    <main className="wrap trk-page">
      <div className="trk-head">
        <h1>Standards library</h1>
        <span className="muted mono">{rows.length} of {all.length}</span>
        {canEdit && (
          <span className="trk-actions">
            <a className="btn-line sm" href="/tracker/standards/recurrence">
              Recurrence settings{unconfirmed ? ` · ${unconfirmed} to confirm` : ""}
            </a>
            <a className="btn-main sm" href="/tracker/standards?new=1">New standard</a>
          </span>
        )}
      </div>
      {searchParams.ok && <p className="notice ok" role="status">{searchParams.ok}</p>}
      {searchParams.error && !editing && <p className="notice" role="alert">{searchParams.error}</p>}
      {error && <p className="notice">Couldn&apos;t load the library: {error.message}</p>}

      {editing && (
        <section className="trk-panel" aria-label={isNew ? "New standard" : `Edit ${editing.code}`}>
          <div className="trk-panel-h">
            <h2>{isNew ? "New standard" : `${editing.code}-${editing.version}`}</h2>
            <a className="btn-line sm" href={`/tracker/standards${isNew ? "" : `?open=${encodeURIComponent(editing.code)}`}`}>Close</a>
          </div>
          {searchParams.error && <p className="notice" role="alert">{searchParams.error}</p>}
          <form action={saveStandard} className="trk-form">
            <input type="hidden" name="is_new" value={isNew ? "1" : "0"} />
            {!isNew && <input type="hidden" name="code" value={editing.code} />}
            <div className="row2">
              <div className="field">
                <label htmlFor="s_code">Standard number</label>
                <input id="s_code" name={isNew ? "code" : undefined} type="text" className="mono" defaultValue={editing.code} disabled={!isNew} placeholder="e.g. PRC-031 or BAL-001-TRE" />
              </div>
              <div className="field">
                <label htmlFor="s_ver">Version</label>
                <input id="s_ver" name="version" type="text" className="mono" defaultValue={editing.version} placeholder="e.g. 1" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="s_title">Title</label>
              <input id="s_title" name="title" type="text" defaultValue={editing.title} placeholder="Standard title as published by NERC" />
            </div>
            <div className="row2">
              <div className="field">
                <label htmlFor="s_fam">Family</label>
                <input id="s_fam" name="family" type="text" className="mono" defaultValue={editing.family} placeholder="Filled from the number, e.g. PRC" />
              </div>
              <div className="field">
                <span className="lbl">Applies to</span>
                <div className="checks">
                  {REGISTERED_FUNCTIONS.map((f) => (
                    <label key={f}><input type="checkbox" name="applies" value={f} defaultChecked={editing.applies.includes(f)} /> {f}</label>
                  ))}
                </div>
              </div>
            </div>
            <div className="field">
              <label htmlFor="s_url">Link (optional)</label>
              <input id="s_url" name="url" type="url" className="mono" defaultValue={editing.url || ""} placeholder="Leave blank to use the nerc.com PDF for this number and version" />
            </div>
            <div className="field">
              <label htmlFor="s_notes">Notes</label>
              <textarea id="s_notes" name="notes" defaultValue={editing.notes || ""} placeholder="Applicability, effective dates, implementation plan" />
            </div>
            {!isNew && (
              <p className="muted small">
                {editTasks} open task{editTasks === 1 ? " uses" : "s use"} this standard. The number can&apos;t be changed after it&apos;s added.
              </p>
            )}
            <div className="trk-form-f">
              <button className="btn-main" type="submit">{isNew ? "Add standard" : "Save"}</button>
            </div>
          </form>
          {!isNew && (
            <form action={deleteStandard} className="trk-form-f">
              <input type="hidden" name="code" value={editing.code} />
              <button className="btn-line sm danger" type="submit" disabled={editTasks > 0} title={editTasks ? "Reassign or delete its tasks first" : undefined}>
                Delete {editing.code}
              </button>
            </form>
          )}
        </section>
      )}

      <form className="trk-filters" method="get" role="search">
        <input type="search" name="q" defaultValue={searchParams.q || ""} placeholder="Search by number or title…" aria-label="Search standards" />
        <select name="fam" defaultValue={fam} aria-label="Family">
          <option value="">All families</option>
          {families.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select name="fn" defaultValue={fn} aria-label="Function">
          <option value="">All functions</option>
          {REGISTERED_FUNCTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <button className="btn-line sm" type="submit">Filter</button>
      </form>

      <div className="tablewrap">
        <table className="grid stdtable">
          <thead>
            <tr><th>Standard</th><th>Title</th><th>Applies to</th><th>Recurring obligations</th><th>Open tasks</th></tr>
          </thead>
          {rows.map((s) => {
            const list = byStd.get(s.code) || [];
            const link = standardLink(s);
            return (
              <tbody key={s.code} className="stdgroup">
                <tr>
                  <td>
                    <details open={searchParams.open === s.code} className="stdx">
                      <summary aria-label={`${s.code}-${s.version} details`}>
                        <span className="mono code">{s.code}-{s.version}</span>
                      </summary>
                    </details>
                  </td>
                  <td>{s.title}</td>
                  <td>{s.applies.map((a) => <span key={a} className="chip">{a}</span>)}</td>
                  <td className="num">{list.length || "—"}</td>
                  <td className="num">{openCount.get(s.code) || 0}</td>
                </tr>
                <tr className="stddetail">
                  <td colSpan={5}>
                    <div className="inner">
                      {s.custom && <div><span className="chip">ADDED BY CGM</span></div>}
                      {s.notes && <p>{s.notes}</p>}
                      <div className="toolbar">
                        <a className="btn-line sm" href={link} target="_blank" rel="noopener noreferrer">Open {s.code}-{s.version} ↗</a>
                        <span className="muted small">{s.url ? "Custom link" : "Default nerc.com PDF link"}</span>
                        {canEdit && <a className="btn-line sm" href={`/tracker/standards?edit=${encodeURIComponent(s.code)}`}>Edit standard details</a>}
                      </div>
                      {canEdit && (
                        <div className="toolbar">
                          <form action={saveVersion} className="toolbar">
                            <input type="hidden" name="code" value={s.code} />
                            <label className="muted small" htmlFor={`ver-${s.code}`}>Version</label>
                            <input id={`ver-${s.code}`} name="version" type="text" className="mono narrow" defaultValue={s.version} />
                            <button className="btn-line sm" type="submit">Save version</button>
                          </form>
                          <form action={saveLink} className="toolbar grow">
                            <input type="hidden" name="code" value={s.code} />
                            <label className="muted small" htmlFor={`url-${s.code}`}>Standard link</label>
                            <input id={`url-${s.code}`} name="url" type="url" className="mono grow" defaultValue={link} />
                            <button className="btn-line sm" type="submit">Save link</button>
                            {s.url && <button className="btn-line sm" type="submit" name="reset" value="1">Reset to nerc.com default</button>}
                          </form>
                        </div>
                      )}
                      <div>
                        <div className="eyebrow">Recurring and event-driven obligations</div>
                        {list.length ? (
                          <ul className="tpls">
                            {list.map((t) => (
                              <li key={t.id} className="tplrow">
                                <span className="tpltext">
                                  <b>{t.title}</b>
                                  <span className="muted mono small">
                                    {t.req ? `${t.req} · ` : ""}{recurText(t)}
                                    {t.recur_n > 0 && !t.basis_confirmed && <span className="chip warn" title="Repeat-from setting not yet confirmed by CGM">SUGGESTED</span>}
                                  </span>
                                </span>
                                {staff && <a className="btn-line sm" href={`/tracker/tasks?t=new&tpl=${t.id}`}>Create task</a>}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="muted">No obligation templates for this standard yet.</p>
                        )}
                        {staff && list.some((t) => t.recur_n > 0) && (
                          <form action={createAllForClient} className="toolbar bulkcreate">
                            <input type="hidden" name="standard_code" value={s.code} />
                            <select name="company_id" defaultValue="" aria-label={`Client for all ${s.code} tasks`}>
                              <option value="">Choose client…</option>
                              {(clients || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                            <button className="btn-main sm" type="submit">Create all recurring tasks for client</button>
                            <span className="muted small">Due one interval from today. Adjust each to the last completed date.</span>
                          </form>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="muted small">
        Versions reflect the library as loaded in October 2026. Confirm the version in effect for each obligation against NERC&apos;s U.S. effective dates before relying on it; edit the version here when NERC retires or replaces a standard and every link updates.
      </p>
    </main>
  );
}
