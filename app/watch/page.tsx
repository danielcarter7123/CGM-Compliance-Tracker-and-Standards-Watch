import { redirect } from "next/navigation";
import WatchView from "@/components/WatchView";
import { getViewer } from "@/lib/auth";
import { needsWelcome } from "@/lib/guards";
import { loadContent } from "@/lib/content";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// The one page in CGM Compliance Tracker that carries the NERC Standards Watch name.
export const metadata = { title: "NERC Standards Watch" };

export default async function WatchPage() {
  const viewer = await getViewer();
  if (!viewer) redirect("/login?next=/watch");
  if (!viewer.hasAccess) redirect("/account?need=subscription");
  if (needsWelcome(viewer)) redirect("/welcome?next=/watch");
  // Read as the subscriber: row level security confirms the subscription again.
  const content = await loadContent(createClient());
  return (
    <main>
      <WatchView content={content} defaultFunctions={viewer.functions} />
      <div className="nextbar">
        <div className="wrap">
          {viewer.products.tracker ? (
            <>
              <span>Done reviewing this week&apos;s changes? Your tasks are on the Dashboard.</span>
              <a className="nbtn" href="/tracker">Continue to the Dashboard →</a>
            </>
          ) : (
            <>
              <span>The Compliance Tracker is available to CGM clients. Ask CGM Consulting Group about access.</span>
              <a className="nbtn locked" href="/account?need=tracker" title="The Compliance Tracker is available to CGM clients">
                <svg width="13" height="14" viewBox="0 0 13 14" aria-hidden="true"><rect x="1" y="6" width="11" height="7.5" rx="1.5" fill="currentColor" /><path d="M3.5 6V4.2a3 3 0 0 1 6 0V6" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
                Compliance Tracker
              </a>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
