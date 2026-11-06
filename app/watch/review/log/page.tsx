import { requireEditor } from "@/lib/guards";
import { fieldLabel } from "@/lib/draft-fields";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Watch decision log" };

const SECTION_NAME: Record<string, string> = {
  items: "Standard", deadlines: "Comment period / event", activity: "FERC / NERC action", sources: "Source", week: "This-week box",
};
const DECISIONS = { approved: "Approved", rejected: "Rejected" } as const;
const PAGE = 100;

type Row = {
  id: string; section: string; op: string; key: string; label: string | null; reason: string | null;
  refs: { t?: string; u?: string }[]; value: Record<string, unknown> | null; status: "approved" | "rejected";
  edited: boolean; created_at: string; created_by: string | null; decided_at: string | null; decided_by: string | null;
};

const when = (s: string | null) =>
  s ? new Date(s).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "";

/** Editor only: every decision on a Watch draft, newest first, with who decided and whether it was edited.
 *  Drafts are never deleted, so this is the full record of what reached subscribers and why. */
export default async function DecisionLog({ searchParams }: { searchParams: { status?: string; section?: string; page?: string } }) {
  await requireEditor("/watch/review/log");
  const db = createClient();
  const page = Math.max(0, Number(searchParams.page) || 0);
  const status = searchParams.status === "approved" || searchParams.status === "rejected" ? searchParams.status : "";
  const section = searchParams.section && SECTION_NAME[searchParams.section] ? searchParams.section : "";

  let q = db.from("drafts").select("*", { count: "exact" }).neq("status", "pending");
  if (status) q = q.eq("status", status);
  if (section) q = q.eq("section", section);
  const { data, count, error } = await q.order("decided_at", { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
  const rows = (data || []) as Row[];

  const ids = [...new Set(rows.map((r) => r.decided_by).filter(Boolean))] as string[];
  const { data: people } = ids.length ? await db.from("profiles").select("id, full_name, email").in("id", ids) : { data: [] };
  const who = new Map((people || []).map((p) => [p.id as string, (p.full_name as string) || (p.email as string)]));

  const link = (over: Record<string, string | number>) => {
    const p = new URLSearchParams();
    const all = { status, section, ...over };
    for (const [k, v] of Object.entries(all)) if (String(v) !== "" && String(v) !== "0") p.set(k, String(v));
    const s = p.toString();
    return `/watch/review/log${s ? `?${s}` : ""}`;
  };

  return (
    <main className="console">
      <div className="wrap">
        <p><a href="/watch/review">← Review queue</a></p>
        <h1>Decision log</h1>
        <p>Every approved and rejected Standards Watch draft, newest first. Edited means you changed the draft before approving it.</p>

        <form className="logfilters" method="get">
          <label>
            Decision{" "}
            <select name="status" defaultValue={status}>
              <option value="">All</option>
              {Object.entries(DECISIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <label>
            Section{" "}
            <select name="section" defaultValue={section}>
              <option value="">All</option>
              {Object.entries(SECTION_NAME).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <button className="btn" type="submit">Filter</button>
          <span className="rc">{count ?? 0} decision{count === 1 ? "" : "s"}</span>
        </form>

        {error && <p>Couldn&apos;t load the log: {error.message}</p>}
        <section className="review">
          <div className="rlist">
            {!rows.length && <p className="dnote">No decisions match.</p>}
            {rows.map((r) => (
              <article key={r.id} className="draft logrow" style={{ borderLeftColor: r.status === "approved" ? "var(--adm-add)" : "var(--adm-del)" }}>
                <div className="dtop">
                  <span className={`pill ${r.status === "approved" ? "approved" : "upcoming"}`}>{DECISIONS[r.status]}{r.edited ? " · edited" : ""}</span>
                  <span className="pill dev">{SECTION_NAME[r.section] || r.section}</span>
                  <span className="pill dev">{r.op === "remove" ? "Remove" : "Add or change"}</span>
                  <b className="dlabel">{r.label || r.key}</b>
                  <span className="dwhen">{when(r.decided_at)}{r.decided_by ? ` · ${who.get(r.decided_by) || "unknown"}` : ""}</span>
                </div>
                {r.reason && <p className="dreason">{r.reason}</p>}
                <p className="dnote">Drafted {when(r.created_at)}{r.created_by ? ` by ${r.created_by}` : ""}.</p>
                {r.status === "approved" && r.value && (
                  <details>
                    <summary className="dnote">What was published</summary>
                    <ul className="dlist">
                      {Object.entries(r.value).filter(([k, v]) => k !== "pos" && v !== null && v !== "").map(([k, v]) => (
                        <li key={k}><span className="dk">{fieldLabel(r.section, k)}</span><span /><span>{typeof v === "string" ? v : JSON.stringify(v)}</span></li>
                      ))}
                    </ul>
                  </details>
                )}
                {r.refs?.length > 0 && (
                  <p className="drefs">{r.refs.map((x, i) => <span key={i}>{i > 0 && " · "}{x.u ? <a href={x.u} target="_blank" rel="noopener noreferrer">{x.t || x.u}</a> : x.t}</span>)}</p>
                )}
              </article>
            ))}
          </div>
        </section>
        <p style={{ display: "flex", gap: 16 }}>
          {page > 0 && <a href={link({ page: page - 1 })}>← Newer</a>}
          {(count ?? 0) > (page + 1) * PAGE && <a href={link({ page: page + 1 })}>Older →</a>}
        </p>
      </div>
    </main>
  );
}
