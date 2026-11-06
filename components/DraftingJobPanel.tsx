"use client";

import { useState, useTransition } from "react";
import { runDraftingJob } from "@/app/admin/review/actions";

export type JobRun = {
  id: string; started_at: string; finished_at: string | null; trigger: string; status: string; drafts_queued: number;
  summary: string | null; unconfirmed: string[]; sources_checked: string[]; error: string | null; est_cost_usd: number | null;
};

const when = (s: string) => new Date(s).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STATUS: Record<string, string> = { ok: "Done", error: "Failed", skipped: "Skipped", running: "Running" };

/** Editor only: the weekly drafting job's recent runs, and a two-click "Run it now". */
export default function DraftingJobPanel({ runs }: { runs: JobRun[] }) {
  const [armed, setArmed] = useState(false);
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <section className="review" aria-label="Weekly drafting job">
      <div className="rhead">
        <span className="rtag">Editor only</span>
        <h2>Weekly drafting job</h2>
        <span className="rc">Mondays at 10 a.m. Mountain (11 a.m. in summer)</span>
        <button
          type="button"
          className="btn"
          disabled={pending}
          onClick={() => {
            if (!armed) return setArmed(true);
            setArmed(false);
            setMsg("Reading this week's NERC and FERC news. This takes a few minutes…");
            start(async () => {
              const r = await runDraftingJob();
              setMsg(r.ok ? r.message || "Done." : `Didn't finish: ${r.error}`);
            });
          }}
        >
          {pending ? "Running…" : armed ? "Click again to run it now (about $1)" : "Run it now"}
        </button>
      </div>
      <div className="rlist">
        <p className="dnote">
          Claude reads this week&apos;s NERC Weekly Regulatory Update and official NERC, FERC, Federal Register and Regional Entity pages, then queues drafts here. It never publishes anything. Your Monday task stays as the backup; drafts from both share ids, so nothing is queued twice.
        </p>
        {msg && <p className="dnote" role="status">{msg}</p>}
        {runs.length > 0 && (
          <ul className="dlist jobruns">
            {runs.map((r) => (
              <li key={r.id}>
                <span className="dk">{when(r.started_at)}</span>
                <span />
                <span>
                  <b>{STATUS[r.status] || r.status}</b> · {r.trigger === "cron" ? "scheduled" : "run by hand"}
                  {r.status === "ok" && ` · ${r.drafts_queued} draft${r.drafts_queued === 1 ? "" : "s"}`}
                  {r.est_cost_usd != null && ` · about $${Number(r.est_cost_usd).toFixed(2)}`}
                  {(r.summary || r.error) && `\n${r.error || r.summary}`}
                  {r.unconfirmed?.length > 0 && `\nCouldn't confirm: ${r.unconfirmed.join("; ")}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
