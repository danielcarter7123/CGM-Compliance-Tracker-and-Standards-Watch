import { addEvidenceLink, recordUpload, removeEvidence } from "@/app/tracker/evidence/actions";
import EvidenceUpload from "@/components/EvidenceUpload";
import { formatBytes, type Evidence } from "@/lib/evidence";

const when = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/** Evidence on a task or client task (docs/EVIDENCE.md): uploaded files, links, and the pilot's single link.
 *  Anyone who can see the task can add evidence; whoever added an item (or CGM staff) can remove it, which keeps
 *  it on record as removed. */
export default function EvidencePanel({
  items, names, me, staff, company, target, back, cip, legacyLink,
}: {
  items: Evidence[];
  names: Map<string, string>;
  me: string;
  staff: boolean;
  company: string;
  target: { task?: string; ctask?: string };
  back: string;
  cip: boolean;
  legacyLink?: string | null;
}) {
  const live = items.filter((e) => !e.removed_at);
  const removed = items.filter((e) => e.removed_at);
  const who = (id: string | null) => (!id ? "" : id === me ? "you" : names.get(id) || "a team member");
  const hidden = (
    <>
      {target.task ? <input type="hidden" name="task_id" value={target.task} /> : <input type="hidden" name="client_task_id" value={target.ctask} />}
      <input type="hidden" name="back" value={back} />
    </>
  );

  return (
    <section className="evidence" aria-label="Evidence">
      <h3>Evidence</h3>
      {legacyLink && /^https:\/\//i.test(legacyLink) && (
        <p className="small">Evidence link: <a href={legacyLink} target="_blank" rel="noopener noreferrer">{legacyLink.length > 70 ? `${legacyLink.slice(0, 67)}…` : legacyLink} ↗</a></p>
      )}
      {live.length ? (
        <ul className="evlist">
          {live.map((e) => (
            <li key={e.id}>
              <a href={`/tracker/evidence/${e.id}`} target="_blank" rel="noopener noreferrer">
                {e.kind === "file" ? "📄 " : "🔗 "}{e.title || e.file_name || e.url}
              </a>
              <span className="muted small">
                {e.kind === "file" ? ` ${formatBytes(e.size_bytes)} · ` : " "}added by {who(e.added_by)} on {when(e.created_at)}
              </span>
              {(staff || e.added_by === me) && (
                <form action={removeEvidence} className="inline">
                  <input type="hidden" name="id" value={e.id} />
                  <input type="hidden" name="back" value={back} />
                  <button type="submit" className="linkbtn" aria-label={`Remove ${e.title || e.file_name || "this link"}`}>Remove</button>
                </form>
              )}
            </li>
          ))}
        </ul>
      ) : !legacyLink && <p className="muted small">No evidence yet.</p>}
      {removed.length > 0 && (
        <details className="small">
          <summary>{removed.length} removed</summary>
          <ul className="evlist">
            {removed.map((e) => (
              <li key={e.id} className="muted"><s>{e.title || e.file_name || e.url}</s> removed by {who(e.removed_by)} on {when(e.removed_at!)}</li>
            ))}
          </ul>
        </details>
      )}
      <div className="ev-add">
        <EvidenceUpload action={recordUpload} company={company} target={target} back={back} cip={cip} />
        <form action={addEvidenceLink} className="ev-link">
          {hidden}
          <label htmlFor="ev_url">Or paste a link</label>
          <input id="ev_url" name="url" type="url" required placeholder="https://… SharePoint, OneDrive or another system" />
          <label className="sr" htmlFor="ev_title">Link name</label>
          <input id="ev_title" name="title" type="text" placeholder="Name (optional)" maxLength={200} />
          <button className="btn-line sm" type="submit">Add link</button>
        </form>
      </div>
    </section>
  );
}
