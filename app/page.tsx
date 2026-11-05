import WatchView from "@/components/WatchView";
import { getViewer } from "@/lib/auth";
import { loadContent } from "@/lib/content";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Content } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Public landing page: what the service is, a three-card teaser from live content, and the plans. */
export default async function Home({ searchParams }: { searchParams: { checkout?: string } }) {
  const viewer = await getViewer().catch(() => null);
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
            <div className="eyebrow">For generation &amp; transmission compliance teams</div>
            <h1>Know which NERC standards are changing, before they reach you</h1>
            <p className="lede">
              Every week CGM Consulting Group reviews NERC and FERC activity and tells you, for your registered functions, what was approved,
              what takes effect next, what is still phasing in, and what to do about each one.
            </p>
            <p style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
              <a className="btn-main" href="#plans">See plans</a>
              {viewer?.hasAccess ? <a className="btn-line" href="/watch">Open Standards Watch</a> : <a className="btn-line" href="/login">Sign in</a>}
            </p>
          </div>
          <div className="next">
            <span className="lbl">What subscribers get</span>
            <span className="what">Weekly reviewed digest</span>
            <span className="sub">Filtered to GO, GOP, TO, TOP, TP or PC</span>
            <span className="what">Live Standards Watch page</span>
            <span className="sub">Effective dates, phase-ins, comment deadlines</span>
            <span className="what">Calendar feed</span>
            <span className="sub">Dates land in Outlook or Google Calendar</span>
          </div>
        </div>
      </section>

      <div className="wrap">
        {searchParams.checkout === "cancelled" && <p className="notice">Checkout was cancelled. Nothing was charged.</p>}
        {content && content.items.length > 0 && (
          <>
            <div className="sechead"><h2>A look at this week</h2></div>
            <p className="secnote">A few entries from the current Standards Watch. Subscribers see every standard, filtered to their functions.</p>
            <WatchView content={content} defaultFunctions={[]} teaser />
          </>
        )}

        <section id="plans" className="section">
          <div className="sechead"><h2>Plans</h2></div>
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
