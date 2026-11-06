"use client";

import { useState, useTransition } from "react";
import { approveAll, approveDraft, rejectDraft } from "@/app/watch/review/actions";
import DraftEditor from "@/components/DraftEditor";
import { draftProblems, fieldLabel } from "@/lib/draft-fields";
import { TOPICS, type Draft } from "@/lib/types";

export type ReviewDraft = Draft & { current: Record<string, unknown> | null };

const SECTION_NAME: Record<string, string> = {
  items: "Standard", deadlines: "Comment period / event", activity: "FERC / NERC action", sources: "Source", week: "This-week box",
};

/** A value as a reader would say it: lists of dated rows as lines, function lists joined, long text trimmed. */
function show(v: unknown, k?: string): string {
  if (k === "topic" && typeof v === "string" && TOPICS[v]) return TOPICS[v];
  if (v === undefined || v === null || v === "") return "";
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x === "string")) return v.join(", ");
    return v.map((r: Record<string, unknown>) => [r.d, r.b, r.l ?? r.t].filter(Boolean).join(" · ")).join("\n");
  }
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 400 ? s.slice(0, 397) + "…" : s;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export default function ReviewQueue({ drafts, sources }: { drafts: ReviewDraft[]; sources: Record<string, string> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ value: Record<string, unknown>; problems: string[] } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? r.message || done : `Couldn't save: ${r.error}`);
      setArmed(null);
      if (r.ok) { setEditing(null); setEdit(null); }
    });

  return (
    <section className="review" aria-label="Review queue">
      <div className="rhead">
        <span className="rtag">Editor only</span>
        <h2>Review queue</h2>
        <span className="rc">{drafts.length ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} waiting` : "Nothing waiting"}</span>
        {drafts.length >= 2 && !editing && (
          <button
            type="button"
            className="btn primary"
            disabled={pending}
            onClick={() => (armed === "all"
              ? run(() => approveAll(drafts.map((d) => d.id)), `Published all ${drafts.length}.`)
              : setArmed("all"))}
          >
            {armed === "all" ? `Click again to publish all ${drafts.length}` : "Approve all"}
          </button>
        )}
        <span className="only">Clients never see this page</span>
      </div>
      {msg && <p className="dnote" style={{ padding: "10px 20px 0" }} role="status">{msg}</p>}
      <div className="rlist">
        {!drafts.length && <p className="dnote">The Monday task puts proposed changes here. Nothing reaches subscribers until you approve it.</p>}
        {drafts.map((d) => {
          const v = (d.value || {}) as Record<string, unknown>;
          const cur = d.current;
          const keys = cur && d.op === "upsert"
            ? [...new Set([...Object.keys(cur), ...Object.keys(v)])].filter((k) => k !== "pos" && !same(cur[k], v[k]))
            : [];
          const label = d.label || d.key;
          return (
            <article className="draft" key={d.id} aria-label={`Draft: ${label}`}>
              <div className="dtop">
                <span className="pill dev">{SECTION_NAME[d.section] || d.section}</span>
                <span className={`pill ${d.op === "remove" ? "upcoming" : "approved"}`}>{d.op === "remove" ? "Remove" : cur ? "Change" : "Add"}</span>
                <b className="dlabel">{label}</b>
                <span className="dwhen">Drafted {new Date(d.created_at).toLocaleDateString()}{d.created_by ? ` · ${d.created_by}` : ""}</span>
              </div>
              {d.reason && <p className="dreason">{d.reason}</p>}
              {d.op === "remove" ? (
                <p className="dnote">Removes this entry from the published page.</p>
              ) : !cur ? (
                <ul className="dlist">
                  {Object.keys(v).filter((k) => k !== "pos" && show(v[k], k)).map((k) => (
                    <li key={k}><span className="dk">{fieldLabel(d.section, k)}</span><span /><span>{show(v[k], k)}</span></li>
                  ))}
                </ul>
              ) : keys.length ? (
                <ul className="dlist">
                  {keys.map((k) => (
                    <li key={k}>
                      <span className="dk">{fieldLabel(d.section, k)}</span>
                      {show(cur[k], k) ? <s>{show(cur[k], k)}</s> : <span />}
                      <span>{v[k] !== undefined ? show(v[k], k) || "(empty)" : "(removed)"}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="dnote">No change from what is published.</p>
              )}
              {d.refs?.length > 0 && (
                <p className="drefs">{d.refs.map((r, i) => <span key={i}>{i > 0 && " · "}{r.u ? <a href={r.u} target="_blank" rel="noopener noreferrer">{r.t || r.u}</a> : r.t}</span>)}</p>
              )}
              {editing === d.id && (
                <DraftEditor section={d.section} initial={v} sources={sources} onChange={(value, problems) => setEdit({ value, problems })} />
              )}
              <div className="dact">
                {editing === d.id ? (
                  <>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={pending || !edit || edit.problems.length > 0}
                      onClick={() => run(() => approveDraft(d.id, edit!.value), `Published: ${label}`)}
                    >
                      Approve edited
                    </button>
                    <button type="button" className="btn" onClick={() => { setEditing(null); setEdit(null); }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn primary" disabled={pending} onClick={() => run(() => approveDraft(d.id), `Published: ${label}`)}>Approve and publish</button>
                    {d.op !== "remove" && (
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setEditing(d.id);
                          setEdit({ value: { ...v }, problems: draftProblems(d.section, v, Object.keys(sources)) });
                          setArmed(null);
                        }}
                      >
                        Edit first
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn danger"
                      disabled={pending}
                      onClick={() => (armed === d.id ? run(() => rejectDraft(d.id), `Rejected: ${label}`) : setArmed(d.id))}
                    >
                      {armed === d.id ? "Click again to reject" : "Reject"}
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
