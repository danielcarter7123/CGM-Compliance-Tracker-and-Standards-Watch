import DigestComposer from "@/components/SendDigestButton";
import { pendingAlerts } from "@/lib/alerts";
import { correctionLines, type DecidedDraft } from "@/lib/changes";
import { loadContent } from "@/lib/content";
import { renderDigest, renderDigestText } from "@/lib/digest";
import { requireEditor } from "@/lib/guards";
import { emailsEnabled } from "@/lib/settings";
import { siteUrl } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { ALL_FUNCTIONS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Editor only: preview the weekly email for any set of functions, add corrections, then send it to everyone.
 *  Also shows which alerts the daily job would send next. Everything is read as the editor (RLS). */
export default async function DigestPage({ searchParams }: { searchParams: { fn?: string } }) {
  await requireEditor("/admin/digest");
  const fns = (searchParams.fn || "").split(",").filter((f) => ALL_FUNCTIONS.includes(f));
  const db = createClient();
  const content = await loadContent(db);

  // Corrections: approved changes to already-published entries since the last digest went out.
  const { data: sentRows } = await db.from("weekly_summaries").select("digest_sent_at").not("digest_sent_at", "is", null).order("digest_sent_at", { ascending: false }).limit(1);
  const since = (sentRows?.[0]?.digest_sent_at as string | undefined) || new Date(Date.now() - 7 * 864e5).toISOString();
  const { data: changed } = await db
    .from("drafts")
    .select("id, section, op, key, label, value, previous, decided_at")
    .eq("status", "approved")
    .gt("decided_at", since)
    .order("decided_at");
  const suggestions = correctionLines((changed || []) as DecidedDraft[]);

  const opts = { corrections: suggestions, unsubscribeUrl: `${siteUrl()}/unsubscribe` };
  const html = renderDigest(content, fns, siteUrl(), opts);
  const text = renderDigestText(content, fns, siteUrl(), opts);
  const [alerts, emailsOn] = await Promise.all([pendingAlerts(db), emailsEnabled(db)]);

  return (
    <main className="console">
      <div className="wrap" style={{ display: "grid", gap: 14 }}>
        <div>
          <h1>Weekly digest</h1>
          <p>Approve this week&apos;s drafts first. Each subscriber gets their own version, filtered to the functions on their account, with their own unsubscribe link.</p>
        </div>
        <section className="review">
          <div className="rhead">
            <span className="rtag">Editor only</span><h2>Preview as</h2>
            <span className="rc">
              <a href="/admin/digest">All</a> · <a href="/admin/digest?fn=GO,GOP">GO/GOP</a> · <a href="/admin/digest?fn=TO,TOP,TP,PC">TO/TOP/TP/PC</a>
            </span>
          </div>
          <div className="rlist">
            <DigestComposer key={fns.join(",")} functions={fns} suggestions={suggestions} initialHtml={html} initialText={text} />
          </div>
        </section>

        <section className="review">
          <div className="rhead">
            <span className="rtag">Editor only</span><h2>Alerts</h2>
            <span className="rc">{alerts.length ? `${alerts.length} due` : "None due"}</span>
            <span className="only">{emailsOn ? "The daily job sends these each morning." : "Automated emails are off, so nothing is sent. Turn them on from the Admin page."}</span>
          </div>
          <div className="rlist">
            <p className="dnote">
              Alerts are optional and off by default; the digest is the main email. Subscribers who turned alerts on (account page) get one short email when FERC approves a standard, an effective date is set or moves, or a comment period or event is within 14 days, filtered to their functions. Each alert goes out once.
            </p>
            {alerts.length > 0 && (
              <ul className="dlist">
                {alerts.map((a) => (
                  <li key={a.key}><span className="dk">{a.kind === "ferc" ? "FERC" : a.kind === "effective" ? "Effective" : "Soon"}</span><span /><span>{a.label}{a.fn?.length ? ` (${a.fn.join(", ")})` : ""}</span></li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
