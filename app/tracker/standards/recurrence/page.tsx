import { redirect } from "next/navigation";
import { requireTracker } from "@/lib/guards";
import { createClient } from "@/lib/supabase/server";
import { applyRecurrence } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recurrence settings | Compliance Tracker" };

type Tpl = { id: string; standard_code: string; req: string; title: string; recur_n: number; recur_unit: string; recur_basis: "due" | "done"; basis_confirmed: boolean };
type Task = { title: string; standard_code: string | null; requirement: string | null; recur_basis: string };

const key = (title: string, code: string | null, req: string | null) => `${title}|${code || ""}|${req || ""}`;
const interval = (t: Tpl) => `${t.recur_n} ${t.recur_unit === "d" ? "days" : t.recur_unit === "y" ? "cal yr" : "mo"}`;

/** CGM project managers and admins confirm what each recurring obligation counts its next due date from. */
export default async function RecurrenceSettings({ searchParams }: { searchParams: { ok?: string; error?: string } }) {
  const v = await requireTracker("/tracker/standards/recurrence");
  if (!v.canApprove) redirect("/tracker/standards");
  const db = createClient();
  const [{ data: tpls }, { data: tasks }] = await Promise.all([
    db.from("obligation_templates").select("id, standard_code, req, title, recur_n, recur_unit, recur_basis, basis_confirmed").gt("recur_n", 0).order("standard_code").order("pos"),
    db.from("tasks").select("title, standard_code, requirement, recur_basis").neq("status", "done").gt("recur_n", 0),
  ]);
  const byKey = new Map<string, Task[]>();
  for (const t of (tasks || []) as Task[]) {
    const k = key(t.title, t.standard_code, t.requirement);
    byKey.set(k, [...(byKey.get(k) || []), t]);
  }
  const rows = ((tpls || []) as Tpl[]).map((t) => {
    const matching = byKey.get(key(t.title, t.standard_code, t.req)) || [];
    return { t, matching, mixed: new Set(matching.map((m) => m.recur_basis)).size > 1 };
  });
  const unconfirmed = rows.filter((r) => !r.t.basis_confirmed).length;

  return (
    <main className="wrap trk-page">
      <p><a href="/tracker/standards">← Standards library</a></p>
      <h1>Recurrence settings</h1>
      <p className="lede-sm">
        Choose what each recurring obligation counts its next due date from. <b>Due date</b> keeps a fixed schedule. <b>Completion</b> restarts the interval from the date the work was performed. New tasks created from these obligations inherit the setting.
      </p>
      {searchParams.ok && <p className="notice ok" role="status">{searchParams.ok}</p>}
      {searchParams.error && <p className="notice" role="alert">{searchParams.error}</p>}
      {unconfirmed > 0 && (
        <p className="notice warn">
          {unconfirmed} obligation{unconfirmed === 1 ? " has" : "s have"} no confirmed setting. Rows marked <span className="chip warn">SUGGESTED</span> are pre-filled with a suggested reading of where the standard measures the interval from the last performance. Confirm each one against the standard, then apply. Nothing changes until you do.
        </p>
      )}
      <form action={applyRecurrence} className="trk-form">
        <div className="tablewrap">
          <table className="grid">
            <thead><tr><th>Standard</th><th>Obligation</th><th>Interval</th><th>Repeat from</th><th>Open tasks</th></tr></thead>
            <tbody>
              {rows.map(({ t, matching, mixed }) => (
                <tr key={t.id}>
                  <td className="mono nowrap">{t.standard_code}<div className="muted small">{t.req}</div></td>
                  <td>{t.title}</td>
                  <td className="num nowrap">{interval(t)}</td>
                  <td className="nowrap">
                    <select name={`basis_${t.id}`} defaultValue={t.recur_basis} aria-label={`Repeat from for ${t.standard_code} ${t.req} ${t.title}`}>
                      <option value="due">Due date</option>
                      <option value="done">Completion</option>
                    </select>
                    {!t.basis_confirmed && <span className="chip warn">SUGGESTED</span>}
                  </td>
                  <td className="num">
                    {matching.length}
                    {mixed && <span className="chip" title="These open tasks currently use different settings">MIXED</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <label className="checkline">
          <input type="checkbox" name="with_tasks" defaultChecked /> Also update the open repeating tasks that came from each obligation
        </label>
        <p className="muted small">
          Changes only how future occurrences are scheduled. Current due dates stay as they are. Tasks not created from an obligation keep their own setting. Applying confirms every row shown.
        </p>
        <div><button className="btn-main" type="submit">Apply settings</button></div>
      </form>
    </main>
  );
}
