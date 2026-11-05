"use client";

import { useState, useTransition } from "react";
import { approveDraft, rejectDraft } from "@/app/admin/review/actions";
import type { Draft } from "@/lib/types";

export type ReviewDraft = Draft & { current: Record<string, unknown> | null };

const SECTION_NAME: Record<string, string> = {
  items: "Standard", deadlines: "Comment period / event", activity: "FERC / NERC action", sources: "Source", week: "This-week box",
};
const LONG = new Set(["what", "todo", "todoTx", "stage", "t", "reason"]);
const short = (v: unknown) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s && s.length > 220 ? s.slice(0, 217) + "…" : s;
};

/** Plain fields get inputs; lists and nested values get a small JSON box. */
function DraftForm({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>, ok: boolean) => void }) {
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const set = (k: string, raw: string, isJson: boolean) => {
    const next = { ...value };
    let bad = false;
    if (isJson) {
      try { next[k] = raw.trim() ? JSON.parse(raw) : null; } catch { bad = true; }
    } else next[k] = raw;
    const errs = { ...errors, [k]: bad };
    setErrors(errs);
    onChange(next, !Object.values(errs).some(Boolean));
  };
  return (
    <div className="formgrid">
      {Object.entries(value).filter(([k]) => k !== "pos").map(([k, v]) => {
        const isJson = typeof v === "object" && v !== null;
        const long = isJson || LONG.has(k) || (typeof v === "string" && v.length > 60);
        return (
          <div className="field" key={k} style={long ? { gridColumn: "1 / -1" } : undefined}>
            <label htmlFor={`f-${k}`}>{k}{isJson ? " (list)" : ""}{errors[k] ? " · not valid yet" : ""}</label>
            {long ? (
              <textarea id={`f-${k}`} defaultValue={isJson ? JSON.stringify(v, null, 2) : String(v ?? "")} onChange={(e) => set(k, e.target.value, isJson)} spellCheck={!isJson} />
            ) : (
              <input id={`f-${k}`} type="text" defaultValue={String(v ?? "")} onChange={(e) => set(k, e.target.value, false)} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function ReviewQueue({ drafts }: { drafts: ReviewDraft[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ value: Record<string, unknown>; ok: boolean } | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>("");
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? done : `Couldn't save: ${r.error}`);
      if (r.ok) { setEditing(null); setEdit(null); setArmed(null); }
    });

  return (
    <section className="review" aria-label="Review queue">
      <div className="rhead">
        <span className="rtag">Editor only</span>
        <h2>Review queue</h2>
        <span className="rc">{drafts.length ? `${drafts.length} draft${drafts.length === 1 ? "" : "s"} waiting` : "Nothing waiting"}</span>
        <span className="only">Clients never see this page</span>
      </div>
      {msg && <p className="dnote" style={{ padding: "10px 20px 0" }} role="status">{msg}</p>}
      <div className="rlist">
        {!drafts.length && <p className="dnote">The Monday task puts proposed changes here. Nothing reaches subscribers until you approve it.</p>}
        {drafts.map((d) => {
          const v = (d.value || {}) as Record<string, unknown>;
          const cur = d.current;
          const keys = cur && d.op === "upsert"
            ? [...new Set([...Object.keys(cur), ...Object.keys(v)])].filter((k) => k !== "pos" && JSON.stringify(cur[k] ?? null) !== JSON.stringify(v[k] ?? null))
            : [];
          return (
            <article className="draft" key={d.id}>
              <div className="dtop">
                <span className="pill dev">{SECTION_NAME[d.section] || d.section}</span>
                <span className={`pill ${d.op === "remove" ? "upcoming" : "approved"}`}>{d.op === "remove" ? "Remove" : cur ? "Change" : "Add"}</span>
                <b className="dlabel">{d.label || d.key}</b>
                <span className="dwhen">Drafted {new Date(d.created_at).toLocaleDateString()}{d.created_by ? ` · ${d.created_by}` : ""}</span>
              </div>
              {d.reason && <p className="dreason">{d.reason}</p>}
              {d.op === "remove" ? <p className="dnote">Removes this entry from the published page.</p>
                : !cur ? <p className="dnote"><b>New entry.</b> {short(v.std ?? v.t ?? v.label ?? "")} {v.title ? `· ${String(v.title)}` : ""}</p>
                : keys.length ? (
                  <ul className="dlist">{keys.map((k) => (
                    <li key={k}><span className="dk">{k}</span>{cur[k] !== undefined && cur[k] !== null ? <s>{short(cur[k])}</s> : <span />}<span>{v[k] !== undefined ? short(v[k]) : "(removed)"}</span></li>
                  ))}</ul>
                ) : <p className="dnote">No change from what is published.</p>}
              {d.refs?.length > 0 && (
                <p className="drefs">{d.refs.map((r, i) => <span key={i}>{i > 0 && " · "}{r.u ? <a href={r.u} target="_blank" rel="noopener noreferrer">{r.t || r.u}</a> : r.t}</span>)}</p>
              )}
              {editing === d.id && edit && <DraftForm value={edit.value} onChange={(value, ok) => setEdit({ value, ok })} />}
              <div className="dact">
                {editing === d.id ? (
                  <>
                    <button className="btn primary" disabled={pending || !edit?.ok} onClick={() => run(() => approveDraft(d.id, edit!.value), `Published: ${d.label || d.key}`)}>Approve edited</button>
                    <button className="btn" onClick={() => { setEditing(null); setEdit(null); }}>Cancel</button>
                  </>
                ) : (
                  <>
                    <button className="btn primary" disabled={pending} onClick={() => run(() => approveDraft(d.id), `Published: ${d.label || d.key}`)}>Approve and publish</button>
                    {d.op !== "remove" && <button className="btn" onClick={() => { setEditing(d.id); setEdit({ value: { ...v }, ok: true }); }}>Edit first</button>}
                    <button className="btn danger" disabled={pending} onClick={() => (armed === d.id ? run(() => rejectDraft(d.id), `Rejected: ${d.label || d.key}`) : setArmed(d.id))}>
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
