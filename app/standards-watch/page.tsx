import WatchView from "@/components/WatchView";
import { loadContent } from "@/lib/content";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Content } from "@/lib/types";

export const dynamic = "force-dynamic";
export const metadata = { title: "Plans" };

/** Public offer page for CGM Standards Watch (subscribe self-serve). The app's front door is the sign-in screen;
 *  this page is for marketing links and the "Standards Watch plans" links. Teaser cards come from live content. */
export default async function StandardsWatchOffer({ searchParams }: { searchParams: { checkout?: string } }) {
  let content: Content | null = null;
  try {
    // Server-side read with the service key, so signed-out visitors see the teaser cards only.
    content = await loadContent(createAdminClient());
  } catch {
    content = null;
  }

  return (
    <main>
      <section className="section wrap watchintro page" id="standards-watch">
        <div className="watchname">CGM Standards Watch</div>
        <h1 className="watchoffer">Know which NERC standards are changing, before they reach you</h1>
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
            <p className="secnote">A few entries from the current CGM Standards Watch. Subscribers see every standard, filtered to their functions.</p>
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
