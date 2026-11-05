import { redirect } from "next/navigation";
import SendDigestButton from "@/components/SendDigestButton";
import { getViewer } from "@/lib/auth";
import { loadContent } from "@/lib/content";
import { renderDigest } from "@/lib/digest";
import { siteUrl } from "@/lib/stripe";
import { createClient } from "@/lib/supabase/server";
import { ALL_FUNCTIONS } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Editor-only: preview the weekly email for any set of functions, then send it to everyone. */
export default async function DigestPage({ searchParams }: { searchParams: { fn?: string } }) {
  const v = await getViewer();
  if (!v) redirect("/login?next=/admin/digest");
  if (!v.isEditor) redirect("/watch");
  const fns = (searchParams.fn || "").split(",").filter((f) => ALL_FUNCTIONS.includes(f));
  const content = await loadContent(createClient());
  const html = renderDigest(content, fns, siteUrl());

  return (
    <main className="console">
      <div className="wrap" style={{ display: "grid", gap: 14 }}>
        <div>
          <h1>Weekly digest</h1>
          <p>Approve this week&apos;s drafts first. Each subscriber gets their own version, filtered to the functions on their account.</p>
        </div>
        <section className="review">
          <div className="rhead">
            <span className="rtag">Editor only</span><h2>Preview as</h2>
            <span className="rc">
              <a href="/admin/digest">All</a> · <a href="/admin/digest?fn=GO,GOP">GO/GOP</a> · <a href="/admin/digest?fn=TO,TOP,TP,PC">TO/TOP/TP/PC</a>
            </span>
            <span className="only"><SendDigestButton /></span>
          </div>
          <div className="rlist">
            <div className="preview"><iframe title="Digest preview" srcDoc={html} sandbox="" /></div>
          </div>
        </section>
      </div>
    </main>
  );
}
