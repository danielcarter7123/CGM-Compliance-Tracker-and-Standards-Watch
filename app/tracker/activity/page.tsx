import { ACTION_LABEL, KIND_FILTERS, KIND_LABEL, RANGES, canRestore, canRevert, changes } from "@/lib/activity";
import { activityFilters, loadActivity } from "@/lib/activity-data";
import { requireTracker } from "@/lib/guards";
import { initials } from "@/lib/nav";
import { createClient } from "@/lib/supabase/server";
import { restoreEntry, revertEntry } from "./actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Activity Log" };

const when = (s: string) =>
  new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const ini = (name: string) => initials({ fullName: name, email: null } as Parameters<typeof initials>[0]);

/** Activity Log (TRACKER-SPEC §3.11). CGM staff see everything and can restore deletions and revert changes;
 *  a client user sees their own company's task, client-task and evidence history. */
export default async function Activity({ searchParams: sp }: { searchParams: Record<string, string | undefined> }) {
  const v = await requireTracker("/tracker/activity");
  const staff = v.isStaff;
  const f = activityFilters(sp);
  const d = await loadActivity(createClient(), v, f);
  const qs = new URLSearchParams(Object.entries({ range: f.range, who: f.who, kind: f.kind, client: f.client, q: f.q }).filter(([, x]) => x) as [string, string][]).toString();
  const keepFields = Object.entries({ range: f.range, who: f.who, kind: f.kind, client: f.client, q: f.q, n: String(f.n) })
    .map(([k, x]) => (x ? <input key={k} type="hidden" name={`f_${k}`} value={x} /> : null));
  const confirmId = Number(sp.confirm) || 0;

  return (
    <main className="wrap trk-page">
      <div className="trk-head">
        <h1>Activity Log</h1>
        <span className="muted mono">{d.rows.length}{d.more ? "+" : ""} shown</span>
        <span className="trk-actions"><a className="btn-line sm" href={`/tracker/activity/export?${qs}`}>Export CSV</a></span>
      </div>
      <p className="muted small">
        {staff
          ? "Every change made in CGM Compliance Tracker, written by the database. Restore and revert make new, logged changes; the log itself is never edited."
          : "Changes to your company's tasks, client tasks and evidence."}
      </p>
      {sp.ok && <p className="notice ok" role="status">{sp.ok}</p>}
      {sp.error && <p className="notice" role="alert">{sp.error}</p>}
      {d.error && <p className="notice">Couldn&apos;t load the activity log: {d.error.message}</p>}

      <form className="trk-filters" method="get" role="search">
        <input type="search" name="q" defaultValue={f.q} placeholder="Search records and notes…" aria-label="Search the activity log" />
        <select name="range" defaultValue={f.range} aria-label="Date range">
          {RANGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {staff && (
          <select name="who" defaultValue={f.who} aria-label="Person">
            <option value="">Everyone</option>
            {d.people.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        )}
        <select name="kind" defaultValue={f.kind} aria-label="Record type">
          <option value="">All record types</option>
          {KIND_FILTERS(staff).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        {staff && (
          <select name="client" defaultValue={f.client} aria-label="Client">
            <option value="">All clients</option>
            {d.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button className="btn-line sm" type="submit">Filter</button>
      </form>

      <div className="tablewrap">
        <table className="grid acttable">
          <thead>
            <tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th>Client</th><th>Details</th>{staff && <th><span className="sr">Restore or revert</span></th>}</tr>
          </thead>
          <tbody>
            {d.rows.map((e) => {
              const name = d.who(e);
              const cs = changes(e, { personName: d.personName, clientName: d.clientName });
              const later = d.followUps.get(e.id);
              const restoredLegacy = e.source === "legacy" && e.legacy?.restoredAt;
              return (
                <tr key={e.id} id={`e${e.id}`}>
                  <td className="nowrap mono small">{when(e.at)}</td>
                  <td className="nowrap"><span className="who"><span className="avatar sm" aria-hidden="true">{ini(name)}</span>{name}</span></td>
                  <td className="nowrap">
                    <span className={`acttag ${e.action.replace(/\s+/g, "-")}`}>{ACTION_LABEL[e.action] || e.action}</span>
                    {later && <div><span className="chip accent" title={`${when(later.at)} by ${later.by}`}>{later.action === "restored" ? "RESTORED" : "REVERTED"}</span></div>}
                    {restoredLegacy && <div><span className="chip accent">RESTORED</span></div>}
                  </td>
                  <td>
                    <span className="muted small">{KIND_LABEL[e.kind] || e.kind}</span>
                    <div>{e.label || "—"}</div>
                  </td>
                  <td className="small">{d.client(e) || <span className="muted">—</span>}</td>
                  <td className="small">
                    {e.legacy?.note && <p className="actnote">{e.legacy.note}</p>}
                    {e.action === "restored" && e.ref_id && <p className="muted">Restored from a deletion.</p>}
                    {e.action === "reverted" && e.ref_id && <p className="muted">Put back the earlier values.</p>}
                    {cs.length > 0 && (
                      <ul className="changes">
                        {cs.map((c, i) => (
                          <li key={i}>
                            <b>{c.field}:</b> {c.from && <del>{c.from}</del>} {c.from && c.to ? "→ " : ""}{c.to || (c.from ? <i className="muted">cleared</i> : "")}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  {staff && (
                    <td className="nowrap">
                      {canRestore(e) && !later && (
                        <form action={restoreEntry}>
                          {keepFields}
                          <input type="hidden" name="id" value={e.id} />
                          <input type="hidden" name="label" value={e.label || ""} />
                          <button className="btn-line sm" type="submit" aria-label={`Restore ${e.label || "this record"}`}>Restore</button>
                        </form>
                      )}
                      {canRevert(e) && cs.length > 0 && !later && (
                        confirmId === e.id ? (
                          <form action={revertEntry} className="revertask" role="group" aria-label="Confirm revert">
                            {keepFields}
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="label" value={e.label || ""} />
                            <input type="hidden" name="force" value="1" />
                            <span className="small">Revert anyway? Edited since {sp.since ? when(sp.since) : "this change"}.</span>
                            <button className="btn-main sm" type="submit">Revert anyway</button>
                            <a className="btn-line sm" href={`/tracker/activity?${qs}`}>Cancel</a>
                          </form>
                        ) : (
                          <form action={revertEntry}>
                            {keepFields}
                            <input type="hidden" name="id" value={e.id} />
                            <input type="hidden" name="label" value={e.label || ""} />
                            <button className="btn-line sm" type="submit" aria-label={`Revert this change to ${e.label || "the record"}`}>Revert</button>
                          </form>
                        )
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
            {!d.rows.length && <tr><td colSpan={staff ? 7 : 6} className="muted">No activity matches these filters.</td></tr>}
          </tbody>
        </table>
      </div>
      {d.more && (
        <p><a className="btn-line sm" href={`/tracker/activity?${[qs, `n=${f.n + 200}`].filter(Boolean).join("&")}`}>Show more</a></p>
      )}
      {staff && (
        <p className="muted small">
          History carried over from the pilot is shown as recorded; restore and revert work on changes made in this app. Messages aren&apos;t logged here.
        </p>
      )}
    </main>
  );
}
