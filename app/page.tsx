import { redirect } from "next/navigation";
import WatchView from "@/components/WatchView";
import { getViewer } from "@/lib/auth";
import { loadContent } from "@/lib/content";
import { homeFor } from "@/lib/nav";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Content } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Public home page of CGM Compliance Tracker: what the service is, then NERC Standards Watch (sold on its own)
 *  with a three-card teaser from live content and the plans. Signed-in users with a product go to their home. */
export default async function Home({ searchParams }: { searchParams: { checkout?: string } }) {
  const viewer = await getViewer().catch(() => null);
  if (viewer?.hasAccess && !searchParams.checkout) redirect(homeFor(viewer));
  let content: Content | null = null;
  try {
    // Server-side read with the service key, so signed-out visitors see the teaser cards only.
    content = await loadContent(createAdminClient());
  } catch {
    content = null;
  }

  return (
    <main>
      <section className="hero">
        <div className="wrap">
          <div>
            <div className="eyebrow">CGM Consulting Group</div>
            <h1>CGM Compliance Tracker</h1>
            <p className="lede">
              The NERC compliance program CGM Consulting Group runs with each client: recurring tasks from the standards library,
              reminders, review and approval, evidence, messages and a full audit trail, with your company&apos;s own view of its tasks.
            </p>
            <p style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
              <a className="btn-main" href="/login">Sign in</a>
              <a className="btn-line" href="mailto:dan@cgmconsultinggroup.com?subject=CGM%20Compliance%20Tracker">Ask CGM about the Tracker</a>
            </p>
          </div>
          <div className="next">
            <span className="lbl">Inside the Tracker</span>
            <span className="what">Compliance tasks and reminders</span>
            <span className="sub">Every recurring NERC obligation, due dates and approvals</span>
            <span className="what">Evidence and audit trail</span>
            <span className="sub">SharePoint folders, uploads and a record of every change</span>
            <span className="what">NERC Standards Watch</span>
            <span className="sub">Reviewed weekly changes for your registered functions</span>
          </div>
        </div>
      </section>

      <section className="section wrap watchintro" id="standards-watch">
        <div className="watchname">NERC Standards Watch</div>
        <div className="sechead"><h2>Know which NERC standards are changing, before they reach you</h2></div>
        <p className="secnote">
          Included with the Tracker, and available on its own. Every week CGM Consulting Group reviews NERC and FERC activity and tells you,
          for your registered functions, what was approved, what takes effect next, what is still phasing in, and what to do about each one.
          Subscribers get the full page, a weekly digest and a calendar feed for Outlook or Google Calendar.
        </p>
      </section>

      <div className="wrap">
        {searchParams.checkout === "cancelled" && <p className="notice">Checkout was cancelled. Nothing was charged.</p>}
        {content && content.items.length > 0 && (
          <>
            <div className="sechead"><h3 className="subhead">A look at this week</h3></div>
            <p className="secnote">A few entries from the current NERC Standards Watch. Subscribers see every standard, filtered to their functions.</p>
            <WatchView content={content} defaultFunctions={[]} teaser />
          </>
        )}

        <section id="plans" className="section">
          <div className="sechead"><h2>Standards Watch plans</h2></div>
          <p className="secnote">Priced per company with several seats. Cancel any time from your account page.</p>
          <div className="plans">
            <div className="plan featured">
              <h3>Watch</h3>
              <ul>
                <li>Weekly digest for your functions</li>
                <li>Full Standards Watch page</li>
                <li>Comment periods and events</li>
                <li>Calendar feed of compliance dates</li>
              </ul>
              <form action="/api/stripe/checkout" method="post" style={{ display: "grid", gap: 8 }}>
                <input type="hidden" name="plan" value="watch_monthly" />
                <button className="btn-main" type="submit">Subscribe monthly</button>
              </form>
              <form action="/api/stripe/checkout" method="post">
                <input type="hidden" name="plan" value="watch_annual" />
                <button className="btn-line" type="submit" style={{ width: "100%" }}>Subscribe annually</button>
              </form>
            </div>
            <div className="plan">
              <h3>Watch + Advisory</h3>
              <ul>
                <li>Everything in Watch</li>
                <li>Quarterly applicability review with CGM</li>
                <li>A block of question hours</li>
              </ul>
              <a className="btn-line" href="mailto:dan@cgmconsultinggroup.com?subject=Standards%20Watch%20Advisory">Talk to CGM</a>
            </div>
            <div className="plan">
              <h3>Compliance Tracker</h3>
              <ul>
                <li>Standards Watch included</li>
                <li>Tasks, reminders and evidence tracking</li>
                <li>Audit worksheets and reporting forms</li>
              </ul>
              <a className="btn-line" href="mailto:dan@cgmconsultinggroup.com?subject=Compliance%20Tracker">Ask about access</a>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
