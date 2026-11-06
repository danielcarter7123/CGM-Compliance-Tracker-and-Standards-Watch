"use client";

import { useState } from "react";
import { nextDuePreview } from "@/lib/tasks";
import { fmt } from "@/lib/watch";

/** "Close out task" (Dan, Nov 6, 2026): clients often do the work and get the report weeks later, so the date
 *  entered is the date the WORK was performed, not the day they close it out. It starts at today, can be backdated
 *  (never future), must be confirmed with a tick, and shows when the next occurrence will fall due so a wrong date
 *  stands out. The database records who and when, and schedules the next occurrence from it. */
export default function CloseOutForm({
  action, id, filters, evidence, today, due, recur,
}: {
  action: (fd: FormData) => void;
  id: string;
  filters: Record<string, string>;
  evidence: string;
  today: string;
  due: string | null;
  recur: { n: number; unit: "d" | "m" | "y"; basis: "due" | "done" };
}) {
  const [date, setDate] = useState(today);
  const [checked, setChecked] = useState(false);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today;
  const base = recur.basis === "done" ? date : due;
  const next = recur.n > 0 && base && valid ? nextDuePreview(base, recur.n, recur.unit) : null;
  const backdated = valid && date < today;

  return (
    <form action={action} className="trk-form closeout">
      {Object.entries(filters).map(([k, v]) => <input key={k} type="hidden" name={`f_${k}`} value={v} />)}
      <input type="hidden" name="id" value={id} />
      <div className="row2">
        <div className="field">
          <label htmlFor="p_date">Date the work was performed</label>
          <input id="p_date" name="performed_on" type="date" value={date} max={today} required onChange={(e) => { setDate(e.target.value); setChecked(false); }} />
          <span className="muted small">If the report came later, enter the earlier date the work was done. Not a future date.</span>
        </div>
        <div className="field">
          <label htmlFor="p_ev">Evidence or report link (optional)</label>
          <input id="p_ev" name="evidence" type="text" defaultValue={evidence} placeholder="https://… link to the report or evidence folder" />
        </div>
      </div>
      <div className={`closeout-check${backdated ? " backdated" : ""}`}>
        <p>
          Performed on <b>{valid ? fmt(date) : "—"}</b>
          {backdated ? " (backdated)" : date === today ? " (today)" : ""}.
          {next && <> The next occurrence will be due <b>{fmt(next)}</b>{recur.basis === "done" ? ", counted from this date" : ", counted from the due date"}.</>}
        </p>
        <label className="checkline">
          <input type="checkbox" name="confirm_date" checked={checked} onChange={(e) => setChecked(e.target.checked)} disabled={!valid} />
          I&apos;ve checked this is the date the work was performed, not the date the report arrived.
        </label>
      </div>
      <p className="muted small">Closing out counts for compliance. A CGM project manager then reviews and approves it.</p>
      <div><button className="btn-main" type="submit" disabled={!checked || !valid}>Close out task</button></div>
    </form>
  );
}
